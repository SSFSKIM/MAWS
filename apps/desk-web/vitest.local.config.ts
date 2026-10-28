import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The cards client's suites against the real endpoint on the local hub (P5 O13 M4): each starts desk-hub's local runner,
// a wrangler dev child, and MAWS's endpoint module in-process (test/local/endpoint.ts), so they run in a project of
// their own, one file at a time, with the time a hub's start and an enrollment take, as MAWS's root config isolates the
// endpoint's own `test/endpoint/*.local.test.ts` (its `node-timing` project). The endpoint and its harness reach MAWS's
// shared modules through `@shared`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, '../../src/shared'), '@artifacts': resolve(import.meta.dirname, '../../src/artifacts') } },
  test: {
    name: 'desk-web-local',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.local.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
