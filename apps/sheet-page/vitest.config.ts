import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The page's unit suites under MAWS's own vitest (the root config lists this file among its projects), built under the
// React Compiler as vite.config.ts builds the page. Under Node, which has the browser's WebSocket; a suite that needs a
// DOM says so with `// @vitest-environment happy-dom`. The page itself is proved in a browser (e2e/).
export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } })],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared'), '@artifacts': resolve(import.meta.dirname, '../../src/artifacts') } },
  test: {
    name: 'sheet-page',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['../../test/support/artifacts-dom-setup.ts'], // KaTeX's one quirks-mode advisory, under happy-dom, dropped
    env: { LC_ALL: 'ko_KR.UTF-8', LANG: 'ko_KR.UTF-8' },
  },
});
