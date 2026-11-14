import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `pnpm build` writes one self-contained dist/index.html, so the lab opens by double-click (file://) with no server.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: 'esnext', chunkSizeWarningLimit: 5000 },
});
