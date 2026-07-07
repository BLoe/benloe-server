import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// @server aliases the gateway's protocol modules (sse, fold) so the client
// parses and folds with the exact code the server encodes and persists with.
const serverSrc = fileURLToPath(new URL('../server/src', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@server': serverSrc } },
  server: {
    port: 5199,
    proxy: { '/api': 'http://127.0.0.1:3008', '/healthz': 'http://127.0.0.1:3008' },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
