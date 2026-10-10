// E8's live run (E8 execution document, M3 "The live run"; Acceptance G1 to G4): the built app against the owner's
// installed engine behind ClaudeUsage's relay, through Playwright only (no desktop automation), in a scratch root under
// /tmp whose config home the engine and its plugin CLI write (support/plugins-live.ts). A session is created through
// "+" on a scratch repository and runs one turn so `system/init` reports its plugins; then, in `/plugins` (P2-B's
// library: My items, Browse, the Add menu's Add marketplace and Manage marketplaces) and the panel, every management
// action runs through its confirm sheet: the scratch folder marketplace added, one repository-source
// marketplace added from GitHub and removed (network-dependent: a refusal is recorded, the folder case stays the gate),
// `e8-probe@e8-scratch` installed and reflected in the running session before any new turn, the panel's Reload plugins and
// Reload skills, Refresh, a real Update to 0.2.0, `/skills` after the next turn, disable, enable, uninstall, the
// engine's error for a plugin its marketplace withdrew, the plugin installed again, and the marketplace removed with it
// still installed (2.1.291 uninstalls it; the sheet names it). Around every action the config
// home's file tree is read and its delta set beside the action's `writesOf` manifest in `<scratch>/live-run.txt`; each
// step leaves `<scratch>/live-<step>.png`; what was seen goes to `<scratch>/observations.json`. The owner's
// ~/.claude.json check runs around the whole run, outside this file (Concrete Steps). Run on purpose only; it spends
// usage (two haiku turns):
//   MAWS_HARNESS=1 pnpm exec electron-vite build && unset MAWS_E2E; MAWS_E8_LIVE=1 [MAWS_LIVE_MAX_USD=0.15] pnpm exec playwright test e2e/plugins-live.spec.ts --reporter=line
// With MAWS_LIVE_MAX_USD set (at most 1), the engine is reached through support/live-budget.ts's forwarding script,
// which adds `--max-budget-usd <that cap>` to every session process (P2-F's re-run cap); unset, the engine itself.
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { PluginsAction, PluginsInstallation, PluginsScope } from '@shared/plugins/cli';
import { ENGINE_BIN, ENGINE_VERSION } from '../test/support/engine-pin';
import { invoke, value } from './support/c7-replay';
import { launchMaws } from './support/launch';
import { cappedEngine, capWords } from './support/live-budget';
import { auditOf, manifestOf, untilQuiet, type Manifest, type Tree } from '../test/support/plugins-audit';
import { pluginsLiveSkipReason, pluginsScratch, trackPluginReads, type PluginReads, type PluginsScratch } from './support/plugins-live';
import { newChatIn } from './support/sidebar';

const skip = pluginsLiveSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 1_800_000 });

const HAIKU = /^(Haiku|claude-haiku)/;
const REPO_SOURCE = 'anthropics/claude-plugins-official'; // the architect's ruling of 2026-10-06
const PLUGIN = 'e8-probe@e8-scratch';
const DONE_TIMEOUT = 120_000; // the CLI, the 3 s settle, the reload and its one retry
const CLONE_TIMEOUT = 240_000; // a 23 MB clone (G0: 17 s)
// A clone the network refused, as git and the engine word it (DNS, connection, TLS, timeout, HTTP access).
const NETWORK_REFUSAL = /could not resolve host|unable to access|failed to connect|connection (refused|reset|timed out)|network is unreachable|operation timed out|timed out|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|SSL|TLS|offline/i;
const NOT_FOUND = 'Plugin "nope" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`. · not_found';

let scratch: PluginsScratch;
let reads: PluginReads; // the plugins.* and marketplaces.* invokes main answers (trackPluginReads)
const QUIET_MS = 1_500; // a window closes this long after the last CLI read settled, with none in flight
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
// ---- the G4 audit (test/support/plugins-audit.ts) ----------------------------------------------------------------

