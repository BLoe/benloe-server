import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3009', changeOrigin: true },
    },
  },
  // `vite preview` backs the Playwright run, pointed at the throwaway test API.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: `http://localhost:${process.env.KICKBALL_TEST_PORT ?? 3010}`, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
