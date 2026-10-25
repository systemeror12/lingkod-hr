import { defineConfig } from 'vitest/config';

// Real-PostgreSQL integration tests share one database across parallel files.
// Allow headroom above the default five seconds for setup and lock contention.
// The config package has no key defaults, so tests supply test-only keys here;
// they win over any value in .env, keeping runs independent of local secrets.
export default defineConfig({
  test: {
    testTimeout: 15_000,
    env: {
      DATA_ENCRYPTION_KEY: '07'.repeat(32),
      BLIND_INDEX_KEY: 'test-only-blind-index-key-not-for-real-data',
    },
  },
});