// The trees around one CLI action set side by side: every changed path with its verdict in live-run.txt; a configuration
// write outside the manifest (any, for a listing) or a path nobody recognises fails the step. The window closes only once
// no CLI read is in flight and none settled for QUIET_MS (a refetch behind cached data, or the rereads a
// `plugins.changed` triggers, has finished); the reads that settled inside it are logged.
async function audited(before: Tree, startedAt: number, manifest: Manifest | null, what: string): Promise<void> {
  await untilQuiet(reads, { quietMs: QUIET_MS, timeoutMs: 180_000 });
  const settled = await reads.settledSince(startedAt);
  scratch.log(`CLI reads settled in this window: ${settled.length === 0 ? 'none' : settled.map((r) => `${r.name} ${r.ms} ms${r.outcome === 'answered' ? '' : ` (${r.outcome})`}`).join(' · ')}`);
  const audit = auditOf(before, scratch.tree(), manifest);
  scratch.log(manifest ? `manifest: ${manifest.paths.join(' · ')}` : `${what}: a listing (D-12: the catalogue caches and .claude.json bookkeeping only)`);
  scratch.log(audit.lines.length > 0 ? `delta:\n${audit.lines.join('\n')}` : 'delta: none');
  const verdict =
    audit.unannounced.length === 0 && audit.unclassified.length === 0
      ? manifest
        ? 'verdict: every configuration write inside the manifest'
        : 'verdict: no configuration write'
      : `verdict: FAILED${audit.unannounced.length > 0 ? ` · unannounced: ${audit.unannounced.join(', ')}` : ''}${audit.unclassified.length > 0 ? ` · unclassified: ${audit.unclassified.join(', ')}` : ''}`;
  scratch.log(verdict);
  expect(audit.unannounced, `${what}: configuration writes the sheet did not announce`).toEqual([]);
  expect(audit.unclassified, `${what}: paths the audit could not classify`).toEqual([]);
}
// A listing the widget runs (its opening reads, Browse's first showing), audited as one.
async function listing<T>(what: string, run: () => Promise<T>): Promise<T> {
  scratch.log(`--- listing: ${what}`);
  await untilQuiet(reads, { quietMs: QUIET_MS, timeoutMs: 180_000 }); // the baseline after any earlier read has landed
  const startedAt = Date.now();
  const before = scratch.tree();
  const result = await run();
  await audited(before, startedAt, null, what);
  return result;
}

