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
//   install:   the sheets' warnings; the test marketplace added by path from the Add menu while Discover shows makes
//              its routes present without reopening the page, and removing it from Manage marketplaces brings the add
//              step back; + before the marketplace is added: the add step, the contents and the hook that runs code; the
//              real CLI adds and installs; settings, the engine's own listing, My items; Skills names the plugin and its
//              skills; a second marketplace nobody else lists, added while Discover shows, brings its plugins from the
//              host's read (acceptance 3, 5, 7).
//   projects:  installed at project scope in A reads Installed there and "Installed in another project" in B, where
//              Not installed keeps it and + installs it at B's project scope (acceptance 4).
//   offline:   without the directory's and plugin-details' recordings, the manifests' items stay, plainer, with no
//              counts and no Featured, and the Sources popover says which sources are unavailable; Connectors' Discover
//              says the directory is unavailable, with Retry (acceptance 11; the Connectors side is M4's).
//   agents:    a session started after Discover was browsed on its three kinds is given the same tools, and sends the
//              model the same tool list, as one started before; nothing of the catalog reaches the model. Each session
//              runs one turn against a loopback stand-in for the relay (support/model-stub.ts): no spend (acceptance
//              12's e2e half, M5; its unit half is src/main/catalog/agents.test.ts).
//   all:       the UX wave's U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, C4, C6, C8, C11): with
//              two plugins, three skills and two connectors in the scratch configuration, My items, All lists the
//              plugins, the mods, the skills and the connectors, each part by name, each row with its image and its kind's
//              word in one column; a plugin's menu and a connector's Remove work from it; Discover, All is Featured and a
//              shelf per kind, a shelf's See all chooses its kind, and a search is one grid of plugins and connectors
//              whose + opens each kind's sheet; the head at 1512, 900, 620 and 400 px, its four Show choices on one line.
//   skills:    the UX wave's U11 skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md): a skill's
//              detail offers "Open in" with the editors this Mac has and Finder, no terminal; a row hands main the skill's
//              real file, which main's own inventory read admits (the open log's `open-in` line), a plugin's skill says
//              its updates replace the file, a path no inventory lists opens nothing, a removed file reads its refusal
//              under the head; "New skill…" opens a chat whose composer holds the first message, sent by nobody.
// UX wave U11c: Customize's head chooses the view (My items | Discover) and the kind (Show); a scene reaches Discover's
// Plugins, Skills or Connectors by the two (support/customize.ts), and the page opened by the sidebar lands on My items, All.
// The detail, the install sheet and the add-then-install sheet are attached as screenshots beside the home's (M5, for
// the owner's references), each sheet as it opens: its commands and files behind a closed Details (the owner's ruling,
// 2026-10-25).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { invoke, value } from './support/c7-replay';
import { chooseCustomize, customizeHead, customizePage, showChoice, viewChoice } from './support/customize';
import { firstRead } from './support/discover-read';
import { TEST_MARKETPLACE } from './support/discover-scratch';
import { launchMaws, type MawsLaunch } from './support/launch';
import { startModelStub, type ModelRequest } from './support/model-stub';
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

// UX wave U7b (O-40): Customize is a page beside the sidebar, not a main tab. UX wave U11c: Discover's Plugins, reached by
// the head's view and Show; the head's tools (the Add menu, Sources) are found in the page.
const pane = (page: Page) => page.locator('[data-discover="plugins"]');
// the last grid of the pane: All on the home, else the narrowed results
const results = (page: Page, root = pane(page)) => root.locator('[data-catalog-results]').last();
const resultCards = (page: Page) => results(page).locator('[data-catalog-grid] [data-catalog-card]');
const byName = (scope: Locator, installName: string) => scope.locator(`[data-catalog-card][data-install-name="${installName}"]`);
const sheet = (page: Page) => page.locator('[data-plugins-sheet="install"]');

