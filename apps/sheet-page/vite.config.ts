import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Every dynamic import of a chunk in the build calls the page's chunk gate instead (src/chunk-gate.ts; T28): the
// Markdown stack's lazy parts (a grammar, a theme, the diagram renderer and its kinds) are asked for only while the tab's
// connection is proven. Only an import of a chunk is rewritten: the gate's own import of a computed URL has no target,
// so it stays the browser's. Vite's dependency preloads would fetch a chunk's imports past the gate, so there are none
// (`modulePreload: false`); the browser fetches them as the gated import asks.
const CHUNK_GATE_GLOBAL = '__sheetChunk'; // chunk-gate.ts's, which installs it before any chunk can be asked for
const gateDynamicImports = (): Plugin => ({
  name: 'sheet-page:gate-dynamic-imports',
  apply: 'build',
  renderDynamicImport: ({ targetModuleId }) => (targetModuleId === null ? null : { left: `${CHUNK_GATE_GLOBAL}(import.meta.url,`, right: ')' }),
});

// The question sheet's local page (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §P; T23), built as
// desk-web is (apps/desk-web/vite.config.ts): the React plugin under the React Compiler, Tailwind's plugin, and the
// aliases MAWS's renderer modules need, so the page ships the same configuration of them. Built into the repository's
// out/sheet-page/, which the Mac app's archive includes and the Linux pack copies, and where `mawsd` finds it, one
// directory above its own entry. Not under out/main: the bundle guard reads every .js file there as a main-process
// file. No service worker (T19), no proxy, no source maps; the built index.html names its script and its stylesheet as
// files, since the page server's content policy allows no inline script.
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss(), gateDynamicImports()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, '../../src/shared'),
      '@artifacts': resolve(import.meta.dirname, '../../src/artifacts'),
      'shiki/wasm': resolve(import.meta.dirname, 'src/vendor/shiki-wasm-unused.ts'),
      lowlight: resolve(import.meta.dirname, '../../src/renderer/src/tools/code/review/lowlight-no-grammars.mjs'),
      'lowlight-engine': resolve(createRequire(resolve(import.meta.dirname, '../../package.json')).resolve('lowlight'), '../lib/index.js'),
    },
  },
  build: { outDir: resolve(import.meta.dirname, '../../out/sheet-page'), emptyOutDir: true, sourcemap: false, modulePreload: false },
});
