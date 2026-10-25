// P4-AGG's Discover group (`pnpm e2e:discover`, MAWS_DISCOVER_E2E=1; the spec skips itself otherwise, so `pnpm e2e` is
// unchanged): docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, acceptance 1 to 7 and the Plugins side of 11
// (M3). The app runs the real pinned engine (support/real-engine.ts: MAWS_E2E_ENGINE_BIN, which the job's
// scripts/provision-engine.sh exports, else the installed 2.1.309; missing or another version fails the run, never
// skips) over the Discover scratch (support/discover-scratch.ts): a scratch HOME, CLAUDE_CONFIG_DIR and projects, the
// engine's Anthropic Directory off, the recorded catalog sources (MAWS_CATALOG_FIXTURES) and the local test marketplace,
// which the test-source descriptor makes discoverable before it is added. Every engine listing and mutation here is the
// unmodified CLI's own; Discover reads only `catalog.*`.
//   home:      Featured with its count and icon; the shelves in the catalog's order; All · N under Installs; the two
//              desktop sizes' screenshots; See all and its removable chip; All sorted by updated across the page
//              boundary lists every item once in both directions (acceptance 1, 6).
//   labels:    search over both names; the trust labels and their tooltips; one card for a joined pair with "Also
//              listed by", two for a same-name pair (acceptance 2).
//   install:   the sheets' warnings; + before the marketplace is added: the add step, the contents and the hook that
//              runs code; the real CLI adds and installs; settings, the engine's own listing, My items; Skills names the
//              plugin and its skills; a second marketplace nobody else lists, added while Discover shows, brings its
//              plugins from the host's read; one removed outside the app brings the add step back (acceptance 3, 5, 7).
//   projects:  installed at project scope in A reads Installed there and "Installed in another project" in B, + kept;
//              Not installed (acceptance 4).
//   offline:   without the directory's and plugin-details' recordings, the manifests' items stay, plainer, with no
//              counts and no Featured, and the Sources popover says which sources are unavailable (acceptance 11).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { invoke, value } from './support/c7-replay';
import { TEST_MARKETPLACE } from './support/discover-scratch';
import { launchMaws, type MawsLaunch } from './support/launch';
import { REAL_ENGINE_VERSION } from './support/real-engine';
import { openAppDestination } from './support/shell';

test.skip(process.env.MAWS_DISCOVER_E2E !== '1', 'the Discover e2e runs under pnpm e2e:discover (MAWS_DISCOVER_E2E=1)');
test.describe.configure({ timeout: 360_000 });

const CLI_MS = 120_000; // one CLI action, the engine's own start included, on a loaded runner
const TEST_PLUGINS = ['hooked', 'local-server', 'remote-server', 'skills-only'];

let maws: MawsLaunch | null = null;
test.afterEach(async () => {
  await maws?.cleanup();
  maws = null;
});