// `/plugins` opened, its two CLI reads (`plugin list`, `marketplace list`) answered and audited.
async function openPlugins(page: Page): Promise<Locator> {
  return listing('opening /plugins (plugin list --json, plugin marketplace list --json)', async () => {
    const w = await openWidget(page, 'plugins');
    await expect(w.locator('[data-plugins-section="my-items"]')).toBeVisible({ timeout: 30_000 }); // P2-B M3: the library's My items
    await expect(w.locator('[data-plugins-section="my-items"] > *').first()).toBeVisible({ timeout: 30_000 }); // its read answered
    return w;
  });
}
// P2-B M3: My items draws one row per plugin ("Disabled" when the CLI lists it not enabled here); what the session
// loaded is Show › "Loaded in this session" (installed plugins as their rows, the engine's own and a folder's as plain
// rows), and the loaded line under the head counts them.
const installedRow = (w: Locator, id = PLUGIN) => w.locator(`[data-plugins-section="my-items"] [data-plugin-row="${id}"]`);
// P2-B M5: the marketplaces live in the Add menu's two dialogs, sheets beside the frame under which E8's confirm sheet
// stacks; Browse (its `--available` read on the switch's click, audited as a listing) lists cards, one per plugin.
async function openDialog(w: Locator, item: 'Add marketplace' | 'Manage marketplaces'): Promise<Locator> {
  await w.getByRole('button', { name: 'Add', exact: true }).click();
  await w.page().getByRole('menuitem', { name: item, exact: true }).click();
  const dialog = w.page().locator(`[data-marketplaces-dialog="${item === 'Add marketplace' ? 'add' : 'manage'}"]`);
  await expect(dialog).toBeVisible();
  return dialog;
}
async function closeDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}
const marketplaceRow = (dialog: Locator, name: string) => dialog.locator(`[data-marketplace-row="${name}"]`);
async function marketplaceAction(row: Locator, item: 'Check for updates' | 'Remove…'): Promise<void> {
  await row.getByRole('button', { name: /^More actions for / }).click();
  await row.page().getByRole('menuitem', { name: item, exact: true }).click();
}
async function toMyItems(w: Locator): Promise<void> {
  await w.getByRole('radio', { name: 'My items' }).click();
  await expect(w.locator('[data-plugins-section="my-items"]')).toBeVisible();
}
const disabledBadge = (row: Locator) => row.getByText('Disabled', { exact: true });
// P2-B M4: a row's click opens its detail in place of the list; its switch, Update and overflow (Uninstall…) act at the
// chosen chip's scope, and a change's line sits under the chips (`data-plugin-op` per scope). Back returns to the list.
const detailOf = (w: Locator) => w.locator('[data-plugin-detail]');
async function openDetail(w: Locator, id = PLUGIN): Promise<Locator> {
  if ((await detailOf(w).count()) === 0) {
    await toMyItems(w);
    await installedRow(w, id).click();
  }
  await expect(detailOf(w)).toHaveAttribute('data-plugin-detail', id);
  return detailOf(w);
}
async function backToList(w: Locator): Promise<void> {
  const back = w.getByRole('button', { name: /^Back to / });
  if ((await back.count()) > 0) await back.click();
  await expect(detailOf(w)).toHaveCount(0);
  await toMyItems(w);
}
const opLineOf = (detail: Locator, scope = 'user') => detail.locator(`[data-plugin-op="${scope}"]`);
const enableSwitch = (detail: Locator) => detail.getByRole('switch', { name: 'Enable plugin' });
async function show(w: Locator, filter: 'All plugins' | 'Loaded in this session'): Promise<void> {
  await w.getByRole('button', { name: 'Show' }).click();
  await w.page().getByRole('menuitemradio', { name: filter }).click();
}
// The ids (or, for a plugin the CLI does not list, the names) of what Show › "Loaded in this session" lists; the
// filter is set back to All plugins after.
async function loadedIds(w: Locator): Promise<string[]> {
  await backToList(w);
  await show(w, 'Loaded in this session');
  const items = w.locator('[data-plugins-section="my-items"]');
  const ids = await items.locator('[data-plugin-row], [data-loaded-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-plugin-row') ?? row.getAttribute('data-loaded-row') ?? ''));
  await show(w, 'All plugins');
  return ids;
}
// A Browse card's line: on its card (which, once installed, is the installed plugin's), or above the grid once the
// engine's `--available` stops offering it and nothing installed it.
const browseLine = (w: Locator, id: string) => w.locator(`[data-plugins-section="browse"] [data-browse-card="${id}"], [data-plugins-section="browse"] [data-plugin-result="${id}"]`);
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
// Browse shown (its `plugin list --json --available` read, when it runs, audited as a listing) and one card found by
// Browse's search: the grid is virtualised and the built-in directory alone lists thousands.
async function browseCard(w: Locator, id: string): Promise<Locator> {
  const browse = w.locator('[data-plugins-section="browse"]');
  if ((await browse.count()) === 0) {
    await listing('opening Browse (plugin list --json --available)', async () => {
      await w.getByRole('radio', { name: 'Browse' }).click();
      await expect(browse.locator('[data-browse-card]').first()).toBeVisible({ timeout: 120_000 }); // the catalogue read lists the built-in directory too
    });
  }
  await w.getByRole('searchbox', { name: 'Search plugins' }).fill(id);
  const card = browse.locator(`[data-browse-card="${id}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  return card;
}

// ---- the run ---------------------------------------------------------------------------------------------------

test('E8 live: marketplaces and plugins managed from /plugins and the panel through the engine’s CLI, reflected in the running session', async () => {
  // One launch over a fresh profile: the forwarding script's budget is the whole cap (support/live-budget.ts).
  const engine = await cappedEngine({ root: scratch.root, real: ENGINE_BIN });
  scratch.log(`engine cap: ${capWords(engine)}`);
  const maws = await launchMaws({ env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config } });
  const { page } = maws;
  reads = await trackPluginReads(maws.app); // before the page issues any CLI read
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
  const action = async (spec: { name: string; action: PluginsAction; scope: PluginsScope; source: string | null; fill: Record<string, string>; uninstalls?: PluginsInstallation[]; sheet: string; submit: string; acknowledge?: boolean; line: () => Locator; timeout?: number }, open: () => Promise<void>) => {
    scratch.log(`--- ${spec.action}: ${spec.name}`);
    await untilQuiet(reads, { quietMs: QUIET_MS, timeoutMs: 180_000 }); // the baseline after any earlier read has landed
    const startedAt = Date.now();
    const before = scratch.tree();
    await open();
    const sheet = sheetOf(page, spec.sheet);
    await expect(sheet.locator('[data-plugins-argv]')).toBeVisible({ timeout: 30_000 });
    const argv = await sheet.locator('[data-plugins-argv]').innerText();
    const writes = await sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem').allInnerTexts();
    const then = /Reloads plugins in \d+ running sessions?|No running session to reload|Nothing to reload[^\n]*/.exec(await sheet.innerText())?.[0] ?? null;
    const uninstalls = /Also uninstalls [^\n]*/.exec(await sheet.innerText())?.[0] ?? null;
    scratch.log(`sheet: ${argv}`);
    scratch.log(`sheet writes: ${writes.join(' · ')}`);
    if (uninstalls) scratch.log(`sheet: ${uninstalls}`);
    scratch.log(`sheet then: ${then}`);
    await page.screenshot({ path: join(scratch.root, `live-${String(n).padStart(2, '0')}-${spec.name}-sheet.png`) });
    if (spec.acknowledge) await sheet.getByRole('checkbox', { name: 'I understand' }).check();
    await sheet.getByRole('button', { name: spec.submit, exact: true }).click();
    await expect(sheet).toBeHidden();
    const result = await ended(spec.line(), spec.timeout);
    scratch.log(`row: ${result.text.replaceAll('\n', ' ⏎ ')}${result.failed ? '   [drawn as a failure]' : ''}`);
    scratch.observe(spec.name, { argv, writes, then, uninstalls, row: result });
    scratch.log(`(writesOf ${spec.action}, ${spec.scope}, ${spec.source ?? 'null'}${spec.uninstalls ? `, uninstalling ${spec.uninstalls.map((u) => u.id).join(', ')}` : ''})`);
    await audited(before, startedAt, manifestOf(spec.action, spec.scope, spec.source, spec.fill, spec.uninstalls ?? [], scratch.repo), spec.name);
    return { ...result, uninstalls };
  };

  try {
    scratch.log(`E8 live run · ${new Date().toISOString()} · engine ${ENGINE_VERSION} · CLAUDE_CONFIG_DIR=${scratch.config} · marketplace ${scratch.market} · repository ${scratch.repo}`);
    scratch.log('Every CLI run is audited (test/support/plugins-audit.ts): each mutation (the sheet\'s command and writes, the row\'s words once it ended) and each listing (the widget\'s opening reads, Browse\'s catalogue read). The delta covers the config home (config/…) and the project\'s .claude/ (project/…); a file\'s fingerprint is its size, mtime and content hash, so a same-content rewrite shows. Each path is marked [manifest] when writesOf covers it, else [records (D-12)] (a .claude.json bookkeeping key or a .claude.json backup), [catalogue cache (D-12)], [session files] (by name), [unannounced] (a configuration write outside the manifest, any for a listing: fails) or [unclassified] (fails); .claude.json is judged per changed top-level key.');
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

    await step('plugins', '/plugins lists the engine’s (empty) registry', async () => {
      const w = await openPlugins(page);
      const text = await w.innerText();
      scratch.log(`installed: ${(await w.locator('[data-plugins-section="my-items"]').innerText()).replaceAll('\n', ' · ')}`);
      scratch.log(`loaded line: ${await w.locator('[data-plugins-loaded]').innerText()}`);
      const manage = await openDialog(w, 'Manage marketplaces'); // no read of its own: the opening's listing
      scratch.log(`marketplaces: ${(await manage.innerText()).replaceAll('\n', ' · ')}`);
      await closeDialog(manage);
      scratch.observe('plugins', text);
      await expect(w.locator('footer')).toHaveCount(0); // E11 §2.2: the sheet names the scratch home a change writes
    });

    const addLine = (dialog: Locator) => dialog.locator('[data-marketplace-add-line]');
    await step('add-folder', 'Add › Add marketplace: the scratch folder', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const dialog = await openDialog(w, 'Add marketplace');
      const result = await action({ name: 'add-folder', action: 'marketplace-add', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, sheet: 'marketplace-add', submit: 'Add', line: () => addLine(dialog) }, async () => {
        await dialog.getByRole('textbox', { name: 'Source' }).fill(scratch.market);
        await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      });
      expect(result.text).toBe('Successfully added marketplace: e8-scratch (declared in user settings)');
      await closeDialog(dialog);
      const manage = await openDialog(w, 'Manage marketplaces');
      await expect(marketplaceRow(manage, 'e8-scratch')).toContainText(scratch.market);
      await closeDialog(manage);
    });

    await step('add-repo', `Add marketplace: ${REPO_SOURCE} from GitHub (network-dependent), then Remove…`, async () => {
      const w = page.locator('[data-widget="plugins"]');
      const dialog = await openDialog(w, 'Add marketplace');
      const result = await action({ name: 'add-repo', action: 'marketplace-add', scope: 'user', source: null, fill: { name: 'claude-plugins-official' }, sheet: 'marketplace-add', submit: 'Add', line: () => addLine(dialog), timeout: CLONE_TIMEOUT }, async () => {
        await dialog.getByRole('textbox', { name: 'Source' }).fill(REPO_SOURCE);
        await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      });
      await closeDialog(dialog);
      if (result.failed) {
        // only a refusal by the network is tolerated (the architect's ruling); any other failure is the run's
        expect(result.text, 'a repository-source failure other than a network refusal').toMatch(NETWORK_REFUSAL);
        scratch.log(`the network refused the repository source (${result.text.split(' · ').at(-1)}): recorded; the folder case stays the gate`);
        scratch.observe('add-repo.networkRefusal', result.text);
        return;
      }
      const manage = await openDialog(w, 'Manage marketplaces');
      const row = marketplaceRow(manage, 'claude-plugins-official');
      await expect(row).toContainText(REPO_SOURCE);
      scratch.log(`row: ${(await row.innerText()).replaceAll('\n', ' · ')}`);
      const removed = await action({ name: 'remove-repo', action: 'marketplace-remove', scope: 'user', source: 'github', fill: { name: 'claude-plugins-official' }, sheet: 'marketplace-remove', submit: 'Remove', acknowledge: true, line: () => manage.locator('[data-marketplace-result="claude-plugins-official"]') }, () =>
        marketplaceAction(row, 'Remove…'),
      );
      expect(removed.text).toContain('Successfully removed marketplace: claude-plugins-official');
      await expect(row).toHaveCount(0);
      await closeDialog(manage);
    });

    await step('install', `Install ${PLUGIN} from its Browse card at user scope: reflected, the Loaded list and the panel before any new turn`, async () => {
      const w = page.locator('[data-widget="plugins"]');
      const card = await browseCard(w, PLUGIN);
      const result = await action({ name: 'install', action: 'install', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'install', submit: 'Install', line: () => browseLine(w, PLUGIN) }, () => card.getByRole('button', { name: 'Install', exact: true }).click());
      expect(result.text).toBe('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · Reloaded in 1 session · reflected');
      await expect(card).toHaveAttribute('data-installed', 'here'); // the installed plugin's card keeps the result
      await toMyItems(w);
      await expect(installedRow(w)).toHaveAttribute('data-plugin-scope', 'user');
      await expect(disabledBadge(installedRow(w))).toHaveCount(0);
      await expect.poll(() => loadedIds(w), { timeout: 30_000 }).toContain(PLUGIN);
      const s = await status(page, id);
      scratch.log(`status before any new turn: plugins ${JSON.stringify(s.plugins.map((p) => p.name))}`);
      expect(s.plugins.map((p) => p.name)).toContain('e8-probe');
    });

    await step('panel-reload', 'the panel’s Plugins section: Plugins · N loaded (the built-in ones and e8-probe), Reload plugins, Reload skills', async () => {
      await closeWidgets(page);
      const panel = panelPlugins(page);
      await expect(panel).toContainText(`Plugins · ${builtin + 1} loaded`);
      const mods = panel.getByRole('button', { name: 'Reload plugins' });
      const line = mods.locator('xpath=following-sibling::*[@role="status"]');
      await mods.click();
      await expect(line).toHaveText(new RegExp(`^Reloaded · \\d+ commands · \\d+ agents · ${builtin + 1} plugins · 0 errors$`), { timeout: 60_000 });
      scratch.log(`Reload plugins: ${await line.innerText()}`);
      await shot(`${String(n).padStart(2, '0')}-panel-reload-mods`);
      await panel.getByRole('button', { name: 'Reload skills' }).click();
      await expect(line).toHaveText(/^Reloaded · \d+ skills?$/, { timeout: 60_000 });
      scratch.log(`Reload skills: ${await line.innerText()}`);
      scratch.observe('panel', await panel.innerText());
    });

    await step('refresh', 'Manage marketplaces › Check for updates on e8-scratch', async () => {
      const w = await openPlugins(page);
      const manage = await openDialog(w, 'Manage marketplaces');
      const row = marketplaceRow(manage, 'e8-scratch');
      const result = await action({ name: 'refresh', action: 'marketplace-update', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, sheet: 'marketplace-update', submit: 'Refresh', line: () => row }, () => marketplaceAction(row, 'Check for updates'));
      expect(result.text).toContain('Successfully updated marketplace: e8-scratch');
      expect(result.failed).toBe(false);
      await closeDialog(manage);
    });

    await step('update', 'plugin.json rewritten to 0.2.0, then Update: 0.1.0 → 0.2.0', async () => {
      scratch.setPluginVersion('0.2.0');
      const w = page.locator('[data-widget="plugins"]');
      const detail = await openDetail(w);
      const result = await action({ name: 'update', action: 'update', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'update', submit: 'Update', line: () => opLineOf(detail) }, () => detail.getByRole('button', { name: 'Update', exact: true }).click());
      expect(result.text).toContain('0.1.0 → 0.2.0');
      await expect(detail.locator('h3 + p')).toContainText('0.2.0');
      await backToList(w);
      await expect(installedRow(w)).toContainText('0.2.0');
      scratch.log(`loaded after the update's reload: ${(await loadedIds(w)).join(' · ')}`);
    });

    // P2-B M6: the skills library: e8-probe's skill under its plugin's group (user scope, an added marketplace), named
    // after `e8-probe:` with the plugin's name as its badge
    await step('skills', '/skills after the next turn lists e8-probe:e8-hello under its plugin’s group, badged E8 probe', async () => {
      await send(page, 'Reply with exactly: E8 LIVE SKILLS');
      await idle(page, id);
      const w = await openWidget(page, 'skills');
      const hello = w.locator('[data-skills-group="added"] [data-skill-row="e8-probe:e8-hello"]');
      await expect(hello).toBeVisible({ timeout: 30_000 });
      await expect(hello.locator('[data-skill-name]')).toHaveText('e8-hello');
      await expect(hello.locator('[data-skill-badge]')).toHaveText('E8 probe');
      const skills = await w.locator('[data-skills-group]').evaluateAll((groups) => groups.map((g) => `${g.getAttribute('data-skills-group')}: ${Array.from(g.querySelectorAll('[data-skill-row]'), (r) => r.getAttribute('data-skill-row')).join(', ')}`));
      scratch.log(`skills: ${skills.join(' · ')}`);
      scratch.observe('skills', skills);
    });

    await step('disable', 'the detail’s switch: disable; the Loaded list loses e8-probe', async () => {
      const w = await openPlugins(page);
      const detail = await openDetail(w);
      const result = await action({ name: 'disable', action: 'disable', scope: 'user', source: null, fill: {}, sheet: 'disable', submit: 'Disable', line: () => opLineOf(detail) }, () => enableSwitch(detail).click());
      expect(result.text).toBe('Successfully disabled plugin: e8-probe (scope: user) · Reloaded in 1 session · reflected');
      await expect(enableSwitch(detail)).toHaveAttribute('aria-checked', 'false');
      await backToList(w);
      await expect(disabledBadge(installedRow(w))).toBeVisible();
      await expect.poll(() => loadedIds(w), { timeout: 30_000 }).not.toContain(PLUGIN);
    });

    await step('enable', 'the detail’s switch: enable; the Loaded list regains e8-probe', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const detail = await openDetail(w);
      const result = await action({ name: 'enable', action: 'enable', scope: 'user', source: null, fill: {}, sheet: 'enable', submit: 'Enable', line: () => opLineOf(detail) }, () => enableSwitch(detail).click());
      expect(result.text).toBe('Successfully enabled plugin: e8-probe (scope: user) · Reloaded in 1 session · reflected');
      await expect(enableSwitch(detail)).toHaveAttribute('aria-checked', 'true');
      await backToList(w);
      await expect(disabledBadge(installedRow(w))).toHaveCount(0);
      await expect.poll(() => loadedIds(w), { timeout: 30_000 }).toContain(PLUGIN);
    });

    await step('uninstall', 'the detail’s Uninstall…: the plugin leaves, the detail returns to the list, the result stays; the Loaded list loses e8-probe', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const detail = await openDetail(w);
      const result = await action({ name: 'uninstall', action: 'uninstall', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'uninstall', submit: 'Uninstall', acknowledge: true, line: () => w.locator(`[data-plugins-section="my-items"] [data-plugin-result="${PLUGIN}"]`) }, async () => {
        await detail.getByRole('button', { name: /^More actions for / }).click();
        await page.getByRole('menuitem', { name: 'Uninstall…', exact: true }).click();
      });
      expect(result.text).toBe('Successfully uninstalled plugin: e8-probe (scope: user) · Reloaded in 1 session · reflected');
      await expect(detail).toHaveCount(0);
      await expect(installedRow(w)).toHaveCount(0);
      await expect.poll(() => loadedIds(w), { timeout: 30_000 }).not.toContain(PLUGIN);
    });

    await step('offer-nope', 'the marketplace offers `nope`: Check for updates reads it in, and Browse lists it', async () => {
      const w = page.locator('[data-widget="plugins"]');
      scratch.offerNope(true);
      const manage = await openDialog(w, 'Manage marketplaces');
      const market = marketplaceRow(manage, 'e8-scratch');
      const result = await action({ name: 'offer-nope-refresh', action: 'marketplace-update', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, sheet: 'marketplace-update', submit: 'Refresh', line: () => market }, () =>
        marketplaceAction(market, 'Check for updates'),
      );
      expect(result.text).toContain('Successfully updated marketplace: e8-scratch');
      await closeDialog(manage);
      await browseCard(w, 'nope@e8-scratch');
    });

    await step('error', 'install nope@e8-scratch after its marketplace withdrew it: the engine’s words and code', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const card = await browseCard(w, 'nope@e8-scratch');
      // the marketplace withdraws it, and the owner installs from the cards they read
      scratch.offerNope(false);
      const result = await action({ name: 'error', action: 'install', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'nope', id: 'nope@e8-scratch' }, sheet: 'install', submit: 'Install', line: () => browseLine(w, 'nope@e8-scratch') }, () =>
        card.getByRole('button', { name: 'Install', exact: true }).click(),
      );
      expect(result.failed).toBe(true);
      expect(result.text).toBe(NOT_FOUND);
      scratch.observe('error.code', result.text.split(' · ').at(-1));
    });

    await step('reinstall', `Install ${PLUGIN} again, so the marketplace is removed with a plugin still installed`, async () => {
      const w = page.locator('[data-widget="plugins"]');
      const card = await browseCard(w, PLUGIN);
      const result = await action({ name: 'reinstall', action: 'install', scope: 'user', source: null, fill: { marketplace: 'e8-scratch', plugin: 'e8-probe', id: PLUGIN }, sheet: 'install', submit: 'Install', line: () => browseLine(w, PLUGIN) }, () => card.getByRole('button', { name: 'Install', exact: true }).click());
      expect(result.text).toBe('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · Reloaded in 1 session · reflected');
      await toMyItems(w);
      await expect(installedRow(w)).toHaveAttribute('data-plugin-scope', 'user');
      await expect(disabledBadge(installedRow(w))).toHaveCount(0);
    });

    await step('remove-folder', 'Remove… e8-scratch with e8-probe installed: the sheet names the uninstall; the marketplace and the plugin leave; its result stays', async () => {
      const w = page.locator('[data-widget="plugins"]');
      const manage = await openDialog(w, 'Manage marketplaces');
      const row = marketplaceRow(manage, 'e8-scratch');
      const uninstalls = [{ id: PLUGIN, scope: 'user', projectPath: null }];
      const result = await action({ name: 'remove-folder', action: 'marketplace-remove', scope: 'user', source: 'directory', fill: { name: 'e8-scratch' }, uninstalls, sheet: 'marketplace-remove', submit: 'Remove', acknowledge: true, line: () => manage.locator('[data-marketplace-result="e8-scratch"]') }, () =>
        marketplaceAction(row, 'Remove…'),
      );
      expect(result.uninstalls).toBe(`Also uninstalls 1 plugin: ${PLUGIN} (user)`);
      expect(result.text).toContain('Successfully removed marketplace: e8-scratch');
      await expect(row).toHaveCount(0);
      await expect(manage).toContainText('No marketplaces added yet.');
      await closeDialog(manage);
      await expect(installedRow(w)).toHaveCount(0); // the engine uninstalled it with its marketplace
      await expect.poll(() => loadedIds(w), { timeout: 30_000 }).not.toContain(PLUGIN); // and the reload after the removal dropped it
      scratch.log(`loaded after the removal's reload: ${(await loadedIds(w)).join(' · ')}`);
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
