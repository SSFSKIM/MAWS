import { defineConfig } from '@playwright/test';

// P3-E2 M1 spike: the renderer comparison's export proof, run only by `pnpm e2e:dashboard-spike` (an explicitly named
// experimental group, never a default one). One worker; the spike's own Electron main (out/spike-main.cjs).
process.env.LC_ALL = 'en_US.UTF-8';

export default defineConfig({
  testDir: '.',
  testMatch: /\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [['list']],
  outputDir: '../out/test-results',
});
