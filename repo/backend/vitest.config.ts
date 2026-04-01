import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    // Integration tests share one PostgreSQL test database — run files
    // sequentially so that clearAllTables() in one file's beforeEach never
    // wipes data that a concurrently running file just inserted.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/db/migrations/**',
        'src/index.ts',
        'src/**/*.d.ts',
      ],
    },
    env: {
      // Override with DATABASE_TEST_URL in .env.test to point at a dedicated
      // retail_hub_test database; falls back to the dev DB if not set.
      DATABASE_URL:
        process.env['DATABASE_TEST_URL'] ??
        'postgresql://postgres:changeme@localhost:5432/retail_hub_test',
      SESSION_SECRET: 'test_session_secret_replace_in_prod_min32chars',
      ENCRYPTION_KEY:
        '0000000000000000000000000000000000000000000000000000000000000000',
      UPLOAD_DIR: '/tmp/retail_hub_test_uploads',
      MAX_IMAGE_SIZE_BYTES: '5242880',
    },
  },
  resolve: {
    alias: {
      '@retail-hub/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
