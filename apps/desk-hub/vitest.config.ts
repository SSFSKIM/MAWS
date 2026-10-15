import { defineConfig } from 'vitest/config';

// The hub's suites under MAWS's own vitest (the DC3 plan's M1 decision): they run in Node, and the Worker suites reach
// the Worker and its Durable Objects on workerd through Miniflare, which test/support/hub.ts starts from wrangler.jsonc.
// MAWS's root config lists this file among its projects, so `pnpm test` and its `--maxWorkers` reach these suites.
export default defineConfig({
  test: {
    name: 'desk-hub',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/bundle.ts'],
    // Each Worker suite starts a workerd process; under the Mac's load rule that start can take seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
