import { execFileSync } from 'node:child_process';

const TEST_DB =
  'postgresql://ecommerce:ecommerce_local_only@127.0.0.1:54329/ecommerce_test?schema=app';

/** Applies migrations to the local test database before the suite runs. */
export default function setup(): void {
  const url = new URL(TEST_DB);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Refusing to run tests against a non-local database');
  }
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: TEST_DB, DIRECT_URL: TEST_DB },
      stdio: 'pipe',
    });
  } catch (err) {
    const output = err instanceof Error && 'stderr' in err ? String(err.stderr) : String(err);
    throw new Error(
      `Could not migrate the test database. Is Docker running? Try: npm run db:up\n${output}`,
      { cause: err },
    );
  }
}
