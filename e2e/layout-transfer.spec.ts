// P4-B3's cross-surface transfer and restore end to end (docs/doperpowers/plans/2026-10-20-p4-b3-layout.md, M6; the P4
// composite's §2 item 6 and its B3 acceptance line), collected by the bare `pnpm e2e` (`e2e:default`, the product build,
// MAWS_HARNESS=0): a document dragged from a main tab onto the panel and from the panel's record back onto a pane, each
// with an edit typed just before the drop, the edit present exactly once after it (in the editor and in what the host
// exports) and the page's first visible block and the selection carried; a drop onto a surface that already shows the
// document activates that view and closes the source, its last edit kept; the editor header's Expand floating the
// session beside it and Restore split docking it; and a relaunch that brings the pinned Artifacts tab back on its record
// without ever drawing "No open tabs". Drags are Playwright's mouse over Chromium's HTML5 drag and drop. What a mouse in
// Playwright's Electron cannot do mid-drag (Escape, a modifier at the drop: the prior art's live check 5) is covered by
// the handler tests in src/renderer/src/shell/transfer-drag.test.tsx (C1, C2, Z2) and transfer.test.ts (C4).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

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
const mainTab = (page: Page, artifactId: string) => mainRegion(page).locator(`[role="tab"][data-tab-id="artifact:${artifactId}"]`);
const inMain = (page: Page, artifactId: string) => mainRegion(page).locator(`[data-artifact-tab="${artifactId}"]`);
const inPanel = (page: Page, artifactId: string) => panelRegion(page).locator(`[data-artifact-record="${artifactId}"]`);
const editorIn = (scope: Locator) => scope.locator('.ds-doc .ProseMirror').first();

