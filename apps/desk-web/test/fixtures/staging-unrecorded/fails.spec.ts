// A staging-shaped test that times out while its page shows a secret (PROBE_SECRET): a context of its own, made from the
// browser and closed in `finally`, as e2e-staging/desk-web.spec.ts makes its own.
import { expect } from '@playwright/test';
import { test } from '../../../e2e-staging/unrecorded';

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
