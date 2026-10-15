import { defineConfig, devices } from '@playwright/test';

// The desk's browser suites: the built app (dist/, `pnpm build` first — `pnpm e2e` does both) served by the DX3 double,
// which each test starts on its own port, driven in Chromium. On a Mac the system Chrome (no browser download); on
// Linux Playwright's own Chromium, which the gate's desk-web job installs. One worker: each test owns a hub double and
// a browser, and the Mac runs these under the load rule.
//
// The phone's layout cases (tagged @layout in e2e/phone.spec.ts) run again in WebKit with an iPhone's viewport, where
// the gate's Linux job installs Playwright's WebKit (DESK_E2E_WEBKIT=1 elsewhere, once WebKit is installed): the
// engine of the owner's phone, short of the phone itself.
const webkit = process.platform === 'linux' || process.env.DESK_E2E_WEBKIT === '1';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: process.env.DESK_E2E_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined) } },
    ...(webkit ? [{ name: 'phone-webkit', grep: /@layout/, use: { ...devices['iPhone 13'] } }] : []),
  ],
});
