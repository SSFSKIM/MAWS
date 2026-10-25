// P4-AGG's live smoke (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Acceptance "Live smoke"; Decision
// Log 5(6): written in M5). Opt-in and outside every gate's default: it runs only under `pnpm e2e:discover-live`, which
// sets MAWS_LIVE_SMOKE=1, so the bare `pnpm e2e` skips it. It needs a Mac with network and spends nothing: no model is
// called and nothing signs in.
//   counts:    the catalog's real sources walked twice, once by the dev-only summary (scripts/catalog-summary.mjs: the
//              catalog's own code, the records per source) and once by the app itself (MAWS_CATALOG_LIVE=1: its walk
//              through the `catalog` egress rule, then what Discover shows per tab), both printed and attached as
//              `live-counts.json` for the spec's Surprises & Discoveries.
//   directory: frontend-design@anthropic-plugin-directory installed into the scratch configuration through Discover's
//              + and its sheet (the engine's own Anthropic Directory on, as for the owner), seen by the engine's own
//              listing, then uninstalled from My items.
//   linear:    Linear added from Connectors › Discover through the connector sheet and removed from My items; no sign-in.
//   scale:     All on Plugins scrolled to its end at live scale (M3 deferred it): the time to reach the end, and whether
//              the page stays responsive there (frame gaps while scrolling, a search's answer, long tasks), attached as
//              `all-grid-scale.json`.
// The app runs the real pinned engine under a scratch HOME and CLAUDE_CONFIG_DIR (support/discover-scratch.ts, `live`).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CatalogItem, CatalogTab } from '../src/shared/ipc/schema/catalog';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { REAL_ENGINE_VERSION } from './support/real-engine';
import { openAppDestination } from './support/shell';

test.skip(process.env.MAWS_LIVE_SMOKE !== '1', 'the Discover live smoke runs under pnpm e2e:discover-live (MAWS_LIVE_SMOKE=1)');

const CLI_MS = 300_000; // one CLI action on the network: a clone from GitHub, the directory's own walk
const DIRECTORY_PLUGIN = 'frontend-design';
const DIRECTORY_ID = `${DIRECTORY_PLUGIN}@anthropic-plugin-directory`;

let maws: MawsLaunch | null = null;
test.afterEach(async () => {
  await maws?.cleanup();
  maws = null;
});

