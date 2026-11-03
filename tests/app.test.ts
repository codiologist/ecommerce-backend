import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { healthRepository } from '../src/modules/health/health.repository.js';

const app = createApp();

describe('GET /api/v1/health', () => {
  beforeEach(() => {
    vi.spyOn(healthRepository, 'ping').mockResolvedValue();
  });

  it('returns the standard success envelope when the DB is up', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', checks: { database: 'up' } },
    });
    const data = res.body.data as { uptime: unknown; timestamp: string };
    expect(typeof data.uptime).toBe('number');
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });

  it('returns 503 degraded when the DB is down, without leaking the error', async () => {
    vi.spyOn(healthRepository, 'ping').mockRejectedValue(
      new Error('connection refused at 10.0.0.1'),
    );
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.data).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
  });
});

describe('security headers', () => {
  beforeEach(() => {
    vi.spyOn(healthRepository, 'ping').mockResolvedValue();
  });

  it('sets helmet headers, no-store and hides x-powered-by', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('request id', () => {
  beforeEach(() => {
    vi.spyOn(healthRepository, 'ping').mockResolvedValue();
  });

  it('generates an X-Request-Id when absent', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a safe incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'edge-abc123456');
    expect(res.headers['x-request-id']).toBe('edge-abc123456');
  });

  it('replaces an unsafe incoming X-Request-Id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id<script>');
    expect(res.headers['x-request-id']).not.toBe('bad id<script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error handling', () => {
  it('returns standard error format for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route GET /api/v1/does-not-exist not found',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects bodies over 100kb with 413', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(110 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects unexpected Content-Type with 415', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('CORS', () => {
  beforeEach(() => {
    vi.spyOn(healthRepository, 'ping').mockResolvedValue();
  });

  it('allows an allowlisted origin with credentials', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects a non-allowlisted origin with 403 and no CORS headers', async () => {
    const res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_DENIED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
