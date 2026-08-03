import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.ts on purpose: that one sets `root: 'src/web'` for the
 * browser bundle, which would hide the Node-side tests in test/.
 */
export default defineConfig({
  test: { root: '.', include: ['test/**/*.test.ts'], environment: 'node' },
});
