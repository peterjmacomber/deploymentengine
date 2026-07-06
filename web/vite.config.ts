import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the API so the browser calls same-origin (no CORS in dev) and the
// prod build is host-agnostic.
export default defineConfig({
  plugins: [react()],
  // @de/shared ships TypeScript source; let Vite transpile it instead of pre-bundling.
  optimizeDeps: { exclude: ['@de/shared'] },
  server: {
    port: 5175,
    host: true, // reachable from outside the container
    // Docker-on-Windows/OneDrive bind mounts don't emit native FS events reliably, so HMR
    // can serve stale modules. Poll for changes so edits always hot-reload.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      // In Docker this points at the `server` service; on the host it defaults to localhost.
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:8090', changeOrigin: true },
      '/webhooks': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:8090', changeOrigin: true },
    },
  },
});
