// P4-B3's cross-surface transfer and restore end to end (docs/doperpowers/plans/2026-10-20-p4-b3-layout.md, M6; the P4
// composite's §2 item 6 and its B3 acceptance line), collected by the bare `pnpm e2e` (`e2e:default`, the product build,
// MAWS_HARNESS=0): a document dragged from a main tab onto the panel and from the panel's record back onto a pane, each
// with an edit typed just before the drop, the edit present exactly once after it (in the editor and in what the host
// exports) and the page's first visible block and the selection carried; a drop onto a surface that already shows the
// document activates that view and closes the source, its last edit kept; the editor header's Expand floating the
// session beside it and folding the right panel, and Restore split docking it with the panel back; and a relaunch that brings the pinned Artifacts tab back on its record
// without ever drawing "No open tabs". Drags are Playwright's mouse over Chromium's HTML5 drag and drop. What a mouse in
// Playwright's Electron cannot do mid-drag (Escape, a modifier at the drop: the prior art's live check 5) is covered by
// the handler tests in src/renderer/src/shell/transfer-drag.test.tsx (C1, C2, Z2) and transfer.test.ts (C4).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';
import { mainTab as chromeTab, mainTabById, mainTabs, moveMainArtifactToPanel, openSurface, closeSurface, pinSurfaceForSessions, surface } from './support/shell';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

// The panel's harness scenario (C8a): two synthetic sessions main serves, so a session's panel can hold tools.
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';
const PARAGRAPHS = 60;
const line = (k: number) => `Paragraph ${k}: a line of its own.`;

let launch: MawsLaunch | null = null;
let userData: string | null = null;
let scratch: string | null = null;

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-e2e-transfer-'));
  scratch = mkdtempSync(join(tmpdir(), 'maws-e2e-transfer-scratch-'));
});
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  for (const dir of [userData, scratch]) if (dir) rmSync(dir, { recursive: true, force: true });
  userData = scratch = null;
});

// The product over the scenario on this test's profile, its window wide enough for a session and an editor side by side.
// `size` null: the window as launched (a relaunch restores its placement, which a size wider than the display would make
// a maximized one).
async function start(requireFirst?: string, size: [number, number] | null = [1440, 860]): Promise<Page> {
  launch = await launchMaws({ userData: userData!, requireFirst, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS } });
  const { page, app } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  if (size === null) return page;
  const [width, height] = size;
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())!.setContentSize(w, h), [width, height] as const);
  await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height] as const);
  return page;
}

const mainRegion = (page: Page) => page.locator('[data-region="main"]');
const panelRegion = (page: Page) => page.locator('[data-region="panel"]');
// UX2 owner ruling: pane-owned tabs render in the single chrome row, outside the main region's DOM.
const mainTab = (page: Page, artifactId: string) => mainTabById(page, `artifact:${artifactId}`);
const inMain = (page: Page, artifactId: string) => mainRegion(page).locator(`[data-artifact-tab="${artifactId}"]`);
const inPanel = (page: Page, artifactId: string) => panelRegion(page).locator(`[data-artifact-record="${artifactId}"]`);
const editorIn = (scope: Locator) => scope.locator('.ds-doc .ProseMirror').first();

// UX2 removes the generic Artifacts launcher, not existing record transfers. Establish the real singleton by moving a
// temporary Library document through the main-tab route, pin it across sessions, and return it to its list.
async function pinArtifactsTool(page: Page): Promise<void> {
  await (await sidebarRow(page, 'Harness A')).click();
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Transfer staging' });
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: 'Transfer staging', exact: true }).click({ timeout: 15_000 });
  await expect(editorIn(inMain(page, artifact.id))).toBeVisible({ timeout: 15_000 });
  const record = await moveMainArtifactToPanel(page, artifact.id);
  await pinSurfaceForSessions(page, 'Artifacts');
  await record.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(surface(page, 'artifacts').locator('[data-artifacts-list]')).toBeVisible();
}

// A document of PARAGRAPHS lines, opened from the library in a main tab (and typed there).
async function documentInMain(page: Page, title: string): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const editor = editorIn(inMain(page, artifact.id));
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  for (let k = 1; k <= PARAGRAPHS; k++) {
    await page.keyboard.insertText(line(k));
    if (k < PARAGRAPHS) await page.keyboard.press('Enter');
  }
  await expect(editor.locator(':scope > p').filter({ hasText: line(PARAGRAPHS) })).toHaveCount(1);
  await durable(inMain(page, artifact.id));
  return artifact.id;
}

