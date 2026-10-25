import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Starts one in-memory MongoDB replica set for the whole run (transactions need a replica set).
    globalSetup: ['./test/setup/global-setup.ts'],
    // Runs before each test file: own database, connection, index creation, cleanup.
    setupFiles: ['./test/setup/per-file.ts'],
    // Read by src/config/env.ts. MONGODB_URI is replaced by per-file.ts before the app loads.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGODB_URI: 'mongodb://placeholder-set-by-per-file-setup',
    },
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
