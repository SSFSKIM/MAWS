import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The web app's suites under MAWS's own vitest, as the hub's are (MAWS's root config lists this file among its
// projects, so `pnpm test` reaches them). They run under Node, which has the browser's WebSocket and WebCrypto and
// runs the DX3 double in-process; a suite that needs a DOM says so with `// @vitest-environment happy-dom`. The views
// are proved in a browser (e2e/).
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared') } },
  test: {
    name: 'desk-web',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
  },
});