// The engine's own CLI against the launch's scratch configuration and HOME only.
function engineCli(launch: MawsLaunch, args: string[]): string {
  const engine = launch.realEngine!;
  return execFileSync('/usr/bin/env', ['-i', `HOME=${engine.scratch.home}`, `CLAUDE_CONFIG_DIR=${engine.scratch.configDir}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', engine.bin, ...args], { cwd: engine.scratch.projects[0], encoding: 'utf8', timeout: CLI_MS });
}

const library = (page: Page) => page.locator('[data-region="main"] [data-widget="plugins"][data-widget-variant="embedded"]');
const pane = (page: Page) => page.locator('[data-discover="plugins"]');
// the last grid of the pane: All on the home, else the narrowed results
const results = (page: Page, root = pane(page)) => root.locator('[data-catalog-results]').last();
const resultCards = (page: Page) => results(page).locator('[data-catalog-grid] [data-catalog-card]');
const byName = (scope: Locator, installName: string) => scope.locator(`[data-catalog-card][data-install-name="${installName}"]`);
const sheet = (page: Page) => page.locator('[data-plugins-sheet="install"]');

async function openDiscover(page: Page, tab: 'Plugins' | 'Skills' = 'Plugins'): Promise<void> {
  await openAppDestination(page, 'Customize');
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.getByRole('tabpanel', { name: tab }).getByRole('radio', { name: 'Discover' }).click();
  await expect(page.locator(`[data-discover="${tab.toLowerCase()}"]`)).toBeVisible();
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search all sources' }).fill(text);
}

// A fresh search: the home first, so the next results cannot be the last search's.
async function searchAfresh(page: Page, text: string): Promise<void> {
  await search(page, '');
  await expect(pane(page).locator('[data-discover-home]')).toBeVisible();
  await search(page, text);
}

// Every card of the grid, its later pages asked through Show more (or the end scrolling into view).
async function allCards(page: Page): Promise<string[]> {
  const cards = resultCards(page);
  const more = results(page).locator('[data-show-more]');
  await expect(cards.first()).toBeVisible();
  for (let i = 0; i < 20 && (await more.count()) > 0; i += 1) {
    const before = await cards.count();
    await more.click({ timeout: 5_000 }).catch(() => undefined); // the end may already have asked
    await expect.poll(() => cards.count()).toBeGreaterThan(before);
  }
  return cards.evaluateAll((all) => all.map((card) => card.getAttribute('data-catalog-card')!));
}

// The card's whole-card target, by keyboard: focus it, Enter (the spec's keyboard decision).
async function openCard(page: Page, card: Locator): Promise<void> {
  await card.locator('[data-card-open]').focus();
  await page.keyboard.press('Enter');
}

async function sheetFor(page: Page, card: Locator, name: string): Promise<Locator> {
  await card.getByRole('button', { name: `Add ${name}`, exact: true }).click();
  await expect(sheet(page).locator('[data-plugins-argv]')).toBeVisible({ timeout: 30_000 });
  return sheet(page);
}

async function cancel(s: Locator): Promise<void> {
  await s.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(s).toBeHidden();
}

const argvOf = async (s: Locator, attribute: 'data-plugins-argv' | 'data-plugins-add-argv') => JSON.parse((await s.locator(`[${attribute}]`).getAttribute(attribute))!) as string[];

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function contentSize(launch: MawsLaunch, width: number, height: number): Promise<void> {
  await launch.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const);
  await expect.poll(() => launch.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height]);
}

async function chooseProject(page: Page, name: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Project', exact: true });
  await select.selectOption((await select.locator('option', { hasText: name }).getAttribute('value'))!);
  await library(page).getByRole('radio', { name: 'Discover' }).click(); // the page's library is the project's own
  await expect(pane(page)).toBeVisible();
}

test('home: Featured, the shelves, All under Installs; the two desktop sizes; See all; sorting across the page boundary', async () => {
  const info = test.info();
  maws = await launchMaws({ realEngine: { projects: 1 } });
  const { page, app } = maws;
  const engine = maws.realEngine!;

  await test.step('the prerequisites: the pinned engine in the host, the scratch, the catalog seams', async () => {
    expect(engine.version).toBe(REAL_ENGINE_VERSION);
    const env = value(await invoke(page, 'plugins.env', {}));
    expect(env.binary && realpathSync(env.binary)).toBe(realpathSync(engine.bin));
    expect(env.configHome).toBe(engine.scratch.configDir);
    const mainEnv = await app.evaluate(() => ({ fixtures: process.env.MAWS_CATALOG_FIXTURES, sources: process.env.MAWS_CATALOG_TEST_SOURCES, home: process.env.HOME }));
    expect(existsSync(join(mainEnv.fixtures!, 'directory:plugins.json'))).toBe(true);
    expect(JSON.parse(readFileSync(mainEnv.sources!, 'utf8'))).toMatchObject([{ marketplaceName: TEST_MARKETPLACE, marketplaceSource: engine.scratch.marketplace }]);
    expect(mainEnv.home).toBe(engine.scratch.home);
  });

  await openDiscover(page);
  const home = value(await invoke(page, 'catalog.home', { tab: 'plugins', cwd: null }));

  await test.step('Featured: the most-installed plugin listed by Anthropic, its count, its icon as main’s data', async () => {
    const featured = pane(page).locator('[data-featured]');
    await expect(featured).toHaveAttribute('data-featured', home.featured!.id);
    await expect(featured).toContainText('frontend-design');
    await expect(featured.locator('[data-catalog-metric]')).toHaveText('1.3M installs');
    await expect(featured.locator('[data-catalog-icon]')).toHaveAttribute('data-catalog-icon', 'image');
    await expect(featured.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  });

  await test.step('the shelves in the catalog’s order: Your sources first, the seeds, at most four categories; one row each', async () => {
    const shelves = pane(page).locator('[data-shelf]');
    await expect.poll(() => shelves.evaluateAll((all) => all.map((s) => s.getAttribute('data-shelf')))).toEqual(home.shelves.map((s) => s.key));
    expect(home.shelves[0]).toMatchObject({ key: 'added', title: 'Your sources', total: 4 });
    expect(home.shelves.filter((s) => s.kind === 'category').length).toBeLessThanOrEqual(4);
    for (const shelf of home.shelves) {
      const drawn = await pane(page).locator(`[data-shelf="${shelf.key}"] [data-catalog-card]`).evaluateAll((cards) => cards.map((c) => c.getAttribute('data-catalog-card')));
      expect(drawn.length, shelf.key).toBeGreaterThan(0);
      expect(drawn, shelf.key).toEqual(shelf.items.slice(0, drawn.length).map((i) => i.id));
    }
  });

  await test.step('Your sources’ See all: the test marketplace’s four plugins, discoverable before it is added', async () => {
    await pane(page).getByRole('button', { name: 'See all of Your sources' }).click();
    await expect(pane(page).locator('[data-filter-chip="Your sources"]')).toBeVisible();
    await expect(results(page).getByRole('heading', { name: '4 results' })).toBeVisible();
    for (const name of TEST_PLUGINS) {
      const card = byName(results(page), name);
      await expect(card.locator('[data-trust]')).toHaveAttribute('data-trust', 'Added by you');
      await expect(card).toContainText('by MAWS e2e');
      await expect(card.locator('[data-catalog-components]')).not.toHaveText('Contents shown after install');
    }
    await expect(byName(results(page), 'hooked')).toContainText('A plugin whose one component is a hook.'); // its manifest entry's description, before the add
    await pane(page).getByRole('button', { name: 'Remove filter Your sources' }).click();
    await expect(pane(page).locator('[data-filter-chip]')).toHaveCount(0);
  });

  await test.step('All · N, every distinct item after joining, under Installs', async () => {
    await expect(results(page).getByRole('heading', { name: `All · ${home.total}` })).toBeVisible();
    await expect(results(page).locator('[data-sort-shown]')).toHaveText('Installs');
  });

  await test.step('the screenshots at 1280×820 and 1512×982', async () => {
    for (const [w, h] of [[1280, 820], [1512, 982]] as const) {
      await contentSize(maws!, w, h);
      await expect(pane(page).locator('[data-featured]')).toBeVisible();
      await pane(page).locator('[data-discover-pane]').evaluate((el) => el.scrollTo(0, 0));
      await shot(page, info, `discover-plugins-${w}x${h}.png`);
    }
  });

  await test.step('See all on Claude for Financial Services: that source’s grid, its chip removable', async () => {
    const fs = home.shelves.find((s) => s.title === 'Claude for Financial Services')!;
    await pane(page).getByRole('button', { name: 'See all of Claude for Financial Services' }).click();
    await expect(pane(page).locator('[data-filter-chip="Claude for Financial Services"]')).toBeVisible();
    await expect(results(page).getByRole('heading', { name: `${fs.total} results` })).toBeVisible();
    await pane(page).getByRole('button', { name: 'Remove filter Claude for Financial Services' }).click();
    await expect(pane(page).locator('[data-discover-home]')).toBeVisible();
  });

  await test.step('All sorted by updated, across the page boundary: every item exactly once, in both directions', async () => {
    expect(home.total).toBeGreaterThan(60); // more than catalog.query's one page
    await results(page).getByRole('button', { name: 'Sort by' }).click();
    await page.getByRole('menuitemradio', { name: 'Updated' }).click();
    await expect(results(page).locator('[data-sort-shown]')).toHaveText('Updated');
    const down = await allCards(page);
    expect(down).toHaveLength(home.total);
    expect(new Set(down).size).toBe(home.total);
    await results(page).getByRole('button', { name: 'Reverse order' }).click();
    await expect.poll(() => resultCards(page).first().getAttribute('data-catalog-card')).not.toBe(down[0]);
    const up = await allCards(page);
    expect(up).toHaveLength(home.total);
    expect(new Set(up)).toEqual(new Set(down));
  });
});

test('labels: search over both names, the trust labels and tooltips, a joined pair and a same-name pair', async () => {
  maws = await launchMaws({ realEngine: { projects: 1 } });
  const { page } = maws;
  await openDiscover(page);

  await test.step('legal: claude-for-legal’s own plugins by Anthropic, Verified; its external partner’s by its publisher, Partner', async () => {
    await search(page, 'legal');
    await expect(results(page).getByRole('heading', { name: '13 results' })).toBeVisible();
    for (const name of ['commercial-legal', 'privacy-legal', 'product-legal', 'corporate-legal', 'employment-legal', 'regulatory-legal', 'ai-governance-legal', 'litigation-legal', 'legal-clinic', 'legal-builder-hub', 'ip-legal']) {
      const card = byName(results(page), name);
      await expect(card, name).toContainText('by Anthropic');
      await expect(card.locator('[data-trust]'), name).toHaveAttribute('data-trust', 'Verified');
      await expect(card.locator('[data-trust]'), name).toHaveAttribute('title', 'Verified — Anthropic has reviewed this plugin for quality and security.');
    }
    const partner = byName(results(page), 'cocounsel-legal');
    await expect(partner).toContainText('by Thomson Reuters');
    await expect(partner.locator('[data-trust]')).toHaveAttribute('data-trust', 'Partner');
    await expect(partner.locator('[data-trust]')).toHaveAttribute('title', 'Anthropic’s directory lists the publisher as a partner.');
  });

  await test.step('a community item: Community, with Desktop’s community wording', async () => {
    await searchAfresh(page, '0x');
    const card = byName(results(page), '0x');
    await expect(card.locator('[data-trust]')).toHaveAttribute('data-trust', 'Community');
    await expect(card.locator('[data-trust]')).toHaveAttribute('title', 'This plugin hasn’t been reviewed in depth by Anthropic.');
  });

  await test.step('the official-and-community pair is one card whose detail reads Also listed by claude-community', async () => {
    await searchAfresh(page, '42crunch');
    const card = byName(results(page), '42crunch-api-security-testing');
    await expect(card).toHaveCount(1);
    await openCard(page, card);
    const detail = pane(page).locator('[data-catalog-detail]');
    await expect(detail.locator('[data-also-listed]')).toHaveText('Also listed by claude-community');
    await detail.getByRole('button', { name: 'Back to Discover' }).click();
    await expect(detail).toHaveCount(0);
    await expect(card.locator('[data-card-open]')).toBeFocused(); // Back returns to the list as it was
  });

  await test.step('the same-name pair stays two cards', async () => {
    await searchAfresh(page, 'skill-creator');
    await expect(byName(results(page), 'skill-creator')).toHaveCount(2);
  });

  await test.step('the directory’s display name and the install name both find Adobe', async () => {
    for (const text of ['Adobe', 'adobe-for-creativity']) {
      await searchAfresh(page, text);
      await expect(byName(results(page), 'adobe-for-creativity'), text).toHaveCount(1);
    }
  });
});

test('install: + adds the marketplace and installs through the real CLI; warnings; Skills; marketplaces changing under Discover', async () => {
  maws = await launchMaws({ realEngine: { projects: 1 } });
  const { page, userData } = maws;
  const { configDir, marketplace } = maws.realEngine!.scratch;
  await openDiscover(page);

  await test.step('the sheets’ warnings: a stdio server warns, skills only does not, unknown contents may run code', async () => {
    await searchAfresh(page, 'local-server');
    const local = await sheetFor(page, byName(results(page), 'local-server'), 'local-server');
    await expect(local.locator('[data-runs-code]')).toHaveText('Includes components that run code on your computer: a local MCP server.');
    await cancel(local);
    await searchAfresh(page, 'skills-only');
    const skills = await sheetFor(page, byName(results(page), 'skills-only'), 'skills-only');
    await expect(skills.locator('[data-catalog-contents]')).toHaveText('Comes with: 2 skills');
    await expect(skills.locator('[data-runs-code]')).toHaveCount(0);
    await cancel(skills);
    await searchAfresh(page, '10x-shopping');
    const unknown = await sheetFor(page, byName(results(page), '10x-shopping'), '10x-shopping');
    await expect(unknown.locator('[data-catalog-contents]')).toHaveText('Contents shown after install');
    await expect(unknown.locator('[data-runs-code]')).toHaveText('May include components that run code on your computer; its contents are not known before install.');
    await cancel(unknown);
  });

  await test.step('+ on hooked before its marketplace is added: the add step, its contents, the hook that runs code; installed', async () => {
    await searchAfresh(page, 'hooked');
    const s = await sheetFor(page, byName(results(page), 'hooked'), 'hooked');
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Adds the marketplace ${TEST_MARKETPLACE} (user) and installs hooked`);
    await expect(s.locator('[data-catalog-contents]')).toHaveText('Comes with: hooks');
    await expect(s.locator('[data-runs-code]')).toHaveText('Includes components that run code on your computer: hooks.');
    expect(await argvOf(s, 'data-plugins-add-argv')).toEqual(expect.arrayContaining(['plugin', 'marketplace', 'add', marketplace, '--scope', 'user']));
    const install = await argvOf(s, 'data-plugins-argv');
    expect(install.slice(0, 3)).toEqual(['plugin', 'install', `hooked@${TEST_MARKETPLACE}`]);
    await s.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(s).toBeHidden();
    await expect(byName(results(page), 'hooked')).toHaveAttribute('data-installed', 'here', { timeout: 2 * CLI_MS });
    await expect(byName(results(page), 'hooked').locator('[data-catalog-installed]')).toHaveText('Installed');
  });

  await test.step('installed: the scratch settings, the engine’s own listing, My items', async () => {
    const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean>; extraKnownMarketplaces?: Record<string, { source: { source: string; path: string } }> };
    expect(settings.enabledPlugins?.[`hooked@${TEST_MARKETPLACE}`]).toBe(true);
    expect(settings.extraKnownMarketplaces?.[TEST_MARKETPLACE]?.source).toEqual({ source: 'directory', path: marketplace });
    const own = JSON.parse(engineCli(maws!, ['plugin', 'list', '--json'])) as { id: string; scope: string }[];
    expect(own.find((p) => p.id === `hooked@${TEST_MARKETPLACE}`)).toMatchObject({ scope: 'user' });
    await openCard(page, byName(results(page), 'hooked')); // installed here: it opens in My items
    await expect(library(page).getByRole('radio', { name: 'My items' })).toHaveAttribute('data-state', 'on');
    await expect(library(page).locator(`[data-plugin-detail="hooked@${TEST_MARKETPLACE}"], [data-plugin-row="hooked@${TEST_MARKETPLACE}"]`).first()).toBeVisible({ timeout: CLI_MS });
    await library(page).getByRole('radio', { name: 'Discover' }).click();
    await expect(pane(page)).toBeVisible();
  });

  await test.step('the marketplace now present: local-server installs in one step', async () => {
    await searchAfresh(page, 'local-server');
    const s = await sheetFor(page, byName(results(page), 'local-server'), 'local-server');
    await expect(s.locator('[data-plugins-add-argv]')).toHaveCount(0);
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Installs local-server from ${TEST_MARKETPLACE}`);
    await expect(s.locator('[data-runs-code]')).toContainText('a local MCP server');
    await cancel(s);
  });

  await test.step('Skills › Discover: the note; skills-only’s sheet names the plugin and its skills', async () => {
    await openDiscover(page, 'Skills');
    const skills = page.locator('[data-discover="skills"]');
    await expect(skills.locator('[data-skills-note]')).toHaveText('Items whose contents are not known before install are under Plugins.');
    await search(page, 'skills-only');
    const card = byName(results(page, skills), 'skills-only');
    await expect(card.locator('[data-catalog-components]')).toHaveText('greet, summarize-diff'); // a Skills card lists its skills
    await card.getByRole('button', { name: 'Add skills-only', exact: true }).click();
    await expect(sheet(page).locator('[data-catalog-summary]')).toHaveText(new RegExp(`^Installs the plugin skills-only from ${TEST_MARKETPLACE}, with 2 skills: .*greet`));
    await cancel(sheet(page));
    await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
    await expect(pane(page)).toBeVisible();
  });

  await test.step('a second marketplace nobody else lists, added by path while Discover shows: its plugins from the host’s read', async () => {
    const copy = join(userData, 'maws-second-test');
    cpSync(marketplace, copy, { recursive: true });
    const manifest = join(copy, '.claude-plugin', 'marketplace.json');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(`"name": "${TEST_MARKETPLACE}"`, '"name": "maws-second-test"'));
    const second = realpathSync(copy);
    await searchAfresh(page, 'local-server');
    await expect(byName(results(page), 'local-server')).toHaveCount(1);
    await library(page).getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add marketplace', exact: true }).click();
    const dialog = page.locator('[data-marketplaces-dialog="add"]');
    await dialog.getByRole('textbox', { name: 'Source' }).fill(second);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    const add = page.locator('[data-plugins-sheet="marketplace-add"]');
    await expect(add.locator('[data-plugins-argv]')).toBeVisible({ timeout: 30_000 });
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.locator('[data-marketplace-add-line]')).toContainText('Successfully added marketplace: maws-second-test', { timeout: CLI_MS });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(byName(results(page), 'local-server')).toHaveCount(2, { timeout: CLI_MS }); // without reopening the page
    const theirs = results(page).locator(`[data-catalog-card^="local:${second}"][data-install-name="local-server"]`);
    await expect(theirs).toContainText('by MAWS e2e servers');
    await expect(theirs.locator('[data-trust]')).toHaveAttribute('data-trust', 'Added by you');
    const s = await sheetFor(page, theirs, 'local-server');
    await expect(s.locator('[data-plugins-add-argv]')).toHaveCount(0); // the engine has it now
    await expect(s.locator('[data-runs-code]')).toContainText('a local MCP server');
    await cancel(s);
  });

  await test.step('the test marketplace removed outside the app: its route needs the add step again', async () => {
    const id = `local:${marketplace}#plugins/skills-only`;
    expect(value(await invoke(page, 'catalog.item', { id, cwd: null })).install).toMatchObject({ kind: 'plugin', present: true });
    engineCli(maws!, ['plugin', 'marketplace', 'remove', TEST_MARKETPLACE]);
    await expect.poll(async () => (value(await invoke(page, 'catalog.item', { id, cwd: null })).install as { present?: boolean }).present, { timeout: CLI_MS }).toBe(false);
    await searchAfresh(page, 'skills-only');
    const s = await sheetFor(page, results(page).locator(`[data-catalog-card="${id}"]`), 'skills-only');
    await expect(s.locator('[data-plugins-add-argv]')).toHaveCount(1);
    await cancel(s);
  });
});

