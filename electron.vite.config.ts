import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Rollup } from 'vite';

const alias = { '@shared': resolve(__dirname, 'src/shared') };
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

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

  // carried by C9 until the rebase over C6 (wave-2 ledger d.13): the harness page (src/renderer/harness.html) is a second
  // renderer entry, built by the dev server or under MAWS_HARNESS=1 only, so a production build never contains it
  const harnessInput =
    command === 'serve' || process.env.MAWS_HARNESS === '1'
      ? { index: resolve(__dirname, 'src/renderer/index.html'), harness: resolve(__dirname, 'src/renderer/harness.html') }
      : null;
  // carried by C9 until the rebase over C6 (wave-2 ledger d.13)

  return {
    // The host entries are bundled with this config through `?modulePath` (src/main/hosts/index.ts), so they share
    // its aliases, defines and externals: node-pty stays a real file under node_modules, for `asarUnpack`.
    main: {
      resolve: { alias },
      define: { __MAWS_DEV_CSP_NONCE__: JSON.stringify(devNonce), __MAWS_VERSION__: JSON.stringify(version) },
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
      build: { rollupOptions: harnessInput ? { ...rollupOptions, input: harnessInput } : rollupOptions }, // carried by C9 until the rebase over C6: harness input
      plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
    },
  };
});