// The document in the pinned Artifacts tool's record view, opened from its list (P3-L's "open": the panel's own view).
async function openInPanel(page: Page, artifactId: string): Promise<void> {
  const panel = panelRegion(page);
  await openSurface(page, 'Artifacts');
  await panel.getByRole('button', { name: 'All', exact: true }).click();
  await panel.locator(`[data-artifact-row][data-artifact-id="${artifactId}"]`).click({ timeout: 15_000 });
  await expect(editorIn(inPanel(page, artifactId))).toBeVisible({ timeout: 15_000 });
}

// Every edit of the replica behind the editor under `scope` acknowledged by the host.
async function durable(scope: Locator): Promise<void> {
  const unsaved = () =>
    editorIn(scope).evaluate((el) => {
      const editor = (el as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
      return editor?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
    });
  await expect.poll(unsaved, { timeout: 10_000, message: 'every edit acknowledged by the host' }).toBe(0);
}

// The page scrolled so paragraph `k` is its first visible block, flush with its top.
async function scrollTo(scope: Locator, k: number): Promise<void> {
  await scope.locator('.ds-doc').first().evaluate((page, text) => {
    const block = Array.from(page.querySelectorAll<HTMLElement>('.ProseMirror > p')).find((p) => p.textContent?.startsWith(text))!;
    page.scrollTop += block.getBoundingClientRect().top - page.getBoundingClientRect().top;
  }, `Paragraph ${k}:`);
  await expect.poll(() => firstBlock(scope)).toMatch(new RegExp(`^Paragraph ${k}:`));
}

// The text of the page's first block whose bottom is below the page's top.
const firstBlock = (scope: Locator) =>
  scope
    .locator('.ds-doc')
    .first()
    .evaluate((page) => {
      const top = page.getBoundingClientRect().top;
      return Array.from(page.querySelectorAll<HTMLElement>('.ProseMirror > *')).find((block) => block.getBoundingClientRect().bottom > top + 1)?.textContent ?? null;
    });

// The selection as the block's text up to the caret (the editor's own state, so a blurred editor answers too).
const caretContext = (scope: Locator) =>
  editorIn(scope).evaluate((el) => {
    const editor = (el as HTMLElement & { editor?: { state: { selection: { empty: boolean; $from: { parent: { textContent: string }; parentOffset: number } } } } }).editor!;
    const { empty, $from } = editor.state.selection;
    return { empty, before: $from.parent.textContent.slice(0, $from.parentOffset) };
  });

// The caret at the end of paragraph `k` (a click past its text; the End key would scroll the page, smoothly, to its end),
// and `text` typed there; answers once the page has stopped scrolling.
async function typeAtEndOf(page: Page, scope: Locator, k: number, text: string): Promise<void> {
  const paragraph = editorIn(scope).locator(':scope > p').filter({ hasText: `Paragraph ${k}:` });
  const box = (await paragraph.boundingBox())!;
  await paragraph.click({ position: { x: box.width - 2, y: box.height / 2 } });
  await page.keyboard.insertText(text);
  await stillAt(scope);
}

// The page's scroll at rest: the same offset over two reads a tenth of a second apart (its scrolls are smooth).
async function stillAt(scope: Locator): Promise<void> {
  const offset = () => scope.locator('.ds-doc').first().evaluate((page) => page.scrollTop);
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const now = await offset();
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [100], message: 'the page at rest' })
    .toBe(true);
}

const occurrences = (text: string, of: string) => text.split(of).length - 1;

// An application menu item by id (Playwright's keys never reach the macOS menu's key equivalents).
async function menu(id: string): Promise<void> {
  const clicked = await launch!.app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return true;
  }, id);
  expect(clicked, `menu item ${id} exists and is enabled`).toBe(true);
}

// What the host holds: the document exported as Markdown (main's export service reads the host's current revision).
async function hostText(page: Page, artifactId: string): Promise<string> {
  const { path } = await ok<{ path: string }>(page, 'artifacts.export', { artifactId, format: 'md' });
  return readFileSync(path, 'utf8');
}

