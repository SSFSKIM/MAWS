// UX2-L acceptance in the real, quiet Electron app: the scenario supplies sessions, not replacement UI.
// launchMaws owns an isolated profile/config/shell home per case. Screenshots are report attachments, not baselines.
import { mkdirSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '../src/shared/ipc/schema';
import { test, type MawsLaunch } from './support/launch';
import { menu } from './support/menu';
import { sidebarRow } from './support/sidebar';
import { closeSurface, openSurface, unfoldSessionCard } from './support/shell';

const SIZES = [{ width: 1280, height: 820 }, { width: 1512, height: 982 }] as const;
const ENV = {
  MAWS_HARNESS: '0',
  MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json',
  MAWS_SCENARIO_CLOCK: 'manual',
  MAWS_E2E_FOREGROUND: '0',
};
test.use({ mawsEnv: ENV });
test.beforeAll(() => {
  // The scenario's real directories: Terminal and Files use these, never the owner's cwd.
  mkdirSync('/tmp/maws-harness/a', { recursive: true });
  mkdirSync('/tmp/maws-harness/b', { recursive: true });
});

const main = (page: Page) => page.locator('[data-region="main"]');
const panel = (page: Page) => page.locator('[data-region="panel"]');
const sidebar = (page: Page) => page.locator('[data-region="sidebar"]');
const surfaces = (page: Page) => page.locator('[data-surface-row]');
const surface = (page: Page, id: string) => panel(page).locator(`[data-surface="${id}"]`);
const stack = (page: Page) => panel(page).locator('[data-surface]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-surface')));

async function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<CommandResult<N>>;
}
function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const layout = async (page: Page, key: 'regions' | 'panelTools.surfaces') => value(await invoke(page, 'layout.get', { key })).value;

// Drive the native window, not a CDP viewport: hit testing and the window's resize listeners see the same size.
async function size(maws: MawsLaunch, width: number, height: number): Promise<void> {
  await maws.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setContentSize(w, h), [width, height] as const);
  await expect.poll(() => maws.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height]);
}
async function shot(maws: MawsLaunch, info: TestInfo, state: string): Promise<void> {
  const { width, height } = await maws.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const name = `ux2-${state}-${width}x${height}.png`;
  const path = info.outputPath(name);
  await maws.page.mouse.move(0, height - 1);
  await expect(maws.page.locator('[data-hover-card]')).toHaveCount(0);
  await maws.page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect, 'the element has a layout box').not.toBeNull();
  return rect!;
}
async function noReservedPanel(page: Page): Promise<void> {
  // Owner ruling: a surface is optional. Neither an empty main nor a non-session tab earns a right column.
  await expect(panel(page)).toHaveJSProperty('inert', true);
  await expect.poll(async () => (await box(panel(page))).width).toBe(0);
  await expect(main(page).getByRole('complementary', { name: 'Session cards' })).toHaveCount(0);
  await expect.poll(async () => {
    const rect = await box(main(page));
    return Math.round(rect.x + rect.width);
  }).toBe(await page.evaluate(() => innerWidth));
  await expect(main(page)).toHaveJSProperty('inert', false);
}
async function singleChromeRow(page: Page): Promise<void> {
  // Owner ruling: tabs share the window's chrome row, never a second full-width row below it.
  const chrome = page.locator('[data-chrome-tabs]');
  await expect(chrome.getByRole('tablist', { name: 'Open tabs' })).toHaveCount(1);
  await expect(main(page).getByRole('tablist', { name: 'Open tabs' })).toHaveCount(0);
  const header = await box(page.getByRole('banner'));
  const strip = await box(chrome.getByRole('tablist', { name: 'Open tabs' }));
  expect(strip.y).toBeGreaterThanOrEqual(header.y);
  expect(strip.y + strip.height).toBeLessThanOrEqual(header.y + header.height);
  expect((await box(main(page))).y).toBe(header.y + header.height);
  // Owner ruling: usage and its unit belong to the sidebar footer, not the title bar.
  await expect(page.getByRole('banner').locator('[data-usage-pill]')).toHaveCount(0);
  await expect(sidebar(page).locator('footer [data-usage-pill]')).toBeVisible();
  await expect(sidebar(page).locator('footer [data-usage-pill]')).toContainText(/Usage|%/);
}
async function openSession(page: Page): Promise<void> {
  await expect(sidebar(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 15_000 });
  await (await sidebarRow(page, 'Harness A')).click();
  await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Harness A', exact: true })).toHaveAttribute('aria-selected', 'true');
}

