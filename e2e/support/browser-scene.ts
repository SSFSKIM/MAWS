// E4a's scene for `e2e/browser.spec.ts` (E4a execution document, Task 4.1): E2's scene (a scratch project the sidebar
// shows, the product app over the replay with the e2e seam log; imported from support/deliverables-scene.ts, not
// copied) plus a local web server, the folder main saves downloads into under the e2e (MAWS_E2E_SAVE_PATH), and the
// Browser tool's locators and readers:
//
// - `openBrowser` adds the tool from the panel's "+" menu; `browserIn` is a surface's view (the panel tool or a
//   `browser` main tab), `paneIn` its pane, `chipsIn` its tab strip's chips, `address` types into its address field;
// - `tabState` reads a tab as main records it (`browser.tabs.list`) and its view as Electron holds it (the seam's
//   `__maws_browser.tab`, which reports the view's own state alone: visible, bounds, attached, window, owner);
// - `pageAt` is the Playwright page of a view (a WebContentsView's page is one of `electronApp.windows()`), matched by URL,
//   so a case reads the page's own DOM;
// - `shootBrowser` writes `e4a-<surface>-<theme>.png` under docs/doperpowers/evidence/p1-e4a/ when MAWS_E4A_SHOTS=1. A
//   view is not in the renderer's screenshot, so the shown page's own screenshot is laid into the pane first, where the
//   view draws, and taken out after.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, value } from './c7-replay';
import { clearToasts, closeScene, launchScene, scratchProject, type Scene, type Scratch } from './deliverables-scene';
import { REPO_ROOT } from './launch';
import { startBrowserServer, type BrowserServer } from './browser-server';

export type Surface = 'panel' | 'main';
type Rect = { x: number; y: number; width: number; height: number };

// What `__maws_browser.tab` answers (src/main/browser/inspect.ts `InspectedTab`; the e2e does not import main's code).
export interface InspectedView {
  visible: boolean;
  bounds: Rect | null;
  attached: boolean;
  windowId: number | null;
  owner: { paneId: string; surface: Surface; windowId: number } | null;
}
interface BrowserInspector {
  tab(tabId: string): InspectedView | null;
  showPane(request: unknown): boolean;
  metrics(): { loaded: number; sampled: number };
}

export interface BrowserScene extends Scene {
  server: BrowserServer;
  saveDir: string; // where main saves a download under the e2e
}

// The product app over the scratch profile with downloads saved into `<scratch>/downloads` (main reads the variable at
// start; launchMaws passes the runner's environment on).
export async function launchBrowserScene(scratch: Scratch, server: BrowserServer, known?: AppSessionId[]): Promise<BrowserScene> {
  const saveDir = join(scratch.root, 'downloads');
  mkdirSync(saveDir, { recursive: true });
  const before = process.env.MAWS_E2E_SAVE_PATH;
  process.env.MAWS_E2E_SAVE_PATH = saveDir;
  try {
    return Object.assign(await launchScene(scratch, known), { server, saveDir });
  } finally {
    if (before === undefined) delete process.env.MAWS_E2E_SAVE_PATH;
    else process.env.MAWS_E2E_SAVE_PATH = before;
  }
}

// One launch over a fresh scratch project and a fresh server, closed (console clean) and removed after the body.
export async function browserScene(titles: string[], body: (s: BrowserScene) => Promise<void>): Promise<void> {
  const scratch = scratchProject({ titles });
  const server = await startBrowserServer();
  try {
    const s = await launchBrowserScene(scratch, server);
    try {
      await body(s);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);
  } finally {
    await server.close();
    rmSync(scratch.root, { recursive: true, force: true });
  }
}

// ---- the surfaces ---------------------------------------------------------------------------------------------------

export const browserIn = (s: Scene, surface: Surface): Locator =>
  surface === 'panel' ? s.panel.locator('[data-browser-view="panel"]') : s.page.locator('[data-region="main"] [data-browser-view="main"]');
export const paneIn = (view: Locator): Locator => view.locator('[data-browser-pane]');
export const chipsIn = (view: Locator): Locator => view.locator('[data-browser-chip]');
export const chipOf = (view: Locator, tabId: string): Locator => view.locator(`[data-browser-chip="${tabId}"]`);
export const addressOf = (view: Locator): Locator => view.getByRole('combobox', { name: 'Address' });
export const noticesIn = (view: Locator): Locator => view.locator('[data-browser-notice]');

