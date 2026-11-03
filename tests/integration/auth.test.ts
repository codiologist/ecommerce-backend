import { Role, UserStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainJobs } from '../../src/lib/jobs.js';
import { testOutbox } from '../../src/lib/mailer.js';
import { prisma } from '../../src/lib/prisma.js';
import { turnstile } from '../../src/lib/turnstile.js';
import { LOGIN_PROTECTION } from '../../src/modules/auth/login-protection.js';
import {
  API,
  app,
  createUser,
  rawSetCookie,
  STRONG_PASSWORD,
  TestClient,
} from '../helpers/client.js';
import { resetState } from '../helpers/db.js';

const originalDelays = { base: LOGIN_PROTECTION.baseDelayMs, max: LOGIN_PROTECTION.maxDelayMs };

beforeEach(async () => {
  await resetState();
  LOGIN_PROTECTION.baseDelayMs = 1;
  LOGIN_PROTECTION.maxDelayMs = 2;
});
afterAll(() => {
  LOGIN_PROTECTION.baseDelayMs = originalDelays.base;
  LOGIN_PROTECTION.maxDelayMs = originalDelays.max;
});

const tokenFromOutbox = (to: string, path: string): string => {
  const mail = [...testOutbox].reverse().find((m) => m.to === to && m.text.includes(path));
  const match = mail?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error(`No ${path} email for ${to}`);
  return match[1];
};

describe('CSRF protection', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a header that matches the cookie but is not signed by the server', async () => {
    const forged = 'forged.value';
    const res = await request(app)
      .post(`${API}/auth/login`)
      .set('Cookie', `csrf_token=${forged}`)
      .set('X-CSRF-Token', forged)
      .send({ email: 'a@b.co', password: 'x' });
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a valid token from a disallowed Origin', async () => {
    const client = await TestClient.create();
    const res = await client.agent
      .post(`${API}/auth/login`)
      .set('X-CSRF-Token', client.csrf)
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.co', password: 'x' });
    // CORS rejects first for browsers; the CSRF origin check is the second line of defence.
    expect(res.status).toBe(403);
  });

  it('issues a non-HttpOnly csrf_token cookie', async () => {
    const res = await request(app).get(`${API}/auth/csrf`);
    const cookie = rawSetCookie(res, 'csrf_token');
    expect(cookie).toBeDefined();
    expect(cookie).not.toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });
});

