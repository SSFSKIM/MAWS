// The product in stub mode over the scratch repository (C8c's e2e pattern), shared by the code tools spec and the editor
// spec (E5 execution document, M4: a pure move out of `code-tools.spec.ts`, plus the three conflict tokens in the
// theme scan's palette). The product has no harness API, so these helpers read what a case asserts from the DOM and
// drive it with the clicks a reader makes.
import { expect, type Locator, type Page } from '@playwright/test';
import { addressed } from './address';
import { buildCodeScratch, type CodeScratch } from './code-scratch';
import { launchMaws, type MawsLaunch, type ShellLaunchOptions } from './launch';
import { CHARTER } from './panel-support';
import { sidebarOf, sidebarRow } from './sidebar';
import { mainTabById, openSurface, sideColumn, surface } from './shell';
import { storedMain, stripOf, type LayoutMain, type Strip, type TabRef } from '../../src/shared/ipc/schema/layout';

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

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6): `frames`, for a case whose fixture
// makes a session's file in its frame log errors of its own (a page's stylesheet and script refused by the frame's CSP):
// each pattern is matched against `<location> <text>`. The closing check leaves out a console error located in a frame (a
// token's URL or Chromium's PDF viewer) only when one of the patterns matches it, and a page error only when the frame that
// threw it (its stack's first call site, read after the message) is one and a pattern matches; every other error, the
// window's own and a frame's unexpected load or viewer error, fails the case. Without `frames`, every error fails it.
const FRAME_LOCATION = /^(maws-artifact|chrome-extension):/;

// The URL of a page error's first call site, read below its message (which can hold any text); '' when the stack does not
// begin with the message as Playwright writes it, so such an error counts as the window's.
function thrownAt(error: Error): string {
  const head = `${error.name}: ${error.message}`;
  const stack = error.stack ?? '';
  if (!stack.startsWith(head)) return '';
  return /^\s+at (?:[^\n]*\()?([^\s()]+):\d+:\d+\)?$/m.exec(stack.slice(head.length))?.[1] ?? '';
}