test('projects: installed at project scope in A reads Installed there and Installed in another project in B; Not installed', async () => {
  maws = await launchMaws({ realEngine: { projects: 2 } });
  const { page } = maws;
  const [a] = maws.realEngine!.scratch.projects;
  for (const directory of maws.realEngine!.scratch.projects) value(await invoke(page, 'session.projects.add', { directory }));
  await openDiscover(page);
  const card = () => byName(results(page), 'remote-server');

  await test.step('in A: + at project scope adds the marketplace and installs there', async () => {
    await chooseProject(page, 'project-a');
    await searchAfresh(page, 'remote-server');
    const s = await sheetFor(page, card(), 'remote-server');
    await s.getByRole('radio', { name: 'Project' }).check();
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Adds the marketplace ${TEST_MARKETPLACE} (project) and installs remote-server`);
    await s.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(s).toBeHidden();
    await expect(card()).toHaveAttribute('data-installed', 'here', { timeout: 2 * CLI_MS });
    expect(JSON.parse(readFileSync(join(a, '.claude', 'settings.json'), 'utf8')).enabledPlugins?.[`remote-server@${TEST_MARKETPLACE}`]).toBe(true);
  });

  await test.step('Not installed leaves it out in A', async () => {
    await pane(page).getByRole('checkbox', { name: 'Not installed' }).check();
    await expect(card()).toHaveCount(0);
    await pane(page).getByRole('checkbox', { name: 'Not installed' }).uncheck();
    await expect(card()).toHaveCount(1);
  });

  await test.step('in B: Installed in another project, + kept', async () => {
    await chooseProject(page, 'project-b');
    await searchAfresh(page, 'remote-server');
    await expect(card()).toHaveAttribute('data-installed', 'elsewhere', { timeout: CLI_MS });
    await expect(card()).toContainText('Installed in another project');
    await expect(card().getByRole('button', { name: 'Add remote-server', exact: true })).toBeEnabled();
  });
});

test('offline: without the directory and plugin-details, the manifests’ items stay, plainer, and the Sources popover says so', async () => {
  maws = await launchMaws({ realEngine: { projects: 1, omitSources: ['directory:plugins', 'directory:servers', 'plugin-details'] } });
  const { page } = maws;
  await openDiscover(page);
  await expect(pane(page).locator('[data-shelf="seed:claude-for-legal"]')).toBeVisible();
  await expect(pane(page).locator('[data-featured]')).toHaveCount(0); // Featured needs a count
  await search(page, 'legal');
  const legal = byName(results(page), 'commercial-legal');
  await expect(legal.locator('[data-trust]')).toHaveAttribute('data-trust', 'Listed by Anthropic'); // no review tier without the directory
  await expect(legal.locator('[data-catalog-icon]')).toHaveAttribute('data-catalog-icon', 'monogram');
  await expect(results(page).locator('[data-catalog-metric]')).toHaveCount(0);
  await library(page).getByRole('button', { name: 'Sources' }).click();
  const popover = page.locator('[data-catalog-sources]');
  await expect(popover.locator('[data-source="directory:plugins"]')).toHaveAttribute('data-source-state', 'unavailable');
  await expect(popover.locator('[data-source="directory:plugins"]')).toContainText('Anthropic’s directory: plugins unavailable');
  await expect(popover.locator('[data-source="plugin-details"]')).toHaveAttribute('data-source-state', 'unavailable');
  await expect(popover.locator('[data-source="seed:claude-for-legal"]')).not.toHaveAttribute('data-source-state', 'unavailable');
});
