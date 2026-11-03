import { Role, UserStatus } from '@prisma/client';
import { generate } from 'otplib';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { totp } from '../../src/modules/auth/two-factor.js';

import type { Response } from 'supertest';

export const app = createApp();
export const API = '/api/v1';
export const STRONG_PASSWORD = 'Correct-Horse-Battery-42';

/** Parses Set-Cookie headers into name -> value (expired cookies map to ''). */
export function cookiesOf(res: Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, string> = {};
  for (const line of list) {
    const [pair] = line.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (!pair || index < 0) continue;
    out[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
  }
  return out;
}

export function rawSetCookie(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((line) => line.startsWith(`${name}=`));
}

/**
 * Browser-like client: keeps cookies (supertest agent) and sends the CSRF header on
 * state-changing requests, tracking CSRF rotation.
 */
export class TestClient {
  readonly agent = request.agent(app);
  csrf = '';

  static async create(): Promise<TestClient> {
    const client = new TestClient();
    const res = await client.agent.get(`${API}/auth/csrf`);
    client.csrf = (res.body as { data: { csrfToken: string } }).data.csrfToken;
    return client;
  }

  private track(res: Response): Response {
    const rotated = cookiesOf(res).csrf_token;
    if (rotated) this.csrf = rotated;
    return res;
  }

  async get(path: string): Promise<Response> {
    return this.track(await this.agent.get(`${API}${path}`));
  }
  async post(path: string, body?: object): Promise<Response> {
    const req = this.agent.post(`${API}${path}`).set('X-CSRF-Token', this.csrf);
    return this.track(await (body ? req.send(body) : req));
  }
  async patch(path: string, body: object): Promise<Response> {
    return this.track(
      await this.agent.patch(`${API}${path}`).set('X-CSRF-Token', this.csrf).send(body),
    );
  }
  async delete(path: string): Promise<Response> {
    return this.track(await this.agent.delete(`${API}${path}`).set('X-CSRF-Token', this.csrf));
  }

  async login(email: string, password = STRONG_PASSWORD): Promise<Response> {
    return this.post('/auth/login', { email, password });
  }
}

let counter = 0;
export async function createUser(
  overrides: {
    role?: Role;
    email?: string;
    verified?: boolean;
    status?: UserStatus;
    password?: string;
  } = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user${counter}-${Date.now()}@example.com`,
      name: `User ${counter}`,
      passwordHash: await hashPassword(overrides.password ?? STRONG_PASSWORD),
      role: overrides.role ?? Role.CUSTOMER,
      status: overrides.status ?? UserStatus.ACTIVE,
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    },
  });
}

/** Creates a user with TOTP already enabled. Returns the plaintext secret for generating codes. */
export async function createUserWithTwoFactor(role: Role = Role.ADMIN) {
  const user = await createUser({ role });
  const { secret, encrypted } = totp.createSecret();
  await prisma.twoFactorSecret.create({
    data: {
      userId: user.id,
      secretEncrypted: encrypted,
      enabledAt: new Date(),
      backupCodeHashes: [],
    },
  });
  return { user, secret };
}

/** Code for the NEXT/PREVIOUS time step, so tests can log in twice without hitting replay protection. */
export const totpCode = (secret: string, offsetSteps = 0): Promise<string> =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + offsetSteps * 30 });