test('UX2: one chrome row and no reserved column for empty main or Settings', async ({ maws }, info) => {
  const { page } = maws;
  await expect(main(page).getByText('No open tabs')).toBeVisible({ timeout: 15_000 });
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    await singleChromeRow(page);
    await noReservedPanel(page);
    await shot(maws, info, 'empty');
    await menu(maws.app, 'settings.open');
    await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
    await singleChromeRow(page);
    await noReservedPanel(page);
    await shot(maws, info, 'settings');
    await menu(maws.app, 'tab.close');
    await expect(main(page).getByText('No open tabs')).toBeVisible();
  }
  expect(maws.consoleErrors()).toEqual([]);
});

test('UX2: plain-click stacking, same-tool tabs, and overflow icon pinning', async ({ maws }, info) => {
  test.setTimeout(120_000);
  const { page } = maws;
  await size(maws, 1280, 820);
  await openSession(page);
  const cards = main(page).getByRole('complementary', { name: 'Session cards' });
  await expect(cards).toBeVisible();
  for (const title of ['Environment', 'Context', 'Connectors', 'Artifacts']) {
    await expect(cards.getByRole('region', { name: title, exact: true }).getByRole('button').first()).toHaveAttribute('aria-expanded', 'false');
  }
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    await shot(maws, info, 'session-cards');
  }
  // The approved expanded state uses the real session/git/connector/project Library reads, not screenshot-only data.
  await expect.poll(async () => value(await invoke(page, 'engine.hostState', undefined)).state, { timeout: 20_000 }).toBe('ready');
  const environment = await unfoldSessionCard(page, 'Environment');
  const connectors = await unfoldSessionCard(page, 'Connectors');
  const artifacts = await unfoldSessionCard(page, 'Artifacts');
  await expect(environment).toContainText('/tmp/maws-harness/a');
  await expect(environment.getByText('…', { exact: true })).toHaveCount(0); // git watch has answered
  await expect(connectors.getByText('Connector status not reported', { exact: true })).toBeVisible();
  await expect(artifacts.getByRole('combobox', { name: 'Artifacts project', exact: true })).toHaveValue('proj-harness');
  await expect(artifacts.getByText('No artifacts in this project yet', { exact: true })).toBeVisible();
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    await shot(maws, info, 'session-cards-expanded');
  }
  await size(maws, 1280, 820);
  await openSurface(page, 'Terminal');
  await expect(surface(page, 'terminal').locator('[data-terminal-id]')).toBeVisible({ timeout: 15_000 });
  const terminalId = await surface(page, 'terminal').locator('[data-terminal-id]').getAttribute('data-terminal-id');
  const narrowWidth = (await box(panel(page))).width;
  expect(narrowWidth).toBeLessThanOrEqual(420);
  await openSurface(page, 'Review');
  await expect.poll(() => stack(page)).toEqual(['terminal', 'review']);
  expect((await box(panel(page))).width, 'Review earns a wide surface').toBeGreaterThan(narrowWidth);
  const first = await box(surface(page, 'terminal'));
  expect((await box(surface(page, 'review'))).y, 'the second surface is below the first').toBeGreaterThanOrEqual(first.y + first.height);
  await openSurface(page, 'Files');
  await expect.poll(() => stack(page)).toEqual(['terminal', 'files']);
  await expect(surface(page, 'terminal').locator('[data-terminal-id]')).toHaveAttribute('data-terminal-id', terminalId!);
  await expect(surface(page, 'review'), 'the displaced tool is closed even if narrow chrome folds its icon').toHaveCount(0);

  // Owner ruling: tabs exist within one tool; adding another Terminal must not replace Files or add a third surface.
  const terminal = surface(page, 'terminal');
  const terminalTabs = terminal.getByRole('tablist', { name: 'terminal tabs' });
  const firstTabId = await terminalTabs.locator('[data-tab-id]').first().getAttribute('data-tab-id');
  await terminal.getByRole('button', { name: 'New terminal tab', exact: true }).click();
  await expect(terminalTabs.getByRole('tab')).toHaveCount(2);
  await expect(terminalTabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => stack(page)).toEqual(['terminal', 'files']);
  await expect(terminal.locator('[data-terminal-id]')).toBeVisible({ timeout: 15_000 });
  await expect(terminal.locator('[data-terminal-id]')).not.toHaveAttribute('data-terminal-id', terminalId!);
  await terminalTabs.locator(`[data-tab-id="${firstTabId}"]`).getByRole('tab').click();
  await expect(terminal.locator('[data-terminal-id]')).toHaveAttribute('data-terminal-id', terminalId!);
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    await shot(maws, info, 'two-surfaces-terminal-tabs');
  }

  // This part specifically tests toolbar pinning, so give the chrome room to retain the pinned icon.
  await size(maws, 1512, 982);
  await surfaces(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Session info', exact: true })).toBeVisible();
  await shot(maws, info, 'overflow-menu');
  await page.getByRole('menuitem', { name: 'Session info', exact: true }).click();
  await expect.poll(() => stack(page)).toEqual(['terminal', 'session-info']);
  const infoIcon = surfaces(page).getByRole('button', { name: 'Session info', exact: true });
  await infoIcon.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin to toolbar', exact: true }).click();
  await infoIcon.click(); // An open icon closes its surface; a pinned icon stays in the row.
  await expect.poll(() => stack(page)).toEqual(['terminal']);
  await expect(infoIcon).toBeVisible();
  await expect(infoIcon).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => layout(page, 'panelTools.surfaces')).toMatchObject({ pinnedTools: ['session-info'] });
  await page.reload();
  await expect(infoIcon).toBeVisible({ timeout: 15_000 });
  await expect(infoIcon).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => stack(page)).toEqual(['terminal']);
  await infoIcon.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin from toolbar', exact: true }).click();
  await expect(infoIcon, 'a closed, unpinned overflow tool leaves the icon row').toHaveCount(0);
  expect(maws.consoleErrors()).toEqual([]);
});

