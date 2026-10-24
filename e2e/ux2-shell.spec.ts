// UX2-L acceptance in the real, quiet Electron app: the scenario supplies sessions, not replacement UI.
// launchMaws owns an isolated profile/config/shell home per case. Screenshots are report attachments, not baselines.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScenario } from '../test/support/scenario';
import { scratchMarketplace, writePluginCliStub } from '../test/support/plugin-cli-stub';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '../src/shared/ipc/schema';
import { AppSessionIdSchema } from '../src/shared/graph/ids';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
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

// Identical measurement-only code runs before and after the chrome changes. The lead compares independent run artifacts.
// eslint-disable-next-line no-empty-pattern -- this case owns its isolated fixture launch
test('Chrome measurements: document, deck and live Customize at both desktop sizes', async ({}, info) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'maws-chrome-measure-'));
  const directory = join(root, 'chrome-project');
  mkdirSync(directory);
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/panel/harness-sessions.json'), 'utf8'));
  scenario.projects[0].directory = directory;
  scenario.sessions.forEach((record: { directory: string; worktree: unknown }) => { record.directory = directory; record.worktree = null; });
  scenario.engine = [{ appSessionId: 'A', process: 'ready', engineState: 'idle', turn: null, pendingRequests: 0 }];
  expect(parseScenario(scenario).engine[0]?.cwd).toBe(directory);
  const source = join(root, 'scenario.json');
  writeFileSync(source, JSON.stringify(scenario));
  const plugins = [{ name: 'chrome-review', version: '1.0.0', description: 'Review the working narrative.' }];
  const market = scratchMarketplace(join(root, 'market'), { name: 'chrome-tools', plugins });
  const cli = writePluginCliStub(root, { marketplaces: [{ name: 'chrome-tools', source: 'directory', path: market, plugins }], installed: [{ id: 'chrome-review@chrome-tools', version: '1.0.0', scope: 'user', enabled: true, projectPath: null }], fail: {} });
  try {
    const maws = await launchMaws({ userData: root, env: { ...ENV, MAWS_SESSION_SOURCE: `stub:${source}`, MAWS_WIDGET_BACKEND: 'fixtures', MAWS_E2E_ENGINE_BIN: cli.bin } });
    try {
      const { page } = maws;
      await openSession(page);
      await expect.poll(async () => value(await invoke(page, 'engine.hostState', undefined)).state, { timeout: 20_000 }).toBe('ready');
      const documentArtifact = value(await invoke(page, 'artifacts.create', { kind: 'document', title: 'Chrome working notes' })).artifact;
      const deck = value(await invoke(page, 'artifacts.create', { kind: 'presentation', title: 'Chrome review deck' })).artifact;
      await page.waitForFunction(() => typeof (window as unknown as { __maws_presentations?: unknown }).__maws_presentations === 'object');
      await page.evaluate(async ([id, files]) => {
        const seam = (window as unknown as { __maws_presentations: { seed(id: string, files: Record<string, string>): Promise<unknown> } }).__maws_presentations;
        await seam.seed(id, files);
      }, [deck.id, DECK_FILES] as const);
      const capture = async (state: string, selectors: Record<string, string>) => {
        const geometry = await page.evaluate((selectors) => {
          const rectangle = (node: Element) => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom }; };
          const visible = (node: Element) => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
          const boxes = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, Array.from(document.querySelectorAll(selector)).filter(visible).map(rectangle)]));
          const main = document.querySelector('[data-region="main"]')!;
          const content = boxes.page?.[0] ?? boxes.stage?.[0] ?? boxes.firstPlugin?.[0] ?? null;
          return { window: { width: innerWidth, height: innerHeight }, main: rectangle(main), boxes, contentTopFromMain: content ? content.y - main.getBoundingClientRect().y : null,
            features: { sectionStrip: document.querySelectorAll('.doc-tabs').length, deckToolbarHost: document.querySelectorAll('[data-editor-toolbar]').length, notesDisclosure: document.querySelectorAll('[data-notes-disclosure]').length, liveScope: document.querySelectorAll('select[aria-label="Live session"]').length } };
        }, selectors);
        const name = `chrome-${state}-${geometry.window.width}x${geometry.window.height}`;
        await info.attach(`${name}.json`, { body: Buffer.from(JSON.stringify(geometry, null, 2)), contentType: 'application/json' });
        await shot(maws, info, `chrome-${state}`);
      };
      for (const { width, height } of SIZES) {
        await size(maws, width, height);
        const notes = await openArtifact(page, 'Chrome working notes', documentArtifact.id);
        await expect(notes.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
        await capture('document-single-section', { header: '[data-region="main"] [data-editor-header]', sections: '.doc-tabs', toolbar: '.doc-toolbar', page: '.doc-page-frame', editor: '.ds-doc .ProseMirror' });
        const deckTab = await openArtifact(page, 'Chrome review deck', deck.id);
        await expect(deckTab.locator('[data-stage-slide]')).toBeVisible({ timeout: 15_000 });
        await capture('deck-default', { header: '[data-region="main"] [data-editor-header]', toolbar: '.deck-toolbar', stage: '.deck-stage', slide: '[data-stage-slide]', notes: '.deck-notes', notesField: '.deck-notes-field', filmstrip: '.deck-filmstrip' });
        const disclosure = deckTab.locator('[data-notes-disclosure]');
        if (await disclosure.count()) {
          await disclosure.click();
          await expect(deckTab.getByRole('textbox', { name: 'Speaker notes' })).toBeVisible();
          await capture('deck-notes-open', { toolbar: '.deck-toolbar', stage: '.deck-stage', notes: '.deck-notes', notesField: '.deck-notes-field' });
          await disclosure.click();
        }
        await sidebar(page).getByRole('button', { name: 'Customize', exact: true }).click();
        await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('proj-harness');
        await expect(page.getByRole('combobox', { name: 'Live session', exact: true })).toBeVisible();
        await expect(page.locator('[data-plugin-row="chrome-review@chrome-tools"]')).toBeVisible({ timeout: 15_000 });
        await capture('customize-live-plugins', { header: '[data-region="main"] header', sections: '[aria-label="Customize sections"]', project: 'select[aria-label="Project"]', live: 'select[aria-label="Live session"]', library: '[data-widget-variant="embedded"] > header', loaded: '[data-plugins-loaded]', firstPlugin: '[data-plugin-row="chrome-review@chrome-tools"]' });
      }
      expect(maws.consoleErrors()).toEqual([]);
    } finally { await maws.cleanup(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// eslint-disable-next-line no-empty-pattern -- this case owns its ready-session fixture launch
test('Chrome: live Customize keeps scopes on its two control rows and loaded feedback on the third', async ({}, info) => {
  test.setTimeout(90_000);
  const root = mkdtempSync(join(tmpdir(), 'maws-customize-chrome-'));
  const directory = join(root, 'chrome-project');
  mkdirSync(directory);
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/panel/harness-sessions.json'), 'utf8'));
  scenario.projects[0].directory = directory;
  scenario.sessions.forEach((record: { directory: string; worktree: unknown }) => { record.directory = directory; record.worktree = null; });
  scenario.engine = [{ appSessionId: 'A', process: 'ready', engineState: 'idle', turn: null, pendingRequests: 0 }];
  expect(parseScenario(scenario).engine[0]?.cwd).toBe(directory);
  const source = join(root, 'scenario.json');
  writeFileSync(source, JSON.stringify(scenario));
  const plugins = [{ name: 'chrome-review', version: '1.0.0', description: 'Review the working narrative.' }];
  const market = scratchMarketplace(join(root, 'market'), { name: 'chrome-tools', plugins });
  const cli = writePluginCliStub(root, { marketplaces: [{ name: 'chrome-tools', source: 'directory', path: market, plugins }], installed: [{ id: 'chrome-review@chrome-tools', version: '1.0.0', scope: 'user', enabled: true, projectPath: null }], fail: {} });
  try {
    const maws = await launchMaws({ userData: root, env: { ...ENV, MAWS_SESSION_SOURCE: `stub:${source}`, MAWS_WIDGET_BACKEND: 'fixtures', MAWS_E2E_ENGINE_BIN: cli.bin } });
    try {
      const { page } = maws;
      await openSession(page);
      await sidebar(page).getByRole('button', { name: 'Customize', exact: true }).click();
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('proj-harness');
      const header = main(page).locator('[data-customize-header]');
      const library = page.locator('[data-widget="plugins"][data-widget-variant="embedded"] > header');
      await expect(library.getByRole('combobox', { name: 'Live session', exact: true })).toBeVisible();
      await expect(page.locator('[data-plugin-row="chrome-review@chrome-tools"]')).toBeVisible({ timeout: 15_000 });
      for (const { width, height } of SIZES) {
        await size(maws, width, height);
        const headerControls = await Promise.all([box(header.getByRole('heading', { name: 'Customize', exact: true })), box(header.getByRole('tablist', { name: 'Customize sections' })), box(header.getByRole('combobox', { name: 'Project', exact: true }))]);
        const libraryControls = await Promise.all([box(library.getByRole('radio', { name: 'My items', exact: true })), box(library.getByRole('searchbox', { name: 'Search plugins', exact: true })), box(library.getByRole('combobox', { name: 'Live session', exact: true }))]);
        for (const row of [headerControls, libraryControls]) {
          const centers = row.map((rect) => rect.y + rect.height / 2);
          expect(Math.max(...centers) - Math.min(...centers), 'scope controls share their earned row at desktop widths').toBeLessThanOrEqual(1);
        }
        await expect(library.getByRole('heading', { name: 'Plugins', exact: true })).toHaveCount(0);
        const loaded = await box(page.locator('[data-plugins-loaded]'));
        const content = await box(page.locator('[data-plugin-row="chrome-review@chrome-tools"]'));
        const mainBox = await box(main(page));
        expect(loaded.y).toBeGreaterThanOrEqual((await box(library)).y + (await box(library)).height);
        expect(content.y).toBeGreaterThan(loaded.y + loaded.height);
        expect(await main(page).evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
        await info.attach(`customize-chrome-regression-${width}x${height}.json`, { body: Buffer.from(JSON.stringify({ window: { width, height }, main: mainBox, headerControls, libraryControls, loaded, firstPlugin: content, contentTopFromMain: content.y - mainBox.y }, null, 2)), contentType: 'application/json' });
        await shot(maws, info, 'customize-three-rows');
      }
      expect(maws.consoleErrors()).toEqual([]);
    } finally { await maws.cleanup(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
  const terminalHeader = surface(page, 'terminal').locator('[data-editor-header]');
  const tabBox = await box(terminalHeader.getByRole('tablist', { name: 'terminal tabs' }));
  const headerBox = await box(terminalHeader);
  expect(tabBox.y).toBeGreaterThanOrEqual(headerBox.y);
  expect(tabBox.y + tabBox.height, 'terminal tabs share the surface header instead of repeating a heading below it').toBeLessThanOrEqual(headerBox.y + headerBox.height);
  await expect(terminalHeader.getByRole('button', { name: 'Close surface' })).toBeVisible();
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
  const files = surface(page, 'files');
  const root = files.getByRole('treeitem').first();
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  const refreshBox = await box(files.getByRole('button', { name: 'Refresh', exact: true }));
  const rootBox = await box(root);
  expect(refreshBox.y, 'Files refresh lives beside the root, without its own toolbar').toBe(rootBox.y);
  expect(refreshBox.y + refreshBox.height).toBeLessThanOrEqual(rootBox.y + rootBox.height);
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

test('UX2: at 900 the sidebar yields; at 620 a surface is a dismissible sheet', async ({ maws }, info) => {
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
  await expect(page.getByRole('banner').getByRole('button', { name: /^Overview/ })).toBeVisible();
  await shot(maws, info, 'narrow-sidebar-yields');
  await page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await expect(sidebar(page)).toHaveJSProperty('inert', false);
  await expect(page.getByRole('button', { name: 'Close sidebar overlay', exact: true })).toBeVisible();
  expect((await box(main(page))).width, 'the temporary sidebar overlays without squeezing main').toBe(beforeOverlay.width);
  await expect(page.getByRole('button', { name: 'Close sidebar overlay', exact: true })).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await shot(maws, info, 'narrow-sidebar-overlay');
  await sidebar(page).getByRole('searchbox').focus();
  await page.keyboard.press('Escape');
  await expect(sidebar(page)).toHaveJSProperty('inert', true);

  await size(maws, 620, 820);
  await expect(sidebar(page)).toHaveJSProperty('inert', true);
  await expect(main(page)).toHaveJSProperty('inert', true); // the sheet owns input; covered content must not take focus
  const sheet = await box(panel(page));
  const under = await box(main(page));
  expect(under.width, 'a sheet overlays rather than reserving a side column').toBe(620);
  expect(sheet.x).toBeGreaterThan(under.x);
  expect(sheet.x).toBeLessThan(under.x + under.width);
  expect(Math.round(sheet.x + sheet.width)).toBe(620);
  await expect(panel(page)).toHaveCSS('position', 'absolute');
  await shot(maws, info, 'narrow-surface-sheet');
  expect(await layout(page, 'regions'), 'narrow rendering never changes remembered widths or collapse preferences').toEqual(remembered);
  await size(maws, 1512, 982);
  await expect(sidebar(page)).toHaveJSProperty('inert', false);
  expect((await box(sidebar(page))).width).toBe(240);
  await expect(panel(page)).toHaveCSS('position', 'relative');
  expect(await layout(page, 'regions')).toEqual(remembered);
  await size(maws, 620, 820);
  // Native resize completion is not the sheet's React commit or its keyboard-focus boundary.
  await expect(page.getByRole('button', { name: 'Close surface sheet', exact: true })).toBeVisible();
  await expect(panel(page)).toHaveCSS('position', 'absolute');
  await expect(main(page)).toHaveJSProperty('inert', true);
  const sheetControl = surface(page, 'files').getByRole('button', { name: 'Refresh', exact: true });
  await sheetControl.focus();
  await expect(sheetControl).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await box(panel(page))).width).toBe(0);
  await openSurface(page, 'Files');
  await page.getByRole('button', { name: 'Close surface sheet', exact: true }).click({ position: { x: 5, y: 60 } });
  await expect.poll(async () => (await box(panel(page))).width).toBe(0);
  expect((await box(main(page))).width).toBe(620);
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
    await expect(documentTab.locator('.doc-tabs')).toHaveCount(0);
    const singlePage = await box(documentTab.locator('.doc-page-frame'));
    await documentTools.getByRole('button', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New section', exact: true }).click();
    await expect(documentTab.locator('.doc-tabs').getByRole('tab')).toHaveCount(2);
    const earnedStrip = await box(documentTab.locator('.doc-tabs'));
    const multiPage = await box(documentTab.locator('.doc-page-frame'));
    expect(Math.abs(multiPage.y - singlePage.y - earnedStrip.height), 'a single-section page starts one measured section-strip height earlier').toBeLessThanOrEqual(1);
    expect(Math.abs(singlePage.height - multiPage.height - earnedStrip.height), 'the removed row becomes actual page height').toBeLessThanOrEqual(1);
    await shot(maws, info, 'document-two-sections');
    await documentTab.getByRole('button', { name: 'Delete Tab 2', exact: true }).click();
    await expect(documentTab.locator('.doc-tabs')).toHaveCount(0);
    await expect(documentTab.locator('.ds-doc .ProseMirror')).toContainText('The main area is the main thing.');
    await expect.poll(async () => (await box(documentTab.locator('.doc-page-frame'))).height).toBe(singlePage.height);
    await info.attach(`document-chrome-regression-${width}x${height}.json`, { body: Buffer.from(JSON.stringify({ window: { width, height }, singlePage, multiPage, earnedStrip, recoveredPagePixels: singlePage.height - multiPage.height }, null, 2)), contentType: 'application/json' });
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
    await expect(main(page).locator('[data-editor-header]')).toHaveCount(0);
    const deckTools = deckTab.getByRole('toolbar', { name: 'Deck', exact: true });
    await expect(deckTools.locator('[data-editor-toolbar]')).toBeVisible();
    await expect(deckTools.getByRole('button', { name: 'Present', exact: true })).toBeVisible();
    await expect(deckTools.getByRole('button', { name: 'Deck actions', exact: true })).toBeVisible();
    const mainBox = await box(main(page));
    const toolbarBox = await box(deckTools);
    expect(toolbarBox.y, 'the working toolbar is flush with main; no metadata row remains above it').toBe(mainBox.y);
    const notesToggle = deckTab.locator('[data-notes-disclosure]');
    await expect(notesToggle).toHaveAttribute('aria-expanded', 'false');
    const foldedNotes = await box(deckTab.locator('.deck-notes'));
    const foldedStage = await box(deckTab.locator('.deck-stage'));
    expect(foldedNotes.height, 'unused notes occupy only the approved disclosure row').toBeLessThanOrEqual(28.5);
    await notesToggle.click();
    await expect(deckTab.getByRole('textbox', { name: 'Speaker notes' })).toBeVisible();
    const expandedNotes = await box(deckTab.locator('.deck-notes'));
    const expandedStage = await box(deckTab.locator('.deck-stage'));
    expect(expandedNotes.height).toBeGreaterThan(foldedNotes.height);
    expect(Math.abs(foldedStage.height - expandedStage.height - (expandedNotes.height - foldedNotes.height)), 'folding notes gives the stage the actual measured height, not a presumed pixel budget').toBeLessThanOrEqual(1);
    await shot(maws, info, 'deck-notes-expanded');
    await notesToggle.click();
    await expect.poll(async () => (await box(deckTab.locator('.deck-stage'))).height).toBe(foldedStage.height);
    await info.attach(`deck-chrome-regression-${width}x${height}.json`, { body: Buffer.from(JSON.stringify({ window: { width, height }, main: mainBox, toolbar: toolbarBox, foldedNotes, expandedNotes, foldedStage, expandedStage, currentBuildRecoveredStagePixels: foldedStage.height - expandedStage.height }, null, 2)), contentType: 'application/json' });
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
    await page.mouse.move(0, 0); // pressed, not merely hovered
    const activeToolColor = await deckTab.locator('[data-deck-editor]').evaluate((node) => getComputedStyle(node).color);
    for (const name of ['Inspector', 'Version history']) {
      const toggle = toolbar.getByRole('button', { name, exact: true });
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(toggle).toHaveCSS('color', activeToolColor);
      await expect(toggle).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
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


test('Acceptance: overflowing tabs remain reachable and F6 visits cards and surface content', async ({ maws }, info) => {
  const { page } = maws;
  await size(maws, 1280, 820);
  await openSession(page);
  const composer = main(page).locator('[contenteditable="true"]').first();
  await composer.focus();
  await menu(maws.app, 'region.focusNext');
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-region="cards"]') !== null)).toBe(true);
  await openSurface(page, 'Files');
  await composer.focus();
  await menu(maws.app, 'region.focusNext');
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-panel-content]') !== null)).toBe(true);
  await closeSurface(page, 'Files');

  for (let i = 0; i < 20; i++) await menu(maws.app, 'session.new');
  await expect(page.locator('[data-chrome-tabs]').getByRole('tab')).toHaveCount(21);
  await menu(maws.app, 'settings.open');
  await expect(page.locator('[data-chrome-tabs]').getByRole('tab')).toHaveCount(22);
  for (const dimensions of [...SIZES, { width: 900, height: 820 }, { width: 620, height: 820 }]) {
    await size(maws, dimensions.width, dimensions.height);
    const all = page.getByRole('button', { name: 'All tabs', exact: true });
    await expect(all).toBeVisible();
    const chromeBox = await box(page.locator('[data-chrome-tabs]'));
    const overflowBox = await box(all);
    expect(overflowBox.x + overflowBox.width).toBeLessThanOrEqual(chromeBox.x + chromeBox.width + 1);
    await all.click();
    await expect(page.getByRole('menuitemradio', { name: 'Settings', exact: true })).toBeVisible();
    await shot(maws, info, 'acceptance-tab-overflow');
    await page.getByRole('menuitemradio', { name: 'Settings', exact: true }).click();
    await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  expect(maws.consoleErrors()).toEqual([]);
});

test('Acceptance: compact inactive file tabs contain their extension, pin, dirty mark and close hit target', async () => {
  test.setTimeout(90_000);
  const { writeFileSync } = await import('node:fs');
  const { restoreWithTab, withProduct } = await import('./support/code-product');
  const names = Array.from({ length: 10 }, (_, index) => `adornment-heavy-context-${index}.typescript`);
  await withProduct(async (p) => {
    const { maws, page, scratch } = p;
    await size(maws, 1280, 820);
    // restoreWithTab reads persisted layout; a selected DOM tab can precede that write.
    await expect.poll(async () => {
      const saved = value(await invoke(page, 'layout.get', { key: 'main.tabs' })).value as import('../src/shared/ipc/schema/layout').LayoutMain | null;
      if (!saved) return false;
      return saved.sets[saved.current]?.panes.some((pane) => pane.tabs.some((tab) => tab.id === `session:${scratch.appSessionId}`)) ?? false;
    }, { message: 'the scratch session reached the persisted current tab set before restoring file tabs' }).toBe(true);
    await restoreWithTab(p, names.map((name): import('../src/shared/ipc/schema/layout').TabRef => ({ id: `file:${scratch.path(name)}`, kind: 'file', appSessionId: AppSessionIdSchema.parse(scratch.appSessionId), path: scratch.path(name), line: null, pinned: true })));
    const name = names.at(-1)!;
    const tab = page.locator('[data-chrome-tabs]').getByRole('tab', { name, exact: true });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    const viewer = main(page).locator(`[data-file-viewer][data-path="${scratch.path(name)}"]`);
    await expect(viewer).toHaveAttribute('data-editable', 'true');
    await viewer.locator('.cm-content .cm-line').first().click({ position: { x: 3, y: 4 } });
    await page.keyboard.type('// unsaved tab');
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('data-dirty', 'true');
    await menu(maws.app, 'settings.open');
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    await expect(tab.getByRole('img', { name: 'Pinned', exact: true })).toBeVisible();
    await expect(tab.getByRole('img', { name: 'Unsaved changes', exact: true })).toBeVisible();
    for (const dimensions of [...SIZES, { width: 900, height: 820 }]) {
      await size(maws, dimensions.width, dimensions.height);
      await tab.hover(); // reveals Close without activating the inactive tab
      await expect(tab.getByRole('button', { name: `Close ${name}`, exact: true })).toBeVisible();
      expect((await box(tab)).width, 'decorated tabs stay compact instead of retaining their full title width').toBeLessThanOrEqual(160);
      await expect.poll(() => tab.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const children = Array.from(node.children).map((child) => child.getBoundingClientRect());
        const close = node.querySelector<HTMLButtonElement>('button')!;
        const target = close.getBoundingClientRect();
        const title = node.querySelector<HTMLElement>(':scope > span.truncate:last-of-type')!.getBoundingClientRect();
        return {
          inside: children.every((child) => child.left >= bounds.left && child.right <= bounds.right),
          noOverlap: children.every((child, index) => index === 0 || child.left >= children[index - 1]!.right),
          titleHasRoom: title.width >= 8,
          closeHit: close.contains(document.elementFromPoint(target.x + target.width / 2, target.y + target.height / 2)),
        };
      }), { message: 'each adornment and the visible Close target stays inside its own inactive tab, without overlap' }).toEqual({ inside: true, noOverlap: true, titleHasRoom: true, closeHit: true });
    }
    await tab.click();
    await menu(maws.app, 'file.save');
    await expect(tab).not.toHaveAttribute('data-dirty');
  }, (scratch) => {
    for (const name of names) writeFileSync(scratch.path(name), 'export const value = 1;\n');
  });
});