// The Browser tool added from the panel's "+" menu (it shows the shown session's tabs).
export async function openBrowser(s: Scene): Promise<Locator> {
  await s.panel.getByRole('button', { name: 'Add a tool' }).click();
  await s.page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
  const view = browserIn(s, 'panel');
  await expect(view).toBeVisible();
  return view;
}

// Text typed into the surface's address field and run with Enter (the typed address is the first suggestion): the field
// lets go once the address goes to main. A refused address keeps the field and its text (Design §5); Esc then puts the
// page's URL back.
export async function address(view: Locator, text: string, opts: { refused?: boolean } = {}): Promise<void> {
  const field = addressOf(view);
  await field.click();
  await expect(field).toBeFocused();
  await field.fill(text);
  await field.press('Enter');
  if (opts.refused) {
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(text);
    await field.press('Escape');
  }
  await expect(field).not.toBeFocused();
}

// The chrome's overflow menu, one item chosen.
export async function overflow(s: Scene, view: Locator, item: string): Promise<void> {
  await view.getByRole('button', { name: 'Browser options' }).click();
  await s.page.getByRole('menuitem', { name: item, exact: true }).click();
}

// ---- main's records -------------------------------------------------------------------------------------------------

export async function tabsOf(s: Scene, appSessionId: AppSessionId): Promise<{ tabs: BrowserTab[]; selected: string | null }> {
  const listed = value(await invoke(s.page, 'browser.tabs.list', { appSessionId }));
  return { tabs: listed.tabs, selected: listed.selected[appSessionId] ?? null };
}

export async function viewOf(s: Scene, tabId: string): Promise<InspectedView | null> {
  return s.maws.app.evaluate((_electron, id) => (globalThis as unknown as { __maws_browser: BrowserInspector }).__maws_browser.tab(id), tabId);
}

// A tab as main records it and its view as Electron holds it (Decision Log 44 (e)).
export async function tabState(s: Scene, tabId: string): Promise<{ tab: BrowserTab | null; view: InspectedView | null }> {
  const { tabs } = value(await invoke(s.page, 'browser.tabs.list', {}));
  return { tab: tabs.find((tab) => tab.tabId === tabId) ?? null, view: await viewOf(s, tabId) };
}

export async function metrics(s: Scene): Promise<{ loaded: number; sampled: number }> {
  return s.maws.app.evaluate(() => (globalThis as unknown as { __maws_browser: BrowserInspector }).__maws_browser.metrics());
}

// `show_pane 'browser' {target}` as the engine host hands it to the windows (the e2e runs no engine).
export async function showPane(s: Scene, request: { appSessionId: AppSessionId; requestId: string; target: string | null }): Promise<void> {
  const sent = await s.maws.app.evaluate(
    (_electron, r) => (globalThis as unknown as { __maws_browser: BrowserInspector }).__maws_browser.showPane(r),
    { ...request, pane: 'browser', line: null },
  );
  expect(sent, 'maws.pane.show was valid and sent').toBe(true);
}

// The id of the session's tab whose URL is `url` (after its page committed there).
export async function tabAt(s: Scene, appSessionId: AppSessionId, url: string): Promise<string> {
  let id: string | undefined;
  await expect.poll(async () => (id = (await tabsOf(s, appSessionId)).tabs.find((tab) => tab.url === url)?.tabId), { message: `a tab at ${url}` }).toBeDefined();
  return id!;
}

// ---- pages and rects ------------------------------------------------------------------------------------------------

// The Playwright page of a view whose document is at `url` (a WebContentsView's page is a window to Playwright).
export async function pageAt(s: Scene, url: string): Promise<Page> {
  let found: Page | undefined;
  await expect.poll(() => (found = s.maws.app.windows().find((p) => p !== s.page && !p.isClosed() && p.url() === url)) !== undefined, { message: `a page at ${url}` }).toBe(true);
  return found!;
}

