import { defineConfig } from 'vitest/config';

// The package's suites under MAWS's own vitest (its root config lists this file among its projects): the vectors
// replayed in Node, and again in workerd through Miniflare, as the hub's Worker runs them.
export default defineConfig({
  test: {
    name: 'org-protocol',
    root: import.meta.dirname,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The workerd suite starts a workerd process; under the Mac's load rule that start can take seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
