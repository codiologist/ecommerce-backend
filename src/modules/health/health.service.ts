import { healthRepository } from './health.repository.js';

export type HealthStatus = {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  checks: { database: 'up' | 'down' };
};

const DB_CHECK_TIMEOUT_MS = 2_000;

async function checkDatabase(): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      healthRepository.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('db ping timeout'));
        }, DB_CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

export const healthService = {
  async getStatus(): Promise<HealthStatus> {
    const database = await checkDatabase();
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  },
};