// Discover on a kind, once its catalog is shown: a cwd's first read runs the engine's CLI (support/discover-read.ts).
async function openDiscover(page: Page, tab: 'Plugins' | 'Skills' = 'Plugins'): Promise<void> {
  const read = await firstRead(page);
  await openAppDestination(page, 'Customize');
  await chooseCustomize(page, { view: 'Discover', show: tab });
  const shown = page.locator(`[data-discover="${tab.toLowerCase()}"]`);
  await expect(shown).toBeVisible();
  await read(shown, tab.toLowerCase());
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

// A sheet's Details: the exact commands and the files they write (the owner's ruling, 2026-10-25).
const details = (s: Locator) => s.getByRole('button', { name: 'Details', exact: true });
async function openDetails(s: Locator): Promise<void> {
  if ((await details(s).getAttribute('aria-expanded')) === 'false') await details(s).click();
  await expect(details(s)).toHaveAttribute('aria-expanded', 'true');
  await expect(s.locator('[data-plugins-argv]')).toBeVisible();
}

// The sheet once plugins.env answered: its commands and files behind Details, which every opening shows closed.
async function sheetFor(page: Page, card: Locator, name: string): Promise<Locator> {
  await card.getByRole('button', { name: `Add ${name}`, exact: true }).click();
  await expect(details(sheet(page))).toBeVisible({ timeout: 30_000 });
  await expect(details(sheet(page))).toHaveAttribute('aria-expanded', 'false');
  await expect(sheet(page).locator('[data-plugins-argv]')).toHaveCount(0);
  return sheet(page);
}

async function cancel(s: Locator): Promise<void> {
  await s.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(s).toBeHidden();
}

async function argvOf(s: Locator, attribute: 'data-plugins-argv' | 'data-plugins-add-argv'): Promise<string[]> {
  await openDetails(s);
  return JSON.parse((await s.locator(`[${attribute}]`).getAttribute(attribute))!) as string[];
}
// The add step's command, behind Details: there while the engine lacks the marketplace, absent once it has it.
async function expectAddSteps(s: Locator, count: 0 | 1): Promise<void> {
  await openDetails(s);
  await expect(s.locator('[data-plugins-add-argv]')).toHaveCount(count);
}

// Every item of a tab, paged through catalog.query as Discover's All is.
async function allItems(page: Page, input: { tab: 'plugins' | 'skills' | 'connectors'; cwd: string | null }) {
  const items: Awaited<ReturnType<typeof queryPage>>['items'] = [];
  let cursor: string | null = null;
  do {
    const page_: Awaited<ReturnType<typeof queryPage>> = await queryPage(page, { ...input, cursor, limit: 200 });
    items.push(...page_.items);
    cursor = page_.nextCursor;
  } while (cursor !== null);
  return items;
}
const queryPage = async (page: Page, input: { tab: 'plugins' | 'skills' | 'connectors'; cwd: string | null; cursor: string | null; limit: number }) => value(await invoke(page, 'catalog.query', input));

// A shelf's order (Design, The home): installs descending, then updated descending, then name, ties by id; a missing
// count or date after every present one.
type Ordered = { id: string; name: string; installs: number | null; updatedAt: string | null };
function compareShelfOrder(a: Ordered, b: Ordered): number {
  const keys = (i: Ordered) => [i.installs === null ? Infinity : -i.installs, i.updatedAt === null ? Infinity : -Date.parse(i.updatedAt), i.name.toLowerCase(), i.id] as const;
  const [x, y] = [keys(a), keys(b)];
  for (let k = 0; k < x.length; k += 1) if (x[k] !== y[k]) return x[k]! < y[k]! ? -1 : 1;
  return 0;
}

// The Add menu's marketplace dialogs (Add marketplace, Manage marketplaces), as the person uses them.
async function addMarketplace(page: Page, source: string, name: string): Promise<void> {
  await customizePage(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add marketplace', exact: true }).click();
  const dialog = page.locator('[data-marketplaces-dialog="add"]');
  await dialog.getByRole('textbox', { name: 'Source' }).fill(source);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const add = page.locator('[data-plugins-sheet="marketplace-add"]');
  await expect(details(add)).toBeVisible({ timeout: 30_000 });
  await openDetails(add);
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.locator('[data-marketplace-add-line]')).toContainText(`Successfully added marketplace: ${name}`, { timeout: CLI_MS });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}
async function removeMarketplace(page: Page, name: string): Promise<void> {
  await customizePage(page).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Manage marketplaces', exact: true }).click();
  const manage = page.locator('[data-marketplaces-dialog="manage"]');
  await manage.locator(`[data-marketplace-row="${name}"]`).getByRole('button', { name: /^More actions for / }).click();
  await page.getByRole('menuitem', { name: 'Remove…', exact: true }).click();
  const remove = page.locator('[data-plugins-sheet="marketplace-remove"]');
  await expect(details(remove)).toBeVisible({ timeout: 30_000 });
  await openDetails(remove);
  const acknowledge = remove.getByRole('checkbox', { name: 'I understand' });
  if ((await acknowledge.count()) > 0) await acknowledge.check();
  await remove.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(manage.locator(`[data-marketplace-result="${name}"]`)).toContainText(`Successfully removed marketplace: ${name}`, { timeout: CLI_MS });
  await expect(manage.locator(`[data-marketplace-row="${name}"]`)).toHaveCount(0);
  await manage.getByRole('button', { name: 'Done' }).click();
  await expect(manage).toBeHidden();
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function contentSize(launch: MawsLaunch, width: number, height: number): Promise<void> {
  await launch.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const);
  await expect.poll(() => launch.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height]);
}

