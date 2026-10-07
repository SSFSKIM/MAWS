// The product in stub mode over the scratch repository (C8c's e2e pattern), shared by the code tools spec and the editor
// spec (E5 execution document, M4: a pure move out of `code-tools.spec.ts`, plus the three conflict tokens in the
// theme scan's palette). The product has no harness API, so these helpers read what a case asserts from the DOM and
// drive it with the clicks a reader makes.
import { expect, type Locator, type Page } from '@playwright/test';
import { buildCodeScratch, type CodeScratch } from './code-scratch';
import { launchMaws, type MawsLaunch } from './launch';
import { CHARTER } from './panel-support';
import { sidebarOf, sidebarRow } from './sidebar';

// ---- themes: C5's smoke's scan, with the `--code-*` tokens in the palette -------------------------------------------------

export const COLOUR_TOKENS = [
  '--bg', '--bg-raised', '--bg-overlay', '--bg-hover', '--bg-active', '--border', '--border-strong', '--fg', '--fg-muted', '--fg-faint',
  '--accent', '--accent-soft', '--success', '--warning', '--danger', '--info', '--diff-add-bg', '--diff-del-bg',
  '--code-keyword', '--code-string', '--code-comment', '--code-number', '--code-type', '--code-function', '--code-variable', '--code-property',
  '--code-operator', '--code-punctuation', '--code-meta', '--code-invalid', '--code-gutter-fg', '--code-line-active-bg', '--code-selection-bg',
  // E5: the conflict-marker view's sections
  '--code-conflict-mine-bg', '--code-conflict-theirs-bg', '--code-conflict-base-bg',
];

// Elements (portals included) whose background, text or border colour is one only the other theme's tokens produce.
// `paintedOnly` skips elements with no layout box (display: none paints nothing in either theme, e.g. xterm's IME
// composition view with its own fixed colours until a composition starts); every element is scanned by default.
export async function otherThemeColours(page: Page, { paintedOnly = false }: { paintedOnly?: boolean } = {}): Promise<string[]> {
  return page.evaluate(({ names, paintedOnly }) => {
    const resolve = (theme: string) => {
      const host = document.createElement('div');
      host.setAttribute('data-theme', theme);
      const probe = document.createElement('span');
      host.append(probe);
      document.body.append(host);
      const out = names.map((name) => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
      });
      host.remove();
      return out;
    };
    const themed = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const own = resolve(themed);
    const forbidden = [...new Set(resolve(themed === 'dark' ? 'light' : 'dark'))].filter((colour) => !own.includes(colour));
    const props = ['background-color', 'color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (paintedOnly && el.getClientRects().length === 0) continue;
      const style = getComputedStyle(el);
      const prop = props.find((p) => forbidden.includes(style.getPropertyValue(p)));
      if (prop) offenders.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').slice(0, 60)} ${prop} ${style.getPropertyValue(prop)}`);
      if (offenders.length >= 8) break;
    }
    return offenders;
  }, { names: COLOUR_TOKENS, paintedOnly });
}

// An application-menu item clicked by its id, as the owner's click would (`theme.light`, `file.save`).
export async function menu(maws: MawsLaunch, id: string): Promise<void> {
  const clicked = await maws.app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return true;
  }, id);
  expect(clicked, `menu item ${id}`).toBe(true);
}

// ---- the product in stub mode over the scratch repository ------------------------------------------------------------------

export interface Product {
  maws: MawsLaunch;
  page: Page;
  panel: Locator;
  scratch: CodeScratch;
}

export async function withProduct(body: (p: Product) => Promise<void>, prepare?: (scratch: CodeScratch) => void): Promise<void> {
  const scratch = buildCodeScratch();
  prepare?.(scratch);
  let maws: MawsLaunch | null = null;
  try {
    maws = await launchMaws({ env: scratch.env });
    const { page } = maws;
    // W11: the row is in its project, expanded once the stub's records are in.
    await expect(sidebarOf(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await (await sidebarRow(page, CHARTER)).click();
    const panel = page.locator('[data-region="panel"]');
    await expect(panel.getByRole('tabpanel', { name: 'Session overview' }).getByRole('heading', { level: 2 })).toContainText(CHARTER);
    await body({ maws, page, panel, scratch });
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws?.cleanup();
    scratch.cleanup();
  }
}

export async function addTool({ page, panel }: Product, name: 'Files' | 'Review'): Promise<void> {
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name }).click();
}

export const treeRow = ({ panel }: Product, path: string) => panel.locator(`[data-tool="files"] [role="treeitem"][data-path="${path}"]`);

// Files open, the repository's root expanded, and each directory on the way to `relative` expanded; then its row.
export async function reveal(p: Product, relative: string): Promise<Locator> {
  if ((await p.panel.locator('[data-tool="files"]').count()) === 0) await addTool(p, 'Files');
  const segments = relative.split('/');
  let at = p.scratch.dir;
  for (const segment of ['', ...segments.slice(0, -1)]) {
    at = segment ? `${at}/${segment}` : at;
    const row = treeRow(p, at);
    await expect(row).toBeVisible();
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
  }
  const row = treeRow(p, `${p.scratch.dir}/${relative}`);
  await expect(row).toBeVisible();
  return row;
}

export async function openInViewer(p: Product, relative: string): Promise<Locator> {
  await (await reveal(p, relative)).click();
  const viewer = p.page.locator(`[data-file-viewer][data-path="${p.scratch.path(relative)}"]`);
  await expect(viewer).toBeVisible();
  return viewer;
}

