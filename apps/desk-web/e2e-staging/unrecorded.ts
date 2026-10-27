// The staging check's `test`: Playwright's, with nothing written about a test when it ends. The browser holds the
// owner's Access token as a cookie and its pages show the Machines dialog's enrollment code, which holds the org key.
// Turning trace, video and screenshot off (playwright.staging.config.ts) is not enough: for a failed test Playwright
// still writes error-context.md, an accessibility snapshot of the page included, and no option turns it off.
//
// Playwright does that in its `_setupArtifacts` fixture, which also starts the traces and takes the failure screenshots
// the configuration turns off; here it does nothing. A private fixture's name: test/staging-recording.test.ts runs a
// test that fails while its page shows a secret through this `test` in Playwright itself, so a Playwright that renamed
// or moved the fixture fails that suite rather than this check writing the page again.
import { test as base } from '@playwright/test';

// Given as a function alone, the override keeps the fixture's own options (automatic, around every hook).
export const test = base.extend<{ _setupArtifacts: void }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  _setupArtifacts: async ({}, use) => {
    await use();
  },
});
