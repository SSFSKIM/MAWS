import type { Locator } from '@playwright/test';

/** UX1 preserves authored line breaks; seek from the top regardless of the initial or asynchronously loaded position. */
export async function revealEarlier(view: Locator, target: Locator): Promise<void> {
  const scroller = view.locator('[data-transcript-scroller]').first();
  await scroller.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -200 })); el.scrollTo({ top: 0 }); });
  for (let i = 0; i < 100; i++) {
    await view.page().waitForTimeout(60);
    const found = await target.evaluateAll((nodes) => {
      const node = nodes.find((candidate) => candidate.isConnected);
      if (!node) return false;
      node.scrollIntoView({ block: 'nearest' });
      return node.isConnected;
    });
    if (found) return;
    await scroller.evaluate((el) => el.scrollBy({ top: el.clientHeight * 0.6 }));
  }
  throw new Error('the earlier transcript row was not reached in 100 windows');
}

/** Load through the known first row, then compare the whole history rather than a measured overscan window. */
export async function allTranscriptRowIds(view: Locator, firstRow: Locator, timeout = 15_000): Promise<string[]> {
  const scroller = view.locator('[data-transcript-scroller]').first();
  const ids = new Set<string>();
  const deadline = Date.now() + timeout;
  let atFirstRow = false;
  await scroller.dispatchEvent('wheel', { deltaY: -200 });
  for (let i = 0; i < 100 && Date.now() < deadline; i++) {
    if (!atFirstRow) {
      // Older-page installation preserves the reader's anchor, so each arriving page can move us away from the top.
      await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
      await view.page().waitForTimeout(60);
      atFirstRow = await firstRow.evaluateAll((nodes) => nodes.some((node) => node.isConnected));
      if (!atFirstRow) continue;
      await scroller.evaluate((el) => el.scrollTo({ top: 0 }));
    }
    await view.page().waitForTimeout(60);
    for (const id of await view.locator('[data-row-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-row-id')!))) ids.add(id);
    const atEnd = await scroller.evaluate((el) => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return true;
      el.scrollBy({ top: el.clientHeight * 0.8 });
      return false;
    });
    if (atEnd) return [...ids];
  }
  throw new Error(`the transcript's ${atFirstRow ? 'end' : 'first row'} was not reached in 100 windows within ${timeout}ms (${ids.size} rows taken)`);
}
