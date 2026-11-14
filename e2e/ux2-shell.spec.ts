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
import { addressed, localRef } from './support/address';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { menu } from './support/menu';
import { sidebarRow } from './support/sidebar';
import { backToTabs, hideSurface, mountedTabs, moveSideTab, openAppDestination, openSurface, pageRegion, sessionCard, settingsDialog, sideColumn, sideGroup, sideTab, sideTabNames, unfoldSessionCard } from './support/shell';

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
const layout = async (page: Page, key: 'regions' | 'panelTools.surfaces' | 'panelTools.groups' | 'panelTools.widths' | 'cards.open') => value(await invoke(page, 'layout.get', { key })).value;

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
  // UX wave U7b (O-47): usage is a ring at the title bar's own right end, and the sidebar's foot holds no usage control.
  await expect(page.getByRole('banner').locator('[data-usage-ring]')).toBeVisible();
  await expect(page.getByRole('banner').locator('[data-usage-ring]')).toHaveAttribute('aria-label', /^Usage · /);
  await expect(sidebar(page).locator('footer [data-usage-ring], footer [data-usage-pill]')).toHaveCount(0);
}
// UX wave U7b (O-40): Settings is a dialog over the window and adds no tab; Esc closes it.
async function settingsAddsNoTab(maws: MawsLaunch): Promise<void> {
  const tabs = mountedTabs(maws.page); // the strip is hidden from accessibility under the dialog: its mounted tabs
  const before = await tabs.count();
  await menu(maws.app, 'settings.open');
  await expect(settingsDialog(maws.page)).toBeVisible();
  await expect(tabs, 'the tab count after ⌘, is unchanged').toHaveCount(before);
  await maws.page.keyboard.press('Escape');
  await expect(settingsDialog(maws.page)).toHaveCount(0);
}
async function openSession(page: Page): Promise<void> {
  await expect(sidebar(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 15_000 });
  await (await sidebarRow(page, 'Harness A')).click();
  await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Harness A', exact: true })).toHaveAttribute('aria-selected', 'true');
}

// UX wave U8b (its execution document, Interfaces §C.3 and §D): the card column's cards by title, in order, and a card's
// fold (its heading's button); a group's tab titles in strip order without a tool's suffix (a terminal names its shell's
// title after its own).
const cardTitles = (page: Page) =>
  main(page).getByRole('complementary', { name: 'Session cards' }).locator('div[aria-label="Session cards"] > section').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
const cardFold = (page: Page, title: 'Environment' | 'Context' | 'Connectors') => sessionCard(page, title).locator(':scope > h3 > button');
const tabTitles = async (page: Page, group: 'upper' | 'lower') => (await sideTabNames(page, group)).map((name) => name.split(' · ')[0]!.trim());

// A resizer dragged along x by `dx` pixels (as shell.spec.ts drags one).
async function dragBy(page: Page, resizer: Locator, dx: number): Promise<void> {
  const rect = await box(resizer);
  const [x, y] = [rect.x + rect.width / 2, rect.y + rect.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 10 });
  await page.mouse.up();
}