async function chooseProject(page: Page, name: string): Promise<void> {
  const read = await firstRead(page); // the project's catalog: its own first read
  const select = page.getByRole('combobox', { name: 'Project', exact: true });
  await select.selectOption((await select.locator('option', { hasText: name }).getAttribute('value'))!);
  await chooseCustomize(page, { view: 'Discover', show: 'Plugins' }); // the page is the project's now
  await expect(pane(page)).toBeVisible();
  await read(pane(page), `plugins in ${name}`);
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
    await expect(featured.locator('[data-item-image]')).toHaveAttribute('data-item-image', 'icon');
    await expect(featured.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    // the most installed of every item with a count (plugin-details counts official plugins alone) not installed here
    const counted = await allItems(page, { tab: 'plugins', cwd: null });
    const most = Math.max(...counted.filter((i) => i.installs !== null && i.installed !== 'here').map((i) => i.installs!));
    expect(home.featured!.installs).toBe(most);
  });

  await test.step('the shelves in the catalog’s order: Your sources first, the seeds, at most four categories; one row each', async () => {
    const shelves = pane(page).locator('[data-shelf]');
    await expect.poll(() => shelves.evaluateAll((all) => all.map((s) => s.getAttribute('data-shelf')))).toEqual(home.shelves.map((s) => s.key));
    expect(home.shelves[0]).toMatchObject({ key: 'added', title: 'Your sources', total: 4 });
    // one shelf per seed with more than one item, in the seed list's order, community never: the recordings list 12
    // official, 5 skills, 19 financial-services, 6 knowledge-work, 13 legal, 2 life-sciences and 3 Carta entries, one each
    // for k12, the advisors, Notion and Canva (none of those four gets a shelf), and 4 community entries (no shelf)
    expect(home.shelves.filter((s) => s.kind === 'source').map((s) => s.key)).toEqual(['seed:claude-plugins-official', 'seed:anthropic-agent-skills', 'seed:claude-for-financial-services', 'seed:knowledge-work-plugins', 'seed:claude-for-legal', 'seed:life-sciences', 'seed:carta-plugins']);
    const categories = home.shelves.filter((s) => s.kind === 'category').length;
    expect(home.shelves.map((s) => s.kind)).toEqual(['added', ...Array<string>(7).fill('source'), ...Array<string>(categories).fill('category')]); // Your sources, the seeds, then the categories
    expect(home.shelves.filter((s) => s.kind === 'category').length).toBeLessThanOrEqual(4);
    for (const shelf of home.shelves) {
      const drawn = await pane(page).locator(`[data-shelf="${shelf.key}"] [data-catalog-card]`).evaluateAll((cards) => cards.map((c) => c.getAttribute('data-catalog-card')));
      expect(drawn.length, shelf.key).toBeGreaterThan(0);
      expect(drawn, shelf.key).toEqual(shelf.items.slice(0, drawn.length).map((i) => i.id));
      // installs descending, then updated descending, then name (a missing count or date last), ties by id
      for (let i = 1; i < shelf.items.length; i += 1) expect(compareShelfOrder(shelf.items[i - 1]!, shelf.items[i]!), `${shelf.key}: ${shelf.items[i - 1]!.id} before ${shelf.items[i]!.id}`).toBeLessThan(0);
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
    // the recordings' 72 plugins after joining (the engine's directory off, so none of its routes) and the test
    // marketplace's four
    expect(home.total).toBe(76);
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
  await contentSize(maws, 1280, 820);
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
    await shot(page, test.info(), 'discover-detail-1280x820.png');
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
  await contentSize(maws, 1280, 820);
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

  await test.step('the test marketplace added by path from the Add menu while Discover shows: its routes present without reopening the page; removed from Manage marketplaces: the add step again', async () => {
    const id = `local:${marketplace}#plugins/skills-only`;
    const present = async () => (value(await invoke(page, 'catalog.item', { id, cwd: null })).install as { present?: boolean }).present;
    const card = () => results(page).locator(`[data-catalog-card="${id}"]`);
    await searchAfresh(page, 'skills-only');
    let s = await sheetFor(page, card(), 'skills-only');
    await expectAddSteps(s, 1);
    await cancel(s);
    await addMarketplace(page, marketplace, TEST_MARKETPLACE);
    await expect.poll(present, { timeout: CLI_MS }).toBe(true);
    await searchAfresh(page, 'skills-only'); // the same page: Discover was never left
    s = await sheetFor(page, card(), 'skills-only');
    await expectAddSteps(s, 0);
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Installs skills-only from ${TEST_MARKETPLACE}`);
    await expect(s.locator('[data-catalog-contents]')).toHaveText('Comes with: 2 skills');
    await cancel(s);
    await removeMarketplace(page, TEST_MARKETPLACE);
    await expect.poll(present, { timeout: CLI_MS }).toBe(false);
    await searchAfresh(page, 'skills-only');
    s = await sheetFor(page, card(), 'skills-only');
    await expectAddSteps(s, 1);
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Adds the marketplace ${TEST_MARKETPLACE} (user) and installs skills-only`);
    await cancel(s);
  });

  await test.step('+ on hooked before its marketplace is added: the add step, its contents, the hook that runs code; installed', async () => {
    await searchAfresh(page, 'hooked');
    const s = await sheetFor(page, byName(results(page), 'hooked'), 'hooked');
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Adds the marketplace ${TEST_MARKETPLACE} (user) and installs hooked`);
    await expect(s.locator('[data-catalog-contents]')).toHaveText('Comes with: hooks');
    await expect(s.locator('[data-runs-code]')).toHaveText('Includes components that run code on your computer: hooks.');
    await expect(s.getByRole('radio', { name: 'User' })).toBeChecked();
    await shot(page, test.info(), 'discover-add-then-install-sheet-1280x820.png'); // as it opens: Details closed
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
    await openCard(page, byName(results(page), 'hooked')); // installed here: it opens in My items, on Plugins
    await expect(viewChoice(page, 'My items')).toHaveAttribute('data-state', 'on');
    await expect(showChoice(page, 'Plugins')).toHaveAttribute('data-state', 'on');
    await expect(customizePage(page).locator(`[data-plugin-detail="hooked@${TEST_MARKETPLACE}"], [data-plugin-row="hooked@${TEST_MARKETPLACE}"]`).first()).toBeVisible({ timeout: CLI_MS });
    await chooseCustomize(page, { view: 'Discover' }); // Show kept: Plugins
    await expect(pane(page)).toBeVisible();
  });

  await test.step('the marketplace now present: local-server installs in one step', async () => {
    await searchAfresh(page, 'local-server');
    const s = await sheetFor(page, byName(results(page), 'local-server'), 'local-server');
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Installs local-server from ${TEST_MARKETPLACE}`);
    await expect(s.locator('[data-runs-code]')).toContainText('a local MCP server');
    await shot(page, test.info(), 'discover-install-sheet-1280x820.png'); // as it opens: Details closed
    await expectAddSteps(s, 0);
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
    await chooseCustomize(page, { show: 'Plugins' }); // the view kept: Discover
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
    await addMarketplace(page, second, 'maws-second-test');
    await expect(byName(results(page), 'local-server')).toHaveCount(2, { timeout: CLI_MS }); // without reopening the page
    const theirs = results(page).locator(`[data-catalog-card^="local:${second}"][data-install-name="local-server"]`);
    await expect(theirs).toContainText('by MAWS e2e servers');
    await expect(theirs.locator('[data-trust]')).toHaveAttribute('data-trust', 'Added by you');
    const s = await sheetFor(page, theirs, 'local-server');
    await expectAddSteps(s, 0); // the engine has it now
    await expect(s.locator('[data-runs-code]')).toContainText('a local MCP server');
    await cancel(s);
    await searchAfresh(page, 'skills-only'); // its skills, from the same read
    const skills = results(page).locator(`[data-catalog-card^="local:${second}"][data-install-name="skills-only"]`);
    await expect(skills.locator('[data-catalog-components]')).toHaveText('2 skills');
    await expect(skills).toContainText('by MAWS e2e skills');
  });
});

