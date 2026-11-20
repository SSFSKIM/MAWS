// UX wave U6b-5b's scenes, their shared part (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, M3 and
// Interfaces §I). The window's zoom is changed as a person changes it: View ▸ Zoom In, Zoom Out and Actual Size, each
// clicked in main by its id once main reads it enabled (a menu accelerator cannot be pressed through Playwright;
// support/menu.ts). Each act waits on the window's zoom store reading the next factor: the root's `--app-zoom`, which
// follows `layout.zoomChanged`, and main sends that event only after it has set the factor on every app page and
// placed every native view again (the document's S3). After each act the zoom says the size reached in one line, a
// toast of the app's own toast host, which a scene of the in-app browser waits to be gone: a toast over a pane draws the
// page's still in the view's place. M1's probe scenes, which set the factor in main as nothing of the product did then,
// were retired by these (the document's Decision Log 20); `spikes/zoom-probe/FINDINGS.md` cites them at their runs.
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { menu } from './menu';

export type ZoomItem = 'zoom.in' | 'zoom.out' | 'zoom.reset';

// The factor the window's zoom store holds, read from the root's `--app-zoom`; NaN before the store first applied one.
export const zoomOfPage = (page: Page): Promise<number> => page.evaluate(() => Number(document.documentElement.style.getPropertyValue('--app-zoom') || Number.NaN));

// Whether View's item is enabled as main's menu holds it (null when it has no such item).
export const zoomItemEnabled = (app: ElectronApplication, id: ZoomItem): Promise<boolean | null> =>
  app.evaluate(({ Menu }, item) => Menu.getApplicationMenu()?.getMenuItemById(item)?.enabled ?? null, id);

// One act: the item clicked once main reads it enabled; answers the factor the store then holds (polled until it moved).
export async function zoomAct(app: ElectronApplication, page: Page, id: ZoomItem): Promise<number> {
  const before = await settledZoom(page);
  await expect.poll(() => zoomItemEnabled(app, id), { message: `View ▸ ${id} enabled` }).toBe(true);
  await menu(app, id);
  await expect.poll(() => zoomOfPage(page), { message: `the window's zoom moved from ${before} after ${id}` }).not.toBe(before);
  return zoomOfPage(page);
}

// The window walked to `factor` by View's items, one step at a time along the steps (Actual Size for 100 %); a factor
// that is not one of the steps fails where a step passes it.
export async function zoomTo(app: ElectronApplication, page: Page, factor: number): Promise<void> {
  let now = await settledZoom(page);
  if (now !== factor && factor === 1) now = await zoomAct(app, page, 'zoom.reset');
  while (now !== factor) {
    const before = now;
    now = await zoomAct(app, page, factor > before ? 'zoom.in' : 'zoom.out');
    expect(Math.sign(factor - now) === -Math.sign(factor - before), `${factor} is one of the steps: from ${before} the next step is ${now}`).toBe(false);
  }
}

// The store's factor once it holds one (the window's zoom is connected at the app's mount).
async function settledZoom(page: Page): Promise<number> {
  await expect.poll(async () => Number.isFinite(await zoomOfPage(page)), { message: 'the window’s zoom store holds a factor' }).toBe(true);
  return zoomOfPage(page);
}

// Main's own factor for each app window's page, and the page's URL (the presenter's and the repair window's included).
export const windowFactors = (app: ElectronApplication): Promise<{ url: string; factor: number }[]> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => ({ url: win.webContents.getURL(), factor: win.webContents.getZoomFactor() })));

// The zoom's line, "Zoom 125 %" (decision 37), as the toast host draws it; and its text for a factor.
export const zoomLines = (page: Page): Locator => page.getByRole('region', { name: /^Notifications/ }).locator('li').filter({ hasText: /Zoom \d+ %/ });
export const zoomLineOf = (factor: number): string => `Zoom ${Math.round(factor * 100)} %`;

// Polled until no zoom's line is drawn (each lasts a second and a half; no time is asserted).
export async function zoomLineGone(page: Page): Promise<void> {
  await expect(zoomLines(page), 'the zoom’s line is gone').toHaveCount(0, { timeout: 15_000 });
}

type Rect = { x: number; y: number; width: number; height: number };
// Decision 27's rule, where main places a CSS rectangle under the factor: each edge multiplied and rounded to a point,
// the size the difference.
export function timesFactor(r: Rect, f: number): Rect {
  const x = Math.round(r.x * f);
  const y = Math.round(r.y * f);
  return { x, y, width: Math.round((r.x + r.width) * f) - x, height: Math.round((r.y + r.height) * f) - y };
}