// Review in the panel on its default scope (Uncommitted on this dirty tree).
export async function openReview(p: Product): Promise<Locator> {
  await addTool(p, 'Review');
  const review = p.panel.locator('[data-review]');
  await expect(review.locator('[data-review-header]')).toContainText('· Uncommitted');
  return review;
}

export async function selectReviewFile(review: Locator, path: string): Promise<void> {
  await review.locator(`[role="option"] button[data-path="${path}"]`).click();
  await expect(review.locator(`[role="option"][aria-selected="true"] button[data-path="${path}"]`)).toBeVisible();
}

// The flashed line of the code view: its text, where its middle sits in the scroller (0 top, 1 bottom), and whether
// the scroller is at its top or its bottom.
export function flashedLine(page: Page): Promise<{ text: string; at: number; atTop: boolean; atBottom: boolean } | null> {
  return page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('[data-file-viewer] .cm-flash-line');
    const scroller = document.querySelector<HTMLElement>('[data-file-viewer] .cm-scroller');
    if (!line || !scroller) return null;
    const l = line.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return {
      text: line.textContent ?? '',
      at: (l.top + l.height / 2 - s.top) / s.height,
      atTop: scroller.scrollTop <= 1,
      atBottom: scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1,
    };
  });
}

// Landed: the line flashed and centred, in the viewport's middle third, or as near it as the document allows (a line
// in the first or last half-screen cannot reach the middle: the scroller then rests at that end with the line in view).
// `within` is a case's own time bound, where its acceptance sets one; otherwise the default expect timeout.
export async function expectLandedOn(page: Page, text: string, within?: number): Promise<void> {
  await expect.poll(async () => (await flashedLine(page))?.text, { ...(within === undefined ? {} : { timeout: within }), message: `the flashed line reads ${text}` }).toBe(text);
  const { at, atTop, atBottom } = (await flashedLine(page))!;
  expect(at, 'in view').toBeGreaterThan(0);
  expect(at, 'in view').toBeLessThan(1);
  if (at < 1 / 3) expect(atTop, `above the middle third (${at.toFixed(2)}) only with the scroller at the top`).toBe(true);
  if (at > 2 / 3) expect(atBottom, `below the middle third (${at.toFixed(2)}) only with the scroller at the bottom`).toBe(true);
}

// Records every notice the viewer shows from now on (a notice can come and go between two polls).
export async function recordNotices(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __notices: string[] }).__notices = seen;
    const note = () => {
      for (const el of Array.from(document.querySelectorAll('[data-file-viewer] [role="status"][data-notice]'))) {
        const text = el.textContent ?? '';
        if (seen.at(-1) !== text) seen.push(text);
      }
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  return () => page.evaluate(() => [...(window as unknown as { __notices: string[] }).__notices]);
}

// A short window, so a 33-line file and a three-hunk diff scroll.
export async function shortWindow({ maws, page }: Product): Promise<void> {
  await maws.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(600, 300);
    win.setSize(1280, 460);
  });
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeLessThan(480);
}

export const notice = (viewer: Locator) => viewer.locator('[role="status"][data-notice]');

// The code view's document end, scrolled to: the last line number drawn and the texts of the last two lines.
export async function documentEnd(viewer: Locator): Promise<{ number: number; last: string; beforeLast: string }> {
  await viewer.locator('.cm-scroller').evaluate((el) => void (el.scrollTop = el.scrollHeight));
  return viewer.evaluate((root) => {
    // The gutter's hidden sizing element (`99999`) is not a line.
    const numbers = Array.from(root.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement'))
      .filter((el) => el.style.visibility !== 'hidden')
      .map((el) => Number(el.textContent) || 0);
    const lines = Array.from(root.querySelectorAll('.cm-content .cm-line')).map((el) => el.textContent ?? '');
    return { number: Math.max(0, ...numbers), last: lines.at(-1) ?? '', beforeLast: lines.at(-2) ?? '' };
  });
}

export const invoke = (page: Page, name: 'files.read', input: { appSessionId: string; path: string }) =>
  page.evaluate(([name, input]) => window.maws.invoke(name, input as never), [name, input] as const);

// `git diff HEAD --numstat` summed, as the acceptance reads it.
export function numstat(scratch: CodeScratch): { files: number; added: number; removed: number } {
  const rows = scratch.git('diff', 'HEAD', '--numstat').split('\n').filter(Boolean).map((line) => line.split('\t'));
  return rows.reduce((sum, [a, r]) => ({ files: sum.files + 1, added: sum.added + Number(a), removed: sum.removed + Number(r) }), { files: 0, added: 0, removed: 0 });
}

// A tab written into layout.json's focused pane beside the session's, then the window reloaded (C5's restore path).
// W12: `main.tabs` holds a tab set per project; the strip's is `current`.
export async function restoreWithTab(p: Product, tabs: Record<string, unknown>[]): Promise<void> {
  type Set = { panes: { tabs: { id: string }[]; activeTabId: string }[]; focusedPane: number };
  const main = await p.page.evaluate(async () => {
    const result = await window.maws.invoke('layout.get', { key: 'main.tabs' });
    return result.ok ? (result.value.value as { current: string; sets: Record<string, Set> }) : null;
  });
  expect(main, 'the session tab reached layout.json').not.toBeNull();
  const shown = main!.sets[main!.current];
  const pane = shown.panes[shown.focusedPane];
  pane.tabs.push(...(tabs as never[]));
  pane.activeTabId = String(tabs.at(-1)!.id);
  await p.page.evaluate(async (value) => {
    const result = await window.maws.invoke('layout.set', { key: 'main.tabs', value });
    if (!result.ok) throw new Error(result.error.message);
  }, main);
  await p.page.reload();
}
