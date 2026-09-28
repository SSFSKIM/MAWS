import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Rollup } from 'vite';

const alias = { '@shared': resolve(__dirname, 'src/shared') };

// zod 4.6.5's sources carry explanatory comments beside `@__PURE__` annotations that Rollup reports as
// INVALID_ANNOTATION on every bundle that includes zod (the preload and the renderer). Harmless; dropped so a real
// warning is not lost among them. Every other warning passes through.
const rollupOptions = {
  onwarn(warning: Rollup.RollupLog, warn: (warning: Rollup.RollupLog) => void) {
    if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/node_modules/zod/')) return;
    warn(warning);
  },
};

export default defineConfig(({ command }) => {
  // Development CSP nonce: minted once per evaluation of this file and handed to both sides, to the dev server's
  // HTML (Vite stamps it on every script and style tag, including plugin-react's inline fast-refresh preamble) and
  // to main's CSP header. A build defines it as null and stamps nothing, so production carries no nonce at all.
  const devNonce = command === 'serve' ? randomBytes(16).toString('base64') : null;

  return {
    main: {
      resolve: { alias },
      define: { __MAWS_DEV_CSP_NONCE__: JSON.stringify(devNonce) },
    },
    preload: {
      resolve: { alias },
      // A sandboxed preload's `require` loads only `electron`, `events`, `timers` and `url`, so zod and the registries
      // the allowlist imports must be bundled into out/preload/index.js; only `electron` stays external.
      build: { externalizeDeps: false, rollupOptions },
    },
    renderer: {
      resolve: { alias },
      html: devNonce ? { cspNonce: devNonce } : undefined,
      build: { rollupOptions },
      plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
    },
  };
});
