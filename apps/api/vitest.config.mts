import { defineConfig } from 'vitest/config';

// Real-PostgreSQL integration tests share one database across parallel files.
// Allow headroom above the default five seconds for setup and lock contention.
export default defineConfig({
  test: {
    testTimeout: 15_000,
  },
});
