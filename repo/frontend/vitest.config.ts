import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    // jsdom provides a browser-like DOM environment for service/utility tests.
    // Angular component rendering tests require @analogjs/vitest-angular —
    // add it when full component test coverage is needed.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/main.ts',
        'src/environments/**',
        'src/**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@retail-hub/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
