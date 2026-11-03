import { logger } from './logger.js';

/**
 * Minimal in-process background jobs (fire-and-forget after the response).
 * Used so that e.g. "email exists" and "email unknown" take the same time to respond.
 * Replace with a durable queue (BullMQ) if/when needed - see PROGRESS.md.
 */
const pending = new Set<Promise<void>>();

export function enqueue(name: string, task: () => Promise<void>): void {
  const run = new Promise<void>((resolve) => {
    setImmediate(() => {
      task()
        .catch((err: unknown) => {
          logger.error({ err, job: name }, 'Background job failed');
        })
        .finally(resolve);
    });
  });
  pending.add(run);
  void run.finally(() => pending.delete(run));
}

/** Wait for all queued jobs (tests and graceful shutdown). */
export async function drainJobs(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}