test('projects: installed at project scope in A reads Installed there and Installed in another project in B; Not installed', async () => {
  maws = await launchMaws({ realEngine: { projects: 2 } });
  const { page } = maws;
  const [a, b] = maws.realEngine!.scratch.projects;
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

  await test.step('in B: Installed in another project, + kept; Not installed shows it; installed from B at project scope', async () => {
    await chooseProject(page, 'project-b');
    await searchAfresh(page, 'remote-server');
    await expect(card()).toHaveAttribute('data-installed', 'elsewhere', { timeout: CLI_MS });
    await expect(card()).toContainText('Installed in another project');
    // + still works: B's own install. The marketplace A added at project scope is in the engine's own registry
    // (plugins/known_marketplaces.json, one per configuration), which `plugin marketplace list` reads in B too, so the
    // engine has it there and the sheet is the install alone (measured on 2.1.309, gate run 40189614848).
    await pane(page).getByRole('checkbox', { name: 'Not installed' }).check(); // not installed here, so B's Not installed keeps it
    await expect(card()).toHaveCount(1);
    await expect(card()).toHaveAttribute('data-installed', 'elsewhere');
    const s = await sheetFor(page, card(), 'remote-server');
    await s.getByRole('radio', { name: 'Project' }).check();
    await expect(s.locator('[data-catalog-summary]')).toHaveText(`Installs remote-server from ${TEST_MARKETPLACE}`);
    expect(await argvOf(s, 'data-plugins-argv')).toEqual(expect.arrayContaining(['plugin', 'install', `remote-server@${TEST_MARKETPLACE}`, '--scope', 'project']));
    await s.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(s).toBeHidden();
    await expect(card()).toHaveCount(0, { timeout: 2 * CLI_MS }); // installed here now: Not installed leaves it out in B too
    await pane(page).getByRole('checkbox', { name: 'Not installed' }).uncheck();
    await expect(card()).toHaveAttribute('data-installed', 'here', { timeout: CLI_MS });
    expect(JSON.parse(readFileSync(join(b, '.claude', 'settings.json'), 'utf8')).enabledPlugins?.[`remote-server@${TEST_MARKETPLACE}`]).toBe(true);
    expect(JSON.parse(readFileSync(join(a, '.claude', 'settings.json'), 'utf8')).enabledPlugins?.[`remote-server@${TEST_MARKETPLACE}`]).toBe(true); // A's own install untouched
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
  await expect(legal.locator('[data-item-image]')).toHaveAttribute('data-item-image', 'tile');
  await expect(results(page).locator('[data-catalog-metric]')).toHaveCount(0);
  await customizePage(page).getByRole('button', { name: 'Sources' }).click();
  const popover = page.locator('[data-catalog-sources]');
  await expect(popover.locator('[data-source="directory:plugins"]')).toHaveAttribute('data-source-state', 'unavailable');
  await expect(popover.locator('[data-source="directory:plugins"]')).toContainText('Anthropic’s directory: plugins unavailable');
  await expect(popover.locator('[data-source="plugin-details"]')).toHaveAttribute('data-source-state', 'unavailable');
  await expect(popover.locator('[data-source="seed:claude-for-legal"]')).not.toHaveAttribute('data-source-state', 'unavailable');
  // P4-AGG M4: the Connectors side of acceptance 11: its Discover says the directory is unavailable, with Retry
  await page.keyboard.press('Escape');
  await chooseCustomize(page, { show: 'Connectors' }); // the view kept: Discover
  const connectors = customizePage(page).locator('[data-customize-body="connectors"]'); // the words stand in the pane's place
  await expect(connectors.locator('[data-connectors-unavailable]')).toContainText('Anthropic’s directory is unavailable.');
  await expect(connectors.locator('[data-connectors-unavailable]').getByRole('button', { name: 'Retry' })).toBeEnabled();
});

// Acceptance 12's e2e half (M5). Two sessions in one project, each with one turn, which the engine sends to the loopback
// stand-in for the relay (MAWS_RELAY_URL; support/model-stub.ts answers "ok", so nothing is spent): the first started
// before Customize is opened, the second after Discover was browsed on all three kinds (a search, a detail, Skills,
// Connectors). Each session's system/init (its tools, MCP servers, skills, plugins, commands, agents) and the tool list of
// its first request to the model are the same; no request the engine made carries anything only the catalog holds.
test('agents: a session started after Discover was browsed is given the same tools as one started before; nothing of the catalog reaches the model', async () => {
  test.setTimeout(480_000);
  const stub = await startModelStub();
  try {
    maws = await launchMaws({ realEngine: { projects: 1 }, env: { MAWS_RELAY_URL: stub.url } });
    const { page } = maws;
    const [directory] = maws.realEngine!.scratch.projects;
    const project = value(await invoke(page, 'session.projects.add', { directory }));

    type Frame = { type?: string; subtype?: string; [key: string]: unknown };
    const turn = async (label: string): Promise<{ request: ModelRequest; init: Frame }> => {
      const created = value(await invoke(page, 'session.create', { projectId: project.id, location: { kind: 'directory', path: directory } }));
      const id = created.appSessionId;
      const message = { content: 'Answer with the word ok.', display: 'Answer with the word ok.' };
      const asked = stub.main().length;
      let start = value(await invoke(page, 'session.start', { appSessionId: id, message, options: { gateway: 'gateway' } }));
      if (start.status === 'needs_trust') start = value(await invoke(page, 'session.start', { appSessionId: id, message, options: { gateway: 'gateway', trust: 'accepted' } }));
      expect(start, `${label}: the session starts with its message`).toMatchObject({ status: 'starting' });
      await expect.poll(() => stub.main().length, { timeout: 120_000, message: `${label}: the engine asks the model` }).toBeGreaterThan(asked);
      const status = async () => value(await invoke(page, 'engine.sessions', undefined)).find((s) => s.appSessionId === id);
      await expect.poll(async () => { const s = await status(); return s?.process === 'ready' && s.turn === null; }, { timeout: 90_000, message: `${label}: the turn ends` }).toBe(true);
      const rows = readFileSync((await status())!.journalPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { direction: string; frame: Frame });
      const init = rows.map((r) => r.frame).find((f) => f.type === 'system' && f.subtype === 'init');
      expect(init, `${label}: the engine's system/init`).toBeDefined();
      value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' }));
      await expect.poll(async () => (await status())?.process ?? 'exited', { timeout: 60_000 }).toBe('exited');
      return { request: stub.main()[asked]!, init: init! };
    };

    const before = await turn('before Discover');

    await test.step('Discover browsed on its three kinds, nothing installed', async () => {
      await openDiscover(page);
      await search(page, 'legal');
      await expect(results(page).getByRole('heading', { name: '13 results' })).toBeVisible();
      await searchAfresh(page, '42crunch');
      await openCard(page, byName(results(page), '42crunch-api-security-testing'));
      await expect(pane(page).locator('[data-catalog-detail]')).toBeVisible();
      await pane(page).getByRole('button', { name: 'Back to Discover' }).click();
      await openDiscover(page, 'Skills');
      await chooseCustomize(page, { show: 'Connectors' }); // the view kept: Discover
      await expect(page.locator('[data-discover="connectors"] [data-catalog-card]').first()).toBeVisible();
    });

    const after = await turn('after Discover');

    await test.step('the same tools, given and sent; the catalog in no request', async () => {
      const surface = (init: Frame) => ({
        tools: init.tools,
        mcpServers: ((init.mcp_servers as { name: string }[] | undefined) ?? []).map((s) => s.name).sort(),
        skills: init.skills,
        plugins: init.plugins,
        slashCommands: init.slash_commands,
        agents: init.agents,
      });
      expect(surface(after.init)).toEqual(surface(before.init));
      expect((before.init.tools as string[]).length).toBeGreaterThan(0);
      const sent = (request: ModelRequest) => (request.body.tools as { name: string }[]).map((tool) => tool.name);
      expect(sent(after.request)).toEqual(sent(before.request));
      const definitions = (request: ModelRequest) => (request.body.tools as unknown[]).map((tool) => JSON.stringify(tool));
      expect(definitions(after.request)).toEqual(definitions(before.request));
      await test.info().attach('agents-tools.json', { body: JSON.stringify({ init: surface(after.init), sent: sent(after.request), requests: stub.requests.length }, null, 2), contentType: 'application/json' });
      // strings only the catalog holds: a recorded directory item, a partner's plugin, the test marketplace
      for (const request of stub.requests) for (const marker of ['42crunch', 'cocounsel', TEST_MARKETPLACE]) expect(request.raw, marker).not.toContain(marker);
      for (const init of [before.init, after.init]) expect(JSON.stringify(init)).not.toMatch(/42crunch|cocounsel|maws-discover-test/);
    });
  } finally {
    await maws?.cleanup(); // the app and its engines first, then the stand-in they talked to
    maws = null;
    await stub.close();
  }
});

// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, M5's new case): My items, All (C4, C6), a
// plugin's menu and a connector's Remove from it, Discover, All (C8) and the head at four widths (C11). The scratch
// configuration is the engine's own CLI's: two plugins of the test marketplace at user scope (one brings two skills), one
// skill of the person's own and two connectors, all invented; the page is the user configuration's.
test('all: My items lists the three kinds in one list; Discover’s home has a shelf per kind; a search mixes them', async () => {
  test.setTimeout(480_000);
  const info = test.info();
  maws = await launchMaws({ realEngine: { projects: 1 } });
  const { page, app, userData } = maws;
  const { configDir, marketplace } = maws.realEngine!.scratch;
  const PLUGINS = [`hooked@${TEST_MARKETPLACE}`, `skills-only@${TEST_MARKETPLACE}`]; // by the name their rows show
  const SKILLS = ['greet', 'outline-notes', 'summarize-diff']; // skills-only's two and the person's own, by label
  const CONNECTORS = ['notes-probe', 'tasks-probe'];
  const all = customizePage(page).locator('[data-customize-all]');
  const discover = page.locator('[data-discover="all"]');
  const marks = (scope: Locator, attribute: string) => scope.locator(`[${attribute}]`).evaluateAll((nodes, name) => nodes.map((node) => node.getAttribute(name)), attribute);
  const storedDestination = () => {
    try {
      return (JSON.parse(readFileSync(join(userData, 'layout.json'), 'utf8')) as { destination?: { destination?: unknown } }).destination?.destination ?? null;
    } catch {
      return null; // not written yet
    }
  };

  await test.step('the scratch configuration: two plugins installed and two connectors added by the engine’s own CLI, one skill on disk', async () => {
    engineCli(maws!, ['plugin', 'marketplace', 'add', marketplace]);
    for (const id of PLUGINS) engineCli(maws!, ['plugin', 'install', id, '--scope', 'user']);
    engineCli(maws!, ['mcp', 'add', '--transport', 'http', 'notes-probe', 'https://notes.example.test/mcp', '--scope', 'user']);
    engineCli(maws!, ['mcp', 'add-json', 'tasks-probe', JSON.stringify({ type: 'stdio', command: '/usr/bin/true', args: [] }), '--scope', 'user']);
    mkdirSync(join(configDir, 'skills', 'outline-notes'), { recursive: true });
    writeFileSync(join(configDir, 'skills', 'outline-notes', 'SKILL.md'), '---\nname: outline-notes\ndescription: Outlines a page of notes as headings. A fixture skill of the Discover e2e group.\n---\nReply with an outline.\n');
  });

  await test.step('the sidebar opens My items, All: the plugins, the mods, the skills, the connectors, each part by name, each row with its image and its kind’s word in one column', async () => {
    await openAppDestination(page, 'Customize');
    await expect(customizePage(page)).toHaveAttribute('data-customize-view', 'mine');
    await expect(customizePage(page)).toHaveAttribute('data-customize-show', 'all');
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'User configuration' });
    await expect(all.locator('[data-plugin-row]')).toHaveCount(PLUGINS.length, { timeout: CLI_MS }); // the plugin list is the engine's CLI's
    await expect(all.locator('[data-skill-row]')).toHaveCount(SKILLS.length);
    await expect(all.locator('[data-connector]')).toHaveCount(CONNECTORS.length);
    const mods = value(await invoke(page, 'mods.list', {})).length; // MAWS's built-in mods, beside at least one item
    await expect(all.locator('[data-mod-row]')).toHaveCount(mods);
    expect(await marks(all, 'data-plugin-row')).toEqual(PLUGINS);
    expect(await marks(all, 'data-skill-row')).toEqual(SKILLS);
    expect(await marks(all, 'data-connector')).toEqual(CONNECTORS);
    // no heading between the parts: one run of each kind's word, in the parts' order
    expect(await marks(all, 'data-kind-word')).toEqual([...Array<string>(PLUGINS.length).fill('plugin'), ...Array<string>(mods).fill('mod'), ...Array<string>(SKILLS.length).fill('skill'), ...Array<string>(CONNECTORS.length).fill('connector')]);
    await expect(all.locator('[data-plugin-row] [data-kind-word]')).toHaveText(PLUGINS.map(() => 'Plugin'));
    await expect(all.locator('[data-skill-row] [data-kind-word]')).toHaveText(SKILLS.map(() => 'Skill'));
    await expect(all.locator('[data-connector] [data-kind-word]')).toHaveText(CONNECTORS.map(() => 'Connector'));
    if (mods > 0) await expect(all.locator('[data-mod-row] [data-kind-word]').first()).toHaveText('Mod');
    const columns = await all.locator('[data-kind-word]').evaluateAll((words) => words.map((word) => Math.round(word.getBoundingClientRect().left)));
    expect(new Set(columns).size, `the kind words' left edges: ${columns.join(', ')}`).toBe(1);
    const rows = all.locator('li:has([data-kind-word])');
    expect(await rows.count()).toBe(PLUGINS.length + mods + SKILLS.length + CONNECTORS.length);
    expect(await rows.evaluateAll((items) => items.filter((item) => item.querySelector('[data-item-image]') === null).length), 'every row has its image').toBe(0);
  });

  await test.step('a plugin’s menu from All: Turn off runs through the real CLI, and the row reads Disabled in its place', async () => {
    const hooked = all.locator(`[data-plugin-row="${PLUGINS[0]!}"]`);
    await hooked.getByRole('button', { name: /^More actions for / }).click();
    await page.getByRole('menuitem', { name: 'Turn off', exact: true }).click();
    const s = page.locator('[data-plugins-sheet="disable"]');
    const disable = s.getByRole('button', { name: 'Disable', exact: true });
    await expect(disable).toBeEnabled({ timeout: 30_000 }); // once plugins.env answered
    await disable.click();
    await expect(s).toBeHidden();
    await expect(hooked.getByText('Disabled', { exact: true })).toBeVisible({ timeout: CLI_MS });
    expect(await marks(all, 'data-plugin-row')).toEqual(PLUGINS);
    const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean> };
    expect(settings.enabledPlugins?.[PLUGINS[0]!]).toBe(false);
  });

  await test.step('a connector’s Remove from All: the sheet at user scope, the real CLI, the row gone and its line at the head of the connectors', async () => {
    const notes = all.locator('[data-connector="notes-probe"]');
    await notes.getByRole('button', { name: 'Remove notes-probe', exact: true }).click();
    const s = page.locator('[data-plugins-sheet="mcp-remove"]');
    await expect(s.locator('[data-plugins-scope]')).toHaveText('Scope: User');
    await expect(details(s)).toBeVisible({ timeout: 30_000 }); // once plugins.env answered
    expect(await argvOf(s, 'data-plugins-argv')).toEqual(['mcp', 'remove', 'notes-probe', '--scope', 'user']);
    await s.getByRole('checkbox').check();
    await s.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(notes).toHaveCount(0, { timeout: CLI_MS });
    await expect(all.locator('[data-all-part="connectors"] [data-connector-gone]')).toContainText('notes-probe');
    expect(await marks(all, 'data-connector')).toEqual(['tasks-probe']);
    const servers = (JSON.parse(readFileSync(join(configDir, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
    expect(Object.keys(servers).sort()).toEqual(['tasks-probe']);
  });

  await test.step('Discover, All: Featured and a shelf per kind, Plugins, Skills, Connectors, each with See all; no Category, no Sort by', async () => {
    const read = await firstRead(page);
    await chooseCustomize(page, { view: 'Discover' }); // Show kept: All
    await expect(discover).toBeVisible();
    await read(discover, 'all');
    const home = value(await invoke(page, 'catalog.home', { tab: 'all', cwd: null }));
    expect(home.shelves.map((shelf) => [shelf.key, shelf.title])).toEqual([['kind:plugins', 'Plugins'], ['kind:skills', 'Skills'], ['kind:connectors', 'Connectors']]);
    for (const shelf of home.shelves) expect(shelf.total, shelf.key).toBeGreaterThan(0);
    await expect.poll(() => marks(discover, 'data-shelf')).toEqual(home.shelves.map((shelf) => shelf.key));
    for (const title of ['Plugins', 'Skills', 'Connectors']) await expect(discover.getByRole('button', { name: `See all of ${title}`, exact: true })).toBeVisible();
    for (const kind of ['plugins', 'connectors']) await expect(discover.locator(`[data-shelf="kind:${kind}"] [data-catalog-card]`).first()).toBeVisible();
    await expect(discover.locator('[data-featured]')).toHaveAttribute('data-featured', home.featured!.id);
    await expect(customizePage(page).getByRole('button', { name: 'Category', exact: true })).toHaveCount(0);
    await expect(customizePage(page).getByRole('button', { name: 'Sort by', exact: true })).toHaveCount(0);
  });

  await test.step('a shelf’s See all chooses its kind in Show, stored; All again is its home', async () => {
    await discover.getByRole('button', { name: 'See all of Connectors', exact: true }).click();
    await expect(customizePage(page)).toHaveAttribute('data-customize-view', 'discover');
    await expect(customizePage(page)).toHaveAttribute('data-customize-show', 'connectors');
    await expect(showChoice(page, 'Connectors')).toHaveAttribute('data-state', 'on');
    await expect(page.locator('[data-discover="connectors"]')).toBeVisible();
    await expect.poll(storedDestination, { message: 'the page is stored where See all put it', timeout: 15_000 }).toMatchObject({ kind: 'customize', view: 'discover', show: 'connectors' });
    await chooseCustomize(page, { show: 'All' });
    await expect(discover.locator('[data-discover-home]')).toBeVisible();
  });

  await test.step('a search is one grid across kinds: Canva as a connector and as a plugin, each card with its word; each + opens its kind’s sheet', async () => {
    await search(page, 'Canva');
    const grid = results(page, discover);
    const cards = grid.locator('[data-catalog-grid] [data-catalog-card]');
    await expect(cards.first()).toBeVisible();
    expect(new Set(await marks(grid.locator('[data-catalog-grid]'), 'data-kind-word'))).toEqual(new Set(['plugin', 'connector']));
    const connector = cards.filter({ has: page.locator('[data-kind-word="connector"]') }).filter({ hasText: 'Canva' }).first();
    await expect(connector.locator('[data-kind-word]')).toHaveText('Connector');
    await connector.getByRole('button', { name: 'Add Canva', exact: true }).click();
    const connectorSheet = page.locator('[data-plugins-sheet="mcp-add"]');
    await expect(connectorSheet).toBeVisible();
    await cancel(connectorSheet);
    const plugin = cards.filter({ has: page.locator('[data-kind-word="plugin"]') }).filter({ has: page.getByRole('button', { name: /^Add / }) }).first();
    await expect(plugin.locator('[data-kind-word]')).toHaveText('Plugin');
    await plugin.getByRole('button', { name: /^Add / }).click();
    await expect(details(sheet(page))).toBeVisible({ timeout: 30_000 }); // the install sheet, once plugins.env answered
    await cancel(sheet(page));
    await search(page, '');
    await expect(discover.locator('[data-discover-home]')).toBeVisible();
  });

  // The head's edges, measured (the architect's ruling of 2026-11-15 on the tools line)
  const head = customizeHead(page);
  const edges = (node: Locator) => node.evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; });
  const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: ${a} against ${b}`).toBeLessThanOrEqual(1);
  const searchField = () => head.getByRole('searchbox').locator('xpath=ancestor::label[1]');
  const actions = () => head.locator('[data-customize-actions] > *');
  const showRow = () => head.locator('[data-customize-row="show"]');

  await test.step('the head at 1512, 900, 620 and 400 px, in My items and in Discover, All: the four Show choices on one line; the tools line’s edges at 620 and 400 px', async () => {
    for (const [width, height] of [[1512, 982], [900, 820], [620, 820], [400, 820]] as const) {
      await app.evaluate(({ BrowserWindow }, [w, h]) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        win.setMinimumSize(Math.min(w, 600), 600); // the window's own minimum is 600 px wide
        win.setContentSize(w, h);
      }, [width, height] as const);
      await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height]);
      for (const view of ['My items', 'Discover'] as const) {
        await chooseCustomize(page, { view, show: 'All' });
        await expect(view === 'My items' ? all : discover).toBeVisible();
        const tops = await customizeHead(page).getByRole('radiogroup', { name: 'Show', exact: true }).getByRole('radio').evaluateAll((choices) => choices.map((choice) => Math.round(choice.getBoundingClientRect().top)));
        expect(tops, `the Show choices at ${width} px, ${view}`).toHaveLength(4);
        expect(new Set(tops).size, `the Show choices on one line at ${width} px, ${view}: ${tops.join(', ')}`).toBe(1);
        const at = `${width} px, ${view}`;
        const row = await edges(showRow());
        const search = await edges(searchField());
        if (width === 620) {
          // a line of their own: the search from the row's left, grown, the last action at the row's right
          near(search.left, row.left, `${at}: the search's left edge`);
          near((await edges(actions().last())).right, row.right, `${at}: the last action's right edge`);
        }
        if (width === 400) {
          // the search takes the line; actions that no longer fit beside it start the next one from the left
          near(search.left, row.left, `${at}: the search's left edge`);
          near(search.right, row.right, `${at}: the search's right edge`);
          const first = await edges(actions().first());
          if (first.top >= search.bottom) near(first.left, row.left, `${at}: the first action's left edge, wrapped`);
        }
        await info.attach(`customize-head-${view === 'My items' ? 'mine' : 'discover'}-all-${width}x${height}.png`, { body: await customizeHead(page).screenshot(), contentType: 'image/png' });
      }
    }
  });

  // The stacked head a person can reach. Under 700 px the sidebar is an overlay and takes no column (`sidebarAside`,
  // src/renderer/src/app/shell-geometry.ts:15-16), so there the page is the whole window, never under the window's 600 px
  // minimum; a docked sidebar is clamped to 200..480 px (SIDEBAR_BOUNDS, src/renderer/src/app/regions.ts). The page is under
  // the `customize` container's 24rem only beside a widened docked sidebar: here the window at 700 px and the sidebar at
  // 480, the page about 220 px.
  await test.step('700 px with the sidebar docked at 480 px: the page under 24rem; the switch, Showing, the Show choices, then the search at full width', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setMinimumSize(600, 600);
      win.setContentSize(700, 820);
    });
    await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([700, 820]);
    const resizer = page.locator('[data-region="sidebar"]').getByRole('separator', { name: 'Resize sidebar' });
    await resizer.focus();
    await page.keyboard.press('End'); // the sidebar's widest
    await expect(resizer).toHaveAttribute('aria-valuenow', '480');
    await chooseCustomize(page, { view: 'My items', show: 'All' });
    await expect(all).toBeVisible();
    const [containerWidth, rem] = await customizePage(page).evaluate((el) => [el.getBoundingClientRect().width, parseFloat(getComputedStyle(document.documentElement).fontSize)]);
    expect(containerWidth, `the customize container, ${containerWidth} px`).toBeLessThan(24 * rem!);
    const viewRow = await edges(head.locator('[data-customize-row="view"]'));
    const row = await edges(showRow());
    const showing = await edges(head.getByRole('combobox', { name: 'Project', exact: true }).locator('xpath=ancestor::label[1]'));
    const live = head.getByRole('combobox', { name: 'Live session', exact: true }).locator('xpath=ancestor::label[1]');
    const stacked = [
      ['the switch', await edges(head.getByRole('radiogroup', { name: 'Library', exact: true }))],
      ['Showing', showing],
      ...((await live.count()) > 0 ? [['Live session', await edges(live)] as const] : []),
      ['the Show choices', await edges(head.getByRole('radiogroup', { name: 'Show', exact: true }))],
      ['the search', await edges(searchField())],
    ] as const;
    for (let i = 1; i < stacked.length; i += 1) expect(stacked[i]![1].top, `${stacked[i]![0]} under ${stacked[i - 1]![0]}`).toBeGreaterThanOrEqual(stacked[i - 1]![1].bottom);
    for (const [name, box] of stacked.filter(([part]) => part === 'Showing' || part === 'Live session')) {
      near(box.left, viewRow.left, `${name}'s left edge`);
      near(box.right, viewRow.right, `${name}'s right edge`);
    }
    const search = await edges(searchField());
    near(search.left, row.left, 'the search’s left edge');
    near(search.right, row.right, 'the search’s right edge');
    await info.attach('customize-head-mine-all-700x820-sidebar-480.png', { body: await head.screenshot(), contentType: 'image/png' });
    await info.attach('customize-page-mine-all-700x820-sidebar-480.png', { body: await page.screenshot(), contentType: 'image/png' });
  });
});

