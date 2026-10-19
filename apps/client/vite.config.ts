import { defineConfig } from 'vite';

/** wrangler dev port (apps/worker). Same-origin paths in dev and production. */
const WORKER = 'http://localhost:8787';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: WORKER, changeOrigin: true },
      '/ws': { target: WORKER, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
