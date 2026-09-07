import { defineConfig } from 'vitest/config';

// vite.config.ts sets `root: src/web` for the browser bundle; the library tests
// live outside it, so vitest gets its own root rather than inheriting that one.
export default defineConfig({
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
});