// `launch` (`appKitDefaults`): the app's AppKit defaults for this launch (classic scroll bars, for a scene that drags one).
// Both options share the one argument, so either side's callers read as they did.
export async function withProduct(body: (p: Product) => Promise<void>, prepare?: (scratch: CodeScratch) => void, opts: { frames?: RegExp[] } & Pick<ShellLaunchOptions, 'appKitDefaults'> = {}): Promise<void> {
  const { frames, ...launch } = opts;
  const scratch = buildCodeScratch();
  prepare?.(scratch);
  let maws: MawsLaunch | null = null;
  try {
    maws = await launchMaws({ env: scratch.env, ...launch });
    const { page } = maws;
    const expected = frames;
    const own: string[] = expected ? maws.consoleErrors() : [];
    if (expected) {
      const theFrames = (location: string, text: string) => FRAME_LOCATION.test(location) && expected.some((pattern) => pattern.test(`${location} ${text}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && !theFrames(message.location().url, message.text())) own.push(message.text());
      });
      page.on('pageerror', (error) => {
        if (!theFrames(thrownAt(error), error.message)) own.push(`uncaught: ${error.message}`);
      });
    }
    // W11: the row is in its project, expanded once the stub's records are in.
    await expect(sidebarOf(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await (await sidebarRow(page, CHARTER)).click();
    const panel = page.locator('[data-region="panel"]');
    const tab = mainTabById(page, `session:${await addressed(page, scratch.appSessionId)}`);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toContainText(CHARTER);
    await body({ maws, page, panel, scratch });
    expect(expected ? own : maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws?.cleanup();
    scratch.cleanup();
  }
}

export async function addTool({ page }: Product, name: 'Files' | 'Review'): Promise<void> {
  await openSurface(page, name);
}

// UX wave U6b-3a (Decision Log 14, ruling 1): a tree row by its `data-kind`, which a row of the Changed group above the
// tree, a `treeitem` with the same `data-path`, does not carry
export const treeRow = ({ page }: Product, path: string) => surface(page, 'files').locator(`[role="treeitem"][data-kind][data-path="${path}"]`);

// Files open, the repository's root expanded, and each directory on the way to `relative` expanded; then its row.
export async function reveal(p: Product, relative: string): Promise<Locator> {
  await openSurface(p.page, 'Files');
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

// UX wave U6b-1 (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, Interfaces §G): a row's click opens
// the file beside the chat, as a tab of the side column, so the viewer is found there; the locator answered is the
// window's, so a case that moves the file to the main area keeps it.
export async function openInViewer(p: Product, relative: string): Promise<Locator> {
  await (await reveal(p, relative)).click();
  const selector = `[data-file-viewer][data-path="${p.scratch.path(relative)}"]`;
  await expect(sideColumn(p.page).locator(selector), `${relative} beside the chat`).toBeVisible();
  return p.page.locator(selector);
}

// A file's tab in the side column's strip, by the file's name: the element that carries the tab's marks (`data-preview`,
// `data-dirty`), its unsaved dot and its close glyph, beside the tab's own button, which the name is the name of.
export const sideFileTab = (page: Page, name: string): Locator =>
  sideColumn(page).locator('[data-side-strip] [data-tab-id]').filter({ has: page.getByRole('tab', { name, exact: true }) });

// Review in the panel on its default scope (Uncommitted on this dirty tree), its toolbar measured as drawn. UX wave U5b:
// the totals no longer name the scope (card 1 at its default), the pressed chip above them does.
export async function openReview(p: Product): Promise<Locator> {
  await addTool(p, 'Review');
  const review = surface(p.page, 'review').locator('[data-review]');
  await expect(review.locator('[data-chip="uncommitted"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(review.locator('[data-review-header]')).toContainText(' changed · ');
  await expectToolbarAsDrawn(review, "Review's toolbar as drawn in the panel"); // measured, in every scene that opens it here
  return review;
}

// ---- UX wave U5b (M6): Review as one stack of sections (the U5b execution document's §F) -----------------------------------

export const reviewSection = (review: Locator, path: string): Locator => review.locator(`[data-review-file="${path}"]`);

// The paths of the stack's sections, in order.
export const sectionPaths = (review: Locator): Promise<string[]> => review.locator('[data-review-stack] > [data-review-file]').evaluateAll((sections) => sections.map((s) => s.getAttribute('data-review-file') ?? ''));

// A file's section brought to the top of the stack as a reader scrolls to it: a wheel, then the scroll (the stack reads a
// scroll with no input before it as a layout change, M4 decision 17 b), as the harness's `selectFile` does. Answers the
// section; at the end of the stack the scroller stops short and the section is in view below its top.
export async function selectReviewFile(review: Locator, path: string): Promise<Locator> {
  const section = reviewSection(review, path);
  await expect(section).toHaveCount(1);
  await scrollIntoSection(review, path, 0);
  await expect(section).toBeInViewport();
  return section;
}

// A reader's scroll to `depth` pixels below the top of a file's section (the same wheel, then the scroll).
export async function scrollIntoSection(review: Locator, path: string, depth: number): Promise<void> {
  await review.locator('[data-review-stack]').evaluate(
    (scroller, { path, depth }) => {
      const section = Array.from(scroller.querySelectorAll<HTMLElement>(':scope > [data-review-file]')).find((each) => each.dataset.reviewFile === path);
      if (!section) throw new Error(`no section for ${path}`);
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      scroller.scrollTop = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + depth;
    },
    { path, depth },
  );
}

// The hunk counter as drawn ("Showing hunk 3 of 6", or "3 of 6" where the long form does not fit, card 1): null while no
// file is loaded.
export const hunkCounter = async (review: Locator): Promise<{ index: number; count: number } | null> => {
  const counter = review.locator('[data-review-hunk]');
  if ((await counter.count()) === 0) return null;
  const found = /(\d+) of (\d+)/.exec((await counter.textContent()) ?? '');
  return found ? { index: Number(found[1]), count: Number(found[2]) } : null;
};

// Where the stack is being read, measured on the page (unified rows): the section at the scroller's top, the diff row at
// the reading edge under its sticky header (M4 decision 16 b) by its line numbers ("old 12 new 13"), and the pixels of
// that row above the edge; with the header's and the section's tops from the scroller's top (a header that sticks reads
// 0 while its section's top is above the scroller's).
export interface StackTop {
  path: string;
  row: string | null; // null: no diff row reaches the edge (a body of words, or the edge on the header)
  offset: number;
  header: number;
  section: number;
}

// `want` names a place read earlier: its row's offset from today's edge is answered too (null: that row is not drawn in
// the section at the top), so a place is compared by its own row, never by whichever row a sub-pixel puts at the edge.
function readTop(review: Locator, want: { path: string; row: string } | null): Promise<(StackTop & { wanted: number | null }) | null> {
  return review.locator('[data-review-stack]').evaluate((scroller, want) => {
    const top = scroller.getBoundingClientRect().top;
    const section = Array.from(scroller.querySelectorAll<HTMLElement>(':scope > [data-review-file]')).find((each) => {
      const box = each.getBoundingClientRect();
      return box.top <= top + 0.5 && box.bottom > top + 0.5;
    });
    if (!section) return null;
    const header = section.querySelector<HTMLElement>(':scope > [data-review-file-header]')!.getBoundingClientRect();
    const edge = header.bottom;
    const lines = (tr: Element) =>
      Array.from(tr.querySelectorAll<HTMLElement>('[data-line-old-num], [data-line-new-num]'))
        .map((cell) => (cell.dataset.lineOldNum ? `old ${cell.dataset.lineOldNum}` : cell.dataset.lineNewNum ? `new ${cell.dataset.lineNewNum}` : ''))
        .filter(Boolean)
        .join(' ');
    let row: string | null = null;
    let offset = 0;
    let wanted: number | null = null;
    for (const tr of Array.from(section.querySelectorAll(':scope > [data-review-body] tr'))) {
      const name = lines(tr);
      if (name === '') continue;
      const box = tr.getBoundingClientRect();
      if (want !== null && want.path === section.dataset.reviewFile && want.row === name) wanted = edge - box.top;
      if (box.top > edge + 0.5) continue;
      row = name;
      offset = edge - box.top;
    }
    return { path: section.dataset.reviewFile!, row, offset, header: header.top - top, section: section.getBoundingClientRect().top - top, wanted };
  }, want);
}

export const stackTop = async (review: Locator): Promise<StackTop | null> => {
  const read = await readTop(review, null);
  return read === null ? null : { path: read.path, row: read.row, offset: read.offset, header: read.header, section: read.section };
};

// The place once the stack has come to rest: two reads a poll apart that agree. A failure names the last read, so a run
// shows where the stack stood.
export async function settledTop(review: Locator): Promise<StackTop> {
  let last = '';
  let read: StackTop | null = null;
  try {
    await expect
      .poll(
        async () => {
          read = await stackTop(review);
          const now = JSON.stringify(read);
          const same = read !== null && read.row !== null && now === last;
          last = now;
          return same;
        },
        { message: 'the stack comes to rest on a diff row' },
      )
      .toBe(true);
  } catch (error) {
    if (error instanceof Error) error.message += `\nthe last read: ${last}`;
    throw error;
  }
  return read!;
}

// The same file and line at the top: the section at the scroller's top is the place's, and the place's own row stands
// at the reading edge within a pixel of where it stood; once reached, and again once the stack has come to rest (so a
// layout still settling cannot pass on a passing frame).
export async function expectPlaceAtTop(review: Locator, place: StackTop, message: string): Promise<void> {
  const there = async () => {
    const read = await readTop(review, place.row === null ? null : { path: place.path, row: place.row });
    return { path: read?.path ?? null, row: place.row, there: read?.wanted !== null && read?.wanted !== undefined && Math.abs(read.wanted - place.offset) <= 1 };
  };
  const want = { path: place.path, row: place.row, there: true };
  await expect.poll(there, { message }).toEqual(want);
  await settledTop(review);
  expect(await there(), `${message}, at rest`).toEqual(want);
}

// The sticky header, measured: the section at the top has scrolled under its header, which stands at the scroller's top.
export function expectHeaderSticks(top: StackTop, message: string): void {
  expect(Math.abs(top.header), `${message}: the header at the scroller's top`).toBeLessThanOrEqual(1);
  expect(top.section, `${message}: the section's top scrolled above it`).toBeLessThan(-1);
}

// The toolbar's parts measured (§F: it wraps by measure, not by a width): the bar's box, the totals' and the controls'
// (Collapse all to View, one box around them), each with its vertical middle, and the lines the toolbar says it drew.
interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  middle: number;
}
export function toolbarLayout(review: Locator): Promise<{ lines: number; bar: Box; totals: Box; controls: Box }> {
  return review.locator('[data-review-toolbar]').evaluate((bar) => {
    const box = (rects: DOMRect[]) => {
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return { top, bottom, left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), middle: (top + bottom) / 2 };
    };
    const of = (selector: string) => bar.querySelector(selector)!.getBoundingClientRect();
    return { lines: Number(bar.getAttribute('data-lines')), bar: box([bar.getBoundingClientRect()]), totals: box([of('[data-review-header]')]), controls: box([of('[data-review-collapse]'), of('[data-review-nav]')]) };
  });
}

// The toolbar as drawn at whatever width it has, measured against the lines it says it drew: on one line its totals
// beside its controls, on two or three (a comment chip of its own line) its controls under its totals; its controls
// inside the bar either way.
export async function expectToolbarAsDrawn(review: Locator, message: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const { lines, bar, totals, controls } = await toolbarLayout(review);
        const laid = lines === 1 ? Math.abs(totals.middle - controls.middle) <= 2 : (lines === 2 || lines === 3) && controls.top >= totals.bottom - 0.5;
        return { laid, inside: controls.left >= bar.left - 0.5 && controls.right <= bar.right + 0.5 };
      },
      { message },
    )
    .toEqual({ laid: true, inside: true });
}

