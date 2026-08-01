import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  publicDir: '../../public',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    port: 5310,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3010' },
  },
});
