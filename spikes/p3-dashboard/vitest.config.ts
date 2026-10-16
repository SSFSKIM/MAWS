// P3-E2 M1 spike: its own unit project (spikes are outside the repository's suites), Node only, no DOM.
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, '../../src/shared'), '@artifacts': resolve(__dirname, '../../src/artifacts') } },
  test: { name: 'p3-dashboard-spike', environment: 'node', root: resolve(__dirname, '../..'), include: ['spikes/p3-dashboard/test/**/*.test.ts'] },
});
