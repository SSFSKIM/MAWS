// E8's live run (E8 execution document, M3 "The live run"; Acceptance G1 to G4): the built app against the owner's
// installed engine behind ClaudeUsage's relay, through Playwright only (no desktop automation), in a scratch root under
// /tmp whose config home the engine and its plugin CLI write (support/plugins-live.ts). A session is created through
// "+" on a scratch repository and runs one turn so `system/init` reports its plugins; then, in `/plugins` and the panel,
// every management action runs through its confirm sheet: the scratch folder marketplace added, one repository-source
// marketplace added from GitHub and removed (network-dependent: a refusal is recorded, the folder case stays the gate),
// `e8-probe@e8-scratch` installed and reflected in the running session before any new turn, the panel's Reload mods and
// Reload skills, Refresh, a real Update to 0.2.0, `/skills` after the next turn, disable, enable, uninstall, the
// engine's error for a plugin its marketplace withdrew, and the marketplace removed. Around every action the config
// home's file tree is read and its delta set beside the action's `writesOf` manifest in `<scratch>/live-run.txt`; each
// step leaves `<scratch>/live-<step>.png`; what was seen goes to `<scratch>/observations.json`. The owner's
// ~/.claude.json check runs around the whole run, outside this file (Concrete Steps). Run on purpose only; it spends
// usage (two haiku turns):
//   MAWS_HARNESS=1 pnpm exec electron-vite build && unset MAWS_E2E; MAWS_E8_LIVE=1 pnpm exec playwright test e2e/plugins-live.spec.ts --reporter=line
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { PluginsAction, PluginsScope } from '@shared/plugins/cli';
import { ENGINE_BIN, ENGINE_VERSION } from '../test/support/engine-pin';
import { invoke, value } from './support/c7-replay';
import { launchMaws } from './support/launch';
import { deltaOf, kindOf, manifestOf, pluginsLiveSkipReason, pluginsScratch, type PluginsScratch } from './support/plugins-live';
import { newChatIn } from './support/sidebar';

const skip = pluginsLiveSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 1_800_000 });

const HAIKU = /^(Haiku|claude-haiku)/;
const REPO_SOURCE = 'anthropics/claude-plugins-official'; // the architect's ruling of 2026-10-06
const PLUGIN = 'e8-probe@e8-scratch';
const DONE_TIMEOUT = 120_000; // the CLI, the 3 s settle, the reload and its one retry
const CLONE_TIMEOUT = 240_000; // a 23 MB clone (G0: 17 s)

let scratch: PluginsScratch;
test.beforeAll(() => {
  scratch = pluginsScratch();
});

// ---- the page --------------------------------------------------------------------------------------------------

const status = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
async function idle(page: Page, id: string): Promise<void> {
  await page.waitForTimeout(1_500);
  await expect.poll(async () => {
    const s = await status(page, id);
    return s.turn === null && s.pendingRequests === 0;
  }, { timeout: 240_000, intervals: [500] }).toBe(true);
}
async function closeWidgets(page: Page): Promise<void> {
  if (await page.getByRole('dialog', { name: 'Model and effort' }).isVisible()) await page.keyboard.press('Escape');
  for (const w of await page.locator('[data-widget]').all()) await w.getByRole('button', { name: /^Close / }).first().click().catch(() => undefined);
}
async function send(page: Page, text: string): Promise<void> {
  await closeWidgets(page);
  await page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}
