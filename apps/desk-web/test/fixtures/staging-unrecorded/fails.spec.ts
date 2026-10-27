// Staging-shaped tests that fail, through the staging check's `test` (e2e-staging/unrecorded.ts); run by
// test/staging-recording.test.ts. One fails with no browser; the other times out while its page shows a secret
// (PROBE_SECRET), in a context of its own made from the browser and closed in `finally`, as e2e-staging/desk-web.spec.ts
// makes its own.
import { expect } from '@playwright/test';
import { test } from '../../../e2e-staging/unrecorded';

test('fails without a page', () => {
  expect(1, 'a failure').toBe(2);
});

test('times out with a secret on the page', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(`<div data-testid="enrollment-code"></div>`);
    await page.getByTestId('enrollment-code').evaluate((node, secret) => (node.textContent = secret), process.env.PROBE_SECRET!);
    await expect(page.getByTestId('never-there')).toBeVisible({ timeout: 10_000 });
  } finally {
    await context.close();
  }
});