test('skills: a skill’s Open in hands its listed file to an editor or Finder; a plugin’s line; refusals; New skill… fills a chat', async () => {
  const logs = mkdtempSync(join(tmpdir(), 'maws-skill-open-'));
  const log = join(logs, 'open.log');
  const logged = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  try {
    maws = await launchMaws({ realEngine: { projects: 1 }, env: { MAWS_E2E_OPEN_LOG: log, MAWS_E2E_OPEN_IN_APPS: 'zed' } });
    const { page } = maws;
    const { configDir, marketplace, projects } = maws.realEngine!.scratch;
    const mine = join(configDir, 'skills', 'outline-notes', 'SKILL.md');
    const projectSkill = join(projects[0]!, '.claude', 'skills', 'release-steps', 'SKILL.md');
    const detail = (name: string) => customizePage(page).locator(`[data-skill-detail="${name}"]`);
    // a person clicks the row's name: the row's content stands above its full-row open button (its tooltips), and the
    // row's own click opens the detail (SkillItem in src/renderer/src/widgets/skills/SkillsLibrary.tsx)
    const openDetail = async (name: string) => {
      await customizePage(page).locator(`[data-skill-row="${name}"] [data-skill-name]`).click();
      await expect(detail(name)).toBeVisible();
    };
    const choose = async (name: string, row: string) => {
      await detail(name).getByRole('button', { name: 'Open in', exact: true }).click();
      await page.getByRole('menuitem', { name: row, exact: true }).click();
    };

    await test.step('the scratch: the skills-only plugin installed by the engine’s own CLI, a person’s skill and a project’s on disk', async () => {
      engineCli(maws!, ['plugin', 'marketplace', 'add', marketplace]);
      engineCli(maws!, ['plugin', 'install', `skills-only@${TEST_MARKETPLACE}`, '--scope', 'user']);
      for (const [file, name] of [[mine, 'outline-notes'], [projectSkill, 'release-steps']] as const) {
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, `---\nname: ${name}\ndescription: A fixture skill of the Discover e2e group.\n---\nReply in one line.\n`);
      }
    });

    await test.step('a person’s skill: Open in lists Zed and Finder, no terminal; Zed is handed the real file', async () => {
      await openAppDestination(page, 'Customize');
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'User configuration' });
      await chooseCustomize(page, { show: 'Skills' });
      await openDetail('outline-notes');
      await detail('outline-notes').getByRole('button', { name: 'Open in', exact: true }).click();
      await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText(['Zed', 'Finder']);
      await page.getByRole('menuitem', { name: 'Zed', exact: true }).click();
      await expect.poll(logged).toBe(`open-in zed ${realpathSync(mine)}\n`);
      await expect(detail('outline-notes').locator('[data-skill-refusal]')).toHaveCount(0);
      await expect(detail('outline-notes').locator('[data-skill-note]')).toHaveCount(0);
    });

    await test.step('a plugin’s skill from All: its line, and Finder shows the plugin’s copy', async () => {
      const greet = value(await invoke(page, 'customization.inventory', { cwd: null })).skills.find((skill) => skill.name === 'greet')!;
      await chooseCustomize(page, { show: 'All' });
      await openDetail('greet');
      await expect(detail('greet').locator('[data-skill-note]')).toHaveText(/^Comes with the plugin .+\. An update of the plugin replaces this file, and any edit in it\.$/);
      await choose('greet', 'Finder');
      await expect.poll(logged).toBe(`open-in zed ${realpathSync(mine)}\nopen-in finder ${realpathSync(greet.path)}\n`);
    });

    await test.step('main opens only what its own inventory read lists for the place, and never for a terminal', async () => {
      const before = logged();
      expect(value(await invoke(page, 'customization.skillFile', { cwd: null, path: projectSkill, app: 'finder' }))).toEqual({ status: 'refused', reason: 'missing', message: null }); // listed on the project's page only
      expect(value(await invoke(page, 'customization.skillFile', { cwd: null, path: join(configDir, 'settings.json'), app: 'zed' }))).toEqual({ status: 'refused', reason: 'missing', message: null });
      expect((await invoke(page, 'customization.skillFile', { cwd: null, path: mine, app: 'terminal' } as never)).ok).toBe(false);
      expect(logged()).toBe(before);
      expect(value(await invoke(page, 'customization.skillFile', { cwd: projects[0]!, path: projectSkill, app: 'finder' }))).toEqual({ status: 'opened' });
      await expect.poll(logged).toBe(`${before}open-in finder ${realpathSync(projectSkill)}\n`);
    });

    await test.step('a file removed after the list was read: the refusal under the head, nothing opened', async () => {
      await chooseCustomize(page, { show: 'Skills' });
      await openDetail('outline-notes');
      const before = logged();
      rmSync(join(mine, '..'), { recursive: true, force: true });
      await choose('outline-notes', 'Zed');
      await expect(detail('outline-notes').getByRole('alert')).toHaveText("This skill's file is no longer here. Refresh, then try again.");
      expect(logged()).toBe(before);
    });

    await test.step('New skill… on the user configuration’s page: a new chat, its composer filled, nothing sent', async () => {
      await chooseCustomize(page, { show: 'Skills' });
      await customizeHead(page).getByRole('button', { name: 'New skill…', exact: true }).click();
      const composer = page.locator('[data-composer] [contenteditable="true"]').filter({ hasText: "Let's create a new skill in " });
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await expect(composer).toContainText('/skills/, for all my projects. First ask me what it should do.');
      expect(maws!.consoleErrors(), 'the console stays free of errors').toEqual([]);
    });
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});
