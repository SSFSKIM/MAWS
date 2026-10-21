import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The web app's suites under MAWS's own vitest, as the hub's are (MAWS's root config lists this file among its
// projects, so `pnpm test` reaches them). They run under Node, which has the browser's WebSocket and WebCrypto and
// runs the DX3 double in-process; a suite that needs a DOM says so with `// @vitest-environment happy-dom`. The views
// are proved in a browser (e2e/). The depth column (DC6) imports MAWS's transcript model, store, and backfill, which
// reach MAWS's shared modules through its `@shared` and `@artifacts` aliases.
//
// Built under the React Compiler as vite.config.ts builds the app (and electron.vite.config.ts MAWS's renderer), so
// every component and hook a suite renders, the desk's own and MAWS's, runs as it ships.
//
// English throughout (P4 Decision Log 4): the suites run under the owner's Korean system locale, as MAWS's renderer
// suites do (../../vitest.config.ts), so every time and count they expect in English is shown to be English whatever
// the browser's locale; Node reads its Intl default from LC_ALL, then LANG, as a worker starts. MAWS's happy-dom setup
// drops KaTeX's one quirks-mode advisory, which the depth column's suites raise through MAWS's Markdown.
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared'), '@artifacts': resolve(import.meta.dirname, '../../src/artifacts') } },
  test: {
    name: 'desk-web',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
    env: { LC_ALL: 'ko_KR.UTF-8', LANG: 'ko_KR.UTF-8' },
    setupFiles: [resolve(import.meta.dirname, '../../test/support/artifacts-dom-setup.ts')],
  },
});
