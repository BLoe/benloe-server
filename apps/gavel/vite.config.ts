import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  publicDir: '../../public',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    port: 5313,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3013' },
  },
});
