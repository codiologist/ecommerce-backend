import { beforeEach, describe, expect, it } from 'vitest';

import { drainJobs } from '../../src/lib/jobs.js';
import { testOutbox } from '../../src/lib/mailer.js';
import { createUser, STRONG_PASSWORD, TestClient } from '../helpers/client.js';
import { resetState } from '../helpers/db.js';

beforeEach(resetState);

const NEW_PASSWORD = 'Another-Strong-Pass-77';

function resetTokenFor(email: string): string {
  const mail = [...testOutbox]
    .reverse()
    .find((m) => m.to === email && m.text.includes('/reset-password'));
  const token = mail?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('no reset email');
  return token;
}

describe('profile', () => {
  it('returns and updates the current user', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    await client.login(user.email);

    const res = await client.patch('/users/me', { name: '  Jane Doe ', phone: '+8801712345678' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Jane Doe', phone: '+8801712345678' });

    const invalid = await client.patch('/users/me', { phone: 'call me' });
    expect(invalid.status).toBe(422);
  });

  it('requires authentication', async () => {
    const client = await TestClient.create();
    expect((await client.get('/users/me')).status).toBe(401);
  });
});

describe('change password', () => {
  it('requires the current password, then revokes other sessions only', async () => {
    const user = await createUser();
    const laptop = await TestClient.create();
    const phone = await TestClient.create();
    await laptop.login(user.email);
    await phone.login(user.email);

    const wrong = await laptop.post('/users/me/change-password', {
      currentPassword: 'not-my-password',
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');

    const ok = await laptop.post('/users/me/change-password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(ok.status).toBe(204);
    expect((await laptop.get('/users/me')).status).toBe(200);
    expect((await phone.get('/users/me')).status).toBe(401);

    await drainJobs();
    expect(testOutbox.some((m) => m.to === user.email && m.subject.includes('changed'))).toBe(true);
    expect((await (await TestClient.create()).login(user.email, NEW_PASSWORD)).status).toBe(200);
  });
});

describe('forgot / reset password', () => {
  it('responds identically for unknown emails and sends nothing', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const known = await client.post('/auth/forgot-password', { email: user.email });
    const unknown = await client.post('/auth/forgot-password', { email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    await drainJobs();
    expect(testOutbox.map((m) => m.to)).toEqual([user.email]);
  });

  it('resets with a single-use token and revokes all sessions', async () => {
    const user = await createUser();
    const session = await TestClient.create();
    await session.login(user.email);

    const client = await TestClient.create();
    await client.post('/auth/forgot-password', { email: user.email });
    await drainJobs();
    const token = resetTokenFor(user.email);

    const weak = await client.post('/auth/reset-password', { token, password: 'password1' });
    expect(weak.status).toBe(422);

    const ok = await client.post('/auth/reset-password', { token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect((await session.get('/users/me')).status).toBe(401);

    const reused = await client.post('/auth/reset-password', {
      token,
      password: 'Yet-Another-Pass-88',
    });
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe('TOKEN_INVALID');

    expect((await (await TestClient.create()).login(user.email)).status).toBe(401);
    expect((await (await TestClient.create()).login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('only the latest reset token is valid', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    await client.post('/auth/forgot-password', { email: user.email });
    await drainJobs();
    const first = resetTokenFor(user.email);
    await client.post('/auth/forgot-password', { email: user.email });
    await drainJobs();
    const second = resetTokenFor(user.email);

    expect(
      (await client.post('/auth/reset-password', { token: first, password: NEW_PASSWORD })).status,
    ).toBe(400);
    expect(
      (await client.post('/auth/reset-password', { token: second, password: NEW_PASSWORD })).status,
    ).toBe(200);
  });
});