test('UX2: at 900 the sidebar yields; at 600 a surface is a dismissible sheet', async ({ maws }, info) => {
  const { page } = maws;
  await size(maws, 1280, 820);
  await openSession(page);
  await openSurface(page, 'Files');
  await expect(surface(page, 'files')).toBeVisible();
  await expect.poll(() => layout(page, 'panelTools.surfaces')).toMatchObject({ stacks: { A: [expect.any(String)] } });
  const remembered = await layout(page, 'regions');
  await size(maws, 900, 820);
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  expect((await box(sidebar(page))).width).toBe(0);
  const beforeOverlay = await box(main(page));
  const beside = await box(panel(page));
  expect(beforeOverlay.width).toBeGreaterThan(0);
  expect(Math.round(beforeOverlay.x + beforeOverlay.width)).toBe(Math.round(beside.x));
  expect(Math.round(beside.x + beside.width)).toBe(900);
  await shot(maws, info, 'narrow-sidebar-yields');
  await page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(sidebar(page)).toHaveJSProperty('inert', false);
  await expect(page.getByRole('button', { name: 'Close sidebar overlay', exact: true })).toBeVisible();
  expect((await box(main(page))).width, 'the temporary sidebar overlays without squeezing main').toBe(beforeOverlay.width);
  await sidebar(page).getByRole('searchbox').focus();
  await page.keyboard.press('Escape');
  await expect(sidebar(page)).toHaveJSProperty('inert', true);

  await size(maws, 600, 820);
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  await expect(main(page)).toHaveJSProperty('inert', true); // the sheet owns input; covered content must not take focus
  const sheet = await box(panel(page));
  const under = await box(main(page));
  expect(under.width, 'a sheet overlays rather than reserving a side column').toBe(600);
  expect(sheet.x).toBeGreaterThan(under.x);
  expect(sheet.x).toBeLessThan(under.x + under.width);
  expect(Math.round(sheet.x + sheet.width)).toBe(600);
  await expect(panel(page)).toHaveCSS('position', 'absolute');
  await shot(maws, info, 'narrow-surface-sheet');
  expect(await layout(page, 'regions'), 'narrow rendering never changes remembered widths or collapse preferences').toEqual(remembered);
  await size(maws, 1512, 982);
  await expect(sidebar(page)).toHaveJSProperty('inert', false);
  expect((await box(sidebar(page))).width).toBe(240);
  await expect(panel(page)).toHaveCSS('position', 'relative');
  expect(await layout(page, 'regions')).toEqual(remembered);
  await size(maws, 600, 820);
  await closeSurface(page, 'Files');
  await expect.poll(async () => (await box(panel(page))).width).toBe(0);
  expect((await box(main(page))).width).toBe(600);
  await shot(maws, info, 'narrow-sheet-dismissed');
  await size(maws, 900, 820);
  await expect(sidebar(page)).toHaveJSProperty('inert', false);
  expect((await box(sidebar(page))).width).toBe(240);
  expect(maws.consoleErrors()).toEqual([]);
});