// The Artifacts tool added in Harness A's panel and pinned (tools belong to a session; a pin stays beside whatever main
// shows).
async function pinArtifactsTool(page: Page): Promise<void> {
  const panel = panelRegion(page);
  await (await sidebarRow(page, 'Harness A')).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Artifacts' }).click();
  await panel.getByRole('button', { name: 'Pin Artifacts' }).click();
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
  await panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }).click();
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

  await test.step('main → panel: the main tab onto the panel, "Move to panel" shown over it', async () => {
    await scrollTo(inMain(page, id), 20);
    await typeAtEndOf(page, inMain(page, id), 24, ' main-edit');
    const shown = await firstBlock(inMain(page, id)); // where the reader is as the drag starts
    expect(shown, 'a page scrolled into the document').toMatch(/^Paragraph (1\d|2\d):/);
    await drag(page, mainTab(page, id), panel, panel.getByText('Move to panel', { exact: true }));
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
  await drag(page, mainTab(page, id), panel, panel.getByText('Move to panel', { exact: true }));
  await expect(mainTab(page, id), 'the source closed').toHaveCount(0);
  await expect(record, 'the panel’s own view kept').toBeVisible();
  await expect(panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/ }), 'one Artifacts tab').toHaveCount(1);
  await expect.poll(async () => occurrences((await editorIn(record).textContent())!, 'last-main-edit'), 'the edit reaches the panel’s view, once').toBe(1);
  await durable(record);
  expect(occurrences(await hostText(page, id), 'last-main-edit'), 'once at the host').toBe(1);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('the editor header’s Expand floats the session beside it into the main area’s card, and Restore split docks it', async () => {
  test.setTimeout(120_000);
  const page = await start();
  await (await sidebarRow(page, 'Harness A')).click();
  const id = await documentInMain(page, 'B3 expand');
  await menu('pane.split'); // the document into a right pane
  const right = page.getByRole('tablist', { name: 'Right pane tabs' });
  await expect(right.locator(`[data-tab-id="artifact:${id}"]`)).toBeVisible();
  const left = page.getByRole('tablist', { name: 'Left pane tabs' });
  await left.getByRole('tab', { name: /^Harness A/ }).click(); // the session beside it (the library tab stayed active there)
  const header = inMain(page, id).locator('xpath=ancestor::*[@role="tabpanel"][1]');
  const card = mainRegion(page).getByRole('region', { name: 'Session card' });

  await header.getByRole('button', { name: 'Expand pane' }).click();
  await expect(card).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await expect(mainRegion(page).getByRole('separator', { name: 'Resize panes' }), 'no divider while floating').toHaveCount(0);
  await expect(editorIn(inMain(page, id))).toBeVisible();
  const area = (await mainRegion(page).locator('[data-main-area]').boundingBox())!;
  const editorBox = (await inMain(page, id).boundingBox())!;
  expect(Math.round(editorBox.width), 'the editor spans the main area').toBeGreaterThanOrEqual(Math.round(area.width) - 2);

  await header.getByRole('button', { name: 'Restore split', pressed: true }).click();
  await expect(card).toHaveCount(0);
  await expect(left.getByRole('tab', { name: /^Harness A/ })).toBeVisible();
  await expect(mainRegion(page).getByRole('separator', { name: 'Resize panes' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Expand pane', pressed: false })).toBeVisible();
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
  await scope.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment', exact: true }).click();
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
  await mainRegion(page).getByRole('tab', { name: /^Harness A/ }).click();
  await openInPanel(page, id);
  const panel = panelRegion(page);
  const DRAFT = 'draft-note kept across the move';
  await startComment(page, inPanel(page, id), 5, DRAFT);

  // panel → main by the right edge, so the session stays beside it
  await drag(page, inPanel(page, id).getByTitle('Drag to move to a tab'), mainRegion(page).getByTestId('drop-edge'), mainRegion(page).getByTestId('drop-edge-highlight'));
  await expect(inMain(page, id)).toBeVisible();
  await expect(inMain(page, id).locator('[data-comment-card] textarea'), 'the draft in main’s card').toHaveValue(DRAFT);
  expect(await draftFields(page, DRAFT), 'one draft').toBe(1);

  await drag(page, mainTab(page, id), panel, panel.getByText('Move to panel', { exact: true }));
  await expect(inPanel(page, id)).toBeVisible();
  await expect(inPanel(page, id).locator('[data-comment-card] textarea'), 'the draft back in the panel’s card').toHaveValue(DRAFT);
  expect(await draftFields(page, DRAFT), 'one draft').toBe(1);
  // the card closed (its draft with it), so the quit has no unsent comment to ask about
  await inPanel(page, id).locator('[data-comment-card]').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-comment-card]')).toHaveCount(0);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// The controller's measurement (at B1's landing): B1's margin tier (src/artifacts/comments/margin-tiers.ts, `tierFor`)
// reads only the side space beside the page; our Expand pane widens the document to the main column. At 1512 × 900 with
// the default layout (sidebar 300, panel 380) and a document with an open thread: (c) in the panel's record with the
// panel floated (P3-G's card over it), (a) alone in main with the panel docked, (d) the same with the panel closed, (b)
// beside a session in main after Expand pane. What the margin draws in each is asserted; the widths go to the report.
type MarginReading = { scrollBox: number; page: number; tier: string | null; threads: number };
const marginOf = (scope: Locator): Promise<MarginReading> =>
  scope.evaluate((root) => {
    const scroll = root.querySelector<HTMLElement>('.ds-doc')!;
    return {
      scrollBox: scroll.clientWidth,
      page: Math.round(root.querySelector('.ds-doc-page')!.getBoundingClientRect().width),
      tier: root.querySelector('.doc-margin')?.getAttribute('data-margin-tier') ?? null,
      threads: new Set(Array.from(root.querySelectorAll<HTMLElement>('[data-thread]')).map((el) => el.dataset.thread)).size,
    };
  });

test('the document margin’s tier at 1512 × 900: in the floated panel, alone in main, with the panel closed, and after Expand pane', async () => {
  test.setTimeout(120_000);
  const page = await start(undefined, [1512, 900]);
  await pinArtifactsTool(page);
  const id = await documentInMain(page, 'B3 margin');
  await mainTab(page, id).getByRole('button', { name: /^Close / }).click();
  await mainRegion(page).getByRole('tab', { name: /^Harness A/ }).click();
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
  const widths = () => page.evaluate(() => Object.fromEntries(['sidebar', 'main', 'panel'].map((r) => [r, Math.round(document.querySelector(`[data-region="${r}"]`)?.getBoundingClientRect().width ?? -1)])));
  const readings: Record<string, unknown> = {};

  // (c) the panel floated (⌥⌘B): the panel spans the area, the session's card over its body at the bottom right
  await menu('panel.float');
  const card = panelRegion(page).getByRole('region', { name: 'Session card' });
  await expect(card).toBeVisible();
  const floated = await marginOf(inPanel(page, id));
  const covered = await page.evaluate(() => {
    const card = document.querySelector('[data-region="panel"] [aria-label="Session card"]')!.getBoundingClientRect();
    const meets = (r: DOMRect) => r.width > 0 && r.height > 0 && r.left < card.right && r.right > card.left && r.top < card.bottom && r.bottom > card.top;
    const margin = document.querySelector('[data-region="panel"] .doc-margin');
    return {
      column: margin ? meets(margin.getBoundingClientRect()) : null,
      entries: Array.from(document.querySelectorAll('[data-region="panel"] .doc-margin [data-margin-entry]')).filter((entry) => meets(entry.getBoundingClientRect())).length,
    };
  });
  readings.c = { ...(await widths()), ...floated, cardCovers: covered };
  await menu('panel.float');
  await expect(card).toHaveCount(0);

  // (a) alone in main, the panel docked: the record's grip onto main's pane
  await drag(page, inPanel(page, id).getByTitle('Drag to move to a tab'), mainRegion(page).locator('[data-pane="0"] > [role="tabpanel"]'), mainRegion(page).getByText('Move to tab', { exact: true }));
  await expect(inMain(page, id)).toBeVisible();
  const alone = await marginOf(inMain(page, id));
  readings.a = { ...(await widths()), ...alone };

  // (d) the panel closed
  await menu('panel.toggle');
  await expect.poll(async () => (await widths()).panel).toBeLessThanOrEqual(0);
  await expect.poll(async () => (await marginOf(inMain(page, id))).scrollBox).toBeGreaterThan(alone.scrollBox);
  const closed = await marginOf(inMain(page, id));
  readings.d = { ...(await widths()), ...closed };
  await menu('panel.toggle');
  await expect.poll(async () => (await widths()).panel).toBeGreaterThan(0);

  // (b) beside a session in main, then Expand pane (the session floats into the main area's card)
  await menu('pane.split');
  await page.getByRole('tablist', { name: 'Left pane tabs' }).getByRole('tab', { name: /^Harness A/ }).click();
  const header = inMain(page, id).locator('xpath=ancestor::*[@role="tabpanel"][1]');
  const split = await marginOf(inMain(page, id));
  await header.getByRole('button', { name: 'Expand pane' }).click();
  await expect(mainRegion(page).getByRole('region', { name: 'Session card' })).toBeVisible();
  await expect.poll(async () => (await marginOf(inMain(page, id))).scrollBox).toBeGreaterThan(split.scrollBox);
  const expanded = await marginOf(inMain(page, id));
  readings.b = { ...(await widths()), split, ...expanded };
  test.info().annotations.push({ type: 'margin readings', description: JSON.stringify(readings) });

  // What holds (margin-tiers.ts): off under a 720 px body (rail-width.ts RAIL_BESIDE_FROM_PX); cards while the side
  // space beside the 816 px page is at least 26 + 282 + 25 = 333 px; else icons.
  expect({ c: floated.tier, a: alone.tier, d: closed.tier, split: split.tier, b: expanded.tier }).toEqual({ c: 'cards', a: 'icons', d: 'cards', split: 'off', b: 'icons' });
  expect([floated, alone, closed, expanded].map((r) => r.threads), 'the open thread in every reading').toEqual([1, 1, 1, 1]);
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
  await expect(mainRegion(page).getByRole('tab', { name: /^Harness A/ })).toHaveCount(1);
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
  await expect(panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/, selected: true })).toBeVisible();
  await expect(panel.getByRole('tabpanel', { name: 'Session overview' })).toHaveCount(0);
  await expect(mainTab(page, id)).toHaveCount(1);
  expect(await sawNoOpenTabs(page), 'no "No open tabs" frame at any moment of the relaunch').toBe(false);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
