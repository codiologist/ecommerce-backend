import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { sha256 } from '../../src/lib/crypto.js';
import { prisma } from '../../src/lib/prisma.js';
import { API, app, cookiesOf, createUser, TestClient } from '../helpers/client.js';
import { resetState } from '../helpers/db.js';

beforeEach(resetState);

/** Calls /auth/refresh with an explicit refresh token (simulates a stolen/replayed cookie). */
async function refreshWith(refreshToken: string) {
  const csrf = await request(app).get(`${API}/auth/csrf`);
  const token = cookiesOf(csrf).csrf_token ?? '';
  return request(app)
    .post(`${API}/auth/refresh`)
    .set('Cookie', [`csrf_token=${token}`, `refresh_token=${refreshToken}`])
    .set('X-CSRF-Token', token);
}

describe('refresh token rotation', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const login = await client.login(user.email);
    const firstRefresh = cookiesOf(login).refresh_token ?? '';

    const res = await client.post('/auth/refresh');
    expect(res.status).toBe(204);
    const cookies = cookiesOf(res);
    expect(cookies.access_token).toBeTruthy();
    expect(cookies.refresh_token).toBeTruthy();
    expect(cookies.refresh_token).not.toBe(firstRefresh);

    const old = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: sha256(firstRefresh) },
    });
    expect(old.revokedReason).toBe('ROTATED');
    expect((await client.get('/users/me')).status).toBe(200);
  });

  it('keeps the absolute session expiry on rotation', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    await client.login(user.email);
    const [first] = await prisma.session.findMany({ where: { userId: user.id } });
    await client.post('/auth/refresh');
    const rows = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.expiresAt.getTime()).toBe(first?.expiresAt.getTime());
  });

  it('treats a replay within the grace window as a benign race (two tabs)', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const login = await client.login(user.email);
    const original = cookiesOf(login).refresh_token ?? '';
    await client.post('/auth/refresh'); // tab A rotates

    const tabB = await refreshWith(original); // tab B sends the same (now rotated) token
    expect(tabB.status).toBe(204);
    expect(cookiesOf(tabB).access_token).toBeTruthy();
    expect(cookiesOf(tabB).refresh_token).toBeUndefined(); // no new refresh token issued
    expect((await client.get('/users/me')).status).toBe(200); // family still alive
  });

  it('revokes the whole family when a rotated token is reused later (theft) and audits it', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const login = await client.login(user.email);
    const stolen = cookiesOf(login).refresh_token ?? '';
    await client.post('/auth/refresh');

    // Move the rotation outside the grace window.
    await prisma.session.update({
      where: { tokenHash: sha256(stolen) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const attacker = await refreshWith(stolen);
    expect(attacker.status).toBe(401);
    expect(attacker.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate user's session (same family) is gone too.
    const me = await client.get('/users/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.refresh_token_reuse', actorId: user.id },
      }),
    ).toBe(1);
  });

  it('rejects unknown refresh tokens and clears cookies', async () => {
    const res = await refreshWith('not-a-real-token-at-all-xxxxxxxxxxxx');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    expect(cookiesOf(res).access_token).toBe('');
  });
});

describe('access token verification', () => {
  it('rejects tampered and alg:none tokens', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const login = await client.login(user.email);
    const access = cookiesOf(login).access_token ?? '';
    const [, payload] = access.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
    const tampered = `${access.slice(0, -4)}AAAA`;

    for (const token of [none, tampered]) {
      const res = await request(app).get(`${API}/users/me`).set('Cookie', `access_token=${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('applies blocking immediately, even with a still-valid access token', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    await client.login(user.email);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'BLOCKED' } });
    const res = await client.get('/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('logout', () => {
  it('logout revokes the session; the refresh token stops working', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const login = await client.login(user.email);
    const refresh = cookiesOf(login).refresh_token ?? '';

    const res = await client.post('/auth/logout');
    expect(res.status).toBe(204);
    expect(cookiesOf(res).access_token).toBe('');
    expect((await client.get('/users/me')).status).toBe(401);
    expect((await refreshWith(refresh)).status).toBe(401);
  });

  it('logout-all signs out every device', async () => {
    const user = await createUser();
    const laptop = await TestClient.create();
    const phone = await TestClient.create();
    await laptop.login(user.email);
    await phone.login(user.email);

    expect((await laptop.post('/auth/logout-all')).status).toBe(204);
    expect((await phone.get('/users/me')).status).toBe(401);
    expect((await laptop.get('/users/me')).status).toBe(401);
  });
});

describe('active sessions', () => {
  it('lists sessions, marks the current one and revokes another device', async () => {
    const user = await createUser();
    const laptop = await TestClient.create();
    const phone = await TestClient.create();
    await laptop.login(user.email);
    await phone.login(user.email);

    const list = await laptop.get('/users/me/sessions');
    expect(list.status).toBe(200);
    const sessions = list.body.data as { id: string; current: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const other = sessions.find((s) => !s.current);
    expect((await laptop.delete(`/users/me/sessions/${other?.id ?? ''}`)).status).toBe(204);
    expect((await phone.get('/users/me')).status).toBe(401);
    expect((await laptop.get('/users/me')).status).toBe(200);
  });

  it("cannot see or revoke another user's session (IDOR)", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceClient = await TestClient.create();
    const bobClient = await TestClient.create();
    await aliceClient.login(alice.email);
    await bobClient.login(bob.email);
    const bobSession = await prisma.session.findFirstOrThrow({ where: { userId: bob.id } });

    const list = await aliceClient.get('/users/me/sessions');
    expect((list.body.data as { id: string }[]).map((s) => s.id)).not.toContain(
      bobSession.familyId,
    );

    const res = await aliceClient.delete(`/users/me/sessions/${bobSession.familyId}`);
    expect(res.status).toBe(404);
    expect((await bobClient.get('/users/me')).status).toBe(200);
  });

  it('validates the session id', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    await client.login(user.email);
    const res = await client.delete('/users/me/sessions/not-a-uuid');
    expect(res.status).toBe(422);
  });
});