// The upper group's strip once its fit holds still (two reads that agree) and keeps `fitTabs`' rule (UX wave U8b, M2,
// decision 5; panel/TabStrip.tsx): one tab in view, never an icon; the tabs not in view whole or icons, the icons the
// rightmost of them; the tab in view cut only once every other is an icon, never under 72 px; an icon 28 px wide, its
// title its name and tooltip; and no sideways scroll while the tab in view could still give up width.
interface FittedTab { shape: string; selected: boolean; width: number; name: string; tooltip: string | null }
async function fittedStrip(page: Page, message: string): Promise<FittedTab[]> {
  const read = () =>
    sideGroup(page, 'upper').locator('[data-side-strip] [role="tablist"]').evaluate((list) => ({
      overflow: list.scrollWidth - list.clientWidth,
      tabs: Array.from(list.querySelectorAll('[data-tab-id]')).map((tab) => {
        const button = tab.querySelector('[role="tab"]')!;
        return { shape: tab.getAttribute('data-tab-shape') ?? '', selected: button.getAttribute('aria-selected') === 'true', width: Math.round(tab.getBoundingClientRect().width), name: button.getAttribute('aria-label') ?? button.textContent ?? '', tooltip: button.getAttribute('title') };
      }),
    }));
  let last = '';
  let tabs: FittedTab[] = [];
  await expect
    .poll(async () => {
      const strip = await read();
      tabs = strip.tabs;
      const now = JSON.stringify(strip);
      const still = now === last;
      last = now;
      return still ? fitBreaks(strip) : ['not settled'];
    }, { message: `the strip ${message} keeps the fit rule`, timeout: 10_000 })
    .toEqual([]);
  return tabs;
}
function fitBreaks({ overflow, tabs }: { overflow: number; tabs: FittedTab[] }): string[] {
  const shown = tabs.filter((tab) => tab.selected);
  if (shown.length !== 1) return [`${shown.length} tabs in view`];
  const inView = shown[0]!;
  const others = tabs.filter((tab) => !tab.selected);
  const broken: string[] = [];
  if (inView.shape === 'icon') broken.push('the tab in view is an icon');
  if (others.some((tab) => tab.shape === 'cut')) broken.push('a tab not in view is cut');
  const firstIcon = others.findIndex((tab) => tab.shape === 'icon');
  if (firstIcon !== -1 && others.slice(firstIcon).some((tab) => tab.shape !== 'icon')) broken.push('a tab right of an icon keeps its title');
  if (inView.shape === 'cut' && others.some((tab) => tab.shape !== 'icon')) broken.push('the tab in view is cut while another keeps its title');
  if (inView.shape === 'cut' && inView.width < 72 - 1) broken.push(`the tab in view cut to ${inView.width} px`);
  for (const tab of others.filter((other) => other.shape === 'icon')) {
    if (Math.abs(tab.width - 28) > 1) broken.push(`${tab.name}: an icon ${tab.width} px wide`);
    if (tab.name === '' || tab.tooltip !== tab.name) broken.push(`${tab.name}: an icon without its title as name and tooltip`);
  }
  if ((inView.shape === 'whole' || (inView.shape === 'cut' && inView.width > 72 + 1)) && overflow > 2) broken.push(`the strip scrolls ${overflow} px while a tab could still give up width`);
  return broken;
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
        await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(await addressed(page, 'proj-harness')); // P5 O6 M2: the option's value is the project's address
        await expect(page.getByRole('combobox', { name: 'Live session', exact: true })).toBeVisible();
        await expect(page.locator('[data-plugin-row="chrome-review@chrome-tools"]')).toBeVisible({ timeout: 15_000 });
        await capture('customize-live-plugins', { header: '[data-region="page"] [data-customize-header]', sections: '[aria-label="Customize sections"]', project: 'select[aria-label="Project"]', live: 'select[aria-label="Live session"]', library: '[data-widget-variant="embedded"] > header', loaded: '[data-plugins-loaded]', firstPlugin: '[data-plugin-row="chrome-review@chrome-tools"]' });
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
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(await addressed(page, 'proj-harness')); // P5 O6 M2: the option's value is the project's address
      // UX wave U7b (O-40): Customize is a page; its name is the title bar's heading, so the header row holds the section
      // tabs and the Project select, and the content is measured against the page's box
      const header = pageRegion(page).locator('[data-customize-header]');
      const library = page.locator('[data-widget="plugins"][data-widget-variant="embedded"] > header');
      await expect(library.getByRole('combobox', { name: 'Live session', exact: true })).toBeVisible();
      await expect(page.locator('[data-plugin-row="chrome-review@chrome-tools"]')).toBeVisible({ timeout: 15_000 });
      for (const { width, height } of SIZES) {
        await size(maws, width, height);
        await expect(header.getByRole('heading', { name: 'Customize', exact: true })).toHaveCount(0);
        const headerControls = await Promise.all([box(header.getByRole('tablist', { name: 'Customize sections' })), box(header.getByRole('combobox', { name: 'Project', exact: true }))]);
        const libraryControls = await Promise.all([box(library.getByRole('radio', { name: 'My items', exact: true })), box(library.getByRole('searchbox', { name: 'Search plugins', exact: true })), box(library.getByRole('combobox', { name: 'Live session', exact: true }))]);
        for (const row of [headerControls, libraryControls]) {
          const centers = row.map((rect) => rect.y + rect.height / 2);
          expect(Math.max(...centers) - Math.min(...centers), 'scope controls share their earned row at desktop widths').toBeLessThanOrEqual(1);
        }
        await expect(library.getByRole('heading', { name: 'Plugins', exact: true })).toHaveCount(0);
        const loaded = await box(page.locator('[data-plugins-loaded]'));
        const content = await box(page.locator('[data-plugin-row="chrome-review@chrome-tools"]'));
        const pageBox = await box(pageRegion(page));
        expect(loaded.y).toBeGreaterThanOrEqual((await box(library)).y + (await box(library)).height);
        expect(content.y).toBeGreaterThan(loaded.y + loaded.height);
        expect(await pageRegion(page).evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
        await info.attach(`customize-chrome-regression-${width}x${height}.json`, { body: Buffer.from(JSON.stringify({ window: { width, height }, page: pageBox, headerControls, libraryControls, loaded, firstPlugin: content, contentTopFromPage: content.y - pageBox.y }, null, 2)), contentType: 'application/json' });
        await shot(maws, info, 'customize-three-rows');
      }
      expect(maws.consoleErrors()).toEqual([]);
    } finally { await maws.cleanup(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// UX wave U7b (O-40): Settings is no tab, so Diagnostics stands for the tab of no session; Settings adds no tab.
test('UX2: one chrome row and no reserved column for empty main or a tab of no session', async ({ maws }, info) => {
  const { page } = maws;
  await expect(main(page).getByText('No open tabs')).toBeVisible({ timeout: 15_000 });
  for (const { width, height } of SIZES) {
    await size(maws, width, height);
    await singleChromeRow(page);
    await noReservedPanel(page);
    await shot(maws, info, 'empty');
    await settingsAddsNoTab(maws);
    await menu(maws.app, 'diagnostics.open');
    await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveAttribute('aria-selected', 'true');
    await singleChromeRow(page);
    await noReservedPanel(page);
    await shot(maws, info, 'diagnostics');
    await menu(maws.app, 'tab.close');
    await expect(main(page).getByText('No open tabs')).toBeVisible();
  }
  expect(maws.consoleErrors()).toEqual([]);
});

// UX wave U8b (A1, A3, A11; its execution document, docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md,
// M2 to M4 and "Proof that an executor does not run", the `layout` row): the session's card column holds three cards,
// Environment open; Artifacts is an entry of "More surfaces", no card. Every tool opened beside the chat is a tab of one
// strip, one tab in view, the others kept as they were left; "Move below" in a tab's menu makes a second group under a
// bar; a relaunch brings back the same tabs, the two groups with the tab in view of each, the bar's share and the cards'
// folds, and hiding the column then showing it again restores both groups. Two launches over one profile.
// eslint-disable-next-line no-empty-pattern -- this case owns its two launches over one profile
test('U8b: three cards, Artifacts in More surfaces; tools are tabs with one in view; Move below makes two groups; a relaunch restores tabs, groups, share and folds', async ({}, info) => {
  test.setTimeout(180_000);
  const root = mkdtempSync(join(tmpdir(), 'maws-ux2-tabs-'));
  try {
    const first = await launchMaws({ userData: root, env: ENV });
    let before = { upper: [] as string[], lower: [] as string[], groups: null as unknown, share: '' };
    try {
      const maws = first;
      const { page } = maws;
      await size(maws, 1280, 820);
      await openSession(page);
      const cards = main(page).getByRole('complementary', { name: 'Session cards' });
      await expect(cards).toBeVisible();
      // A1: the three cards a record feeds, in order, Environment open and the other two folded; nothing runs, so neither
      // card for running work is drawn
      await expect.poll(() => cardTitles(page), { message: 'three cards, no Artifacts card' }).toEqual(['Environment', 'Context', 'Connectors']);
      for (const [title, open] of [['Environment', 'true'], ['Context', 'false'], ['Connectors', 'false']] as const) {
        await expect(cardFold(page, title), `${title} ${open === 'true' ? 'open' : 'folded'} at first`).toHaveAttribute('aria-expanded', open);
      }
      // A3: Artifacts is an entry of the title bar's "More surfaces"
      await surfaces(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Artifacts', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: 'Artifacts', exact: true })).toHaveCount(0);
      for (const { width, height } of SIZES) {
        await size(maws, width, height);
        await shot(maws, info, 'session-cards');
      }
      // The approved expanded state uses the real session/git/connector reads, not screenshot-only data.
      await expect.poll(async () => value(await invoke(page, 'engine.hostState', undefined)).state, { timeout: 20_000 }).toBe('ready');
      const environment = sessionCard(page, 'Environment');
      const connectors = await unfoldSessionCard(page, 'Connectors');
      await expect(environment).toContainText('/tmp/maws-harness/a');
      await expect(environment.getByText('…', { exact: true })).toHaveCount(0); // git watch has answered
      await expect(connectors.getByText('Connector status not reported', { exact: true })).toBeVisible();
      for (const { width, height } of SIZES) {
        await size(maws, width, height);
        await shot(maws, info, 'session-cards-expanded');
      }
      // the folds the relaunch must bring back: Environment folded, Connectors open (`cards.open`)
      await cardFold(page, 'Environment').click();
      await expect(cardFold(page, 'Environment')).toHaveAttribute('aria-expanded', 'false');
      await expect.poll(() => layout(page, 'cards.open'), { message: 'the folds are stored' }).toEqual({ version: 1, open: ['connectors'] });

      // A11's first half: Review, a terminal and Session info are three tabs of one strip, one tool in view at a time
      await size(maws, 1280, 820);
      await openSurface(page, 'Review');
      await expect.poll(() => stack(page)).toEqual(['review']);
      const wide = (await box(panel(page))).width;
      await openSurface(page, 'Terminal');
      await expect.poll(() => stack(page), { message: 'the terminal in place of Review, which stays a tab' }).toEqual(['terminal']);
      await expect(surface(page, 'terminal').locator('[data-terminal-id]')).toBeVisible({ timeout: 15_000 });
      const terminalId = await surface(page, 'terminal').locator('[data-terminal-id]').getAttribute('data-terminal-id');
      expect((await box(panel(page))).width, 'a terminal earns the wide column, as Review does (UX wave U8b, Addendum 6)').toBe(wide);
      await expect(surface(page, 'terminal').getByRole('tablist'), 'a terminal draws no strip of its own').toHaveCount(0);
      await openSurface(page, 'Session info');
      await expect.poll(() => stack(page), { message: 'one tool in view' }).toEqual(['session-info']);
      expect((await box(panel(page))).width, 'Session info the narrow one').toBeLessThan(wide);
      await expect(sideColumn(page).locator('section[data-side-group]'), 'one group').toHaveCount(1);
      await expect.poll(() => tabTitles(page, 'upper'), { message: 'three tabs in the order they were opened' }).toEqual(['Review', 'Terminal', 'Session info']);
      await expect(sideColumn(page).getByRole('tab', { selected: true })).toHaveAccessibleName('Session info');
      await expect(sideGroup(page, 'upper').locator('[data-side-strip]').getByRole('button', { name: 'Hide side column', exact: true })).toBeVisible();
      // a tab chosen comes into view as it was left: the same terminal
      await sideTab(sideColumn(page), /^Terminal/).click();
      await expect.poll(() => stack(page)).toEqual(['terminal']);
      await expect(surface(page, 'terminal').locator('[data-terminal-id]'), 'the terminal kept while it was not in view').toHaveAttribute('data-terminal-id', terminalId!);

      // M3: "Move below" on Review (a tab not in view) splits the column; the upper group keeps the terminal in view and
      // Review comes into view in the lower one, the bar between them in place of a gap
      await moveSideTab(page, 'Review', 'below');
      await expect.poll(() => stack(page), { message: 'two groups, a tab in view in each' }).toEqual(['terminal', 'review']);
      await expect.poll(() => tabTitles(page, 'upper')).toEqual(['Terminal', 'Session info']);
      expect(await tabTitles(page, 'lower')).toEqual(['Review']);
      await expect(sideGroup(page, 'upper')).toHaveAttribute('aria-label', 'Terminal');
      await expect(sideGroup(page, 'lower')).toHaveAttribute('aria-label', 'Review');
      await expect(sideGroup(page, 'lower').getByRole('button', { name: 'Hide side column', exact: true }), 'the region’s controls stay on the first strip').toHaveCount(0);
      const bar = sideColumn(page).getByRole('separator', { name: 'Resize groups', exact: true });
      await expect(bar).toHaveAttribute('aria-orientation', 'horizontal');
      const [upperBox, barBox, lowerBox] = [await box(sideGroup(page, 'upper')), await box(bar), await box(sideGroup(page, 'lower'))];
      expect(Math.abs(barBox.y - (upperBox.y + upperBox.height)), 'the bar starts where the upper group ends').toBeLessThanOrEqual(1);
      expect(Math.abs(lowerBox.y - (barBox.y + barBox.height)), 'the lower group starts where the bar ends: no other gap').toBeLessThanOrEqual(1);
      expect((await box(panel(page))).width, 'Review in view below keeps the column wide').toBe(wide);
      // a tab of the lower group offers "Move above" and not "Move below"
      await sideTab(sideGroup(page, 'lower'), 'Review').click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: 'Move above', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Move below', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      // The menu closed hands the keyboard back to the tab it was opened on, in a task after the close; so the scene waits
      // for that before it takes the keyboard to the bar, or the hand-back lands between the bar's focus and the keys
      await expect(page.getByRole('menu')).toHaveCount(0);
      await expect(sideTab(sideGroup(page, 'lower'), 'Review'), 'the closed menu hands the keyboard back to its tab').toBeFocused();
      // the bar from the keyboard: the lower group grows by three steps
      const evenShare = Number(await bar.getAttribute('aria-valuenow'));
      await bar.focus();
      await expect(bar).toBeFocused();
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
      await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow')), { message: 'the lower group’s share grew' }).toBeGreaterThan(evenShare);
      for (const { width, height } of SIZES) {
        await size(maws, width, height);
        await shot(maws, info, 'two-groups');
      }
      await size(maws, 1280, 820);
      const scope = await addressed(page, 'A');
      const reviewTab = await sideGroup(page, 'lower').locator('[data-tab-id]').first().getAttribute('data-tab-id');
      const storedLower = async () => ((await layout(page, 'panelTools.groups')) as { lower: Record<string, { tabs: string[]; share: number } | undefined> }).lower[scope];
      await expect.poll(async () => (await storedLower())?.share ?? 0, { message: 'the moved share is stored' }).toBeGreaterThan(0.5);
      expect((await storedLower())?.tabs, 'the lower group stored with its tab').toEqual([reviewTab]);
      await expect.poll(async () => ((await layout(page, 'panelTools.surfaces')) as { stacks: Record<string, string[]> }).stacks[scope]?.length, { message: 'both tabs in view are stored' }).toBe(2);
      before = { upper: await tabTitles(page, 'upper'), lower: await tabTitles(page, 'lower'), groups: await layout(page, 'panelTools.groups'), share: (await bar.getAttribute('aria-valuenow'))! };
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      await first.cleanup(); // the quit
    }

    const second = await launchMaws({ userData: root, env: ENV });
    try {
      const maws = second;
      const { page } = maws;
      await size(maws, 1280, 820);
      await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Harness A', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
      await expect.poll(() => stack(page), { message: 'both groups back, each with its tab in view', timeout: 15_000 }).toEqual(['terminal', 'review']);
      expect(await tabTitles(page, 'upper'), 'the same tabs above').toEqual(before.upper);
      expect(await tabTitles(page, 'lower'), 'the same tabs below').toEqual(before.lower);
      await expect(sideColumn(page).getByRole('separator', { name: 'Resize groups', exact: true }), 'the bar’s share as it was left').toHaveAttribute('aria-valuenow', before.share);
      expect(await layout(page, 'panelTools.groups'), 'hydration rewrote no group').toEqual(before.groups);
      // hiding the column shows the cards with their folds as they were left
      await hideSurface(page, 'Terminal');
      await expect.poll(() => stack(page)).toEqual([]);
      await expect(main(page).getByRole('complementary', { name: 'Session cards' })).toBeVisible();
      for (const [title, open] of [['Environment', 'false'], ['Context', 'false'], ['Connectors', 'true']] as const) {
        await expect(cardFold(page, title), `${title} as it was left`).toHaveAttribute('aria-expanded', open);
      }
      // and the terminal's icon shows the column again with both groups and both tabs in view
      await openSurface(page, 'Terminal');
      await expect.poll(() => stack(page), { message: 'hide then show restores both groups' }).toEqual(['terminal', 'review']);
      expect(await tabTitles(page, 'upper')).toEqual(before.upper);
      expect(await tabTitles(page, 'lower')).toEqual(before.lower);
      await shot(maws, info, 'two-groups-relaunched');
      expect(maws.consoleErrors()).toEqual([]);
    } finally {
      await second.cleanup();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// UX wave U8b (M2, decision 5: the owner's "Shrink to icons" of 2026-11-12; `fitTabs` in panel/TabStrip.tsx): while a
// strip's tabs do not fit, the tabs not in view stand as their icons alone (28 px, the title as tooltip and name), the
// rightmost first; only once every one of them is an icon is the tab in view cut, down to 72 px. Five tools (two
// terminals among them: a second terminal is a second tab of the strip) with Session info in view, so at the narrow
// automatic 360 px (a terminal in view would make the column wide, Addendum 6), then at the column's minimum and at its
// maximum.
test('U8b: a narrow strip shrinks the tabs not in view to icons, the rightmost first, then cuts the tab in view; two terminals are two tabs', async ({ maws }, info) => {
  test.setTimeout(120_000);
  const { page } = maws;
  await size(maws, 1280, 820);
  await openSession(page);
  await openSurface(page, 'Terminal');
  await expect(surface(page, 'terminal').locator('[data-terminal-id]')).toBeVisible({ timeout: 15_000 });
  const firstTerminal = await surface(page, 'terminal').locator('[data-terminal-id]').getAttribute('data-terminal-id');
  const firstTab = await sideGroup(page, 'upper').locator('[data-tab-id]').first().getAttribute('data-tab-id');
  for (const tool of ['Session info', 'Background tasks', 'Subagents', 'Terminal']) {
    await sideGroup(page, 'upper').getByRole('button', { name: 'Add a tool', exact: true }).click();
    await page.getByRole('menuitem', { name: tool, exact: true }).click();
    await expect(sideColumn(page).getByRole('tab', { selected: true }), `${tool} from "+" comes into view`).toHaveAccessibleName(tool === 'Terminal' ? /^Terminal/ : tool);
  }
  // a second terminal is a second tab of the strip, its own process; the first is kept and comes back as it was left
  await expect.poll(() => tabTitles(page, 'upper')).toEqual(['Terminal', 'Session info', 'Background tasks', 'Subagents', 'Terminal']);
  await expect(surface(page, 'terminal').locator('[data-terminal-id]')).toBeVisible({ timeout: 15_000 });
  await expect(surface(page, 'terminal').locator('[data-terminal-id]')).not.toHaveAttribute('data-terminal-id', firstTerminal!);
  await expect(page.getByRole('tablist', { name: 'terminal tabs' }), 'no strip inside a terminal').toHaveCount(0);
  await sideGroup(page, 'upper').locator(`[data-tab-id="${firstTab}"] [role="tab"]`).click();
  await expect(surface(page, 'terminal').locator('[data-terminal-id]')).toHaveAttribute('data-terminal-id', firstTerminal!);
  // a tab in the middle in view, so tabs stand on both sides of it
  await sideTab(sideColumn(page), 'Session info').click();
  await expect.poll(() => stack(page)).toEqual(['session-info']);

  const resizer = panel(page).getByRole('separator', { name: 'Resize right panel', exact: true });
  await expect(resizer, 'a narrow tool’s automatic width').toHaveAttribute('aria-valuenow', '360');
  const automatic = await fittedStrip(page, 'at 360 px');
  test.info().annotations.push({ type: 'strip at 360 px', description: JSON.stringify(automatic) });
  expect(automatic.filter((tab) => tab.shape === 'icon').length, 'five tabs do not fit 360 px whole: some are icons').toBeGreaterThan(0);
  await shot(maws, info, 'strip-narrow');

  await resizer.focus();
  await page.keyboard.press('Home');
  await expect(resizer).toHaveAttribute('aria-valuenow', '280');
  const least = await fittedStrip(page, 'at 280 px');
  test.info().annotations.push({ type: 'strip at 280 px', description: JSON.stringify(least) });
  expect(least.map((tab) => tab.shape), 'at the minimum every tab not in view is an icon and the tab in view is cut').toEqual(['icon', 'cut', 'icon', 'icon', 'icon']);
  await shot(maws, info, 'strip-least');

  await page.keyboard.press('End');
  await expect.poll(async () => Number(await resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(360);
  const most = await fittedStrip(page, 'at the maximum');
  test.info().annotations.push({ type: 'strip at the maximum', description: JSON.stringify(most) });
  expect(most.filter((tab) => tab.shape === 'icon').length, 'a wider strip has no more icons').toBeLessThanOrEqual(automatic.filter((tab) => tab.shape === 'icon').length);
  expect(most.find((tab) => tab.selected)?.shape).toBe('whole');
  expect(maws.consoleErrors()).toEqual([]);
});

// UX wave U8b (A5; M1, decision 3; X-165): two remembered widths. Review, Files, the browser and a terminal (Addendum 6)
// open at 60 % of the room right of the sidebar, any other tool at 360 px; a drag moves only the width in use, and a reset (Enter) makes it
// automatic again, writing F's 380 to `regions.panel.width`.
test('U8b (A5): the side column remembers a reading tool’s width and any other tool’s apart', async ({ maws }) => {
  const { page } = maws;
  await size(maws, 1512, 982);
  await openSession(page);
  const resizer = panel(page).getByRole('separator', { name: 'Resize right panel', exact: true });
  const width = async () => Number(await resizer.getAttribute('aria-valuenow'));
  await openSurface(page, 'Review');
  const room = (await page.evaluate(() => innerWidth)) - Math.round((await box(sidebar(page))).width);
  await expect.poll(width, { message: 'Review opens at 60 % of the room' }).toBe(Math.round(room * 0.6));
  expect(Math.round((await box(panel(page))).width)).toBe(Math.round(room * 0.6));
  await expect.poll(() => layout(page, 'panelTools.widths'), { message: 'a fresh profile: both widths automatic' }).toEqual({ version: 1, wide: null, narrow: null });

  await dragBy(page, resizer, (await width()) - 820); // Review dragged wider
  await expect(resizer).toHaveAttribute('aria-valuenow', '820');
  await expect.poll(() => layout(page, 'panelTools.widths')).toEqual({ version: 1, wide: 820, narrow: null });

  // Files is a reading tool: the same wide width. Its refresh lives beside the root, without a toolbar of its own.
  await openSurface(page, 'Files');
  await expect(resizer).toHaveAttribute('aria-valuenow', '820');
  const files = surface(page, 'files');
  const root = files.getByRole('treeitem').first();
  await expect(root).toHaveAttribute('aria-expanded', 'true');
  const refreshBox = await box(files.getByRole('button', { name: 'Refresh', exact: true }));
  const rootBox = await box(root);
  expect(refreshBox.y, 'Files refresh lives beside the root, without its own toolbar').toBe(rootBox.y);
  expect(refreshBox.y + refreshBox.height).toBeLessThanOrEqual(rootBox.y + rootBox.height);

  await openSurface(page, 'Background tasks');
  await expect(resizer, 'any other tool opens at 360 px').toHaveAttribute('aria-valuenow', '360');
  expect(Math.round((await box(panel(page))).width)).toBe(360);
  await dragBy(page, resizer, 360 - 400);
  await expect(resizer).toHaveAttribute('aria-valuenow', '400');
  await expect.poll(() => layout(page, 'panelTools.widths'), { message: 'the drag moved the narrow width alone' }).toEqual({ version: 1, wide: 820, narrow: 400 });

  await openSurface(page, 'Review');
  await expect(resizer, 'Review as wide as it was left').toHaveAttribute('aria-valuenow', '820');
  await openSurface(page, 'Background tasks');
  await expect(resizer, 'Background tasks at 400 the next time').toHaveAttribute('aria-valuenow', '400');

  await resizer.focus();
  await page.keyboard.press('Enter'); // the reset: automatic again
  await expect(resizer).toHaveAttribute('aria-valuenow', '360');
  await expect.poll(() => layout(page, 'panelTools.widths')).toEqual({ version: 1, wide: 820, narrow: null });
  expect(((await layout(page, 'regions')) as { panel: { width: number } }).panel.width, 'F reads its automatic width').toBe(380);
  await openSurface(page, 'Review');
  await expect(resizer, 'the reset left the wide width alone').toHaveAttribute('aria-valuenow', '820');
  expect(maws.consoleErrors()).toEqual([]);
});

// The overflow tool's icon: pinned to the toolbar it stays in the row. UX wave U8b (M2, decision 8): a click on the icon
// of the tool in view hides the side column and closes nothing (its tab and instance stay); its context menu reads
// "Hide surface" then, "Open surface" otherwise.
test('UX2 → U8b: an overflow tool’s icon pins to the toolbar; the icon of the tool in view hides the column and closes nothing', async ({ maws }, info) => {
  const { page } = maws;
  await size(maws, 1512, 982); // room for the chrome to keep the pinned icon
  await openSession(page);
  const scope = await addressed(page, 'A');
  await surfaces(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Session info', exact: true })).toBeVisible();
  await shot(maws, info, 'overflow-menu');
  await page.getByRole('menuitem', { name: 'Session info', exact: true }).click();
  await expect.poll(() => stack(page)).toEqual(['session-info']);
  const tabId = await sideGroup(page, 'upper').locator('[data-tab-id]').first().getAttribute('data-tab-id');
  const infoIcon = surfaces(page).getByRole('button', { name: 'Session info', exact: true });
  await infoIcon.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Hide surface', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Pin to toolbar', exact: true }).click();
  await infoIcon.click(); // the icon of the tool in view: the column hides, the tab stays
  await expect.poll(() => stack(page)).toEqual([]);
  await expect(main(page).getByRole('complementary', { name: 'Session cards' }), 'the cards where the column was').toBeVisible();
  await expect(infoIcon).toBeVisible();
  await expect(infoIcon).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => layout(page, 'panelTools.surfaces')).toMatchObject({ pinnedTools: ['session-info'], stacks: { [scope]: [] } });
  await infoIcon.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open surface', exact: true }).click();
  await expect.poll(() => stack(page)).toEqual(['session-info']);
  await expect(sideGroup(page, 'upper').locator('[data-tab-id]'), 'the same tab, nothing closed').toHaveAttribute('data-tab-id', tabId!);
  await infoIcon.click();
  await expect.poll(() => stack(page)).toEqual([]);
  await page.reload();
  await expect(infoIcon).toBeVisible({ timeout: 15_000 });
  await expect(infoIcon).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => stack(page)).toEqual([]);
  await infoIcon.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin from toolbar', exact: true }).click();
  await expect(infoIcon, 'an unpinned overflow tool not in view leaves the icon row').toHaveCount(0);
  expect(maws.consoleErrors()).toEqual([]);
});

test('UX2: at 900 the sidebar yields; at 620 a surface is a dismissible sheet', async ({ maws }, info) => {
  const { page } = maws;
  await size(maws, 1280, 820);
  await openSession(page);
  await openSurface(page, 'Files');
  await expect(surface(page, 'files')).toBeVisible();
  await expect.poll(() => layout(page, 'panelTools.surfaces')).toMatchObject({ stacks: { [await addressed(page, 'A')]: [expect.any(String)] } });
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
  await hideSurface(page, 'Files');

  for (let i = 0; i < 20; i++) await menu(maws.app, 'session.new');
  await expect(page.locator('[data-chrome-tabs]').getByRole('tab')).toHaveCount(21);
  await menu(maws.app, 'diagnostics.open'); // UX wave U7b: Diagnostics stands for the tab of no session Settings was
  await expect(page.locator('[data-chrome-tabs]').getByRole('tab')).toHaveCount(22);
  await settingsAddsNoTab(maws);
  // UX wave U7b (M5's observation; the branch review): Back shows the strip at the offset it had when the page opened.
  // With a side column open the title bar spans main's columns only, and a page widens it across the column, which
  // clamps the hidden strip's offset. The strip is left a little short of its end with Diagnostics, its last tab, in
  // front and in view: the wider strip under the page must clamp that offset, and keeping the tab in front in view
  // after Back would scroll to the end, not to the offset.
  await openSurface(page, 'Background tasks');
  const list = page.locator('[data-chrome-tabs] [role="tablist"]');
  const inFront = list.getByRole('tab', { name: 'Diagnostics', exact: true });
  await expect(inFront).toHaveAttribute('aria-selected', 'true');
  const overflow = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, 'the strip overflows by more than the step short of its end').toBeGreaterThan(80);
  await list.evaluate((el) => { el.scrollLeft = el.scrollWidth - el.clientWidth - 40; });
  let offset = -1;
  await expect.poll(async () => {
    const now = await list.evaluate((el) => el.scrollLeft);
    const settled = now === offset;
    offset = now;
    return settled;
  }, { message: 'the strip’s scroll has settled', intervals: [250] }).toBe(true);
  expect(offset, 'the strip is scrolled, short of its end').toBe(overflow - 40);
  const [stripBox, tabBox] = [await box(list), await box(inFront)];
  expect(tabBox.x + tabBox.width, 'the tab in front is in view').toBeLessThanOrEqual(stripBox.x + stripBox.width + 1);
  await openAppDestination(page, 'Customize');
  await expect.poll(() => list.evaluate((el) => el.scrollLeft), { message: 'the wider strip under the page clamps the offset' }).not.toBe(offset);
  await backToTabs(page);
  await expect(inFront).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => list.evaluate((el) => el.scrollLeft), { message: 'Back shows the strip at the same offset' }).toBe(offset);
  await hideSurface(page, 'Background tasks');
  for (const dimensions of [...SIZES, { width: 900, height: 820 }, { width: 620, height: 820 }]) {
    await size(maws, dimensions.width, dimensions.height);
    const all = page.getByRole('button', { name: 'All tabs', exact: true });
    await expect(all).toBeVisible();
    const chromeBox = await box(page.locator('[data-chrome-tabs]'));
    const overflowBox = await box(all);
    expect(overflowBox.x + overflowBox.width).toBeLessThanOrEqual(chromeBox.x + chromeBox.width + 1);
    await all.click();
    await expect(page.getByRole('menuitemradio', { name: 'Diagnostics', exact: true })).toBeVisible();
    await shot(maws, info, 'acceptance-tab-overflow');
    await page.getByRole('menuitemradio', { name: 'Diagnostics', exact: true }).click();
    await expect(page.locator('[data-chrome-tabs]').getByRole('tab', { name: 'Diagnostics', exact: true })).toHaveAttribute('aria-selected', 'true');
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
    const [machine, session] = [await localRef(page), await addressed(page, scratch.appSessionId)]; // the page's tabs hold addresses
    await size(maws, 1280, 820);
    // restoreWithTab reads persisted layout; a selected DOM tab can precede that write.
    await expect.poll(async () => {
      const saved = value(await invoke(page, 'layout.get', { key: 'main.tabs' })).value as import('../src/shared/ipc/schema/layout').LayoutMain | null;
      if (!saved) return false;
      return saved.sets[saved.current]?.panes.some((pane) => pane.tabs.some((tab) => tab.id === `session:${session}`)) ?? false;
    }, { message: 'the scratch session reached the persisted current tab set before restoring file tabs' }).toBe(true);
    await restoreWithTab(p, names.map((name): import('../src/shared/ipc/schema/layout').TabRef => ({ id: `file:${machine}:${scratch.path(name)}`, kind: 'file', appSessionId: AppSessionIdSchema.parse(session), path: scratch.path(name), line: null, machine, pinned: true })));
    const name = names.at(-1)!;
    const tab = page.locator('[data-chrome-tabs]').getByRole('tab', { name, exact: true });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    const viewer = main(page).locator(`[data-file-viewer][data-path="${scratch.path(name)}"]`);
    await expect(viewer).toHaveAttribute('data-editable', 'true');
    await viewer.locator('.cm-content .cm-line').first().click({ position: { x: 3, y: 4 } });
    await page.keyboard.type('// unsaved tab');
    await page.keyboard.press('Enter');
    await expect(tab).toHaveAttribute('data-dirty', 'true');
    await settingsAddsNoTab(maws); // UX wave U7b: Settings is a dialog; Diagnostics is the other tab that takes the front
    await expect(tab, 'the dialog left the file tab in front').toHaveAttribute('aria-selected', 'true');
    await menu(maws.app, 'diagnostics.open');
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
        // U13a: the title shares a box with the tab's place (drawn in a strip that mixes places), so the walk measures
        // that box's own children, the title and the place, beside the marks and the close button
        const titleNode = node.querySelector<HTMLElement>(':scope > span > span.truncate')!;
        const children = Array.from(node.children)
          .flatMap((child) => (child.contains(titleNode) ? Array.from(child.children) : [child]))
          .map((child) => child.getBoundingClientRect());
        const close = node.querySelector<HTMLButtonElement>('button')!;
        const target = close.getBoundingClientRect();
        const title = titleNode.getBoundingClientRect();
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

// U6a (the UX wave's U6, first landing; A7 and A9): the side surfaces' chords are menu accelerators, View reads in groups
// with five submenus, and the shortcut sheet groups its keys as the menus do. A key equivalent cannot be pressed through
// Playwright (support/menu.ts), so the scene reads the installed menu and clicks its items by id. Free of how two surfaces
// arrange: each surface is shown and hidden again before the next.
test('U6a: ⌘J, ⇧⌘D and ⇧⌘F show and hide Terminal, Review and Files; View in groups; the sheet in the same groups', async ({ maws }) => {
  const { page } = maws;
  await size(maws, 1512, 982);
  await openSession(page);
  const installed = await maws.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()!;
    const view = menu.items.find((item) => item.label === 'View')!.submenu!.items;
    return {
      chords: ['surface.terminal', 'surface.review', 'surface.files'].map((id) => menu.getMenuItemById(id)?.accelerator ?? null),
      submenus: view.filter((item) => item.type === 'submenu').map((item) => item.label),
    };
  });
  expect(installed).toEqual({ chords: ['Cmd+J', 'Cmd+Shift+D', 'Cmd+Shift+F'], submenus: ['Tabs', 'More surfaces', 'Comments', 'Appearance', 'Developer'] });
  for (const id of ['terminal', 'review', 'files']) {
    await menu(maws.app, `surface.${id}`);
    await expect.poll(() => stack(page), { message: `View ▸ ${id} shows it` }).toContain(id);
    await menu(maws.app, `surface.${id}`);
    await expect.poll(() => stack(page), { message: `View ▸ ${id} again hides it` }).not.toContain(id);
  }
  await menu(maws.app, 'shortcuts.open');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet.getByRole('table', { name: 'View › Tabs' })).toBeVisible();
  await expect(sheet.getByRole('table', { name: 'View', exact: true }).getByRole('row', { name: /Terminal/ })).toContainText('⌘J');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(maws.consoleErrors()).toEqual([]);
});
