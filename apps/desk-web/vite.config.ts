import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The desk's web app, built to dist/ for the hub's Worker to serve as static assets (single-page fallback; the Worker
// first on /api/* and /machine/*). `pnpm --filter desk-web dev` proxies /api — the HTTP calls and the two sockets — to
// a local hub at DESK_HUB_URL (DC3's local runtime, or the DX3 double), so the app talks to it as it will in production.
const hub = process.env.DESK_HUB_URL ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The depth column (DC6) imports MAWS's transcript and backfill, which reach MAWS's shared modules by these aliases.
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared'), '@artifacts': resolve(import.meta.dirname, '../../src/artifacts') } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: hub, ws: true, changeOrigin: true } } },
});