async function openWidget(page: Page, name: string): Promise<Locator> {
  await closeWidgets(page);
  await page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.type(`/${name}`);
  const chosen = page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]');
  await expect(chosen).toContainText(`/${name}`);
  await page.keyboard.press('Enter');
  const w = page.locator(`[data-widget="${name}"]`);
  await expect(w).toBeVisible();
  return w;
}
async function openPlugins(page: Page): Promise<Locator> {
  const w = await openWidget(page, 'plugins');
  await expect(w.locator('[data-plugins-section="installed"]')).toBeVisible({ timeout: 30_000 });
  await expect(w.locator('[data-plugins-section="marketplaces"]')).not.toContainText('Reading', { timeout: 30_000 });
  return w;
}
const installedRow = (w: Locator, id = PLUGIN) => w.locator(`[data-plugins-section="installed"] [data-plugin-row="${id}"]`);
const marketplaceRow = (w: Locator, name: string) => w.locator(`[data-marketplace-row="${name}"]`);
const loaded = (w: Locator) => w.locator('[data-plugins-section="loaded"]');
// An Available plugin's line: on its row, or beneath the groups once the engine's `--available` stops offering it (it
// leaves out what is installed).
const availableLine = (w: Locator, id: string) => w.locator(`[data-plugins-section="available"] [data-plugin-row="${id}"], [data-plugins-section="available"] [data-plugin-result="${id}"]`);
const sheetOf = (page: Page, action: string) => page.locator(`[data-plugins-sheet="${action}"]`);
const panelPlugins = (page: Page) => page.locator('[data-region="panel"]').getByRole('region', { name: 'Plugins' });

// A row's operation once it has ended: its status line neither `Working…` nor `Reloading running sessions…`, and no
// Stop (shown while the CLI runs). Answers the line's words.
async function ended(scope: Locator, timeout = DONE_TIMEOUT): Promise<{ text: string; failed: boolean }> {
  const line = scope.getByRole('status');
  await expect
    .poll(async () => {
      if ((await line.count()) !== 1) return false;
      const text = (await line.innerText()).trim();
      return text !== '' && !/^(Working…|Reloading running sessions…)$/.test(text) && (await scope.getByRole('button', { name: 'Stop' }).count()) === 0;
    }, { timeout, intervals: [500] })
    .toBe(true);
  return { text: (await line.innerText()).trim(), failed: ((await line.getAttribute('class')) ?? '').includes('text-danger') };
}
async function openAvailableGroup(w: Locator, marketplace: string): Promise<Locator> {
  const section = w.locator('[data-plugins-section="available"]');
  if ((await section.locator('details').first().getAttribute('open')) === null) await section.locator('summary').first().click();
  const group = section.locator('details details').filter({ has: w.page().locator('summary', { hasText: new RegExp(`^${marketplace} · \\d+ plugins?$`) }) });
  await expect(group).toHaveCount(1, { timeout: 120_000 }); // the catalogue read lists the built-in directory too
  if ((await group.getAttribute('open')) === null) await group.locator('summary').click();
  return group;
}

// ---- the run ---------------------------------------------------------------------------------------------------

