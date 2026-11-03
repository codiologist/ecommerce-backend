import { Role } from '@prisma/client';
import { generate } from 'otplib';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import {
  createUser,
  createUserWithTwoFactor,
  STRONG_PASSWORD,
  TestClient,
  totpCode,
} from '../helpers/client.js';
import { resetState } from '../helpers/db.js';

beforeEach(resetState);

async function loginWithTwoFactor(client: TestClient, email: string, code: string) {
  const first = await client.login(email);
  expect(first.body.data).toMatchObject({ twoFactorRequired: true });
  return client.post('/auth/login/2fa', {
    challengeId: first.body.data.challengeId as string,
    code,
  });
}

describe('RBAC on admin routes (permission-denied tests, §9)', () => {
  it('returns 401 without a session', async () => {
    const client = await TestClient.create();
    const res = await client.get('/admin/session');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a CUSTOMER', async () => {
    const customer = await createUser({ role: Role.CUSTOMER });
    const client = await TestClient.create();
    await client.login(customer.email);
    const res = await client.get('/admin/session');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a CUSTOMER cannot escalate their role via PATCH /users/me', async () => {
    const customer = await createUser();
    const client = await TestClient.create();
    await client.login(customer.email);
    const res = await client.patch('/users/me', { name: 'x', role: 'SUPER_ADMIN' });
    expect(res.status).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).role).toBe(
      Role.CUSTOMER,
    );
  });

  it.each([Role.STAFF, Role.ADMIN, Role.SUPER_ADMIN])(
    '%s without 2FA is told to set it up',
    async (role) => {
      const admin = await createUser({ role });
      const client = await TestClient.create();
      await client.login(admin.email);
      const res = await client.get('/admin/session');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    },
  );
});

describe('2FA setup (mandatory for admins)', () => {
  it('admin sets up TOTP, gets backup codes once, then can access admin routes', async () => {
    const admin = await createUser({ role: Role.ADMIN });
    const client = await TestClient.create();
    await client.login(admin.email);

    const setup = await client.post('/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret = setup.body.data.secret as string;

    const stored = await prisma.twoFactorSecret.findUniqueOrThrow({ where: { userId: admin.id } });
    expect(stored.secretEncrypted).not.toContain(secret); // encrypted at rest

    const wrong = await client.post('/auth/2fa/enable', { code: '000000' });
    expect(wrong.status).toBe(400);

    const enable = await client.post('/auth/2fa/enable', { code: await generate({ secret }) });
    expect(enable.status).toBe(200);
    expect(enable.body.data.backupCodes).toHaveLength(10);

    const access = await client.get('/admin/session');
    expect(access.status).toBe(200);
    expect(access.body.data).toMatchObject({ role: 'ADMIN', twoFactorVerified: true });
  });

  it('cannot run setup again once enabled', async () => {
    const { user } = await createUserWithTwoFactor(Role.CUSTOMER);
    await prisma.twoFactorSecret.update({ where: { userId: user.id }, data: { enabledAt: null } });
    const client = await TestClient.create();
    await client.login(user.email);
    await prisma.twoFactorSecret.update({
      where: { userId: user.id },
      data: { enabledAt: new Date() },
    });
    const res = await client.post('/auth/2fa/setup');
    expect(res.status).toBe(409);
  });
});

describe('2FA login', () => {
  it('requires a TOTP code; no cookies are set before it', async () => {
    const { user, secret } = await createUserWithTwoFactor(Role.ADMIN);
    const client = await TestClient.create();
    const first = await client.login(user.email);
    expect(first.status).toBe(200);
    expect(first.body.data.twoFactorRequired).toBe(true);
    expect(first.headers['set-cookie']?.toString() ?? '').not.toMatch(/access_token=/);

    const bad = await client.post('/auth/login/2fa', {
      challengeId: first.body.data.challengeId as string,
      code: '123456',
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('TWO_FACTOR_CODE_INVALID');

    const ok = await client.post('/auth/login/2fa', {
      challengeId: first.body.data.challengeId as string,
      code: await totpCode(secret),
    });
    expect(ok.status).toBe(200);
    expect((await client.get('/admin/session')).status).toBe(200);
  });

  it('rejects a replayed TOTP code', async () => {
    const { user, secret } = await createUserWithTwoFactor(Role.ADMIN);
    const code = await totpCode(secret);
    expect((await loginWithTwoFactor(await TestClient.create(), user.email, code)).status).toBe(
      200,
    );
    const replay = await loginWithTwoFactor(await TestClient.create(), user.email, code);
    expect(replay.status).toBe(401);
  });

  it('invalidates the challenge after 5 wrong attempts', async () => {
    const { user, secret } = await createUserWithTwoFactor(Role.ADMIN);
    const client = await TestClient.create();
    const first = await client.login(user.email);
    const challengeId = first.body.data.challengeId as string;
    for (let i = 0; i < 5; i += 1)
      await client.post('/auth/login/2fa', { challengeId, code: '000000' });
    const res = await client.post('/auth/login/2fa', { challengeId, code: await totpCode(secret) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TWO_FACTOR_CHALLENGE_INVALID');
  });

  it('accepts each backup code exactly once', async () => {
    const admin = await createUser({ role: Role.ADMIN });
    const client = await TestClient.create();
    await client.login(admin.email);
    const secret = (await client.post('/auth/2fa/setup')).body.data.secret as string;
    const codes = (await client.post('/auth/2fa/enable', { code: await totpCode(secret) })).body
      .data.backupCodes as string[];

    const use = async () => {
      const c = await TestClient.create();
      const first = await c.login(admin.email);
      return c.post('/auth/login/2fa', {
        challengeId: first.body.data.challengeId as string,
        backupCode: codes[0],
      });
    };
    expect((await use()).status).toBe(200);
    expect((await use()).status).toBe(401);
  });
});

describe('re-authentication and 2FA disable', () => {
  it('disabling 2FA needs reauth, and is refused for admin roles', async () => {
    const { user, secret } = await createUserWithTwoFactor(Role.ADMIN);
    const client = await TestClient.create();
    await loginWithTwoFactor(client, user.email, await totpCode(secret, -1));

    const noReauth = await client.post('/auth/2fa/disable');
    expect(noReauth.status).toBe(403);
    expect(noReauth.body.error.code).toBe('REAUTH_REQUIRED');

    const missingCode = await client.post('/auth/reauth', { password: STRONG_PASSWORD });
    expect(missingCode.body.error.code).toBe('TWO_FACTOR_CODE_REQUIRED');
    expect(
      (
        await client.post('/auth/reauth', {
          password: STRONG_PASSWORD,
          code: await totpCode(secret, 1),
        })
      ).status,
    ).toBe(204);

    const res = await client.post('/auth/2fa/disable');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TWO_FACTOR_REQUIRED_FOR_ROLE');
  });

  it('a customer can disable 2FA after reauth', async () => {
    const { user, secret } = await createUserWithTwoFactor(Role.CUSTOMER);
    const client = await TestClient.create();
    await loginWithTwoFactor(client, user.email, await totpCode(secret, -1));
    expect((await client.post('/auth/reauth', { password: 'wrong-password-1' })).status).toBe(401);
    await client.post('/auth/reauth', { password: STRONG_PASSWORD, code: await totpCode(secret) });
    expect((await client.post('/auth/2fa/disable')).status).toBe(204);
    expect(await prisma.twoFactorSecret.count({ where: { userId: user.id } })).toBe(0);
  });
});
