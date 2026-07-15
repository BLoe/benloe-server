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
    // Pin NODE_ENV: vitest inherits an ambient value instead of overriding,
    // and Cabinet's own agent shell carries NODE_ENV=production (PM2 env) —
    // which makes React load its production build, which has no React.act,
    // which fails every component test with "React.act is not a function".
    env: { NODE_ENV: 'development' },
  },
});
