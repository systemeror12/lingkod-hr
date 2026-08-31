import { defineConfig, devices } from '@playwright/test';

const oidcIssuer = 'http://127.0.0.1:4100';
const apiUrl = 'http://localhost:3101';
const appUrl = 'http://localhost:3100';

process.env.OIDC_ISSUER = oidcIssuer;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
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
      command: 'pnpm --filter @lingkod-hr/api dev',
      url: `${apiUrl}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        APP_URL: appUrl,
        API_URL: apiUrl,
        API_PORT: '3101',
        OIDC_ISSUER: oidcIssuer,
        OIDC_CLIENT_ID: 'local-client',
        OIDC_CLIENT_SECRET: 'local-client-secret',
        OIDC_REDIRECT_URI: `${apiUrl}/api/v1/auth/callback`,
      },
    },
    {
      command: 'pnpm exec next dev --hostname 0.0.0.0 --port 3100',
      url: `${appUrl}/health`,
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