const DECK_FILES = {
  'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-24T09:00:00Z' }, lists: 'css', title: 'UX2 review', cover: 'cover', order: ['cover', 'next'], sections: {}, faces: {}, designSystems: [] }),
  'project/slides/cover.html': '<section id="cover" style="background:#ffffff;padding:128px;display:flex;flex-direction:column;justify-content:flex-end"><h1 id="title" style="font-size:96px">Main is the main thing</h1><p id="sub" style="font-size:40px">UX2 layout review</p></section>',
  'project/slides/next.html': '<section id="next" style="background:#ffffff;padding:128px"><h2 id="heading" style="font-size:72px">Space earned by content</h2></section>',
};

async function openArtifact(page: Page, title: string, id: string): Promise<Locator> {
  await sidebar(page).getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  return main(page).locator(`[data-artifact-tab="${id}"]`);
}

async function deckFilmstripPlacement(deck: Locator, horizontal: boolean): Promise<void> {
  const filmstrip = deck.locator('.deck-filmstrip');
  const stage = deck.locator('.deck-stage');
  await expect(filmstrip).toHaveAttribute('data-direction', horizontal ? 'horizontal' : 'vertical');
  // Check the rendered boxes, not just orientation state: the filmstrip is wrapped in a display:contents scope.
  await expect.poll(async () => {
    const [stripBox, stageBox] = await Promise.all([box(filmstrip), box(stage)]);
    return horizontal ? stripBox.y - (stageBox.y + stageBox.height) : stageBox.x - (stripBox.x + stripBox.width);
  }, { message: horizontal ? 'the horizontal filmstrip sits below the stage' : 'the vertical filmstrip sits left of the stage' }).toBeGreaterThanOrEqual(0);
}