// The pane's rect as the renderer lays it out, rounded per edge as the pane reports it (Decision Log 48).
export async function paneRect(pane: Locator): Promise<Rect> {
  return pane.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left);
    const y = Math.round(r.top);
    return { x, y, width: Math.round(r.right) - x, height: Math.round(r.bottom) - y };
  });
}

const within1 = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;

// The tab's view is visible and lies on the pane's rect within 1 px, polled until it settles.
export async function expectOnPane(s: Scene, tabId: string, pane: Locator, surface: Surface, timeout = 2_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const [view, rect] = await Promise.all([viewOf(s, tabId), paneRect(pane)]);
        return view !== null && view.visible && view.attached && view.owner?.surface === surface && view.bounds !== null && within1(view.bounds, rect) ? 'on the pane' : JSON.stringify({ view, rect });
      },
      { timeout, intervals: [16, 16, 33, 50, 100] },
    )
    .toBe('on the pane');
}

// Where the view lies against the pane two animation frames after the call (the pane reports from a frame callback,
// main applies at once): null when it is on the pane within 1 px, else what was read.
export async function offPaneAfterFrames(s: Scene, tabId: string, pane: Locator): Promise<string | null> {
  await s.page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const [view, rect] = await Promise.all([viewOf(s, tabId), paneRect(pane)]);
  return view?.visible && view.bounds && within1(view.bounds, rect) ? null : JSON.stringify({ bounds: view?.bounds, visible: view?.visible, rect });
}

// How long main took to hide the view after `act` ran in main (one evaluate, so no round trip is counted): ms, or null
// if it stayed visible for 2 s.
export async function hiddenAfter(s: Scene, tabId: string, act: 'palette' | 'overview'): Promise<number | null> {
  const id = act === 'palette' ? 'palette.open' : 'tab.overview';
  return s.maws.app.evaluate(
    ({ Menu }, { id, tabId }) =>
      new Promise<number | null>((resolve) => {
        const browser = (globalThis as unknown as { __maws_browser: BrowserInspector }).__maws_browser;
        const item = Menu.getApplicationMenu()?.getMenuItemById(id);
        if (!item?.enabled) return resolve(-1);
        const start = performance.now();
        item.click();
        const check = () => {
          const elapsed = performance.now() - start;
          if (browser.tab(tabId)?.visible === false) return resolve(elapsed);
          if (elapsed > 2_000) return resolve(null);
          setTimeout(check, 2);
        };
        check();
      }),
    { id, tabId },
  );
}

// ---- evidence -------------------------------------------------------------------------------------------------------

export const SHOTS = process.env.MAWS_E4A_SHOTS === '1' ? join(REPO_ROOT, 'docs/doperpowers/evidence/p1-e4a') : null;
const THEMES = ['light', 'dark'] as const;

// `e4a-<surface>-<theme>.png` in each theme, then back to light. With `page`, that view's own screenshot is laid into
// `pane` for the shot (where the view draws over the renderer), and removed after.
export async function shootBrowser(s: Scene, surface: string, opts: { pane?: Locator; page?: Page } = {}): Promise<void> {
  if (SHOTS === null) return;
  mkdirSync(SHOTS, { recursive: true });
  await clearToasts(s.page);
  await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // no focus ring left from the last click
  for (const theme of THEMES) {
    value(await invoke(s.page, 'settings.set', { theme }));
    await expect(s.page.locator('html')).toHaveAttribute('data-theme', theme);
    if (opts.page && opts.pane) {
      const picture = `data:image/png;base64,${(await opts.page.screenshot()).toString('base64')}`;
      await opts.pane.evaluate(
        (el, src) =>
          new Promise<void>((resolve) => {
            const img = document.createElement('img');
            img.dataset.e4aShot = '';
            img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none';
            img.onload = () => resolve();
            img.src = src;
            el.appendChild(img);
          }),
        picture,
      );
    }
    await s.page.waitForTimeout(250);
    await s.page.screenshot({ path: join(SHOTS, `e4a-${surface}-${theme}.png`) });
    if (opts.pane) await opts.pane.evaluate((el) => el.querySelector('img[data-e4a-shot]')?.remove());
  }
  value(await invoke(s.page, 'settings.set', { theme: 'light' }));
  await expect(s.page.locator('html')).toHaveAttribute('data-theme', 'light');
}