// An HTML5 drag of `source` onto `target` by the mouse: pressed on the source, moved in steps (Chromium starts the drag
// past its threshold), over the target until it highlights (`over`, when given), released.
async function drag(page: Page, source: Locator, target: Locator, over?: Locator): Promise<void> {
  const from = (await source.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  const to = (await target.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  if (over) await expect(over).toBeVisible();
  await page.mouse.up();
}

test('a document moves main → panel and panel → main by drag: the edit typed just before each drop is there once; the first visible block and the selection come across', async () => {
  test.setTimeout(120_000);
  const page = await start();
  await pinArtifactsTool(page);
  const id = await documentInMain(page, 'B3 transfer');
  const panel = panelRegion(page);

  await test.step('main → panel: the main tab onto the panel, "Move to side surface" shown over it', async () => {
    await scrollTo(inMain(page, id), 20);
    await typeAtEndOf(page, inMain(page, id), 24, ' main-edit');
    const shown = await firstBlock(inMain(page, id)); // where the reader is as the drag starts
    expect(shown, 'a page scrolled into the document').toMatch(/^Paragraph (1\d|2\d):/);
    await drag(page, mainTab(page, id), panel, panel.getByText('Move to side surface', { exact: true }));
    await expect(inPanel(page, id)).toBeVisible();
    await expect(mainTab(page, id), 'the main tab closed').toHaveCount(0);
    await expect(inMain(page, id)).toHaveCount(0);
    const record = inPanel(page, id);
    await expect(editorIn(record)).toContainText(line(PARAGRAPHS));
    expect(occurrences((await editorIn(record).textContent())!, 'main-edit'), 'the edit once in the panel’s editor').toBe(1);
    await expect.poll(() => firstBlock(record), 'the first visible block carried').toBe(shown);
    expect(await caretContext(record), 'the caret carried after the edit').toEqual({ empty: true, before: `${line(24)} main-edit` });
    await durable(record);
    expect(occurrences(await hostText(page, id), 'main-edit'), 'the edit once at the host').toBe(1);
  });

  await test.step('panel → main: the record’s grip onto the main pane, "Move to tab" shown over it', async () => {
    const record = inPanel(page, id);
    await scrollTo(record, 30);
    await typeAtEndOf(page, record, 33, ' panel-edit');
    const shown = await firstBlock(record);
    expect(shown, 'a page scrolled into the document').toMatch(/^Paragraph (2\d|3\d):/);
    const pane = mainRegion(page).locator('[data-pane-drop-target="0"]');
    await drag(page, record.getByTitle('Drag to move to a tab'), mainRegion(page).locator('[data-pane="0"] > [role="tabpanel"]'), pane.getByText('Move to tab', { exact: true }));
    await expect(inMain(page, id)).toBeVisible();
    await expect(inPanel(page, id), 'the panel let it go').toHaveCount(0);
    await expect(panel.locator('[data-artifacts-list]'), 'the panel’s tab back on its list').toBeVisible();
    const tab = inMain(page, id);
    const text = (await editorIn(tab).textContent())!;
    expect([occurrences(text, 'main-edit'), occurrences(text, 'panel-edit')], 'each edit once in main’s editor').toEqual([1, 1]);
    await expect.poll(() => firstBlock(tab), 'the first visible block carried').toBe(shown);
    expect(await caretContext(tab), 'the caret carried after the edit').toEqual({ empty: true, before: `${line(33)} panel-edit` });
    await durable(tab);
    const host = await hostText(page, id);
    expect([occurrences(host, 'main-edit'), occurrences(host, 'panel-edit')], 'each edit once at the host').toEqual([1, 1]);
  });
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('a drop onto a panel already showing the document activates it and closes the main tab, keeping the edit typed just before', async () => {
  test.setTimeout(120_000);
  const page = await start();
  await pinArtifactsTool(page);
  const id = await documentInMain(page, 'B3 activate');
  await openInPanel(page, id); // a second view, through the list (P3-L Decision Log 8), never by a drag
  const panel = panelRegion(page);
  const record = inPanel(page, id);

  await typeAtEndOf(page, inMain(page, id), 5, ' last-main-edit');
  await drag(page, mainTab(page, id), panel, panel.getByText('Move to side surface', { exact: true }));
  await expect(mainTab(page, id), 'the source closed').toHaveCount(0);
  await expect(record, 'the panel’s own view kept').toBeVisible();
  await expect(surface(page, 'artifacts'), 'one Artifacts singleton surface, not a cross-tool tab').toHaveCount(1);
  await expect.poll(async () => occurrences((await editorIn(record).textContent())!, 'last-main-edit'), 'the edit reaches the panel’s view, once').toBe(1);
  await durable(record);
  expect(occurrences(await hostText(page, id), 'last-main-edit'), 'once at the host').toBe(1);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

const regionWidth = (page: Page, region: 'sidebar' | 'main' | 'panel') => page.evaluate((r) => Math.round(document.querySelector(`[data-region="${r}"]`)?.getBoundingClientRect().width ?? -1), region);

test('the editor header’s Expand keeps a compressed composer and folds the right panel; reopening and Restore split preserve the draft', async () => {
  test.setTimeout(120_000);
  const page = await start();
  await (await sidebarRow(page, 'Harness A')).click();
  const id = await documentInMain(page, 'B3 expand');
  await menu('pane.split'); // the document into a right pane
  const right = mainTabs(page).getByRole('tablist', { name: 'Right pane tabs' });
  await expect(right.locator(`[data-tab-id="artifact:${id}"]`)).toBeVisible();
  const left = mainTabs(page).getByRole('tablist', { name: 'Left pane tabs' });
  await left.getByRole('tab', { name: /^Harness A/ }).click(); // the session beside it (the library tab stayed active there)
  // UX2 optional surfaces: explicitly open a narrow tool so Expand/Restore still exercises folding a real column.
  await openSurface(page, 'Session info');
  const header = inMain(page, id).locator('xpath=ancestor::*[@role="tabpanel"][1]');
  const card = mainRegion(page).getByRole('region', { name: 'Session card' });
  const compact = mainRegion(page).getByRole('region', { name: 'Compact session composer' });
  const panelBefore = await regionWidth(page, 'panel');
  expect(panelBefore, 'the panel open beside the split').toBeGreaterThan(0);

  await header.getByRole('button', { name: 'Expand pane' }).click();
  await expect(card).toHaveCount(0);
  await expect(compact).toBeVisible();
  await expect.poll(() => regionWidth(page, 'panel'), 'Expand folds the right panel (P4 Decision Log 40)').toBeLessThanOrEqual(0);
  const message = compact.getByRole('textbox', { name: 'Message' });
  await expect(message).toBeFocused();
  await message.fill('Keep this draft through reopening and restore');
  await expect(mainRegion(page).getByRole('separator', { name: 'Resize panes' }), 'no divider while floating').toHaveCount(0);
  await expect(editorIn(inMain(page, id))).toBeVisible();
  const area = (await mainRegion(page).locator('[data-main-area]').boundingBox())!;
  const editorBox = (await inMain(page, id).boundingBox())!;
  expect(Math.round(editorBox.width), 'the editor spans the main area').toBeGreaterThanOrEqual(Math.round(area.width) - 2);

  await compact.getByRole('button', { name: 'Show session card' }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Message' })).toContainText('Keep this draft through reopening and restore');
  await expect(card.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await header.getByRole('button', { name: 'Restore split', pressed: true }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => regionWidth(page, 'panel'), 'the panel back as it was').toBe(panelBefore);
  await expect(left.getByRole('tab', { name: /^Harness A/ })).toBeVisible();
  await expect(mainRegion(page).getByRole('separator', { name: 'Resize panes' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Expand pane', pressed: false })).toBeVisible();
  await expect(mainRegion(page).getByRole('textbox', { name: 'Message' })).toContainText('Keep this draft through reopening and restore');
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// A comment started on paragraph k's "a line" (selected by a DOM range, as B1's e2e does; then the toolbar's Comment)
// and typed, not sent: the compose card's field.
async function startComment(page: Page, scope: Locator, k: number, text: string): Promise<void> {
  await editorIn(scope).evaluate((el, prefix) => {
    const block = Array.from(el.children).find((child) => child.textContent?.startsWith(prefix))!;
    const node = document.createTreeWalker(block, NodeFilter.SHOW_TEXT).nextNode()!;
    const at = node.textContent!.indexOf('a line');
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 'a line'.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  }, `Paragraph ${k}:`);
  await scope.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Add comment', exact: true }).click();
  const field = scope.locator('[data-comment-card] textarea');
  await expect(field).toBeFocused();
  await page.keyboard.insertText(text);
  await expect(field).toHaveValue(text);
}
// Every compose field in the window holding `text`.
const draftFields = (page: Page, text: string) =>
  page.evaluate((text) => Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-comment-card] textarea')).filter((field) => field.value === text).length, text);

test('a comment draft moves with its document, panel → main and back, kept once', async () => {
  test.setTimeout(120_000);
  const page = await start();
  await pinArtifactsTool(page); // Harness A in main: a panel record's comment has a session to go to
  const id = await documentInMain(page, 'B3 draft');
  await mainTab(page, id).getByRole('button', { name: /^Close / }).click(); // the record will be the document's one view
  await expect(mainTab(page, id)).toHaveCount(0);
  await chromeTab(page, /^Harness A/).click();
  await openInPanel(page, id);
  const panel = panelRegion(page);
  const DRAFT = 'draft-note kept across the move';
  await startComment(page, inPanel(page, id), 5, DRAFT);
  // the draft's thread drawn active (Decision Log 37: it stays so in the editor a move makes)
  const activePassage = (scope: Locator) => editorIn(scope).locator('.comment-active');
  await expect(activePassage(inPanel(page, id)).first()).toBeVisible();

  // panel → main by the right edge, so the session stays beside it
  await drag(page, inPanel(page, id).getByTitle('Drag to move to a tab'), mainRegion(page).getByTestId('drop-edge'), mainRegion(page).getByTestId('drop-edge-highlight'));
  await expect(inMain(page, id)).toBeVisible();
  await expect(inMain(page, id).locator('[data-comment-card] textarea'), 'the draft in main’s card').toHaveValue(DRAFT);
  expect(await draftFields(page, DRAFT), 'one draft').toBe(1);
  await expect(activePassage(inMain(page, id)).first(), 'the thread still active in main').toBeVisible();

  await drag(page, mainTab(page, id), panel, panel.getByText('Move to side surface', { exact: true }));
  await expect(inPanel(page, id)).toBeVisible();
  await expect(inPanel(page, id).locator('[data-comment-card] textarea'), 'the draft back in the panel’s card').toHaveValue(DRAFT);
  expect(await draftFields(page, DRAFT), 'one draft').toBe(1);
  await expect(activePassage(inPanel(page, id)).first(), 'the thread still active in the panel').toBeVisible();
  // the card closed (its draft with it), so the quit has no unsent comment to ask about
  await inPanel(page, id).locator('[data-comment-card]').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-comment-card]')).toHaveCount(0);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// The controller's measurement (at B1's landing): B1's margin tier (src/artifacts/comments/margin-tiers.ts, `tierFor`)
// reads only the side space beside the page; Expand gives the document the main region minus its conversation. At
// 1280 and 1512 × 900 with UX2's 240px sidebar and narrow default Artifacts surface and an open thread: (c) in the panel's record with the
// panel floated (P3-G's card over it), (a) alone in main with the panel docked, (d) the same with the panel closed, (b)
// beside a session in main after Expand pane, which folds the right panel (P4-B3x, P4 Decision Log 40: the expanded
// document keeps WR #12's reading column beside the conversation), then after Restore split, the panel back and the tier as it was in the split. What
// the margin draws in each is asserted; the widths go to the report.
type MarginReading = { host: number; body: number; scrollBox: number; page: number; conversation: number; tier: string | null; threads: number };
const marginOf = (scope: Locator): Promise<MarginReading> =>
  scope.evaluate((root) => {
    const scroll = root.querySelector<HTMLElement>('.ds-doc')!;
    return {
      host: Math.round(root.getBoundingClientRect().width),
      body: Math.round(root.querySelector('.doc-editor-body')!.getBoundingClientRect().width),
      scrollBox: scroll.clientWidth,
      conversation: Math.round(root.querySelector('[data-document-session-column]')?.getBoundingClientRect().width ?? 0),
      page: Math.round(root.querySelector('.ds-doc-page')!.getBoundingClientRect().width),
      tier: root.querySelector('.doc-margin')?.getAttribute('data-margin-tier') ?? null,
      threads: new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-thread]')).map((el) => el.dataset.thread)).size,
    };
  });
// A reading taken once it holds still: two consecutive polls (expect.poll's intervals, 100 ms and up) that agree. The tier
// follows the widths through a ResizeObserver and a React commit, so a single read can land between them, the scroll box
// already at its new width and the tier still the old layout's (measured: two frames at 1211 px drawn 'off' after ⌥⌘B).
async function settled<T>(read: () => Promise<T>, message: string): Promise<T> {
  let last: string | undefined;
  let value: T | undefined;
  await expect
    .poll(
      async () => {
        value = await read();
        const now = JSON.stringify(value);
        const same = now === last;
        last = now;
        return same;
      },
      { message, timeout: 10_000 },
    )
    .toBe(true);
  return value!;
}

for (const [width, height] of [[1280, 820], [1512, 982]] as const) test(`the document margin’s tier at ${width} × ${height}: in the floated panel, alone in main, with the panel closed, after Expand pane and after Restore split`, async () => {
  test.setTimeout(120_000);
  const page = await start(undefined, [width, height]);
  await pinArtifactsTool(page);
  const id = await documentInMain(page, 'B3 margin');
  await mainTab(page, id).getByRole('button', { name: /^Close / }).click();
  await chromeTab(page, /^Harness A/).click();
  await openInPanel(page, id);
  // an open thread that needs no session to stay (B1's e2e's way): its compose card resolved, then reopened from the
  // Comments panel, so the thread outlives the comment's target (a document alone in main has no session to go to)
  await startComment(page, inPanel(page, id), 5, 'an open thread'); // Harness A in main gives the comment a session
  const record = inPanel(page, id);
  await page.locator('[data-comment-card]').getByRole('button', { name: 'Resolve' }).click();
  await expect(page.locator('[data-comment-card]')).toHaveCount(0);
  const toolbar = record.getByRole('toolbar', { name: 'Formatting' });
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await record.getByRole('complementary', { name: 'Comments' }).locator('article[data-thread]').getByRole('button', { name: 'Reopen' }).click();
  await toolbar.getByRole('button', { name: /^Comments/ }).click();
  await expect(record.getByRole('complementary', { name: 'Comments' })).toHaveCount(0);
  const widths = async () => ({ sidebar: await regionWidth(page, 'sidebar'), main: await regionWidth(page, 'main'), panel: await regionWidth(page, 'panel') });
  const readings: Record<string, unknown> = {};

  // (c) the panel floated (⌥⌘B): the panel spans the area, the session's card over its body at the bottom right
  await menu('panel.float');
  const card = panelRegion(page).getByRole('region', { name: 'Session card' });
  await expect(card).toBeVisible();
  await expect.poll(async () => (await widths()).main, 'the floated panel takes main’s place').toBeLessThanOrEqual(0);
  const coverage = () => page.evaluate(() => {
    const card = document.querySelector('[data-region="panel"] [aria-label="Session card"]')!.getBoundingClientRect();
    const meets = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < card.right && r.right > card.left && r.top < card.bottom && r.bottom > card.top;
    const margin = document.querySelector('[data-region="panel"] .doc-margin');
    return {
      column: margin ? meets(margin.getBoundingClientRect()) : null,
      entries: Array.from(document.querySelectorAll('[data-region="panel"] .doc-margin [data-margin-entry]')).filter((entry) => meets(entry.getBoundingClientRect())).length,
    };
  });
  const { cardCovers, ...floated } = await settled(async () => ({ ...(await widths()), ...(await marginOf(inPanel(page, id))), cardCovers: await coverage() }), '(c) settled');
  readings.c = { ...floated, cardCovers };
  await menu('panel.float');
  await expect(card).toHaveCount(0);

  // (a) alone in main, the panel docked: the record's grip onto main's pane
  await drag(page, inPanel(page, id).getByTitle('Drag to move to a tab'), mainRegion(page).locator('[data-pane="0"] > [role="tabpanel"]'), mainRegion(page).getByText('Move to tab', { exact: true }));
  await expect(inMain(page, id)).toBeVisible();
  const alone = await settled(async () => ({ ...(await widths()), ...(await marginOf(inMain(page, id))) }), '(a) settled');
  readings.a = alone;

  // (d) the panel closed
  await closeSurface(page, 'Artifacts');
  await expect.poll(async () => (await widths()).panel).toBeLessThanOrEqual(0);
  await expect.poll(async () => (await marginOf(inMain(page, id))).scrollBox).toBeGreaterThan(alone.scrollBox);
  const closed = await settled(async () => ({ ...(await widths()), ...(await marginOf(inMain(page, id))) }), '(d) settled');
  readings.d = closed;
  await openSurface(page, 'Artifacts');
  await expect.poll(async () => (await widths()).panel).toBeGreaterThan(0);

  // (b) beside a session in main, then Expand pane (the session floats into the main area's card and the right panel
  // folds), then Restore split (the session docked beside it, the panel back)
  await menu('pane.split');
  await mainTabs(page).getByRole('tablist', { name: 'Left pane tabs' }).getByRole('tab', { name: /^Harness A/ }).click();
  const header = inMain(page, id).locator('xpath=ancestor::*[@role="tabpanel"][1]');
  await expect.poll(async () => (await marginOf(inMain(page, id))).scrollBox, 'the document in its half of the split').toBeLessThan(alone.scrollBox);
  const split = await settled(() => marginOf(inMain(page, id)), '(b) split settled');
  await test.info().attach(`before-expand-${width}x${height}`, { body: await page.screenshot(), contentType: 'image/png' });
  await header.getByRole('button', { name: 'Expand pane' }).click();
  await expect(mainRegion(page).getByRole('region', { name: 'Compact session composer' })).toBeVisible();
  await expect.poll(async () => (await widths()).panel, 'Expand folds the right panel').toBeLessThanOrEqual(0);
  // Expand releases the conversation reservation; record both dimensions and screenshots for acceptance.
  const expanded = await settled(async () => ({ ...(await widths()), ...(await marginOf(inMain(page, id))) }), '(b) expanded settled');
  await test.info().attach(`after-expand-${width}x${height}`, { body: await page.screenshot(), contentType: 'image/png' });
  await header.getByRole('button', { name: 'Restore split', pressed: true }).click();
  await expect(mainRegion(page).getByRole('region', { name: 'Session card' })).toHaveCount(0);
  await expect.poll(async () => (await widths()).panel, 'leaving Expand opens the panel again').toBe(alone.panel);
  await expect.poll(async () => (await marginOf(inMain(page, id))).scrollBox, 'the document in its half of the split again').toBe(split.scrollBox);
  const restored = await settled(async () => ({ ...(await widths()), ...(await marginOf(inMain(page, id))) }), '(b) restored settled');
  readings.b = { ...expanded, split, restored };
  test.info().annotations.push({ type: 'margin readings', description: JSON.stringify(readings) });
  const gain = expanded.scrollBox - alone.scrollBox;
  test.info().annotations.push({ type: 'Expand width gain', description: `${width}px window: alone ${alone.scrollBox}px, expanded ${expanded.scrollBox}px, gain ${gain}px` });
  await test.info().attach(`margin-accounting-${width}`, { body: JSON.stringify({ width, gain, readings }, null, 2), contentType: 'application/json' });
  expect(cardCovers, 'the floated conversation does not cover the reserved comments margin').toEqual({ column: false, entries: 0 });

  // Runtime geometry, not snapshot tiers: off below a 720px body; cards once the page leaves at least
  // 26px + 282px + 25px = 333px for them; icons otherwise. All space beside the page has a named owner.
  const cases = { floated, alone, closed, split, expanded, restored };
  for (const [name, reading] of Object.entries(cases)) {
    expect(reading.body + reading.conversation, `${name}: the document and conversation account for the whole host`).toBe(reading.host);
    expect(reading.scrollBox, `${name}: closed document tools reserve no empty column`).toBe(reading.body);
    const tier = reading.body < 720 ? 'off' : reading.scrollBox - reading.page >= 333 ? 'cards' : 'icons';
    expect(reading.tier, `${name}: margin tier follows its measured body and page side space`).toBe(tier);
    expect(reading.threads, `${name}: the open thread survives every layout`).toBe(1);
  }
  expect(floated.conversation, 'WR #12 reserves the open conversation’s actual default column').toBe(420);
  for (const reading of [alone, closed, split, expanded, restored]) expect(reading.conversation, 'a docked session leaves no conversation column').toBe(0);
  expect(alone.host, 'the alone document fills its main region').toBe(alone.main);
  expect(closed.host, 'closing the panel leaves no empty column beside the main document').toBe(closed.main);
  expect(expanded.host, 'the expanded document and conversation fill the whole main region').toBe(expanded.main);
  expect(expanded.main, 'the expanded document has the panel-closed main column').toBe(closed.main);
  expect(alone.sidebar + alone.main + alone.panel, 'docked regions account for the whole window').toBe(width);
  expect(closed.sidebar + closed.main, 'closed-panel regions account for the whole window').toBe(width);
  expect(expanded.scrollBox, 'Expand gives the document every pixel beside the 240px sidebar').toBe(width - 240);
  expect(gain, 'Expand returns the narrow surface’s full 420px to the document').toBe(420);
  expect(expanded.scrollBox, 'Expand is wider than the preceding split').toBeGreaterThan(split.scrollBox);
});

// Loaded in main before its entry (launchMaws's requireFirst): a frame preload registered on the window's session before
// any window exists, so it runs in the page before the renderer's own code and watches the DOM from its first node. It
// marks the document element when "No open tabs" is ever drawn (a text node or the empty pane's label), which a
// relaunch over saved tabs must never do; a fresh profile's empty main area draws it, the watch's positive control.
const NO_TABS_PRELOAD = `const NEEDLE = 'No open tabs';
const seen = () => document.documentElement && document.documentElement.setAttribute('data-e2e-saw-no-open-tabs', '');
const has = (node) => node && ((node.textContent || '').includes(NEEDLE) || (node.getAttribute && node.getAttribute('aria-label') === NEEDLE));
new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === 'attributes' || record.type === 'characterData') { if (has(record.target)) seen(); continue; }
    for (const node of record.addedNodes) if (has(node)) seen();
  }
}).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
`;
const noTabsHook = (preload: string) => `const { app, session } = require('electron');
app.once('ready', () => session.defaultSession.registerPreloadScript({ type: 'frame', filePath: ${JSON.stringify(preload)} }));
`;
const sawNoOpenTabs = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-e2e-saw-no-open-tabs'));

test('a relaunch brings the pinned Artifacts tab back on its record and never draws "No open tabs"', async () => {
  test.setTimeout(150_000); // two launches
  const preload = join(scratch!, 'no-open-tabs-preload.js');
  const hook = join(scratch!, 'no-open-tabs-hook.cjs');
  writeFileSync(preload, NO_TABS_PRELOAD);
  writeFileSync(hook, noTabsHook(preload));

  let page = await test.step('first launch', () => start(hook, null));
  await expect.poll(() => sawNoOpenTabs(page), 'the watch sees a fresh profile’s empty main area').toBe(true);
  await pinArtifactsTool(page);
  const id = await documentInMain(page, 'B3 restore');
  await openInPanel(page, id);
  // a main area with tabs to restore: the session and the document
  await expect(chromeTab(page, /^Harness A/)).toHaveCount(1);
  await expect(mainTab(page, id)).toHaveCount(1);
  // what persistence wrote before the quit: the pinned tab's record (row 290's key)
  await expect
    .poll(async () => JSON.stringify((await ok<{ value: unknown }>(page, 'layout.get', { key: 'panelTools.params' })).value))
    .toContain(id);
  await test.step('quit', () => launch!.cleanup());
  launch = null;

  page = await test.step('relaunch', () => start(hook, null));
  const panel = panelRegion(page);
  await expect(inPanel(page, id), 'the pinned Artifacts tab back on its record').toBeVisible({ timeout: 15_000 });
  await expect(editorIn(inPanel(page, id))).toContainText(line(PARAGRAPHS));
  await expect(surface(page, 'artifacts')).toBeVisible();
  await expect(panel.locator('[data-surface]'), 'only the restored record surface, no summary column').toHaveCount(1);
  await expect(mainTab(page, id)).toHaveCount(1);
  expect(await sawNoOpenTabs(page), 'no "No open tabs" frame at any moment of the relaunch').toBe(false);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