describe('POST /auth/register', () => {
  it('creates a CUSTOMER, ignores mass-assigned fields and sends a verification email', async () => {
    const client = await TestClient.create();
    const res = await client.post('/auth/register', {
      email: '  New.User@Example.com ',
      password: STRONG_PASSWORD,
      name: 'New User',
      role: 'ADMIN',
      emailVerifiedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
    await drainJobs();

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new.user@example.com' } });
    expect(user.role).toBe(Role.CUSTOMER);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(testOutbox.some((m) => m.to === user.email && m.subject.includes('Verify'))).toBe(true);
  });

  it('returns the same response for an existing email (no enumeration) and notifies the owner', async () => {
    const existing = await createUser({ email: 'taken@example.com' });
    const client = await TestClient.create();
    const fresh = await client.post('/auth/register', {
      email: 'fresh@example.com',
      password: STRONG_PASSWORD,
      name: 'A',
    });
    const taken = await client.post('/auth/register', {
      email: existing.email,
      password: STRONG_PASSWORD,
      name: 'B',
    });

    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
    await drainJobs();
    expect(testOutbox.find((m) => m.to === existing.email)?.subject).toMatch(/Sign-up attempt/);
    expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1);
  });

  it.each([
    ['too short', 'Ab1!'],
    ['common', 'password123'],
    ['contains email', 'jsmith-secure-99'],
  ])('rejects a %s password with 422', async (_label, password) => {
    const client = await TestClient.create();
    const res = await client.post('/auth/register', {
      email: 'jsmith@example.com',
      password,
      name: 'J',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('body.password');
  });

  it('rejects when CAPTCHA verification fails', async () => {
    vi.spyOn(turnstile, 'verify').mockResolvedValue(false);
    const client = await TestClient.create();
    const res = await client.post('/auth/register', {
      email: 'bot@example.com',
      password: STRONG_PASSWORD,
      name: 'Bot',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CAPTCHA_FAILED');
  });
});

describe('email verification', () => {
  it('verifies with a single-use token', async () => {
    const client = await TestClient.create();
    await client.post('/auth/register', {
      email: 'verify@example.com',
      password: STRONG_PASSWORD,
      name: 'V',
    });
    await drainJobs();
    const token = tokenFromOutbox('verify@example.com', '/verify-email');

    const first = await client.post('/auth/verify-email', { token });
    expect(first.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'verify@example.com' } });
    expect(user.emailVerifiedAt).not.toBeNull();

    const second = await client.post('/auth/verify-email', { token });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('TOKEN_INVALID');
  });

  it('resend-verification responds identically for unknown emails', async () => {
    await createUser({ email: 'unverified@example.com', verified: false });
    const client = await TestClient.create();
    const known = await client.post('/auth/resend-verification', {
      email: 'unverified@example.com',
    });
    const unknown = await client.post('/auth/resend-verification', { email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    await drainJobs();
    expect(testOutbox.map((m) => m.to)).toEqual(['unverified@example.com']);
  });
});

describe('POST /auth/login', () => {
  it('sets HttpOnly auth cookies with the right attributes and returns a safe user object', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const res = await client.login(user.email);

    expect(res.status).toBe(200);
    expect(res.body.data.twoFactorRequired).toBe(false);
    expect(res.body.data.user).toMatchObject({ id: user.id, email: user.email, role: 'CUSTOMER' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

    const access = rawSetCookie(res, 'access_token') ?? '';
    const refresh = rawSetCookie(res, 'refresh_token') ?? '';
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Strict/i);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);

    const me = await client.get('/users/me');
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(user.email);
  });

  it('returns the same error for unknown email and wrong password', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const wrong = await client.login(user.email, 'Wrong-Password-123');
    const unknown = await client.login('nobody@example.com', 'Wrong-Password-123');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect({ ...unknown.body.error, requestId: '' }).toEqual({
      ...wrong.body.error,
      requestId: '',
    });
  });

  it('requires CAPTCHA after 3 failures and locks the account after 10', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    for (let i = 0; i < 3; i += 1) await client.login(user.email, 'Wrong-Password-123');

    const noCaptcha = await client.login(user.email, 'Wrong-Password-123');
    expect(noCaptcha.status).toBe(403);
    expect(noCaptcha.body.error.code).toBe('CAPTCHA_REQUIRED');

    for (let i = 3; i < 10; i += 1) {
      const res = await client.post('/auth/login', {
        email: user.email,
        password: 'Wrong-Password-123',
        turnstileToken: 'test-token',
      });
      expect(res.status).toBe(401);
    }

    const locked = await client.post('/auth/login', {
      email: user.email,
      password: STRONG_PASSWORD, // correct password is still refused while locked
      turnstileToken: 'test-token',
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    const actions = await prisma.auditLog.findMany({
      where: { actorId: user.id },
      select: { action: true },
    });
    expect(actions.filter((a) => a.action === 'auth.login_failed')).toHaveLength(10);
    expect(actions.some((a) => a.action === 'auth.account_locked')).toBe(true);
  });

  it('locks unknown emails the same way (no enumeration via lockout)', async () => {
    const client = await TestClient.create();
    for (let i = 0; i < 10; i += 1) {
      await client.post('/auth/login', {
        email: 'ghost@example.com',
        password: 'Nope-12345',
        turnstileToken: 't',
      });
    }
    const res = await client.post('/auth/login', {
      email: 'ghost@example.com',
      password: 'Nope-12345',
      turnstileToken: 't',
    });
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('only reveals a blocked account after a correct password', async () => {
    const user = await createUser({ status: UserStatus.BLOCKED });
    const client = await TestClient.create();
    expect((await client.login(user.email, 'Wrong-Password-123')).body.error.code).toBe(
      'INVALID_CREDENTIALS',
    );
    const res = await client.login(user.email);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('rotates the CSRF token on login', async () => {
    const user = await createUser();
    const client = await TestClient.create();
    const before = client.csrf;
    await client.login(user.email);
    expect(client.csrf).not.toBe(before);
    expect((await client.patch('/users/me', { name: 'Still works' })).status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After after too many password-reset requests', async () => {
    const client = await TestClient.create();
    let last = await client.post('/auth/forgot-password', { email: 'a@example.com' });
    for (let i = 0; i < 10; i += 1)
      last = await client.post('/auth/forgot-password', { email: 'a@example.com' });
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('RATE_LIMITED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
  });
});
