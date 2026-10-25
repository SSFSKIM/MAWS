// P4-AGG's Discover group (`pnpm e2e:discover`, MAWS_DISCOVER_E2E=1; the spec skips itself otherwise, so `pnpm e2e` is
// unchanged): docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md. The app runs the real pinned engine
// (support/real-engine.ts: MAWS_E2E_ENGINE_BIN, which the job's scripts/provision-engine.sh exports, else the installed
// 2.1.309; missing or another version fails the run, never skips) over the Discover scratch (support/discover-scratch.ts):
// a scratch HOME, CLAUDE_CONFIG_DIR and project, the engine's Anthropic Directory off, the recorded catalog sources and
// the local test marketplace. Every listing and mutation here is the unmodified CLI's own.
//   harness: M1's proof that the group can carry M3 and M4. Before Discover exists, today's Customize › Plugins adds the
//            test marketplace by its path (Add marketplace), lists exactly its four plugins in Browse, installs
//            skills-only at user scope through the install sheet, and sees it in My items, in `plugins.list` and in the
//            engine's own `plugin list --json` and settings in the scratch configuration.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { invoke, value } from './support/c7-replay';
import { TEST_MARKETPLACE } from './support/discover-scratch';
import { launchMaws, type MawsLaunch } from './support/launch';
import { REAL_ENGINE_VERSION } from './support/real-engine';
import { openAppDestination } from './support/shell';

test.skip(process.env.MAWS_DISCOVER_E2E !== '1', 'the Discover e2e runs under pnpm e2e:discover (MAWS_DISCOVER_E2E=1)');
test.describe.configure({ timeout: 240_000 });

const PLUGINS = ['hooked', 'local-server', 'remote-server', 'skills-only'].map((name) => `${name}@${TEST_MARKETPLACE}`);
const SKILLS_ONLY = `skills-only@${TEST_MARKETPLACE}`;
const CLI_MS = 120_000; // one CLI action, the engine's own start included, on a loaded runner

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

// A sheet's command, confirmed, and the line its operation leaves once it has ended.
async function confirm(sheet: Locator, submit: string): Promise<void> {
  await expect(sheet.locator('[data-plugins-argv]')).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole('button', { name: submit, exact: true }).click();
  await expect(sheet).toBeHidden();
}

test('harness: the real engine installs from the local test marketplace through Customize › Plugins', async () => {
  maws = await launchMaws({ realEngine: { projects: 1 } });
  const { page, app } = maws;
  const engine = maws.realEngine!;
  const { configDir, marketplace } = engine.scratch;

  await test.step('the prerequisites: the pinned engine in the host, the scratch, the catalog seams', async () => {
    expect(engine.version).toBe(REAL_ENGINE_VERSION);
    const env = value(await invoke(page, 'plugins.env', {}));
    expect(env.binary && realpathSync(env.binary)).toBe(realpathSync(engine.bin));
    expect(env.configHome).toBe(configDir);
    expect(JSON.parse(readFileSync(join(configDir, 'plugins', 'plugin-directory-marketplace.json'), 'utf8'))).toEqual({ enabled: false });
    const mainEnv = await app.evaluate(() => ({ fixtures: process.env.MAWS_CATALOG_FIXTURES, sources: process.env.MAWS_CATALOG_TEST_SOURCES, home: process.env.HOME }));
    expect(existsSync(join(mainEnv.fixtures!, 'directory:plugins.json'))).toBe(true);
    expect(JSON.parse(readFileSync(mainEnv.sources!, 'utf8'))).toMatchObject([{ marketplaceName: TEST_MARKETPLACE, marketplaceSource: marketplace }]);
    expect(mainEnv.home).toBe(engine.scratch.home);
  });

  await openAppDestination(page, 'Customize');
  await page.getByRole('tab', { name: 'Plugins', exact: true }).click();
  const w = page.locator('[data-region="main"] [data-widget="plugins"][data-widget-variant="embedded"]');
  await expect(w).toBeVisible();

  await test.step('Add marketplace: the test marketplace by its scratch path, at user scope', async () => {
    await w.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add marketplace', exact: true }).click();
    const dialog = page.locator('[data-marketplaces-dialog="add"]');
    await dialog.getByRole('textbox', { name: 'Source' }).fill(marketplace);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await confirm(page.locator('[data-plugins-sheet="marketplace-add"]'), 'Add');
    await expect(dialog.locator('[data-marketplace-add-line]')).toContainText(`Successfully added marketplace: ${TEST_MARKETPLACE}`, { timeout: CLI_MS });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('Browse lists exactly the test marketplace’s four plugins (the engine’s directory is off)', async () => {
    await w.getByRole('radio', { name: 'Browse' }).click();
    const cards = w.locator('[data-plugins-section="browse"] [data-browse-card]');
    await expect.poll(async () => (await cards.evaluateAll((all) => all.map((card) => card.getAttribute('data-browse-card')))).sort(), { timeout: CLI_MS }).toEqual(PLUGINS);
  });

  await test.step('Install skills-only from its card at user scope', async () => {
    const card = w.locator(`[data-plugins-section="browse"] [data-browse-card="${SKILLS_ONLY}"]`);
    await card.getByRole('button', { name: 'Install', exact: true }).click();
    const sheet = page.locator('[data-plugins-sheet="install"]');
    await expect(sheet.locator('[data-plugins-argv]')).toBeVisible({ timeout: 30_000 });
    const argv = JSON.parse((await sheet.locator('[data-plugins-argv]').getAttribute('data-plugins-argv'))!) as string[];
    expect(argv.slice(0, 3)).toEqual(['plugin', 'install', SKILLS_ONLY]);
    expect(argv.includes('--scope') ? argv[argv.indexOf('--scope') + 1] : 'user').toBe('user'); // the sheet's default
    await confirm(sheet, 'Install');
    await expect(card).toHaveAttribute('data-installed', 'here', { timeout: CLI_MS });
  });

  await test.step('installed: My items, plugins.list, and the engine’s own listing and settings', async () => {
    await w.getByRole('radio', { name: 'My items' }).click();
    await expect(w.locator(`[data-plugins-section="my-items"] [data-plugin-row="${SKILLS_ONLY}"]`)).toBeVisible({ timeout: CLI_MS });
    const listed = value(await invoke(page, 'plugins.list', { cwd: configDir })).plugins;
    expect(listed.find((plugin) => plugin.id === SKILLS_ONLY)).toMatchObject({ scope: 'user', enabled: true });
    const own = JSON.parse(engineCli(maws!, ['plugin', 'list', '--json'])) as { id: string; scope: string }[];
    expect(own.find((plugin) => plugin.id === SKILLS_ONLY)).toMatchObject({ scope: 'user' });
    const settings = JSON.parse(readFileSync(join(configDir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean>; extraKnownMarketplaces?: Record<string, { source: { source: string; path: string } }> };
    expect(settings.enabledPlugins?.[SKILLS_ONLY]).toBe(true);
    expect(settings.extraKnownMarketplaces?.[TEST_MARKETPLACE]?.source).toEqual({ source: 'directory', path: marketplace });
  });
});
