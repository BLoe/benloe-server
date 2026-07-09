import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Separate from vite.config so the SSR/browser build config doesn't pull the
// test-only jsdom environment. jsdom for component tests; node for the rest.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@server': fileURLToPath(new URL('../server/src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    globals: true,
  },
});