async function deckToolbarPlacement(deck: Locator): Promise<void> {
  const toolbar = deck.getByRole('toolbar', { name: 'Deck', exact: true });
  await expect(toolbar.getByRole('button', { name: 'Arrange', exact: true })).toBeVisible();
  await expect.poll(() => toolbar.evaluate((bar) => {
    const row = bar.getBoundingClientRect();
    const controls = Array.from(bar.querySelectorAll('button, select')).map((control) => control.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
    const height = Math.max(...controls.map((rect) => rect.height));
    return {
      oneRow: Math.max(...controls.map((rect) => rect.bottom)) - Math.min(...controls.map((rect) => rect.top)) <= height + 1,
      inside: controls.every((rect) => rect.left >= row.left - 1 && rect.right <= row.right + 1),
    };
  }), { message: 'every deck toolbar control fits one row without overflowing' }).toEqual({ oneRow: true, inside: true });
  const zoom = toolbar.getByRole('group', { name: 'Zoom controls', exact: true });
  await expect(zoom.locator('button, select')).toHaveCount(3);
  const [out, fit, plus, group, row] = await Promise.all([
    box(zoom.getByRole('button', { name: 'Zoom out', exact: true })),
    box(zoom.getByRole('combobox', { name: 'Zoom', exact: true })),
    box(zoom.getByRole('button', { name: 'Zoom in', exact: true })),
    box(zoom), box(toolbar),
  ]);
  expect(out.x + out.width, 'minus precedes Fit in the same group').toBeLessThanOrEqual(fit.x);
  expect(fit.x + fit.width, 'Fit precedes plus in the same group').toBeLessThanOrEqual(plus.x);
  expect(Math.abs(out.y + out.height / 2 - (plus.y + plus.height / 2)), 'minus and plus share a row').toBeLessThan(1);
  expect(plus.x + plus.width).toBeLessThanOrEqual(group.x + group.width + 1);
  expect(row.x + row.width - (group.x + group.width), 'the zoom group stays at the toolbar’s right inset').toBeGreaterThanOrEqual(0);
  expect(row.x + row.width - (group.x + group.width)).toBeLessThanOrEqual(12);
  const names = ['Undo', 'Redo', 'Insert', 'Text style', 'Arrange'];
  const x = await Promise.all(names.map(async (name) => (await box(toolbar.getByRole('button', { name, exact: true }))).x));
  expect(x, 'undo/redo stay left, followed by Insert, Text style and Arrange').toEqual([...x].sort((a, b) => a - b));
}

test('UX2: real Library document and deck editors use main without an empty panel', async ({ maws }, info) => {
  test.setTimeout(120_000);
  const { page } = maws;
  await size(maws, 1280, 820);
  await openSession(page);
  await expect.poll(async () => value(await invoke(page, 'engine.hostState', undefined)).state, { timeout: 20_000 }).toBe('ready');
  const document = value(await invoke(page, 'artifacts.create', { kind: 'document', title: 'UX2 working notes' })).artifact;
  const deck = value(await invoke(page, 'artifacts.create', { kind: 'presentation', title: 'UX2 review' })).artifact;
  // Same product publish seam as presentations.spec.ts: it authors host-backed files, not a fake editor or DOM.
  await page.waitForFunction(() => typeof (window as unknown as { __maws_presentations?: unknown }).__maws_presentations === 'object');
  await page.evaluate(async ([id, files]) => {
    const seam = (window as unknown as { __maws_presentations: { seed(id: string, files: Record<string, string>): Promise<unknown> } }).__maws_presentations;
    await seam.seed(id, files);
  }, [deck.id, DECK_FILES] as const);
  const notes = await openArtifact(page, 'UX2 working notes', document.id);
  const editor = notes.locator('.ds-doc .ProseMirror');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.insertText('The main area is the main thing.');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Tools appear only when they earn their space. Session surfaces stack beside the work; document tools stay with the document.');
  // document.spec.ts's durability barrier: the saved label deliberately delays Saving…, so it is not an ack barrier.
  await expect.poll(() => editor.evaluate((el) => {
    const live = (el as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
    return live?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
  }), { message: 'the host acknowledged the document fixture' }).toBe(0);
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    const documentTab = await openArtifact(page, 'UX2 working notes', document.id);
    await expect(documentTab.locator('.ds-doc .ProseMirror')).toContainText('The main area is the main thing.');
    const documentTools = documentTab.getByRole('toolbar', { name: 'Formatting', exact: true });
    await expect(documentTools.getByRole('button', { name: 'Version history', exact: true })).toHaveCount(1);
    await expect(documentTools.getByRole('button', { name: /^Comments(?: |$)/ })).toHaveCount(1);
    await expect(documentTools.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(main(page).locator('[data-editor-header]').getByRole('button', { name: /^(Version history|Comments|\d+ open comments?)$/ })).toHaveCount(0);
    await noReservedPanel(page);
    await singleChromeRow(page);
    await shot(maws, info, 'document-main');
    const deckTab = await openArtifact(page, 'UX2 review', deck.id);
    await expect(deckTab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
    await expect(deckTab.locator('[data-deck-editor]')).toContainText('Main is the main thing');
    await noReservedPanel(page);
    await singleChromeRow(page);
    await deckFilmstripPlacement(deckTab, width === 1280);
    await deckToolbarPlacement(deckTab);
    await shot(maws, info, 'deck-main');
    const toolbar = deckTab.getByRole('toolbar', { name: 'Deck', exact: true });
    await expect(toolbar.getByRole('button', { name: 'Inspector', exact: true })).toHaveText('Inspector');
    await expect(toolbar.getByRole('button', { name: 'Version history', exact: true })).toHaveCount(1);
    await expect(toolbar.getByRole('button', { name: /^Comments(?: |$)/ })).toHaveCount(1);
    await expect(toolbar.getByRole('button', { name: 'Add comment', exact: true })).toBeVisible();
    await expect(main(page).locator('[data-editor-header]').getByRole('button', { name: /^(Inspector|Version history|Comments|\d+ open comments?)$/ })).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Inspector', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(deckTab.locator('.deck-tool-card')).toHaveCount(2);
    // Fit uses the measured width left by the floating stack, not the full stage underneath it (l7-shell-02).
    await expect.poll(async () => {
      const slide = await box(deckTab.locator('[data-stage-slide]').first());
      const cards = await box(deckTab.locator('.deck-tool-cards'));
      return slide.x + slide.width <= cards.x + 1;
    }, { message: 'the fitted slide stays visible beside its document tools' }).toBe(true);
    await deckFilmstripPlacement(deckTab, width === 1280);
    await deckToolbarPlacement(deckTab);
    await shot(maws, info, 'deck-tools');
    await toolbar.getByRole('button', { name: 'Arrange', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Arrange', exact: true }).getByRole('menuitem')).toHaveCount(9);
    await shot(maws, info, 'deck-arrange-menu');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Arrange', exact: true })).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'Version history', exact: true }).click();
    await toolbar.getByRole('button', { name: 'Inspector', exact: true }).click();
  }
  expect(maws.consoleErrors()).toEqual([]);
});
