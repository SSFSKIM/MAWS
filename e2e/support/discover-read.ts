// P4-AGG's Discover group: a Discover pane's first answer for a cwd (tech-debt row (27), the hosted row's signatures (6)
// and (27)). The catalog main builds for a cwd it has not read yet waits for the engine's own listings, three runs of
// the pinned CLI (`plugins.list`, `plugins.available`, `marketplaces.list`: src/services/catalog/engine-reads.ts), so the
// pane's first content is bounded as one CLI action is, never by Playwright's 5 s default. On the mini's home instance
// such a read took 0.7 to 3.4 s in green runs and 6.2 s once (the home case of gate run 41494976905, whose IPC wait has
// no 5 s bound); the reds were the panes still drawing their placeholders at 5 s. Later reads for that cwd answer from
// what main built until a change invalidates it, so the assertions after this one keep the default.
// Each read's time goes to the job log with the `catalog.changed` the window heard meanwhile (each one a read again), so
// a slow read says whether it was one slow read or several.
import { expect, type Locator, type Page } from '@playwright/test';

export const FIRST_READ_MS = 120_000; // one CLI action, the engine's own start included, on a loaded runner

/** Call before the step that shows a pane; the function it answers waits for that pane's first answer. */
export async function firstRead(page: Page): Promise<(pane: Locator, label: string) => Promise<void>> {
  const heard = () =>
    page.evaluate(() => {
      const w = window as unknown as { __catalogChanged?: number };
      if (w.__catalogChanged === undefined) {
        w.__catalogChanged = 0;
        window.maws.on('catalog.changed', () => {
          w.__catalogChanged = (w.__catalogChanged ?? 0) + 1;
        });
      }
      return w.__catalogChanged;
    });
  const before = await heard();
  const started = Date.now();
  return async (pane, label) => {
    // the home, or a narrowed grid (a search kept from before); the placeholders are neither
    await expect(pane.locator('[data-discover-home], [data-catalog-grid]').first()).toBeVisible({ timeout: FIRST_READ_MS });
    console.log(`[e2e] Discover's catalog (${label}) shown ${Date.now() - started} ms after it was asked, ${(await heard()) - before} catalog.changed heard`);
  };
}
