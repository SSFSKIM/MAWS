import type { Locator } from '@playwright/test';

/** UX1 preserves authored line breaks, so earlier answers can be outside the mounted window after a reload. */
export async function revealEarlier(view: Locator, target: Locator): Promise<void> {
  const scroller = view.locator('[data-transcript-scroller]').first();
  await scroller.dispatchEvent('wheel', { deltaY: -200 });
  for (let i = 0; i < 100; i++) {
    const found = await target.evaluateAll((nodes) => {
      const node = nodes.find((candidate) => candidate.isConnected);
      if (!node) return false;
      node.scrollIntoView({ block: 'nearest' });
      return true;
    });
    if (found) return;
    await scroller.evaluate((el) => el.scrollBy({ top: -el.clientHeight * 0.6 }));
    await view.page().waitForTimeout(60);
  }
  throw new Error('the earlier transcript row was not reached in 100 windows');
}