function engineCli(launch: MawsLaunch, args: string[]): string {
  const engine = launch.realEngine!;
  return execFileSync('/usr/bin/env', ['-i', `HOME=${engine.scratch.home}`, `CLAUDE_CONFIG_DIR=${engine.scratch.configDir}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', engine.bin, ...args], { cwd: engine.scratch.projects[0], encoding: 'utf8', timeout: CLI_MS });
}

const library = (page: Page) => page.locator('[data-region="main"] [data-widget="plugins"][data-widget-variant="embedded"]');
const pane = (page: Page, tab = 'plugins') => page.locator(`[data-discover="${tab}"]`);
const results = (page: Page, tab = 'plugins') => pane(page, tab).locator('[data-catalog-results]').last();
const sheet = (page: Page, action: string) => page.locator(`[data-plugins-sheet="${action}"]`);

async function openDiscover(page: Page, tab: 'Plugins' | 'Connectors'): Promise<void> {
  await openAppDestination(page, 'Customize');
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await page.getByRole('tabpanel', { name: tab }).getByRole('radio', { name: 'Discover' }).click();
  await expect(pane(page, tab.toLowerCase())).toBeVisible();
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search all sources' }).fill(text);
}

async function allItems(page: Page, tab: CatalogTab): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  let cursor: string | null = null;
  do {
    const answer: { items: CatalogItem[]; nextCursor: string | null } = value(await invoke(page, 'catalog.query', { tab, cwd: null, cursor, limit: 200 }));
    items.push(...answer.items);
    cursor = answer.nextCursor;
  } while (cursor !== null);
  return items;
}

const tally = <T,>(values: readonly T[], key: (value: T) => string) => {
  const counts: Record<string, number> = {};
  for (const v of values) counts[key(v)] = (counts[key(v)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([, a], [, b]) => b - a));
};

function pluginCounts(items: readonly CatalogItem[]) {
  return {
    items: items.length,
    byRoute: tally(items, (i) => (i.install.kind === 'plugin' ? i.install.marketplaceName : i.install.kind === 'manual' ? `manual: ${i.install.reason}` : i.install.kind)),
    byOwnership: tally(items, (i) => i.ownership),
    byReviewTier: tally(items, (i) => i.reviewTier ?? 'none'),
    componentsUnknown: items.filter((i) => i.components === null).length,
    runsOnYourComputer: tally(items, (i) => String(i.runsOnYourComputer)),
    withInstalls: items.filter((i) => i.installs !== null).length,
    withPublisher: items.filter((i) => i.publisher !== null).length,
    withIcon: items.filter((i) => i.iconUrl !== null).length,
    withAlsoListedBy: items.filter((i) => i.alsoListedBy.length > 0).length,
  };
}

function connectorCounts(items: readonly CatalogItem[]) {
  const routes = items.flatMap((i) => (i.install.kind === 'connector' ? [i.install] : []));
  return {
    items: items.length,
    byTransport: tally(routes, (r) => r.transport),
    byAuth: tally(routes, (r) => r.authPosture),
    byAddress: tally(routes, (r) => (r.url !== null ? 'url' : r.urlOptions.length > 0 ? 'url_options' : r.urlPattern !== null ? 'url_regex' : 'none')),
    withRank: items.filter((i) => i.rank !== null).length,
  };
}

test('live: the real sources counted twice; a directory plugin installed and uninstalled through Discover; Linear added and removed; All at live scale', async () => {
  test.setTimeout(1_200_000);
  const info = test.info();
  const report: Record<string, unknown> = {};

  await test.step('the dev-only summary walks the real sources through the catalog’s own code', async () => {
    const out = join(info.outputDir, 'catalog-summary.json');
    mkdirSync(info.outputDir, { recursive: true });
    execFileSync(process.execPath, [resolve(__dirname, '../scripts/catalog-summary.mjs'), '--out', out], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 });
    const summary = JSON.parse(readFileSync(out, 'utf8')) as { walkMs: number; statuses: unknown; sources: unknown; catalog: unknown; unshownClaudeCodeRemoteServers: unknown };
    report.summary = { walkMs: summary.walkMs, statuses: summary.statuses, sources: summary.sources, catalog: summary.catalog, unshownClaudeCodeRemoteServers: summary.unshownClaudeCodeRemoteServers };
    await info.attach('catalog-summary.json', { path: out, contentType: 'application/json' });
  });

  maws = await launchMaws({ realEngine: { projects: 1, live: true } });
  const { page } = maws;
  expect(maws.realEngine!.version).toBe(REAL_ENGINE_VERSION);

  await test.step('the app walks the same sources (its egress rule) and Discover shows them per tab', async () => {
    const started = Date.now();
    const statuses = value(await invoke(page, 'catalog.refresh', {}));
    const walkMs = Date.now() - started;
    const plugins = await allItems(page, 'plugins');
    const skills = await allItems(page, 'skills');
    const connectors = await allItems(page, 'connectors');
    const home = value(await invoke(page, 'catalog.home', { tab: 'plugins', cwd: null }));
    report.app = {
      walkMs,
      sources: statuses.map((s) => ({ key: s.key, state: s.state, dropped: s.dropped })),
      plugins: pluginCounts(plugins),
      skillsTab: skills.length,
      connectors: connectorCounts(connectors),
      home: { featured: home.featured?.name ?? null, shelves: home.shelves.map((s) => `${s.title} (${s.total})`), total: home.total },
    };
    console.log(`live counts\n${JSON.stringify(report, null, 2)}`);
    await info.attach('live-counts.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(statuses.filter((s) => s.state !== 'fresh'), 'every source walked').toEqual([]);
    expect(plugins.length).toBeGreaterThan(3_000);
    expect(connectors.length).toBeGreaterThan(600);
  });

  await test.step(`${DIRECTORY_ID}: installed through Discover, seen by the engine, uninstalled from My items`, async () => {
    await openDiscover(page, 'Plugins');
    await search(page, DIRECTORY_PLUGIN);
    const card = results(page).locator(`[data-catalog-card][data-install-name="${DIRECTORY_PLUGIN}"][data-install-marketplace="anthropic-plugin-directory"]`);
    await expect(card).toHaveCount(1, { timeout: 60_000 });
    await card.getByRole('button', { name: `Add ${DIRECTORY_PLUGIN}`, exact: true }).click();
    const install = sheet(page, 'install');
    await install.getByRole('button', { name: 'Details', exact: true }).click({ timeout: 30_000 }); // the commands sit behind it (the owner's ruling, 2026-10-25)
    await expect(install.locator('[data-plugins-argv]')).toBeVisible();
    await expect(install.locator('[data-plugins-add-argv]')).toHaveCount(0); // the engine's own marketplace, always present
    expect(JSON.parse((await install.locator('[data-plugins-argv]').getAttribute('data-plugins-argv'))!)).toEqual(expect.arrayContaining(['plugin', 'install', DIRECTORY_ID]));
    await install.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(install).toBeHidden();
    await expect(card).toHaveAttribute('data-installed', 'here', { timeout: CLI_MS });
    const listed = () => (JSON.parse(engineCli(maws!, ['plugin', 'list', '--json'])) as { id: string }[]).map((p) => p.id);
    expect(listed()).toContain(DIRECTORY_ID);

    await card.locator('[data-card-open]').focus(); // installed here: the card opens it in My items
    await page.keyboard.press('Enter');
    const w = library(page);
    const where: Locator = w.locator(`[data-plugin-detail="${DIRECTORY_ID}"], [data-plugins-section="my-items"] [data-plugin-row="${DIRECTORY_ID}"]`).first();
    await expect(where).toBeVisible({ timeout: 60_000 });
    await where.getByRole('button', { name: /^More actions for / }).first().click();
    await page.getByRole('menuitem', { name: 'Uninstall…', exact: true }).click();
    const uninstall = sheet(page, 'uninstall');
    await uninstall.getByRole('checkbox', { name: 'I understand' }).check();
    await uninstall.getByRole('button', { name: 'Uninstall', exact: true }).click();
    await expect.poll(listed, { timeout: CLI_MS }).not.toContain(DIRECTORY_ID);
    await expect(w.locator(`[data-plugins-section="my-items"] [data-plugin-row="${DIRECTORY_ID}"]`)).toHaveCount(0, { timeout: 60_000 });
  });

  await test.step('Linear: added from Connectors › Discover, removed from My items; no sign-in', async () => {
    const configFile = join(maws!.realEngine!.scratch.configDir, '.claude.json');
    const userServers = () => (JSON.parse(readFileSync(configFile, 'utf8')) as { mcpServers?: Record<string, { type?: string; url?: string }> }).mcpServers ?? {};
    await openDiscover(page, 'Connectors');
    await search(page, 'Linear');
    await pane(page, 'connectors').getByRole('button', { name: 'Add Linear', exact: true }).first().click();
    const add = sheet(page, 'mcp-add');
    await expect(add.getByRole('textbox', { name: 'Name' })).toHaveValue('linear');
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(add).toBeHidden();
    await expect.poll(() => userServers().linear, { timeout: CLI_MS }).toEqual({ type: 'http', url: 'https://mcp.linear.app/mcp' });
    const panel = page.getByRole('tabpanel', { name: 'Connectors' });
    await panel.getByRole('radio', { name: 'My items' }).click();
    const row = panel.locator('[data-connector="linear"]');
    await row.getByRole('button', { name: 'Remove linear' }).click();
    const remove = sheet(page, 'mcp-remove');
    await remove.getByRole('checkbox').check();
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: CLI_MS });
    expect(userServers().linear).toBeUndefined();
  });

  await test.step('All at live scale: scrolled to its end, and how the page answers there', async () => {
    await openDiscover(page, 'Plugins');
    await search(page, '');
    await expect(pane(page).locator('[data-discover-home]')).toBeVisible();
    const total = value(await invoke(page, 'catalog.home', { tab: 'plugins', cwd: null })).total;
    const scroller = pane(page).locator('[data-discover-pane]');
    const cards = results(page).locator('[data-catalog-grid] [data-catalog-card]');
    await page.evaluate(() => {
      const w = window as unknown as { __longTasks: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => w.__longTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: false });
    });
    const started = Date.now();
    const steps: { cards: number; ms: number }[] = [];
    for (let i = 0; i < 400; i += 1) {
      const before = await cards.count();
      if (before >= total) break;
      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect.poll(() => cards.count(), { timeout: 60_000 }).toBeGreaterThan(before);
      steps.push({ cards: await cards.count(), ms: Date.now() - started });
    }
    const reachedMs = Date.now() - started;
    const reached = await cards.count();
    // frames while the full grid scrolls up by a screen's height a frame for two seconds: the longest gap between frames
    const frames = await scroller.evaluate(
      (el) =>
        new Promise<{ frames: number; maxGapMs: number; meanGapMs: number }>((done) => {
          const gaps: number[] = [];
          let last = performance.now();
          const end = last + 2_000;
          const tick = (now: number) => {
            gaps.push(now - last);
            last = now;
            el.scrollBy(0, -el.clientHeight / 4);
            if (now < end) requestAnimationFrame(tick);
            else done({ frames: gaps.length, maxGapMs: Math.max(...gaps), meanGapMs: gaps.reduce((a, b) => a + b, 0) / gaps.length });
          };
          requestAnimationFrame(tick);
        }),
    );
    const mounted = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, heapMB: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1_048_576) }));
    // a search typed with every card mounted: the time until its answer is drawn
    const searchStarted = Date.now();
    await search(page, 'legal');
    await expect(results(page).getByRole('heading', { name: /^\d[\d,]* results?$/ })).toBeVisible({ timeout: 60_000 });
    const searchMs = Date.now() - searchStarted;
    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    const scale = {
      total,
      reached,
      pages: steps.length,
      reachedMs,
      lastPagesMs: steps.slice(-5).map((s, i, all) => (i === 0 ? null : s.ms - all[i - 1]!.ms)).slice(1),
      frames,
      searchMs,
      atTheEnd: mounted, // every card mounted
      longTasks: { count: longTasks.length, totalMs: Math.round(longTasks.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...longTasks)) },
    };
    console.log(`all-grid scale\n${JSON.stringify(scale, null, 2)}`);
    await info.attach('all-grid-scale.json', { body: JSON.stringify(scale, null, 2), contentType: 'application/json' });
    expect(reached, 'All reaches its end').toBe(total);
  });
});
