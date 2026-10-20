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
async function start(requireFirst?: string): Promise<Page> {
  launch = await launchMaws({ userData: userData!, requireFirst, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS } });
  const { page, app } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!.setContentSize(1600, 900));
  await page.waitForFunction(() => window.innerWidth === 1600 && window.innerHeight === 900);
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
  await launch!.app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('pane.split')!.click());
  const right = page.getByRole('tablist', { name: 'Right pane tabs' });
  await expect(right.locator(`[data-tab-id="artifact:${id}"]`)).toBeVisible();
  const header = inMain(page, id).locator('xpath=ancestor::*[@role="tabpanel"][1]');
  const card = mainRegion(page).getByRole('region', { name: 'Session card' });
  const left = page.getByRole('tablist', { name: 'Left pane tabs' });
  await expect(left.getByRole('tab', { name: /^Harness A/ })).toBeVisible();

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
  test.setTimeout(150_000);
  const preload = join(scratch!, 'no-open-tabs-preload.js');
  const hook = join(scratch!, 'no-open-tabs-hook.cjs');
  writeFileSync(preload, NO_TABS_PRELOAD);
  writeFileSync(hook, noTabsHook(preload));

  let page = await start(hook);
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
  await launch!.cleanup();
  launch = null;

  page = await start(hook);
  const panel = panelRegion(page);
  await expect(inPanel(page, id), 'the pinned Artifacts tab back on its record').toBeVisible({ timeout: 15_000 });
  await expect(editorIn(inPanel(page, id))).toContainText(line(PARAGRAPHS));
  await expect(panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: /^Artifacts/, selected: true })).toBeVisible();
  await expect(panel.getByRole('tabpanel', { name: 'Session overview' })).toHaveCount(0);
  await expect(mainTab(page, id)).toHaveCount(1);
  expect(await sawNoOpenTabs(page), 'no "No open tabs" frame at any moment of the relaunch').toBe(false);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
