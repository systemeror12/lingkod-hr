// Runs `turbo run test` with the DB-backed integration tests enabled against
// this checkout's .env database. Turbo builds workspace dependencies first.
// Extra arguments go to turbo, so a focused run looks like:
//   pnpm test:db --filter @lingkod-hr/api -- src/auth/global-user-lock.test.ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

// .env sets NODE_ENV=development; vitest sets `test` only when it is unset.
delete process.env.NODE_ENV;
process.env.DATABASE_E2E = 'true';
process.env.DATABASE_E2E_ADMIN_URL ||= process.env.DATABASE_MIGRATION_OWNER_URL ?? '';
if (!process.env.DATABASE_E2E_ADMIN_URL) {
  throw new Error(
    'Set DATABASE_MIGRATION_OWNER_URL in .env; DB-backed tests use it as the admin URL.',
  );
}

const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