test('E8 live: marketplaces and plugins managed from /plugins and the panel through the engine’s CLI, reflected in the running session', async () => {
  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: ENGINE_BIN, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config } });
  const { page } = maws;
  const failures: string[] = [];
  let n = 0;
  const shot = (name: string) => page.screenshot({ path: join(scratch.root, `live-${name}.png`) }).catch(() => undefined);
  // Each step records what it saw; a failed step is recorded and the run goes on (a live run is expensive to repeat),
  // and the test fails at its end with every failed step named.
  const step = (name: string, title: string, body: () => Promise<void>) =>
    test.step(title, async () => {
      n += 1;
      const label = `${String(n).padStart(2, '0')}-${name}`;
      scratch.log('');
      scratch.log(`=== ${label} · ${title}`);
      try {
        await body();
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error);
        failures.push(`${label}: ${message}`);
        scratch.log(`FAILED: ${message}`);
        scratch.observe(`${label}.failed`, message);
      }
      await shot(label);
    });
  // One management action: the sheet read (its argv shown and screenshotted), confirmed, the row's words when it ended,
  // and the config home's delta beside the action's manifest.
  const action = async (spec: { name: string; action: PluginsAction; scope: PluginsScope; source: string | null; fill: Record<string, string>; sheet: string; submit: string; acknowledge?: boolean; line: () => Locator; timeout?: number }, open: () => Promise<void>) => {
    const before = scratch.snapshot();
    await open();
    const sheet = sheetOf(page, spec.sheet);
    await expect(sheet.locator('[data-plugins-argv]')).toBeVisible({ timeout: 30_000 });
    const argv = await sheet.locator('[data-plugins-argv]').innerText();
    const writes = await sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem').allInnerTexts();
    const then = /Reloads plugins in \d+ running sessions?|No running session to reload|Nothing to reload[^\n]*/.exec(await sheet.innerText())?.[0] ?? null;
    scratch.log(`sheet: ${argv}`);
    scratch.log(`sheet writes: ${writes.join(' · ')}`);
    scratch.log(`sheet then: ${then}`);
    await page.screenshot({ path: join(scratch.root, `live-${String(n).padStart(2, '0')}-${spec.name}-sheet.png`) });
    if (spec.acknowledge) await sheet.getByRole('checkbox', { name: 'I understand' }).check();
    await sheet.getByRole('button', { name: spec.submit, exact: true }).click();
    await expect(sheet).toBeHidden();
    const result = await ended(spec.line(), spec.timeout);
    scratch.log(`row: ${result.text.replaceAll('\n', ' ⏎ ')}${result.failed ? '   [drawn as a failure]' : ''}`);
    await page.waitForTimeout(1_000); // the CLI has exited; let a straggling writer land before the after-tree is read
    const delta = deltaOf(before, scratch.snapshot());
    const manifest = manifestOf(spec.action, spec.scope, spec.source, spec.fill);
    scratch.log(`manifest (writesOf ${spec.action}, ${spec.scope}, ${spec.source ?? 'null'}): ${manifest.paths.join(' · ')}`);
    const unannounced: string[] = [];
    const lines = ([['added', delta.added], ['removed', delta.removed], ['changed', delta.changed]] as const).flatMap(([kind, paths]) =>
      paths.map((path) => {
        const where = manifest.covers(path) ? 'manifest' : kindOf(path);
        if (where === 'unannounced') unannounced.push(`${kind} ${path}`);
        return `  ${kind.padEnd(7)} ${path}   [${where}]`;
      }),
    );
    scratch.log(lines.length > 0 ? `delta:\n${lines.join('\n')}` : 'delta: none');
    scratch.log(unannounced.length === 0 ? 'verdict: every configuration write inside the manifest' : `verdict: OUTSIDE the manifest: ${unannounced.join(', ')}`);
    scratch.observe(spec.name, { argv, writes, then, row: result, delta, unannounced });
    expect(unannounced, 'configuration writes the sheet did not announce').toEqual([]);
    return result;
  };

  try {
    scratch.log(`E8 live run · ${new Date().toISOString()} · engine ${ENGINE_BIN} (${ENGINE_VERSION}) · CLAUDE_CONFIG_DIR=${scratch.config} · marketplace ${scratch.market} · repository ${scratch.repo}`);
    scratch.log('Each action: the sheet\'s command and writes, the row\'s words once it ended, the config home\'s file delta (config/…) and the project\'s .claude/ (project/…), each path marked [manifest] when writesOf covers it, else [records (D-12)], [catalogue cache (D-12)], [session files] or [unannounced].');
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    let id = '';
    let builtin = 0; // the plugins the engine loads with an empty home (its own `@builtin` ones)

    await step('start', 'a session through + on haiku, one turn so system/init lists its plugins', async () => {
      const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
      if (!projects.some((p) => p.directory === scratch.repo)) value(await invoke(page, 'session.projects.add', { directory: scratch.repo }));
      await newChatIn(page, 'e8-repo');
      await expect(page.getByRole('heading', { name: 'New chat in e8-repo' })).toBeVisible();
      id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
      const model = await openWidget(page, 'model');
      await model.getByRole('menuitemradio', { name: HAIKU }).click();
      await expect.poll(async () => value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === id)?.model ?? '').toMatch(/haiku/);
      await send(page, 'Reply with exactly: E8 LIVE READY');
      await idle(page, id);
      const s = await status(page, id);
      scratch.log(`session ${id}: ${s.process} · model ${s.model.resolved} · gateway ${s.gateway.verified} · plugins loaded ${s.plugins.length}`);
      scratch.observe('start', { id, model: s.model, gateway: s.gateway, plugins: s.plugins });
      builtin = s.plugins.length;
      scratch.log(`loaded before any install: ${s.plugins.map((p) => p.source ?? p.name).join(', ')}`);
      expect(s.gateway.verified).toBe('routed');
    });

    await step('plugins', '/plugins lists the engine’s (empty) registry; the foot names the scratch home', async () => {
      const w = await openPlugins(page);
      const text = await w.innerText();
      scratch.log(`installed: ${(await w.locator('[data-plugins-section="installed"]').innerText()).replaceAll('\n', ' · ')}`);
      scratch.log(`marketplaces: ${(await w.locator('[data-plugins-section="marketplaces"]').innerText()).replaceAll('\n', ' · ')}`);
      scratch.log(`foot: ${(await w.locator('footer').innerText()).replaceAll('\n', ' ')}`);
      scratch.observe('plugins', text);
      await expect(w.locator('footer')).toContainText(scratch.config);
    });

    const addLine = (w: Locator) => w.getByRole('textbox', { name: 'Add marketplace' }).locator('xpath=ancestor::form[1]');
    await step('add-folder', 'Add marketplace: the scratch folder', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const result = await action({ name: 'add-folder', action: 'marketplace-add', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, sheet: 'marketplace-add', submit: 'Add', line: () => addLine(w) }, async () => {
        await w.getByRole('textbox', { name: 'Add marketplace' }).fill(scratch.market);
        await w.getByRole('button', { name: 'Add…' }).click();
      });
      expect(result.text).toBe('Successfully added marketplace: e8-scratch (declared in user settings)');
      await expect(marketplaceRow(w, 'e8-scratch')).toContainText(scratch.market);
    });

    await step('add-repo', `Add marketplace: ${REPO_SOURCE} from GitHub (network-dependent), then Remove…`, async () => {
      const w = page.locator('[data-widget="plugins"]');
      const result = await action({ name: 'add-repo', action: 'marketplace-add', scope: 'user', source: null, fill: { name: 'claude-plugins-official' }, sheet: 'marketplace-add', submit: 'Add', line: () => addLine(w), timeout: CLONE_TIMEOUT }, async () => {
        await w.getByRole('textbox', { name: 'Add marketplace' }).fill(REPO_SOURCE);
        await w.getByRole('button', { name: 'Add…' }).click();
      });
      if (result.failed) {
        scratch.log('the network refused the repository source: recorded; the folder case stays the gate');
        return;
      }
      const row = marketplaceRow(w, 'claude-plugins-official');
      await expect(row).toContainText(REPO_SOURCE);
      scratch.log(`row: ${(await row.innerText()).replaceAll('\n', ' · ')}`);
      const removed = await action({ name: 'remove-repo', action: 'marketplace-remove', scope: 'user', source: 'github', fill: { name: 'claude-plugins-official' }, sheet: 'marketplace-remove', submit: 'Remove', acknowledge: true, line: () => w.locator('[data-marketplace-result="claude-plugins-official"]') }, () =>
        row.getByRole('button', { name: 'Remove…' }).click(),
      );
      expect(removed.text).toContain('Successfully removed marketplace: claude-plugins-official');
      await expect(row).toHaveCount(0);
    });

    await step('install', `Install ${PLUGIN} from Available at user scope: reflected, the Loaded list and the panel before any new turn`, async () => {
      const w = page.locator('[data-widget="plugins"]');
      const group = await openAvailableGroup(w, 'e8-scratch');
      const row = group.locator(`[data-plugin-row="${PLUGIN}"]`);
      const result = await action({ name: 'install', action: 'install', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'install', submit: 'Install', line: () => availableLine(w, PLUGIN) }, () => row.getByRole('button', { name: 'Install…' }).click());
      expect(result.text).toBe('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · Reloaded in 1 session · reflected');
      await expect(installedRow(w)).toContainText('user · enabled · e8-scratch');
      await expect(loaded(w).getByRole('list', { name: 'Loaded plugins' })).toContainText('e8-probe');
      const s = await status(page, id);
      scratch.log(`status before any new turn: plugins ${JSON.stringify(s.plugins.map((p) => p.name))}`);
      expect(s.plugins.map((p) => p.name)).toContain('e8-probe');
    });

    await step('panel-reload', 'the panel’s Plugins section: Plugins · N loaded (the built-in ones and e8-probe), Reload mods, Reload skills', async () => {
      await closeWidgets(page);
      const panel = panelPlugins(page);
      await expect(panel).toContainText(`Plugins · ${builtin + 1} loaded`);
      const mods = panel.getByRole('button', { name: 'Reload mods' });
      const line = mods.locator('xpath=following-sibling::*[@role="status"]');
      await mods.click();
      await expect(line).toHaveText(new RegExp(`^Reloaded · \\d+ commands · \\d+ agents · ${builtin + 1} plugins · 0 errors$`), { timeout: 60_000 });
      scratch.log(`Reload mods: ${await line.innerText()}`);
      await shot(`${String(n).padStart(2, '0')}-panel-reload-mods`);
      await panel.getByRole('button', { name: 'Reload skills' }).click();
      await expect(line).toHaveText(/^Reloaded · \d+ skills?$/, { timeout: 60_000 });
      scratch.log(`Reload skills: ${await line.innerText()}`);
      scratch.observe('panel', await panel.innerText());
    });

    await step('refresh', 'Refresh e8-scratch', async () => {
      const w = await openPlugins(page);
      const row = marketplaceRow(w, 'e8-scratch');
      const result = await action({ name: 'refresh', action: 'marketplace-update', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, sheet: 'marketplace-update', submit: 'Refresh', line: () => row }, () => row.getByRole('button', { name: 'Refresh' }).click());
      expect(result.text).toContain('Successfully updated marketplace: e8-scratch');
      expect(result.failed).toBe(false);
    });

    await step('update', 'plugin.json rewritten to 0.2.0, then Update: 0.1.0 → 0.2.0', async () => {
      scratch.setPluginVersion('0.2.0');
      const w = page.locator('[data-widget="plugins"]');
      const row = installedRow(w);
      const result = await action({ name: 'update', action: 'update', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'update', submit: 'Update', line: () => row }, () => row.getByRole('button', { name: 'Update' }).click());
      expect(result.text).toContain('0.1.0 → 0.2.0');
      await expect(row).toContainText('0.2.0');
      scratch.log(`loaded after the update's reload: ${(await loaded(w).innerText()).replaceAll('\n', ' · ')}`);
    });

    await step('skills', '/skills after the next turn lists e8-probe:e8-hello', async () => {
      await send(page, 'Reply with exactly: E8 LIVE SKILLS');
      await idle(page, id);
      const w = await openWidget(page, 'skills');
      await expect(w.getByRole('list', { name: 'Skills' })).toContainText('e8-probe:e8-hello', { timeout: 30_000 });
      const skills = await w.getByRole('list', { name: 'Skills' }).getByRole('listitem').allInnerTexts();
      scratch.log(`skills: ${skills.map((s) => s.split('\n')[0]).join(' · ')}`);
      scratch.observe('skills', skills);
    });

    await step('disable', 'the switch: disable; the Loaded list loses e8-probe', async () => {
      const w = await openPlugins(page);
      const row = installedRow(w);
      const result = await action({ name: 'disable', action: 'disable', scope: 'user', source: null, fill: {}, sheet: 'disable', submit: 'Disable', line: () => row }, () => row.getByRole('switch').click());
      expect(result.text).toBe('Successfully disabled plugin: e8-probe (scope: user) · Reloaded in 1 session · reflected');
      await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      await expect(loaded(w)).not.toContainText('e8-probe');
    });

    await step('enable', 'the switch: enable; the Loaded list regains e8-probe', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const row = installedRow(w);
      const result = await action({ name: 'enable', action: 'enable', scope: 'user', source: null, fill: {}, sheet: 'enable', submit: 'Enable', line: () => row }, () => row.getByRole('switch').click());
      expect(result.text).toBe('Successfully enabled plugin: e8-probe (scope: user) · Reloaded in 1 session · reflected');
      await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      await expect(loaded(w).getByRole('list', { name: 'Loaded plugins' })).toContainText('e8-probe');
    });

    await step('uninstall', 'Uninstall…: the row leaves, its result stays; the Loaded list loses e8-probe', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const row = installedRow(w);
      const result = await action({ name: 'uninstall', action: 'uninstall', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'uninstall', submit: 'Uninstall', acknowledge: true, line: () => w.locator(`[data-plugin-result="${PLUGIN}"]`) }, () =>
        row.getByRole('button', { name: 'Uninstall…' }).click(),
      );
      expect(result.text).toBe('Successfully uninstalled plugin: e8-probe (scope: user) · Reloaded in 1 session · reflected');
      await expect(row).toHaveCount(0);
      await expect(loaded(w)).not.toContainText('e8-probe');
    });

    await step('error', 'install nope@e8-scratch after its marketplace withdrew it: the engine’s words and code', async () => {
      const w = page.locator('[data-widget="plugins"]');
      // the marketplace offers `nope`; a Refresh reads it in, and the open Available section reads the catalogue again
      scratch.offerNope(true);
      const market = marketplaceRow(w, 'e8-scratch');
      await market.getByRole('button', { name: 'Refresh' }).click();
      await sheetOf(page, 'marketplace-update').getByRole('button', { name: 'Refresh', exact: true }).click();
      await ended(market);
      const group = await openAvailableGroup(w, 'e8-scratch');
      const row = group.locator('[data-plugin-row="nope@e8-scratch"]');
      await expect(row).toBeVisible({ timeout: 60_000 });
      // then withdraws it, and the owner installs from the list they read
      scratch.offerNope(false);
      const result = await action({ name: 'error', action: 'install', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'nope', id: 'nope@e8-scratch' }, sheet: 'install', submit: 'Install', line: () => availableLine(w, 'nope@e8-scratch') }, () =>
        row.getByRole('button', { name: 'Install…' }).click(),
      );
      expect(result.failed).toBe(true);
      expect(result.text).toMatch(/ · [a-z_]+$/);
      scratch.observe('error.code', result.text.split(' · ').at(-1));
    });

    await step('remove-folder', 'Remove… e8-scratch: the row leaves, its result stays', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const row = marketplaceRow(w, 'e8-scratch');
      const result = await action({ name: 'remove-folder', action: 'marketplace-remove', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, sheet: 'marketplace-remove', submit: 'Remove', acknowledge: true, line: () => w.locator('[data-marketplace-result="e8-scratch"]') }, () =>
        row.getByRole('button', { name: 'Remove…' }).click(),
      );
      expect(result.text).toContain('Successfully removed marketplace: e8-scratch');
      await expect(row).toHaveCount(0);
      await expect(w.locator('[data-plugins-section="marketplaces"]')).toContainText('No marketplaces configured');
    });

    scratch.observe('consoleErrors', maws.consoleErrors());
    scratch.log('');
    scratch.log(`console errors: ${JSON.stringify(maws.consoleErrors())}`);
    scratch.log(failures.length === 0 ? 'result: every step passed' : `result: ${failures.length} step(s) failed:\n${failures.join('\n')}`);
  } finally {
    await shot('final');
    await maws.cleanup();
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
