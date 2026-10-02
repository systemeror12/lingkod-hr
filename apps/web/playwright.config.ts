import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { defineConfig, devices } from '@playwright/test';

// Linked worktrees store their own E2E ports in .env (see scripts/setup-worktree.sh).
// Only those keys are read here; the main checkout and CI keep the defaults.
const envFile = resolve(__dirname, '../../.env');
const envFileValues = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
for (const key of ['PLAYWRIGHT_APP_PORT', 'PLAYWRIGHT_API_PORT', 'PLAYWRIGHT_OIDC_PORT']) {
  const value = envFileValues[key];
  if (value && !process.env[key]) process.env[key] = value;
}

const oidcIssuer = `http://127.0.0.1:${process.env.PLAYWRIGHT_OIDC_PORT ?? '4100'}`;
const apiPort = process.env.PLAYWRIGHT_API_PORT ?? '3101';
const appPort = process.env.PLAYWRIGHT_APP_PORT ?? '3100';
const apiUrl = `http://localhost:${apiPort}`;
const appUrl = `http://localhost:${appPort}`;

process.env.OIDC_ISSUER = oidcIssuer;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: appUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm exec tsx e2e/local-oidc.ts',
      url: `${oidcIssuer}/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        OIDC_REDIRECT_URI: `${apiUrl}/api/v1/auth/callback`,
      },
    },
    {
      command:
        'pnpm exec turbo run build --filter=@lingkod-hr/api && pnpm --filter @lingkod-hr/api exec tsx src/main.ts',
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        APP_URL: appUrl,
        API_URL: apiUrl,
        API_PORT: apiPort,
        OIDC_ISSUER: oidcIssuer,
        OIDC_CLIENT_ID: 'local-client',
        OIDC_CLIENT_SECRET: 'local-client-secret',
        OIDC_REDIRECT_URI: `${apiUrl}/api/v1/auth/callback`,
        DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('hex'),
      },
    },
    {
      command: `pnpm exec next dev --hostname 0.0.0.0 --port ${appPort}`,
      url: `http://127.0.0.1:${appPort}/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        APP_URL: appUrl,
        API_URL: apiUrl,
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