// The View menu opened by a press on its button, then measured: it stands against the button (below it, or above where
// the window has no room below, within the menu's offset) and over it horizontally, and wholly inside the window.
// Answers the open menu; the caller closes it.
export async function expectViewMenuPlaced(review: Locator): Promise<Locator> {
  const page = review.page();
  const trigger = review.locator('[data-review-view]');
  await trigger.click();
  const menu = page.getByRole('menu').filter({ has: page.locator('[data-review-view-item]') });
  await expect(menu).toBeVisible();
  await expect
    .poll(
      async () => {
        const [button, open, room] = [await trigger.boundingBox(), await menu.boundingBox(), await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))];
        if (!button || !open) return null;
        const below = open.y - (button.y + button.height);
        const above = button.y - (open.y + open.height);
        return {
          against: (below >= -0.5 && below <= 8) || (above >= -0.5 && above <= 8),
          over: open.x <= button.x + button.width && open.x + open.width >= button.x,
          inside: open.x >= -0.5 && open.y >= -0.5 && open.x + open.width <= room.width + 0.5 && open.y + open.height <= room.height + 0.5,
        };
      },
      { message: 'the View menu against its button, inside the window' },
    )
    .toEqual({ against: true, over: true, inside: true });
  return menu;
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
export async function shortWindow({ maws, page }: Pick<Product, 'maws' | 'page'>): Promise<void> {
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
// UX wave U13a: `main.tabs` is the one strip, read with `stripOf` and written back through `storedMain`, the store's own.
export async function restoreWithTab(p: Product, tabs: TabRef[]): Promise<void> {
  const stored = await p.page.evaluate(async () => {
    const result = await window.maws.invoke('layout.get', { key: 'main.tabs' });
    return result.ok ? (result.value.value as LayoutMain | null) : null;
  });
  expect(stored, 'the session tab reached layout.json').not.toBeNull();
  const { strip, canonical } = stripOf(stored!);
  expect(canonical, 'the strip as U13a stores it').toBe(true);
  const pane = strip.panes[strip.focusedPane];
  const next: Strip = { ...strip, panes: strip.panes.map((each) => (each === pane ? { tabs: [...each.tabs, ...tabs], activeTabId: tabs.at(-1)!.id } : each)) as Strip['panes'] };
  await p.page.evaluate(async (value) => {
    const result = await window.maws.invoke('layout.set', { key: 'main.tabs', value });
    if (!result.ok) throw new Error(result.error.message);
  }, storedMain(next));
  await p.page.reload();
}
