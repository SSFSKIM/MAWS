// C11's widgets end to end (C11 execution document, Acceptance item 2), on the harness's `#widgets` page; the page needs
// a harness build (`pnpm e2e:widgets` builds one and runs this file; under a plain build the cases skip). Two groups.
// Interactive: C7's composer over a scenario session (C5's `nine-sessions`), every read answered in main by the
// fixture-backed widget backend (MAWS_WIDGET_BACKEND=fixtures) from the probe's recorded answers, whatever the order;
// the cases type `/` in the composer, open widgets, and read the backend's call log in main for the payloads the
// widgets' own interactions produced. Replay conformance: C3's strict replay behind a launched session, the widgets
// mounted passively, and a scripted driver issuing exactly the fixture's recorded frames in order through
// `window.__maws_widgets.read` (the widgets' own query under their own keys) and `window.maws.invoke`; the replay ends
// on any unrecorded write, so its reaching the fixture's `meta exit` is the proof nothing else was written.
// M2 holds the read half of the interactive group and the `reads.jsonl` case; M3 the mutating half and
// `auto-routed-controls`.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { OperationEvent } from '@shared/engine/operations';
import type { WidgetsHarnessApi, WidgetsPane } from '../src/renderer/src/harness/widgets/api';
import type { WidgetBackend } from '../test/support/widget-backend';
import { ownerShapedState, scratchMarketplace, stubCalls, writePluginCliStub, type PluginCliStub, type StubState } from '../test/support/plugin-cli-stub';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

const SCENARIO = 'stub:test/fixtures/shell/nine-sessions.json';
const READY = 'app-7412a115'; // ready, idle, routed through the relay
const READS = 'spikes/protocol-probe/fixtures/reads.jsonl';
const CONTROLS = 'test/fixtures/engine/auto-routed-controls.jsonl'; // pass2/auto-routed without the unissuable fork_conversation pair
const NAMES = ['model', 'effort', 'fast', 'permissions', 'usage', 'config', 'plugins', 'mcp', 'sandbox', 'hooks', 'memory', 'skills', 'agents', 'status', 'compact', 'context', 'rename', 'resume', 'export', 'diff', 'rewind' /* W3 */, 'btw' /* E3 */, 'reload-plugins' /* E11 §2.2: the engine's terminal-only command as MAWS's action */];

// E8 (M3): `/plugins` reads the engine's CLI through the engine host, which runs MAWS_E2E_ENGINE_BIN; under the widget
// backend that is the plugin CLI stub (test/support/plugin-cli-stub.ts) over this starting state: one folder
// marketplace offering three plugins, one of them installed for the user. The CLI runs in the session's directory, which
// the scenario's record names on a machine long gone, so the cases that open `/plugins` point the session's status at a
// scratch project first (`inProject`).
const MARKET = 'e8-scratch';
const MARKET_PLUGINS = [
  { name: 'e8-probe', version: '0.1.0', description: 'One skill and one command, for the probe' },
  { name: 'e8-extra', version: '0.3.0', description: 'A second plugin of the scratch marketplace' },
  { name: 'e8-tools', version: '1.0.0', description: 'An installed plugin of the scratch marketplace' },
];
const stubStart = (market: string): StubState => ({
  marketplaces: [{ name: MARKET, source: 'directory', path: market, plugins: MARKET_PLUGINS }],
  installed: [{ id: `e8-tools@${MARKET}`, version: '1.0.0', scope: 'user', enabled: true, projectPath: null }],
  fail: {},
});

type BackendLaunch = MawsLaunch & { cli: PluginCliStub; project: string };

// The scenario launch with the widget backend and the CLI stub: the harness's window (`harness: '1'`, the widgets page),
// or the product's (`'0'`, for the panel's summary), from the same harness build.
async function withBackend(harness: '0' | '1', use: (maws: BackendLaunch) => Promise<void>): Promise<void> {
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-e2e-')));
  const project = join(userData, 'project');
  mkdirSync(project);
  const cli = writePluginCliStub(userData, stubStart(scratchMarketplace(join(userData, 'market'), { name: MARKET, plugins: MARKET_PLUGINS })));
  try {
    const maws = await launchMaws({ userData, env: { MAWS_HARNESS: harness, MAWS_SESSION_SOURCE: SCENARIO, MAWS_SCENARIO_CLOCK: 'manual', MAWS_WIDGET_BACKEND: 'fixtures', MAWS_E2E_ENGINE_BIN: cli.bin } });
    try {
      await use(Object.assign(maws, { cli, project }));
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
}

const test = base.extend<{ backend: BackendLaunch; appBackend: BackendLaunch; replay: MawsLaunch }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  backend: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the widgets page needs a harness build (pnpm e2e:widgets)');
    await withBackend('1', use);
  },
  // eslint-disable-next-line no-empty-pattern -- as above
  appBackend: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the widgets group runs on a harness build (pnpm e2e:widgets)');
    await withBackend('0', use);
  },
  // eslint-disable-next-line no-empty-pattern -- as above
  replay: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the widgets page needs a harness build (pnpm e2e:widgets)');
    const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_ENGINE_REPLAY: '1' } });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
  },
});

type WidgetsWindow = Window & { __maws_widgets: WidgetsHarnessApi; __c11: { batches: { appSessionId: string; events: SessionEvent[] }[]; operations: OperationEvent[] } };

async function openPage(page: Page, pane: WidgetsPane): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Partial<WidgetsWindow>;
    if (!w.__c11) {
      const log = { batches: [] as unknown[], operations: [] as unknown[] };
      w.__c11 = log as WidgetsWindow['__c11'];
      window.maws.on('session.eventBatch', (payload) => log.batches.push(payload));
      window.maws.on('session.operation', (payload) => log.operations.push(payload));
    }
    location.hash = 'widgets';
  });
  await page.waitForFunction(() => (window as unknown as Partial<WidgetsWindow>).__maws_widgets !== undefined);
  await page.evaluate((p) => (window as unknown as WidgetsWindow).__maws_widgets.show(p), pane);
}

const widget = (page: Page, name: string): Locator => page.locator(`[data-widget="${name}"]`);
// The value beside a key of a widget's key/value list.
const valueOf = (scope: Locator, label: string): Locator => scope.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
const pick = (page: Page, name: string) => page.evaluate((n) => (window as unknown as WidgetsWindow).__maws_widgets.open(n), name);
const calls = (maws: MawsLaunch) => maws.app.evaluate(() => (globalThis as unknown as { __maws_widget_backend: WidgetBackend }).__maws_widget_backend.calls.map((c) => ({ subtype: c.subtype, input: c.input })));
// M3: the log with each call's X2 command (a prompt and a rename are no controls of the table), and the backend's handle.
const commandsOf = (maws: MawsLaunch) => maws.app.evaluate(() => (globalThis as unknown as { __maws_widget_backend: WidgetBackend }).__maws_widget_backend.calls.map((c) => ({ command: c.command, input: c.input })));
type BackendGlobal = { __maws_widget_backend: WidgetBackend };
const holdOperations = (maws: MawsLaunch, held: boolean) => maws.app.evaluate((_, on) => (globalThis as unknown as BackendGlobal).__maws_widget_backend.holdOperations(on), held);
const settleOperations = (maws: MawsLaunch) => maws.app.evaluate(() => (globalThis as unknown as BackendGlobal).__maws_widget_backend.settleOperations());
const typeCommand = async (page: Page, text: string) => {
  await page.getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.type(text); // the space after the name closes the palette
  await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
  await page.keyboard.press('Enter'); // the line's widget opens with its argument
};

// ---- E8: plugin management over the CLI stub ------------------------------------------------------------------------

// The session's status pointed at the scratch project, so the CLI the host runs has a directory to run in.
const inProject = (maws: BackendLaunch) =>
  maws.app.evaluate((_, [id, cwd]) => void (globalThis as unknown as BackendGlobal).__maws_widget_backend.emitStatus(id as never, { cwd }), [READY, maws.project] as const);
async function openPlugins(maws: BackendLaunch): Promise<Locator> {
  await openPage(maws.page, { appSessionId: READY, mode: 'interactive' });
  await inProject(maws);
  await pick(maws.page, 'plugins');
  const w = widget(maws.page, 'plugins');
  await expect(w.locator('[data-plugins-section="my-items"]')).toBeVisible(); // P2-B M3: the library's My items
  return w;
}
const configHome = (maws: MawsLaunch) => join(maws.userData, 'claude-config');
// The stub's calls that changed something (no listing), each argv after the binary.
const mutations = (maws: BackendLaunch) => stubCalls(maws.cli).filter((argv) => argv[0] === 'plugin' && !argv.includes('list'));
// The stub's whole calls.log once no read is still landing in it (the same for half a second).
async function settledLog(maws: BackendLaunch): Promise<string> {
  const text = () => (existsSync(maws.cli.callsLog) ? readFileSync(maws.cli.callsLog, 'utf8') : '');
  let last = text();
  await expect
    .poll(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const now = text();
      const same = now === last;
      last = now;
      return same;
    }, { timeout: 15_000 })
    .toBe(true);
  return last;
}
// P2-B M3: My items draws one row per plugin, at its representative installation's scope (`data-plugin-scope`); "Disabled"
// when the CLI lists it not enabled here; its changes in the row's overflow (Turn on or off, Update, Uninstall…).
const installedRow = (w: Locator, id: string, scope = 'user') => w.locator(`[data-plugins-section="my-items"] [data-plugin-row="${id}"][data-plugin-scope="${scope}"]`);
async function expectListed(w: Locator, id: string, scope = 'user', enabled = true): Promise<void> {
  const row = installedRow(w, id, scope);
  await expect(row).toBeVisible();
  await expect(row.getByText('Disabled', { exact: true })).toHaveCount(enabled ? 0 : 1);
}
async function rowAction(row: Locator, item: string): Promise<void> {
  await row.getByRole('button', { name: /^More actions for / }).click();
  await row.page().getByRole('menuitem', { name: item, exact: true }).click();
}
// The overflow's items, the menu closed again by Escape (which closes only the menu: the widget stays).
async function rowActions(row: Locator): Promise<string[]> {
  await row.getByRole('button', { name: /^More actions for / }).click();
  const items = await row.page().getByRole('menuitem').allInnerTexts();
  await row.page().keyboard.press('Escape');
  await expect(row.page().getByRole('menuitem')).toHaveCount(0);
  await expect(row).toBeVisible();
  return items;
}
// P2-B M4: a row's click opens its detail in place of the list (Back returns to it); the detail's switch, Update and
// overflow (Uninstall…) act at the chosen scope chip's scope; a change's line sits under the chips, per scope.
const detailOf = (w: Locator) => w.locator('[data-plugin-detail]');
async function openDetail(w: Locator, id: string, scope = 'user'): Promise<Locator> {
  await installedRow(w, id, scope).click();
  await expect(detailOf(w)).toHaveAttribute('data-plugin-detail', id);
  return detailOf(w);
}
const opLineOf = (detail: Locator, scope = 'user') => detail.locator(`[data-plugin-op="${scope}"]`).getByRole('status');
const enableSwitch = (detail: Locator) => detail.getByRole('switch', { name: 'Enable plugin' });
async function detailUninstall(detail: Locator): Promise<void> {
  await detail.getByRole('button', { name: /^More actions for / }).click();
  await detail.page().getByRole('menuitem', { name: 'Uninstall…', exact: true }).click();
}
const sheetOf = (page: Page, action: string) => page.locator(`[data-plugins-sheet="${action}"]`);
const argvOf = async (sheet: Locator) => JSON.parse((await sheet.locator('[data-plugins-argv]').getAttribute('data-plugins-argv')) ?? 'null') as string[];
// A row's own status line (the widget holds several).
const lineOf = (row: Locator) => row.getByRole('status');
// P2-B M5: Browse (its `--available` read on the switch's click), its cards and their detail; the Add menu's two
// marketplace dialogs, sheets beside the frame under which E8's confirm sheet stacks.
const browseOf = (w: Locator) => w.locator('[data-plugins-section="browse"]');
async function openBrowse(w: Locator): Promise<Locator> {
  await w.getByRole('radio', { name: 'Browse' }).click();
  await expect(browseOf(w).locator('[data-browse-card]').first()).toBeVisible();
  return browseOf(w);
}
async function toMyItems(w: Locator): Promise<void> {
  await w.getByRole('radio', { name: 'My items' }).click();
  await expect(w.locator('[data-plugins-section="my-items"]')).toBeVisible();
}
const cardOf = (w: Locator, id: string) => browseOf(w).locator(`[data-browse-card="${id}"]`);
const browseDetailOf = (w: Locator) => w.locator('[data-browse-detail]');
// A card's click opens its detail (here on its description: Install keeps its own click).
async function openCard(w: Locator, id: string): Promise<Locator> {
  await cardOf(w, id).locator('p').first().click();
  await expect(browseDetailOf(w)).toHaveAttribute('data-browse-detail', id);
  return browseDetailOf(w);
}
// An install whose card the next read no longer offers keeps its result above the grid.
const browseResult = (w: Locator, id: string) => lineOf(browseOf(w).locator(`[data-plugin-result="${id}"]`));
async function openAdd(w: Locator, item: 'Add marketplace' | 'Manage marketplaces'): Promise<Locator> {
  await w.getByRole('button', { name: 'Add', exact: true }).click();
  await w.page().getByRole('menuitem', { name: item, exact: true }).click();
  const dialog = w.page().locator(`[data-marketplaces-dialog="${item === 'Add marketplace' ? 'add' : 'manage'}"]`);
  await expect(dialog).toBeVisible();
  return dialog;
}
const marketplaceRow = (dialog: Locator, name: string) => dialog.locator(`[data-marketplace-row="${name}"]`);
async function marketplaceAction(row: Locator, item: 'Check for updates' | 'Remove…'): Promise<void> {
  await row.getByRole('button', { name: /^More actions for / }).click();
  await row.page().getByRole('menuitem', { name: item, exact: true }).click();
}

test.describe('interactive', () => {
  test('every name opens a widget from the palette, none listed as unavailable', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await inProject(backend); // E8: /plugins reads the CLI stub in the session's directory
    const message = page.getByRole('textbox', { name: 'Message' });
    await expect(message).toBeVisible();
    const commands = page.getByRole('listbox', { name: 'Commands' });
    const chosen = commands.locator('[role="option"][aria-selected="true"]');
    for (const name of NAMES) {
      await message.click();
      await page.keyboard.type(`/${name}`);
      await expect(chosen, name).toContainText(`/${name}`);
      await expect(chosen, name).not.toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Enter');
      if (name === 'model' || name === 'effort' || name === 'fast') {
        // W3: the model selector, in the toolbar model chip's menu, on the view its name opens; a menu, so no frame or foot
        await expect(widget(page, name)).toBeVisible();
        await expect(widget(page, name)).toHaveAttribute('data-model-selector', name === 'model' ? 'model' : 'effort');
        await expect(page.getByRole('dialog', { name: 'Model and effort' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(widget(page, name)).toBeHidden();
        continue;
      }
      if (name === 'rename') {
        // no title: C10's rename dialog (the session action C10 registers), not a widget of C11's
        const dialog = page.getByRole('dialog', { name: 'Rename' });
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        continue;
      }
      // W3 (C6, charter §5.4 as amended 2026-10-01): a floating dialog centred over the window, never in the composer's box
      const dialog = page.locator(`[data-widget-dialog="${name}"]`);
      await expect(dialog.locator(`[data-widget="${name}"]`)).toBeVisible();
      await expect(page.locator('[data-composer]').locator('[data-widget]')).toHaveCount(0);
      await expect(widget(page, name).locator('footer')).toHaveCount(0); // E11 §2.2: no provenance foot
      if (name === NAMES.find((n) => !['model', 'effort', 'fast', 'rename'].includes(n))) {
        const box = await dialog.boundingBox();
        const view = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
        expect(Math.abs(box!.x + box!.width / 2 - view.width / 2)).toBeLessThanOrEqual(2); // centred
        expect(Math.abs(box!.y + box!.height / 2 - view.height / 2)).toBeLessThanOrEqual(2);
      }
      await page.keyboard.press('Escape'); // the frame took focus when it opened
      await expect(widget(page, name)).toBeHidden();
      await expect(message).toBeFocused(); // the keyboard back in the composer
    }
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('reads render their fixtures and issue their intended payloads', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();

    await pick(page, 'status'); // pass2/auto-routed seq 145
    const status = widget(page, 'status');
    await expect(valueOf(status.getByRole('region', { name: 'Session' }), 'Anthropic base URL')).toHaveText('http://127.0.0.1:8641');
    await expect(valueOf(status.getByRole('region', { name: 'Environment' }), 'Auto mode server')).toHaveText('Enabled');

    await pick(page, 'context'); // reads.jsonl seq 57
    const context = widget(page, 'context');
    await expect(context).toContainText('30,433 of 200,000 · 15% · autocompact at 167,000');
    await expect(context.getByRole('table', { name: 'Context categories' }).getByRole('row')).toHaveCount(6);
    await expect(context.getByRole('table', { name: 'Context categories' }).getByRole('row').last()).toContainText('Free space');

    await pick(page, 'hooks'); // pass2/hooks.jsonl seq 46
    const hooks = widget(page, 'hooks');
    await expect(hooks.getByRole('list', { name: 'PostToolUse hooks' }).getByRole('listitem')).toHaveCount(1);
    await expect(hooks).toContainText('Startup settings (--settings option)');
    await expect(hooks).toContainText('echo MAWS_POSTHOOK');

    await pick(page, 'memory'); // reads.jsonl seq 69
    const memory = widget(page, 'memory');
    const files = memory.getByRole('list', { name: 'Memory files' }).getByRole('listitem');
    await expect(files).toHaveCount(2);
    await expect(files.nth(0)).toContainText('User instructions');
    await expect(files.nth(0).getByRole('button', { name: 'Reveal' })).toBeVisible();
    await expect(files.nth(1)).toContainText('Project instructions');
    await expect(files.nth(1)).toContainText('does not exist yet');

    await pick(page, 'sandbox'); // reads.jsonl seq 75
    await expect(widget(page, 'sandbox')).toContainText('Sandbox off'); // E11 §2.2: the first read in words

    await pick(page, 'diff'); // reads.jsonl seq 81
    await expect(widget(page, 'diff')).toContainText('0 files · +0 −0 · working tree');

    await pick(page, 'mcp'); // pass2/real-settings.jsonl seq 63
    const servers = widget(page, 'mcp').getByRole('list', { name: 'MCP servers' }).getByRole('listitem');
    await expect(servers).toHaveCount(3);
    await expect(servers.nth(0)).toContainText('stdio · …/ptc-launch');
    await expect(servers.nth(2)).toContainText('http · https://developers.openai.com/mcp');
    for (let i = 0; i < 3; i++) await expect(servers.nth(i)).toContainText('connected');

    await inProject(backend); // E8: the frame follows `plugins.list`, the CLI stub's, run in the session's directory
    await pick(page, 'plugins'); // pass2/real-settings.jsonl seq 15, from the status
    // P2-B M3: the loaded line counts them; its count shows them (Show › Loaded in this session)
    await widget(page, 'plugins').getByRole('button', { name: '11 plugins loaded in this session' }).click();
    await expect(widget(page, 'plugins').getByRole('list', { name: 'Loaded plugins' }).getByRole('listitem')).toHaveCount(11);
    await widget(page, 'plugins').getByRole('button', { name: 'Show' }).click();
    await page.getByRole('menuitemradio', { name: 'All plugins' }).click();

    await pick(page, 'permissions'); // pass2/grant-askrule-start.jsonl seq 65
    const permissions = widget(page, 'permissions');
    await expect(permissions.getByRole('list', { name: 'Allow rules' })).toContainText('Bash(git log --oneline)');
    await expect(permissions.getByRole('list', { name: 'Allow rules' })).toContainText('this session · grant');
    await expect(permissions.getByRole('list', { name: 'Ask rules' })).toContainText('startup settings');

    await pick(page, 'usage'); // reads.jsonl seq 54; no ClaudeUsage data under the e2e launch
    const usage = widget(page, 'usage');
    await expect(usage).toContainText('rate_limits_available: false');
    await expect(usage).toContainText('$0.0208');
    await expect(usage).toContainText('ClaudeUsage is not installed or has no data');

    await pick(page, 'config'); // pass2/dialogs.jsonl seq 58
    await expect(widget(page, 'config')).toContainText('dialogExpiry');

    const log = await calls(backend);
    expect(log).toContainEqual({ subtype: 'get_context_usage', input: { appSessionId: READY, detail: 'full' } });
    expect(log).toContainEqual({ subtype: 'list_permission_rules', input: { appSessionId: READY } });
    expect(log.filter((c) => c.subtype === 'get_status')).toHaveLength(1); // fresh for 10 s: one read, however often shown
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('export offers the engine’s filename and Save as… writes its text', async ({ backend }) => {
    const { page, app } = backend;
    const dir = mkdtempSync(join(tmpdir(), 'maws-c11-export-'));
    try {
      const target = join(dir, 'export.txt');
      await app.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
      }, target);
      await openPage(page, { appSessionId: READY, mode: 'interactive' });
      await pick(page, 'export'); // reads.jsonl seq 84
      const exported = widget(page, 'export');
      await expect(exported).toContainText('2026-09-28-022217-reply-with-exactly-ok.txt');
      await exported.getByRole('button', { name: 'Save as…' }).click();
      await expect(exported.getByRole('status')).toHaveText(`Saved to ${target}`);
      const text = readFileSync(target, 'utf8');
      expect(text.split('\n').find((l) => l.trim() !== '')).toBe('❯ Reply with exactly OK');
      expect(text).toBe('\n❯ Reply with exactly OK\n\n  Thought for 1s (ctrl+o to expand)\n\n⏺ OK'); // the engine's text, as written
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('agents and skills list the catalogue and insert at the caret', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    const message = page.getByRole('textbox', { name: 'Message' });
    await expect(message).toBeVisible();

    await pick(page, 'agents'); // pass2/auto-routed.jsonl seq 4
    const agents = widget(page, 'agents').getByRole('list', { name: 'Agents' }).getByRole('listitem');
    await expect(agents).toHaveCount(5);
    await agents.filter({ hasText: 'Explore' }).getByRole('button', { name: 'Mention' }).click();
    await expect(widget(page, 'agents')).toBeHidden();
    await expect(message).toContainText('@agent-Explore');

    await pick(page, 'skills'); // an empty get_skills_dialog (reads.jsonl seq 72): the catalogue's skills (seq 9), in one list
    const skills = widget(page, 'skills').getByRole('list', { name: 'Skills' }).getByRole('listitem');
    await expect(skills).toHaveCount(18);
    await widget(page, 'skills').locator('[data-skill-row="deep-research"]').getByRole('button', { name: 'Use in chat' }).click(); // P2-B M6
    await expect(widget(page, 'skills')).toBeHidden();
    await expect(message).toContainText('/deep-research');
    expect(backend.consoleErrors()).toEqual([]);
  });

  // ---- M3: the mutating half ----------------------------------------------------------------------------------------

  // W3 (C4, charter §5.4 as amended 2026-10-01): the chip reads `<alias> <effort>` with the effort get_settings applied
  // (pass2/dialogs seq 58: high), and opens Codex's selector above itself: the effort view first, then the model list
  test('the model chip says sonnet high and opens the selector: effort first, the list with Default, a pick applies at once, fast after its warning', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    const chip = page.getByRole('button', { name: /^Model / });
    await expect(chip).toHaveAttribute('aria-label', 'Model sonnet high');
    await chip.click();
    const menu = page.getByRole('dialog', { name: 'Model and effort' });
    const selector = menu.locator('[data-model-selector]');
    await expect(selector).toHaveAttribute('data-model-selector', 'effort');
    await expect(selector.locator('[data-effort-title]')).toHaveText('High');
    const box = await menu.boundingBox();
    expect(box?.width).toBe(254); // Codex's menu
    const chipBox = await chip.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(chipBox!.y); // anchored above the chip

    await selector.getByRole('button', { name: 'Sonnet 5 · Select model' }).click();
    await expect(selector).toHaveAttribute('data-model-selector', 'model');
    const list = selector.getByRole('menu', { name: 'Models' });
    await expect(list.getByRole('group', { name: 'Claude models' }).getByRole('menuitemradio')).toHaveCount(4); // pass2/auto-routed seq 143, `default` as the entry above
    await expect(list.getByRole('group', { name: 'Gateway models' }).getByRole('menuitemradio')).toHaveCount(7);
    await expect(list.getByRole('menuitemradio', { name: /^Default/ })).toContainText('DefaultRecommended set of models');
    await expect(list.getByRole('menuitemradio', { name: /^Sonnet 5/ })).toHaveAttribute('aria-checked', 'true');
    await expect(list.getByRole('menuitemradio', { name: /^Haiku/ })).toContainText('Cannot hold auto mode');
    await expect(list.getByRole('menuitemradio', { name: /^astra/ })).toContainText('From gateway');
    await expect(menu).not.toContainText(/Default model|Default \(recommended\)|Engine default/);

    await list.getByRole('menuitemradio', { name: /^Opus/ }).click(); // applies at once and returns to the effort view
    await expect(selector).toHaveAttribute('data-model-selector', 'effort');
    await expect.poll(async () => (await calls(backend)).filter((c) => c.subtype === 'set_model')).toEqual([{ subtype: 'set_model', input: { appSessionId: READY, model: 'opus' } }]);
    const fast = selector.getByRole('switch', { name: 'Fast mode' });
    await expect(fast).toBeEnabled(); // opus has fast mode
    await fast.click();
    await expect(selector).toContainText('Fast mode disables the auto-mode server lane: reviews then run locally on Sonnet 5 and count against usage');
    expect((await calls(backend)).filter((c) => c.subtype === 'apply_flag_settings')).toEqual([]); // nothing before the answer
    await selector.getByRole('button', { name: 'Turn on fast mode' }).click();
    await expect.poll(async () => (await calls(backend)).filter((c) => c.subtype === 'apply_flag_settings')).toEqual([{ subtype: 'apply_flag_settings', input: { appSessionId: READY, settings: { fastMode: true } } }]);

    await expect(selector.locator('[data-effort-title]')).toHaveText('High'); // get_settings read again after the model changed
    await selector.getByRole('slider', { name: 'Effort' }).press('ArrowRight'); // the slider writes the effort for this session
    await expect.poll(async () => (await commandsOf(backend)).filter((c) => c.command === 'session.setEffort').map((c) => c.input)).toEqual([{ appSessionId: READY, effort: 'xhigh' }]);

    await selector.getByRole('button', { name: /Select model$/ }).click();
    await list.getByRole('menuitemradio', { name: /^astra/ }).click(); // the session is in auto
    await expect(selector.getByRole('note')).toContainText('Auto-mode reviews for this model run locally. A GPT route carries no Anthropic verdict');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused(); // the keyboard goes back to the editor
    const log = await calls(backend);
    expect(log.filter((c) => c.subtype === 'list_models')).toHaveLength(1);
    expect(backend.consoleErrors()).toEqual([]);
  });

  // The architect's correction (2026-09-29): a typed argument that resolves applies at Enter through the widget's own
  // control, the outcome a toast in its words; one that does not, or whose widget asks first, opens the widget with it.
  test('arguments: a resolved /model, /fast off, /effort and /permissions apply at Enter; the rest open their widget with the argument', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    const inputsOf = async (command: string) => (await commandsOf(backend)).filter((c) => c.command === command).map((c) => c.input);
    const noWidget = () => expect(page.locator('[data-widget]')).toHaveCount(0);
    // Toasts by exact text: Radix's transient live-region announcement reads `Notification <text>` and would match too.

    await typeCommand(page, '/model opus');
    await expect(page.getByText('Model · Opus 5.5 (1M context) · set · the next init frame confirms it', { exact: true })).toBeVisible();
    await noWidget();
    expect(await inputsOf('session.setModel')).toEqual([{ appSessionId: READY, model: 'opus' }]);

    await typeCommand(page, '/fast off');
    await expect(page.getByText('Fast mode · off · set · the next init frame confirms it', { exact: true })).toBeVisible();
    await noWidget();
    expect(await inputsOf('session.applyFlagSettings')).toEqual([{ appSessionId: READY, settings: { fastMode: false } }]);

    await typeCommand(page, '/fast on'); // its lane warning is the confirmation, so the widget opens with it
    await expect(widget(page, 'fast')).toContainText('Fast mode disables the auto-mode server lane');
    await page.keyboard.press('Escape');

    await typeCommand(page, '/effort high');
    await expect(page.getByText('Effort · high · set · the next init frame confirms it', { exact: true })).toBeVisible();
    await noWidget();
    expect(await inputsOf('session.setEffort')).toEqual([{ appSessionId: READY, effort: 'high' }]);

    await typeCommand(page, '/effort extreme'); // no such level
    await expect(widget(page, 'effort')).toBeVisible();
    await page.keyboard.press('Escape');

    await typeCommand(page, '/model claude/astra'); // a gateway model in auto: the local-lane note first, proposed, not applied
    const model = widget(page, 'model');
    await expect(model.getByRole('menuitemradio', { name: /^astra/ })).toHaveAttribute('data-proposed', 'true');
    await expect(model.getByRole('note')).toContainText('Auto-mode reviews for this model run locally.');
    await page.keyboard.press('Escape');
    expect(await inputsOf('session.setModel')).toHaveLength(1);

    await typeCommand(page, '/permissions acceptEdits');
    await expect(page.getByText('Permission mode · Accept edits', { exact: true })).toBeVisible();
    await noWidget();
    expect(await inputsOf('session.setPermissionMode')).toEqual([{ appSessionId: READY, mode: 'acceptEdits' }]);

    await typeCommand(page, '/permissions bypassPermissions'); // asks first, as the chip does
    await expect(widget(page, 'permissions').getByRole('status').first()).toHaveText('Bypass permissions asks first · choose it below');
    await page.keyboard.press('Escape');
    expect(await inputsOf('session.setPermissionMode')).toHaveLength(1);

    await typeCommand(page, '/compact focus on tests');
    const compact = widget(page, 'compact');
    await expect(compact.getByRole('textbox', { name: 'Instructions' })).toHaveValue('focus on tests');
    await compact.getByRole('button', { name: 'Compact now' }).click();
    await expect(compact).toBeHidden(); // closes on send
    expect((await commandsOf(backend)).filter((c) => c.command === 'session.send')).toEqual([{ command: 'session.send', input: { appSessionId: READY, content: '/compact focus on tests' } }]);

    await typeCommand(page, '/rename New title');
    await expect(widget(page, 'rename').getByRole('status')).toHaveText('Renamed · New title');
    expect((await commandsOf(backend)).filter((c) => c.command === 'session.rename')).toEqual([{ command: 'session.rename', input: { appSessionId: READY, title: 'New title' } }]); // C10's
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('permissions mode refusal: haiku, then auto, reads the refusal with the mode still default and the composer’s notice', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await pick(page, 'permissions');
    const permissions = widget(page, 'permissions');
    const segment = permissions.getByRole('menu', { name: 'Permission mode' });
    await segment.getByRole('menuitemradio', { name: /^Manual/ }).click();
    await expect(segment.getByRole('menuitemradio', { checked: true })).toContainText('Manual');
    // the modal dialog closes and hands the keyboard back to the editor before the chip opens, as in the app, where the
    // chip and the palette are out of reach until then (a menu opened while the editor's focus is still on its way
    // would see that focus land outside it and close)
    await page.keyboard.press('Escape');
    await expect(permissions).toBeHidden();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();

    await pick(page, 'model'); // W3: the selector in the model chip's menu, on its model view
    await widget(page, 'model').getByRole('menuitemradio', { name: /^Haiku/ }).click();
    await expect(widget(page, 'model').getByRole('button', { name: 'Haiku · Select model' })).toBeVisible(); // applied, back on the effort view

    await pick(page, 'permissions');
    // W3 (C5): Haiku's live row omits supportsAutoMode (reads.jsonl seq 3), which the gate reads as no auto: the item says why
    const auto = widget(page, 'permissions').getByRole('menuitemradio', { name: /^Auto/ });
    await expect(auto).toBeDisabled();
    await expect(auto).toContainText('This model does not support auto mode');
    // the engine's own refusal, asked for directly (seq 156, as C3 maps it): the mode stays, and the composer says so in
    // Claude Desktop's words
    await page.evaluate((id) => (window as unknown as WidgetsWindow).__maws_widgets.control('setPermissionMode', { appSessionId: id, mode: 'auto' }), READY);
    await expect(widget(page, 'permissions').getByRole('menuitemradio', { checked: true })).toContainText('Manual');
    await page.keyboard.press('Escape'); // the widget's dialog is modal: the composer under it is out of reach until it closes
    await expect(page.getByRole('note', { name: 'Permission mode notice' })).toContainText("Auto mode isn't available for this session. Using Manual instead.");
    const log = await calls(backend);
    expect(log.filter((c) => c.subtype === 'set_permission_mode').map((c) => c.input)).toEqual([
      { appSessionId: READY, mode: 'default' },
      { appSessionId: READY, mode: 'auto' },
    ]);
    expect(log).toContainEqual({ subtype: 'list_permission_rules', input: { appSessionId: READY } });
  });

  test('mcp reconnect and plugins reload run as operations', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await holdOperations(backend, true);

    await inProject(backend);
    await pick(page, 'plugins');
    // E8: Reload plugins (E11 §2.2), its line beside the button (the widget's rows carry status lines of their own)
    const reloadMods = widget(page, 'plugins').getByRole('button', { name: 'Reload plugins' });
    const reloadLine = reloadMods.locator('xpath=following-sibling::*[@role="status"]');
    await reloadMods.click();
    await expect(reloadLine).toHaveText('Working…');
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(reloadLine).toHaveText('Reloaded · 52 commands · 5 agents · 11 plugins · 0 errors');
    await widget(page, 'plugins').getByRole('button', { name: 'Reload skills' }).click(); // E8: reload_skills (pass3/e8-plugins-reload seq 34)
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(reloadLine).toHaveText('Reloaded · 15 skills');

    await pick(page, 'mcp');
    const docs = widget(page, 'mcp').getByRole('listitem').filter({ hasText: 'openaiDeveloperDocs' });
    await docs.getByRole('button', { name: 'Reconnect' }).click();
    await expect(docs.getByRole('status')).toHaveText('Working…');
    const before = (await calls(backend)).filter((c) => c.subtype === 'mcp_status').length;
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(docs.getByRole('status')).toHaveText('Reconnected');
    await expect.poll(async () => (await calls(backend)).filter((c) => c.subtype === 'mcp_status').length).toBe(before + 1); // read again on completion
    expect((await calls(backend)).find((c) => c.subtype === 'mcp_reconnect')?.input).toEqual({ appSessionId: READY, serverName: 'openaiDeveloperDocs' });
  });

  test('mcp toggle discloses ~/.claude.json and reads its state back after either outcome', async ({ backend }) => {
    const { page, app } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await pick(page, 'mcp');
    const row = (name: string) => widget(page, 'mcp').getByRole('listitem').filter({ hasText: name });
    const docs = row('openaiDeveloperDocs');
    const mcpReads = async () => (await calls(backend)).filter((c) => c.subtype === 'mcp_status').length;

    // Toggle off: the persistence beside the switch, one read after the outcome, the switch from that read
    await expect(docs).toContainText('Recorded by the engine for this project in ~/.claude.json');
    await holdOperations(backend, true);
    await docs.getByRole('switch').click();
    await expect(docs.getByRole('status')).toHaveText('Working…');
    const before = await mcpReads();
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(docs.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect.poll(mcpReads).toBe(before + 1);
    expect((await calls(backend)).find((c) => c.subtype === 'mcp_toggle')?.input).toEqual({ appSessionId: READY, serverName: 'openaiDeveloperDocs', enabled: false });
    await holdOperations(backend, false);

    // a refusal before the write: the switch where the read puts it, with the error's words
    const ptc = row('plugin:ptc:ptc');
    await app.evaluate(() => (globalThis as unknown as BackendGlobal).__maws_widget_backend.scriptOutcome('session.mcpToggle', () => ({ ok: false, error: { code: 'engine_error', message: 'Server not found: x', engineCode: null } })));
    await ptc.getByRole('switch').click();
    await expect(ptc.getByRole('status')).toHaveText('Server not found: x · engine_error');
    await expect(ptc.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    // an enable that persisted and did not connect (mcp-toggle-connect-failed.json): on, not connected
    const failed = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/widgets/mcp-toggle-connect-failed.json'), 'utf8')) as { operation: unknown; mcp_status: unknown };
    await app.evaluate((_, f) => {
      const backend = (globalThis as unknown as BackendGlobal).__maws_widget_backend;
      backend.scriptOutcome('session.mcpToggle', () => {
        backend.script('session.mcpStatus', () => f.mcp_status);
        return f.operation as never;
      });
    }, failed);
    await docs.getByRole('switch').click(); // off → on
    await expect(docs.getByRole('status')).toHaveText('On · not connected · Connection failed');
    await expect(docs.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

    // the read-back rejects: Unconfirmed with the outcome's words, and Read again reads once more
    const advisor = row('plugin:chatgpt-advisor:advisor');
    await app.evaluate(() => {
      const backend = (globalThis as unknown as BackendGlobal).__maws_widget_backend;
      backend.scriptOutcome('session.mcpToggle', () => {
        backend.script('session.mcpStatus', () => {
          throw new Error('mcp_status unanswered after 8 s');
        });
        return { ok: true, value: null };
      });
    });
    await advisor.getByRole('switch').click();
    await expect(advisor.getByRole('status')).toHaveText('Unconfirmed · Done');
    await expect(advisor.getByRole('switch')).toHaveAttribute('data-state', 'unconfirmed');
    const reads = await mcpReads();
    await advisor.getByRole('button', { name: 'Read again' }).click();
    await expect.poll(mcpReads).toBe(reads + 1);
  });

  // P2-D (the P2 spec, child P2-D, G1, G4, G5): `/resume` is the resume chooser in X19's library box, over this session's
  // project; previewing reads the transcript only (none for these stub sessions), and opening starts nothing
  test('resume opens the chooser over the project’s other sessions, and opening one starts nothing', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await typeCommand(page, '/resume ');
    const dialog = page.locator('[data-widget-dialog="resume"]');
    await expect(dialog).toHaveAttribute('data-widget-size', 'library');
    const rows = widget(page, 'resume').getByRole('option');
    await expect(rows).toHaveCount(2); // nine-sessions' proj-claude-usage-menubar, without this session
    await expect(rows.nth(0)).toContainText('Usage reset countdown');
    await expect(rows.nth(1)).toContainText('SDK wire inventory');
    await expect(widget(page, 'resume').getByTestId('resume-turns')).toHaveText('No messages yet.');
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(widget(page, 'resume').getByTestId('resume-preview')).toContainText('SDK wire inventory');
    await page.keyboard.press('Enter');
    await expect(widget(page, 'resume')).toBeHidden();
    const launches = (await commandsOf(backend)).filter((c) => /^session\.(start|launch|acquire|setVisible)$/.test(c.command));
    expect(launches, 'opening shows the transcript; the first Send continues the session').toEqual([]);
    expect(backend.consoleErrors()).toEqual([]);
  });

  // W2 (C3; §5.4 and §5.5 as amended 2026-10-01): the status line's ctx field is gone; the toolbar's context ring opens
  // the context window over the engine's full get_context_usage (reads.jsonl seq 57).
  test('the toolbar’s context ring opens the context window with the engine’s full reading', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    const ring = page.getByRole('toolbar', { name: 'Composer tools' }).getByRole('button', { name: /^Context window/ });
    await expect(ring).toBeVisible();
    await ring.click();
    const popover = page.getByRole('dialog', { name: 'Context window' });
    await expect(popover).toContainText('of 200k · autocompact at 167k');
    expect(await calls(backend)).toContainEqual({ subtype: 'get_context_usage', input: { appSessionId: READY, detail: 'full' } });
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    expect(backend.consoleErrors()).toEqual([]);
  });

  // ---- M4: Session info and the route switch, beside the composer on the same page ------------------------------------
  // Session info is C11's panel tool rendered for the shown session; W2: its Route row carries the switch, which the
  // status line's usage popover footer carried before. The restart is C10's `session.start`, which the widget backend
  // answers in main: the process comes up ready on the route asked for, as C10's resume would launch it.

  test('Session info renders the six sections and derives the lane from the status and the model', async ({ backend }) => {
    const { page, app } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    const info = page.locator(`[data-session-info="${READY}"]`);
    for (const title of ['Engine', 'Model', 'Gateway', 'Permissions', 'Context, usage, cost', 'Hooks and MCP']) await expect(info.getByRole('region', { name: title })).toBeVisible();
    await expect(valueOf(info, 'Route')).toHaveText('Gateway · ClaudeUsage relay · http://127.0.0.1:8641Switch to Direct…'); // W2: with its switch
    await expect(valueOf(info, 'Context')).toHaveText('21,508 of 200,000 · 11% · autocompact at 167,000');
    const lane = valueOf(info, 'Auto-mode lane');
    const SERVER = 'Server · reviews ride on the main request · no charge · model chosen server-side';
    await expect(lane, 'the scenario status on Sonnet, get_status reading Enabled (auto-routed seq 145)').toHaveText(SERVER);

    await page.evaluate((id) => (window as unknown as WidgetsWindow).__maws_widgets.control('setModel', { appSessionId: id, model: 'claude/astra' }), READY);
    await expect(lane).toHaveText('Local (expected) · a GPT route carries no Anthropic verdict');

    // C3's observation in the open turn (the unavailable-safeguard verdict or the billing notice)
    await app.evaluate((_, id) => {
      const b = (globalThis as unknown as BackendGlobal).__maws_widget_backend;
      const turn = b.emitTurnStarted(id as never);
      b.emitStatus(id as never, { gateway: { ...b.status(id as never).gateway, localLane: { observedInTurn: turn, at: new Date().toISOString() } } });
    }, READY);
    await expect(lane).toHaveText(/^Local · Sonnet 5 through .+ · counted as usage · the engine's notice is in the transcript$/);

    // the next turn on Sonnet: C3 cleared the observation at its turn.started
    await app.evaluate((_, id) => void (globalThis as unknown as BackendGlobal).__maws_widget_backend.emitTurnStarted(id as never), READY);
    await page.evaluate((id) => (window as unknown as WidgetsWindow).__maws_widgets.control('setModel', { appSessionId: id, model: 'sonnet' }), READY);
    await expect(lane).toHaveText(SERVER);
    expect(backend.consoleErrors()).toEqual([]);
  });

  const TWO_TASKS = [
    { taskId: 'task-1', taskType: 'local_agent', description: 'Sleep 120 s', ambient: false },
    { taskId: 'task-2', taskType: 'local_workflow', description: 'Index the repository', ambient: false },
  ];
  // The session on a gateway alias with two background tasks, as the switch case starts it.
  const onAstraWithWork = (maws: MawsLaunch) =>
    maws.app.evaluate(
      (_, [id, tasks]) => void (globalThis as unknown as BackendGlobal).__maws_widget_backend.emitStatus(id as never, { model: { requested: 'claude/astra', resolved: 'claude/astra' }, backgroundTasks: tasks as never }),
      [READY, TWO_TASKS] as const,
    );
  const LIFECYCLE = ['session.status', 'session.interrupt', 'session.stop', 'session.start', 'session.queue.list', 'session.queue.setPaused'];

  test('the switch names background work, requires a Claude model, then re-reads, stops and starts direct in order', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await onAstraWithWork(backend);
    const route = valueOf(page.locator(`[data-session-info="${READY}"]`), 'Route'); // W2: Session info's Route row
    await expect(route).toContainText('Gateway · ClaudeUsage relay');
    await route.getByRole('button', { name: 'Switch to Direct…' }).click();

    const sheet = page.getByRole('dialog', { name: 'Switch this session to Direct?' });
    const disclosure = sheet.getByRole('note'); // C10's BackgroundWorkDisclosure, in the archive dialog's words
    await expect(disclosure).toContainText('2 background tasks are still running and will be stopped');
    await expect(disclosure.getByRole('listitem')).toHaveText(['Sleep 120 s', 'Index the repository']);
    const confirm = sheet.getByRole('button', { name: 'Stop them and switch' });
    await expect(confirm, 'a Claude model first').toBeDisabled();
    await sheet.getByRole('radio', { name: /^Sonnet 5/ }).click();
    await expect(confirm).toBeEnabled();
    const before = (await commandsOf(backend)).length;
    await confirm.click();

    // C10's resume restarts the process on the direct route with the chosen model; the switch's notice follows
    await expect(page.getByText('Settings idle probe restarted direct · on Sonnet 5', { exact: true })).toBeVisible();
    const log = (await commandsOf(backend)).slice(before);
    expect(log.filter((c) => c.command === 'session.start').map((c) => c.input)).toEqual([{ appSessionId: READY, message: null, options: { gateway: 'direct', model: 'sonnet' } }]);
    const lifecycle = log.map((c) => c.command).filter((c) => LIFECYCLE.includes(c));
    expect(lifecycle, 'no turn was open: no interrupt').not.toContain('session.interrupt');
    const stop = lifecycle.indexOf('session.stop');
    expect(lifecycle.slice(stop - 1, stop + 2), 'the recheck, the stop, the restart, in one log').toEqual(['session.status', 'session.stop', 'session.start']);
    expect(lifecycle.filter((c) => c === 'session.stop' || c === 'session.start')).toEqual(['session.stop', 'session.start']);
    await expect(route.getByRole('button', { name: 'Switch to gateway…' })).toBeVisible();
    await expect(route).toHaveText(/^Direct · engine's own login/);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('work that started after the confirm returns the switch to its sheet naming it, and nothing is stopped', async ({ backend }) => {
    const { page, app } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await onAstraWithWork(backend);
    await valueOf(page.locator(`[data-session-info="${READY}"]`), 'Route').getByRole('button', { name: 'Switch to Direct…' }).click(); // W2: Session info's
    const sheet = page.getByRole('dialog', { name: 'Switch this session to Direct?' });
    await sheet.getByRole('radio', { name: /^Sonnet 5/ }).click();
    // a third task between the confirm and the stop: it starts as the switch re-reads the status after the answer
    await app.evaluate(
      (_, [id, tasks]) => {
        const b = (globalThis as unknown as BackendGlobal).__maws_widget_backend;
        const off = b.script('session.status', () => {
          off();
          return b.emitStatus(id as never, { backgroundTasks: tasks as never });
        });
      },
      [READY, [...TWO_TASKS, { taskId: 'task-3', taskType: 'local_agent', description: 'A third agent', ambient: false }]] as const,
    );
    await sheet.getByRole('button', { name: 'Stop them and switch' }).click();
    const again = page.getByRole('dialog', { name: 'Switch this session to Direct?' });
    await expect(again.getByRole('note').getByRole('listitem')).toHaveText(['Sleep 120 s', 'Index the repository', 'A third agent']);
    await expect(again.getByRole('alert')).toHaveText('New background work started since you confirmed · check the list again');
    expect((await commandsOf(backend)).map((c) => c.command)).not.toContain('session.stop');
    await again.getByRole('button', { name: 'Cancel' }).click();
    await expect(again).toBeHidden();
    expect((await commandsOf(backend)).map((c) => c.command)).not.toContain('session.stop');
    expect((await commandsOf(backend)).map((c) => c.command)).not.toContain('session.start');
  });
});

test.describe('replay conformance', () => {
  test('auto-routed-controls: the driver issues the recorded frames and the widgets render the answers', async ({ replay }) => {
    const { page } = replay;
    const id = 'c11-widgets-controls';
    await openPage(page, null);
    await launchReady(page, id, CONTROLS);
    await page.evaluate((p) => (window as unknown as WidgetsWindow).__maws_widgets.show(p), { appSessionId: id, mode: 'passive' as const });
    const events = () => page.evaluate((sid) => (window as unknown as WidgetsWindow).__c11.batches.filter((b) => b.appSessionId === sid).flatMap((b) => b.events), id);
    const ended = async () => (await events()).filter((e) => e.kind === 'turn.ended').length;
    const read = (command: string, input: Record<string, unknown> = {}) => page.evaluate(([c, i]) => (window as unknown as WidgetsWindow).__maws_widgets.read(c, i), [command, { appSessionId: id, ...input }] as const);
    const control = (name: string, input: Record<string, unknown>) => page.evaluate(([n, i]) => (window as unknown as WidgetsWindow).__maws_widgets.control(n, i), [name, { appSessionId: id, ...input }] as const);

    // the three prompts, each after the previous turn ended, and the escalated Bash call allowed as recorded
    value(await invoke(page, 'session.send', { appSessionId: id, content: 'Use Bash to run exactly: git status --short. Then reply OK.' })); // seq 6
    await expect.poll(ended).toBe(1);
    value(await invoke(page, 'session.send', { appSessionId: id, content: 'Use Bash to run exactly: git log --oneline -1. Then reply OK.' })); // seq 44
    await expect.poll(async () => (await events()).some((e) => e.kind === 'permission.requested')).toBe(true); // seq 67, the escalation of seq 68
    const requested = (await events()).find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
    expect(value(await invoke(page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }))).toEqual({ outcome: 'delivered' }); // seq 69
    await expect.poll(ended).toBe(2);
    value(await invoke(page, 'session.send', { appSessionId: id, content: 'Use Bash to run exactly: git push --force origin main. Do not retry or run anything else. If it is blocked or fails, reply BLOCKED.' })); // seq 83
    await expect.poll(ended).toBe(3);

    const model = widget(page, 'model');
    const permissions = widget(page, 'permissions');
    const checkedMode = permissions.getByRole('menuitemradio', { checked: true });
    await read('session.getUsage'); // seq 139
    await expect(widget(page, 'usage')).toContainText('rate_limits_available: false');
    const effort = widget(page, 'effort'); // W3: the selector's effort view, beside its model view
    await read('session.listModels'); // seq 142
    await expect(model.getByRole('group', { name: 'Claude models' }).getByRole('menuitemradio')).toHaveCount(4);
    await expect(model.getByRole('group', { name: 'Gateway models' }).getByRole('menuitemradio')).toHaveCount(7);
    await read('session.getStatus'); // seq 144
    await expect(valueOf(widget(page, 'status').getByRole('region', { name: 'Environment' }), 'Auto mode server')).toHaveText('Enabled');

    await control('setPermissionMode', { mode: 'default' }); // seq 148
    await expect(checkedMode).toContainText('Manual');
    await control('setModel', { model: 'haiku' }); // seq 151
    await expect(model.getByRole('menuitemradio', { name: /^Haiku/ })).toHaveAttribute('aria-checked', 'true');
    await control('setPermissionMode', { mode: 'auto' }); // seq 155: refused
    await expect(permissions).toContainText('This model does not support auto mode');
    await expect(checkedMode).toContainText('Manual');
    await control('setPermissionMode', { mode: 'default' }); // seq 158
    await control('setModel', { model: 'claude/astra' }); // seq 161
    await expect(model.getByRole('menuitemradio', { name: /^astra/ })).toHaveAttribute('aria-checked', 'true');
    await control('setPermissionMode', { mode: 'auto' }); // seq 164
    await expect(checkedMode).toContainText('Auto');
    await expect(model.getByRole('note')).toContainText('Auto-mode reviews for this model run locally.'); // a gateway model in auto
    await control('setPermissionMode', { mode: 'default' }); // seq 167
    await control('setModel', { model: 'opus' }); // seq 171
    await control('applyFlagSettings', { settings: { fastMode: true } }); // seq 175
    await expect(effort.getByRole('switch', { name: 'Fast mode' })).toBeEnabled(); // opus has fast mode
    await expect(effort.getByText('Fast mode · set · the next init frame confirms it', { exact: true })).toBeVisible();
    await read('session.getStatus'); // seq 177
    await expect(valueOf(widget(page, 'status').getByRole('region', { name: 'Environment' }), 'Auto mode server')).toHaveText('Disabled');
    await control('setPermissionMode', { mode: 'auto' }); // seq 179
    await control('applyFlagSettings', { settings: { fastMode: null } }); // seq 182, the recorded argument verbatim
    await control('setModel', { model: 'sonnet' }); // seq 185

    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).process).toBe('exited'); // the meta exit, seq 189
    const status = value(await invoke(page, 'session.status', { appSessionId: id }));
    expect(readFileSync(status.journalPath, 'utf8')).not.toContain('replay_mismatch');
    expect(replay.consoleErrors()).toEqual([]);
  });

  test('reads: the driver issues the recorded frames and the widgets render the answers', async ({ replay }) => {
    const { page } = replay;
    const id = 'c11-widgets-reads';
    await openPage(page, null);
    await launchReady(page, id, READS);
    await page.evaluate((p) => (window as unknown as WidgetsWindow).__maws_widgets.show(p), { appSessionId: id, mode: 'passive' as const });
    const events = () => page.evaluate((sid) => (window as unknown as WidgetsWindow).__c11.batches.filter((b) => b.appSessionId === sid).flatMap((b) => b.events.map((e) => e.kind)), id);

    value(await invoke(page, 'session.send', { appSessionId: id, content: 'Reply with exactly OK' })); // seq 4
    await expect.poll(async () => (await events()).includes('turn.ended')).toBe(true); // seq 51
    const read = (command: string, input: Record<string, unknown>) => page.evaluate(([c, i]) => (window as unknown as WidgetsWindow).__maws_widgets.read(c, i), [command, { appSessionId: id, ...input }] as const);

    await read('session.getUsage', {}); // seq 52
    await expect(widget(page, 'usage')).toContainText('rate_limits_available: false');
    await read('session.getContextUsage', { detail: 'summary' }); // seq 56: the compact widget's read
    await expect(widget(page, 'compact')).toContainText('21,508 of 200,000 · 11% · autocompact at 167,000');
    await read('session.getSettings', {}); // seq 59
    await expect(widget(page, 'config')).toContainText('No settings in effect beyond the defaults');
    await expect(widget(page, 'config')).toContainText('claude-haiku-4-5-20251001');
    await read('session.listPermissionRules', {}); // seq 62: the empty state
    await expect(widget(page, 'permissions')).toContainText('No rules');
    await expect(widget(page, 'permissions').getByRole('list', { name: 'Workspace directories' })).toContainText('/private/tmp/maws-probe-35ZnCO');
    await read('session.getHooksListing', {}); // seq 65
    await expect(widget(page, 'hooks')).toContainText('No hooks configured');
    await read('session.getMemoryDialog', {}); // seq 68
    await expect(widget(page, 'memory')).toContainText('does not exist yet');
    await read('session.getSkillsDialog', {}); // seq 71: empty, so the catalogue's skills
    await expect(widget(page, 'skills').getByRole('list', { name: 'Skills' }).getByRole('listitem')).toHaveCount(18);
    await read('session.getSandboxDialog', {}); // seq 74
    await expect(widget(page, 'sandbox')).toContainText('Sandbox off');
    await read('session.getStatus', {}); // seq 77
    await expect(valueOf(widget(page, 'status').getByRole('region', { name: 'Environment' }), 'Auto mode server')).toHaveText('Disabled');
    await read('session.getWorkspaceDiff', {}); // seq 80
    await expect(widget(page, 'diff')).toContainText('0 files · +0 −0 · working tree');
    await read('session.exportConversation', {}); // seq 83
    await expect(widget(page, 'export')).toContainText('2026-09-28-022217-reply-with-exactly-ok.txt');
    await expect(widget(page, 'export')).toContainText('❯ Reply with exactly OK');

    // C3's second case, as the probe recorded it (no C11 widget renders these: the rename widget is C10's dialog)
    const { opId } = value(await invoke(page, 'session.generateTitle', { appSessionId: id, description: 'Protocol probe', persist: false })); // seq 86
    await expect
      .poll(() => page.evaluate((op) => (window as unknown as WidgetsWindow).__c11.operations.find((o) => o.opId === op)?.outcome, opId))
      .toEqual({ ok: true, value: { title: 'Protocol probe' } }); // seq 87
    expect((await invoke(page, 'session.renameSession', { appSessionId: id, title: 'MAWS protocol probe' })).ok).toBe(true); // seq 89
    await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).process).toBe('exited'); // the meta exit, seq 92
    const status = value(await invoke(page, 'session.status', { appSessionId: id }));
    expect(readFileSync(status.journalPath, 'utf8')).not.toContain('replay_mismatch');
    expect(replay.consoleErrors()).toEqual([]);
  });
});

// ---- P2-C (M6; the P2-C document, G7): MAWS's built-in mods in /plugins ---------------------------------------------
// The section draws `mods.list` for the session. The scenario's session is the read model's, not the index's, so its
// override cannot be written here (the unit tests and main's own cover that write); the app's switch is the settings
// file's, and a new launch's source follows it.
test('P2-C /plugins shows MAWS mods · Built in: To-human with its version, its source, the app switch and this session’s override; no Uninstall', async ({ backend }) => {
  const w = await openPlugins(backend);
  const row = w.getByRole('region', { name: 'MAWS mods · Built in' }).locator('[data-mod-row="maws.to-human"]');
  await expect(row).toContainText('To-human');
  await expect(row).toContainText('Built in');
  await expect(row).toContainText('Version 1');
  await expect(row).toContainText('MAWS gives the agent its instructions');
  await expect(row.getByRole('radiogroup', { name: 'To-human in this session' }).getByRole('radio')).toHaveCount(3);
  await expect(row.getByRole('radio', { name: 'Default (On)' })).toBeChecked();
  const appSwitch = row.getByRole('switch', { name: 'To-human in every session' });
  await expect(appSwitch).toHaveAttribute('aria-checked', 'true');
  await appSwitch.click();
  await expect(appSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(row).toContainText('Off: the agent is not asked to mark anything');
  await expect(row.getByRole('radio', { name: 'Default (Off)' })).toBeChecked();
  await expect(w.getByRole('region', { name: 'MAWS mods · Built in' }).getByRole('button', { name: /Uninstall/ })).toHaveCount(0); // the installed plugins above have theirs
  expect(backend.consoleErrors()).toEqual([]);
});

// ---- E8: plugins and marketplaces, managed through the engine's CLI ----------------------------------------------------
// E8 execution document, M3's action-to-proof matrix, the stub e2e column. The host runs the plugin CLI stub as the
// engine binary (MAWS_E2E_ENGINE_BIN), so the widget, the confirm sheet, the X2 surface, the host's runner and its result
// parsing are the product's own; the stub keeps its registry in a state file and logs every argv it ran (`calls.log`).
// The scenario's sessions have no host process, so a change reloads no session (`No running session to reload`).
test.describe('plugin management (E8)', () => {
  test('lists the engine’s plugins and marketplaces; Browse is read only on its click', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    const tools = installedRow(w, 'e8-tools@e8-scratch');
    await expect(tools).toContainText('1.0.0');
    await expect(tools).toContainText('E8 tools');
    await expect(tools).toContainText('by MAWS stub · An installed plugin of the scratch marketplace'); // read from its files (plugins.manifest)
    await expectListed(w, 'e8-tools@e8-scratch');
    await expect(tools.locator('xpath=ancestor::*[@data-plugins-group][1]')).toHaveAttribute('data-plugins-group', 'added');
    expect(await rowActions(tools)).toEqual(['Turn off', 'Update', 'Uninstall…']);
    const manage = await openAdd(w, 'Manage marketplaces');
    const market = marketplaceRow(manage, MARKET);
    await expect(market).toHaveAttribute('data-marketplace-source', 'directory');
    await expect(market).toContainText(join(backend.userData, 'market'));
    await expect(market).toContainText('1 plugin installed');
    await manage.getByRole('button', { name: 'Done' }).click();
    await expect(manage).toBeHidden();
    // E11 §2.2: no foot; what a change writes is named in its sheet (below)
    await expect(w.locator('footer')).toHaveCount(0);

    const reads = () => stubCalls(backend.cli).filter((argv) => argv[0] === 'plugin');
    expect(reads()).toContainEqual(['plugin', 'list', '--json']);
    expect(reads()).toContainEqual(['plugin', 'marketplace', 'list', '--json']);
    expect(reads().filter((argv) => argv.includes('--available'))).toEqual([]); // not before Browse's click
    const browse = await openBrowse(w);
    expect(reads()).toContainEqual(['plugin', 'list', '--json', '--available']);
    await expect(cardOf(w, 'e8-probe@e8-scratch').getByRole('button', { name: 'Install', exact: true })).toBeVisible();
    await expect(cardOf(w, 'e8-extra@e8-scratch').getByRole('button', { name: 'Install', exact: true })).toBeVisible();
    // the engine leaves the installed e8-tools out; Browse joins it back in, Installed
    await expect(cardOf(w, 'e8-tools@e8-scratch')).toHaveAttribute('data-installed', 'here');
    await expect(cardOf(w, 'e8-tools@e8-scratch').getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);
    await expect(browse.locator('[data-browse-section]')).toHaveCount(1);
    await expect(page.locator('[data-install-count]')).toHaveCount(0); // a folder marketplace carries no count
    expect(mutations(backend)).toEqual([]);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('install at user scope from a Browse card: the sheet names the command and the writes; the card shows the CLI’s progress, then its result; the CLI ran the sheet’s argv', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    await openBrowse(w);
    const card = cardOf(w, 'e8-probe@e8-scratch');
    await card.getByRole('button', { name: 'Install', exact: true }).click();
    const sheet = sheetOf(page, 'install');
    await expect(sheet.getByRole('heading', { name: 'Install e8-probe@e8-scratch?' })).toBeVisible();
    const argv = await argvOf(sheet);
    expect(argv).toEqual(['plugin', 'install', 'e8-probe@e8-scratch', '--scope', 'user', '--json']);
    await expect(sheet.locator('[data-plugins-argv]')).toHaveText('claude plugin install e8-probe@e8-scratch --scope user --json');
    const home = configHome(backend);
    await expect(sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem')).toHaveText([`${home}/settings.json`, `${home}/plugins/installed_plugins.json`, `${home}/plugins/cache/e8-scratch/e8-probe/<version>/`, `${home}/plugins/cache/<any-marketplace>/<dependency>/`]);
    await expect(sheet).toContainText(`and keeps its own records in ${home}/.claude.json`);
    await expect(sheet).toContainText(/Reloads plugins in \d+ running sessions?|No running session to reload/);
    expect(mutations(backend)).toEqual([]); // nothing ran before the confirm
    await expect(browseDetailOf(w)).toHaveCount(0); // Install keeps its own click

    backend.cli.hold(true);
    await sheet.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(lineOf(card)).toHaveText('Holding install e8-probe@e8-scratch --scope user (plugin CLI stub)'); // the CLI's progress line
    await expect(card.getByRole('button', { name: 'Stop' })).toBeVisible();
    backend.cli.hold(false);
    // plugins.changed reread both lists: the engine no longer offers it, and its card is the installed plugin's, keeping the result
    await expect(card).toHaveAttribute('data-installed', 'here');
    await expect(lineOf(card)).toHaveText('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · No running session to reload');
    await toMyItems(w);
    await expectListed(w, 'e8-probe@e8-scratch');
    expect(mutations(backend)).toEqual([argv]); // G4: exactly the argument list the sheet showed
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('install at project and at local scope from a card’s detail: the argv carries the scope and the sheet names the project’s settings file', async ({ backend }) => {
    const { page, project } = backend;
    const w = await openPlugins(backend);
    await openBrowse(w);
    const shown: string[][] = [];
    for (const [plugin, scope, label, file] of [
      ['e8-probe', 'project', 'Project', '.claude/settings.json'],
      ['e8-extra', 'local', 'Local', '.claude/settings.local.json'],
    ] as const) {
      const id = `${plugin}@e8-scratch`;
      const detail = await openCard(w, id);
      await expect(detail).toContainText('from e8-scratch');
      await detail.getByRole('button', { name: 'Install', exact: true }).click();
      const sheet = sheetOf(page, 'install');
      await sheet.getByRole('radio', { name: label }).check();
      await expect(sheet).toContainText(`In ${project}`);
      const argv = await argvOf(sheet);
      expect(argv).toEqual(['plugin', 'install', id, '--scope', scope, '--json']);
      await expect(sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem').first()).toHaveText(`${project}/${file}`);
      shown.push(argv);
      await sheet.getByRole('button', { name: 'Install', exact: true }).click();
      await expect(lineOf(detail)).toHaveText(`Successfully installed plugin: ${id} (scope: ${scope}) · No running session to reload`);
      await expect(detail.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0); // installed here now
      await detail.getByRole('button', { name: 'Back to Browse' }).click();
      await expect(cardOf(w, id)).toHaveAttribute('data-installed', 'here');
    }
    await toMyItems(w);
    await expectListed(w, 'e8-probe@e8-scratch', 'project');
    await expectListed(w, 'e8-extra@e8-scratch', 'local');
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('the detail’s switch disables and enables after its sheet, its position from the read-back; Cancel runs nothing; Update shows the version change; Uninstall asks for the acknowledgement', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    const id = 'e8-tools@e8-scratch';
    const shown: string[][] = [];
    const confirm = async (action: string, submit: string, expected: string[]) => {
      const sheet = sheetOf(page, action);
      const argv = await argvOf(sheet);
      expect(argv).toEqual(expected);
      shown.push(argv);
      await sheet.getByRole('button', { name: submit, exact: true }).click();
      await expect(sheet).toBeHidden();
    };

    // P2-B M4 (§6.2): from the row's detail, at its one chip's scope (User)
    const detail = await openDetail(w, id);
    await expect(detail.getByRole('radio', { name: 'User' })).toHaveAttribute('aria-checked', 'true');
    await expect(detail).toContainText('Enabled for this project');
    const toggle = enableSwitch(detail);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(sheetOf(page, 'disable').getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem')).toHaveText([`${configHome(backend)}/settings.json`]);
    await confirm('disable', 'Disable', ['plugin', 'disable', id, '--scope', 'user', '--json']);
    await expect(opLineOf(detail)).toHaveText('Successfully disabled plugin: e8-tools (scope: user) · No running session to reload');
    await expect(toggle).toHaveAttribute('aria-checked', 'false'); // the read-back
    await expect(detail).toContainText('Not enabled for this project');
    await toggle.click();
    await confirm('enable', 'Enable', ['plugin', 'enable', id, '--scope', 'user', '--json']);
    await expect(opLineOf(detail)).toHaveText('Successfully enabled plugin: e8-tools (scope: user) · No running session to reload');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Cancel: the sheet closes and the CLI never runs: the whole calls.log, reads included, is as it was
    const log = await settledLog(backend);
    await detail.getByRole('button', { name: 'Update', exact: true }).click();
    await sheetOf(page, 'update').getByRole('button', { name: 'Cancel' }).click();
    await expect(sheetOf(page, 'update')).toBeHidden();
    await page.waitForTimeout(500);
    expect(readFileSync(backend.cli.callsLog, 'utf8')).toBe(log);
    expect(mutations(backend)).toEqual(shown);

    // Update: the marketplace now offers 1.1.0
    const state = backend.cli.state();
    backend.cli.setState({ ...state, marketplaces: state.marketplaces.map((m) => ({ ...m, plugins: m.plugins.map((p) => (p.name === 'e8-tools' ? { ...p, version: '1.1.0' } : p)) })) });
    await detail.getByRole('button', { name: 'Update', exact: true }).click();
    await confirm('update', 'Update', ['plugin', 'update', id, '--scope', 'user', '--json']);
    await expect(opLineOf(detail)).toHaveText('Plugin "e8-tools" updated from 1.0.0 to 1.1.0 for scope user. Restart to apply changes. · 1.0.0 → 1.1.0 · No running session to reload');
    await expect(detail.locator('h3 + p')).toContainText('1.1.0');

    // Uninstall: destructive, so the default button waits for the acknowledgement; the plugin leaves the list, so the
    // detail returns to it, where the result stays
    await detailUninstall(detail);
    const sheet = sheetOf(page, 'uninstall');
    await expect(sheet.getByRole('button', { name: 'Uninstall', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter'); // Enter never destroys without the acknowledgement
    await expect(sheet).toBeVisible();
    await sheet.getByRole('checkbox', { name: 'I understand' }).check();
    await confirm('uninstall', 'Uninstall', ['plugin', 'uninstall', id, '--scope', 'user', '--json']);
    await expect(detail).toHaveCount(0);
    await expect(installedRow(w, id)).toHaveCount(0);
    await expect(w.locator(`[data-plugins-section="my-items"] [data-plugin-result="${id}"]`)).toContainText('Successfully uninstalled plugin: e8-tools (scope: user) · No running session to reload');
    await expect(w.locator('[data-plugins-section="my-items"]')).toContainText('Add your first plugins');
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('an engine error is the engine’s words and code in red; a marketplace-declared command opens a second sheet and Run it accepts it by its sha256, never -y', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    await openBrowse(w);

    // not_found: the catalogue Browse read still offers e8-extra, which the marketplace no longer has
    const state = backend.cli.state();
    backend.cli.setState({ ...state, marketplaces: state.marketplaces.map((m) => ({ ...m, plugins: m.plugins.filter((p) => p.name !== 'e8-extra') })) });
    const extra = cardOf(w, 'e8-extra@e8-scratch');
    await extra.getByRole('button', { name: 'Install', exact: true }).click();
    const shown = [await argvOf(sheetOf(page, 'install'))]; // each argv a sheet showed and its confirm ran, in order
    await sheetOf(page, 'install').getByRole('button', { name: 'Install', exact: true }).click();
    await expect(extra).toHaveCount(0); // read again once the CLI ended: no longer offered
    const failure = browseResult(w, 'e8-extra@e8-scratch'); // the result outlives its card
    await expect(failure).toHaveText('Plugin "e8-extra" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`. · not_found');
    await expect(failure).toHaveClass(/text-danger/);

    // shownCommand: the CLI refuses to run a declared command unseen; the second sheet shows it; Run it reruns the
    // request with --accept-command <sha256>
    const sha256 = 'c0ffee'.padEnd(64, '0');
    backend.cli.setState({ ...backend.cli.state(), fail: { install: { failureCode: 'command_source_refused', message: 'e8-probe declares a command to run before it installs', shownCommand: { sha256, command: ['node', './scripts/setup.js'] } } } });
    const probe = cardOf(w, 'e8-probe@e8-scratch');
    await probe.getByRole('button', { name: 'Install', exact: true }).click();
    shown.push(await argvOf(sheetOf(page, 'install')));
    await sheetOf(page, 'install').getByRole('button', { name: 'Install', exact: true }).click();
    const declared = sheetOf(page, 'install');
    await expect(declared.getByRole('heading', { name: 'Run the command e8-probe@e8-scratch declares?' })).toBeVisible();
    await expect(declared.locator('[data-plugins-declared]')).toHaveText('node ./scripts/setup.js');
    const accepted = await argvOf(declared);
    expect(accepted).toEqual(['plugin', 'install', 'e8-probe@e8-scratch', '--scope', 'user', '--accept-command', sha256, '--json']);
    await declared.getByRole('button', { name: 'Run it' }).click();
    await expect(probe).toHaveAttribute('data-installed', 'here');
    await expect(lineOf(probe)).toHaveText('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · No running session to reload');
    shown.push(accepted);
    expect(shown.slice(0, 2)).toEqual([
      ['plugin', 'install', 'e8-extra@e8-scratch', '--scope', 'user', '--json'],
      ['plugin', 'install', 'e8-probe@e8-scratch', '--scope', 'user', '--json'],
    ]);
    expect(mutations(backend)).toEqual(shown); // the rejected runs included: exactly what the three sheets showed
    expect(stubCalls(backend.cli).flat()).not.toContain('-y');
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('marketplaces: Add marketplace adds a folder, an owner/repo and a URL; a missing folder is the engine’s invalid_source; Manage marketplaces checks for updates and removes after the acknowledgement', async ({ backend }) => {
    const { page, userData } = backend;
    const w = await openPlugins(backend);
    const dialog = await openAdd(w, 'Add marketplace');
    await expect(dialog.getByRole('heading', { name: 'Add marketplace' })).toBeVisible();
    await expect(dialog.getByRole('note')).toContainText('Make sure you trust a plugin before installing, updating, or using it.');
    const field = dialog.getByRole('textbox', { name: 'Source' });
    await expect(field).toBeFocused();
    const addLine = dialog.locator('[data-marketplace-add-line]').getByRole('status');
    const home = configHome(backend);
    const folder = scratchMarketplace(join(userData, 'other-market'), { name: 'e8-other', plugins: [{ name: 'e8-more', version: '2.0.0', description: 'From the second folder' }] });
    const shown: string[][] = [];
    const add = async (source: string, writes: string[]) => {
      await field.fill(source);
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      const sheet = sheetOf(page, 'marketplace-add');
      await expect(sheet.getByRole('heading', { name: `Add marketplace ${source}?` })).toBeVisible();
      const argv = await argvOf(sheet);
      expect(argv).toEqual(['plugin', 'marketplace', 'add', source, '--json']);
      await expect(sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem')).toHaveText(writes);
      await expect(sheet).toContainText('Nothing to reload: an added marketplace loads no plugin');
      shown.push(argv);
      await sheet.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(sheet).toBeHidden();
    };

    await add(folder, [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/`]);
    await expect(addLine).toHaveText('Successfully added marketplace: e8-other (declared in user settings)');
    await add('acme/tools', [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/<name>/`]);
    await expect(addLine).toHaveText('Successfully added marketplace: tools (declared in user settings)');
    await add('https://example.com/acme/more.git', [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/<name>/`]);
    await expect(addLine).toHaveText('Successfully added marketplace: more (declared in user settings)');
    const missing = join(userData, 'e8-does-not-exist');
    await add(missing, [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/`]);
    await expect(addLine).toHaveText(`Path does not exist: ${missing} · invalid_source`);
    await expect(addLine).toHaveClass(/text-danger/);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    const manage = await openAdd(w, 'Manage marketplaces');
    await expect(manage).toContainText('Marketplaces added with Claude Code on this computer. Removing one also uninstalls its plugins.');
    await expect(marketplaceRow(manage, 'e8-other')).toContainText(folder);
    await expect(marketplaceRow(manage, 'tools')).toHaveAttribute('data-marketplace-source', 'github');
    await expect(marketplaceRow(manage, 'tools')).toContainText('acme/tools');
    await expect(marketplaceRow(manage, 'more')).toContainText('https://example.com/acme/more.git');

    const scratch = marketplaceRow(manage, MARKET);
    await marketplaceAction(scratch, 'Check for updates');
    let sheet = sheetOf(page, 'marketplace-update');
    shown.push(await argvOf(sheet));
    expect(shown.at(-1)).toEqual(['plugin', 'marketplace', 'update', MARKET, '--json']);
    await sheet.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(lineOf(scratch)).toContainText('Successfully updated marketplace: e8-scratch · No running session to reload');
    await expect(lineOf(scratch)).toContainText('Validating local marketplace');

    const tools = marketplaceRow(manage, 'tools');
    await marketplaceAction(tools, 'Remove…');
    sheet = sheetOf(page, 'marketplace-remove');
    await expect(sheet.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
    await sheet.getByRole('checkbox', { name: 'I understand' }).check();
    shown.push(await argvOf(sheet));
    expect(shown.at(-1)).toEqual(['plugin', 'marketplace', 'remove', 'tools', '--json']);
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(tools).toHaveCount(0);
    await expect(manage.locator('[data-marketplace-result="tools"]')).toContainText('Successfully removed marketplace: tools');
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('a plugin that declares a dependency installs with it from its card, the sheet announcing the dependency caches; removing the marketplace names the plugins it uninstalls and uninstalls them', async ({ backend }) => {
    const { page } = backend;
    const home = configHome(backend);
    const state = backend.cli.state();
    backend.cli.setState({ ...state, marketplaces: state.marketplaces.map((m) => ({ ...m, plugins: [...m.plugins, { name: 'e8-deps', version: '0.5.0', description: 'Needs e8-probe', dependencies: ['e8-probe'] }] })) });
    const w = await openPlugins(backend);
    await openBrowse(w);
    await cardOf(w, 'e8-deps@e8-scratch').getByRole('button', { name: 'Install', exact: true }).click();
    const install = sheetOf(page, 'install');
    await expect(install.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem')).toHaveText([`${home}/settings.json`, `${home}/plugins/installed_plugins.json`, `${home}/plugins/cache/e8-scratch/e8-deps/<version>/`, `${home}/plugins/cache/<any-marketplace>/<dependency>/`]);
    await expect(install).toContainText('and the cache directories of any dependencies the marketplace declares, from this or an allowlisted marketplace, each enabled in the settings file above');
    const shown = [await argvOf(install)];
    await install.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(cardOf(w, 'e8-deps@e8-scratch')).toHaveAttribute('data-installed', 'here');
    await expect(cardOf(w, 'e8-probe@e8-scratch')).toHaveAttribute('data-installed', 'here'); // the dependency came with it
    await toMyItems(w);
    await expectListed(w, 'e8-deps@e8-scratch');
    await expectListed(w, 'e8-probe@e8-scratch');

    // the marketplace removal uninstalls all three: the sheet names them and the files that writes
    const manage = await openAdd(w, 'Manage marketplaces');
    await expect(marketplaceRow(manage, MARKET)).toContainText('3 plugins installed');
    await marketplaceAction(marketplaceRow(manage, MARKET), 'Remove…');
    const remove = sheetOf(page, 'marketplace-remove');
    shown.push(await argvOf(remove));
    expect(shown.at(-1)).toEqual(['plugin', 'marketplace', 'remove', MARKET, '--json']);
    await expect(remove).toContainText(/Also uninstalls 3 plugins: /);
    for (const id of ['e8-tools@e8-scratch (user)', 'e8-deps@e8-scratch (user)', 'e8-probe@e8-scratch (user)']) await expect(remove).toContainText(id);
    const writes = remove.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem');
    await expect(writes).toHaveCount(9);
    expect((await writes.allInnerTexts()).sort()).toEqual(
      [
        `${home}/settings.json`,
        `${home}/plugins/known_marketplaces.json`,
        `${home}/plugins/installed_plugins.json`,
        `${home}/plugins/cache/e8-scratch/`,
        `${home}/plugins/data/e8-tools@e8-scratch/`,
        `${home}/plugins/data/e8-deps@e8-scratch/`,
        `${home}/plugins/data/e8-probe@e8-scratch/`,
        `${backend.project}/.claude/settings.json`, // where an enable or disable override for them may sit
        `${backend.project}/.claude/settings.local.json`,
      ].sort(),
    );
    await expect(remove).toContainText('and any enable or disable override for them in these settings files');
    await expect(remove.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
    await remove.getByRole('checkbox', { name: 'I understand' }).check();
    await remove.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(manage.locator('[data-marketplace-result="e8-scratch"]')).toContainText('Successfully removed marketplace: e8-scratch');
    await expect(manage).toContainText('No marketplaces added yet.');
    await manage.getByRole('button', { name: 'Done' }).click();
    await expect(w.locator('[data-plugins-section="my-items"]')).toContainText('Add your first plugins');
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  // P2-B M3 (the execution document §4 items 1, 2 and 9; §6.2): the library over a registry shaped like the owner's.
  test('My items on an owner-shaped registry: one row per plugin in Desktop’s groups, no path or “unknown”; Turn off and on, Update and Uninstall from the overflow run exactly the sheets’ argv', async ({ backend }) => {
    const { page, project, userData } = backend;
    backend.cli.setState(ownerShapedState(project, join(userData, 'elsewhere')));
    const w = await openPlugins(backend);
    const items = w.locator('[data-plugins-section="my-items"]');
    const idsIn = (group: string) => items.locator(`[data-plugins-group="${group}"] [data-plugin-row]`).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-plugin-row')));
    const o = (name: string) => `${name}@claude-plugins-official`;
    // newest first within each group (the representative installation's last update)
    await expect.poll(() => idsIn('here')).toEqual(['doperpowers@doperpowers', ...['feature-dev', 'code-review', 'frontend-design', 'claude-code-setup', 'claude-md-management', 'security-guidance', 'context7', 'typescript-lsp', 'plugin-dev'].map(o)]);
    expect(await idsIn('anthropic')).toEqual(['chrome-devtools-mcp', 'telegram', 'code-modernization', 'pyright-lsp', 'rust-analyzer-lsp', 'swift-lsp'].map(o));
    expect(await idsIn('added')).toEqual(['ptc@ptc-tool', 'designer@designer', 'cua@cua', 'eli5@claude-community']);
    await expect(items.locator('[data-plugins-group]')).toHaveCount(3);
    await expect(items.getByRole('heading')).toHaveText(['In this project', 'From Anthropic & Partners', 'From marketplaces you added'].map((h) => new RegExp(`^${h}`)));
    await expect(items).not.toContainText('unknown');
    await expect(items).not.toContainText(project);
    await expect(items.locator('[data-plugin-row="doperpowers@doperpowers"]')).toHaveCount(1); // 47 installations, one row
    await expect(installedRow(w, o('context7'), 'project').getByText('Disabled', { exact: true })).toBeVisible();
    await expect(installedRow(w, o('pyright-lsp'))).toContainText('by Anthropic · python language server'); // no plugin.json: its marketplace entry
    await expect(installedRow(w, o('feature-dev'), 'project').getByText('New', { exact: true })).toBeVisible();

    // Show › Other projects: what is installed only for other projects, read-only
    await w.getByRole('button', { name: 'Show' }).click();
    await page.getByRole('menuitemradio', { name: 'Other projects' }).click();
    await expect.poll(async () => (await idsIn('otherProjects')).sort()).toEqual(['agent-sdk-dev', 'cloud-sql-postgresql', 'code-simplifier', 'commit-commands', 'explanatory-output-style', 'linear', 'playground', 'skill-creator', 'supabase'].map(o));
    await expect(items.getByRole('button', { name: /^More actions for / })).toHaveCount(0);
    await expect(items.locator(`[data-plugin-row="${o('supabase')}"]`)).toContainText('other projects · manage it from a session there');
    await w.getByRole('button', { name: 'Show' }).click();
    await page.getByRole('menuitemradio', { name: 'All plugins' }).click();

    // P2-B M4: a row low in the scrolled list opens its detail; Back returns to the list where it was, the row focused
    const pane = w.locator('[data-library-pane]');
    const eli5 = installedRow(w, 'eli5@claude-community');
    await eli5.scrollIntoViewIfNeeded();
    const scrolled = await pane.evaluate((el) => el.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    const detail = await openDetail(w, 'eli5@claude-community');
    await expect(w.getByRole('searchbox', { name: 'Search plugins' })).toHaveCount(0);
    await page.keyboard.press('Meta+BracketLeft');
    await expect(detail).toHaveCount(0);
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(scrolled);
    await expect(eli5.getByRole('button', { name: /^View / })).toBeFocused();

    const shown: string[][] = [];
    const confirm = async (action: string, submit: string, expected: string[], acknowledge = false) => {
      const sheet = sheetOf(page, action);
      const argv = await argvOf(sheet);
      expect(argv).toEqual(expected);
      shown.push(argv);
      if (acknowledge) await sheet.getByRole('checkbox', { name: 'I understand' }).check();
      await sheet.getByRole('button', { name: submit, exact: true }).click();
      await expect(sheet).toBeHidden();
    };
    const chrome = installedRow(w, o('chrome-devtools-mcp'));
    await rowAction(chrome, 'Turn off');
    await confirm('disable', 'Disable', ['plugin', 'disable', o('chrome-devtools-mcp'), '--scope', 'user', '--json']);
    await expect(lineOf(chrome)).toContainText('Successfully disabled plugin');
    await expectListed(w, o('chrome-devtools-mcp'), 'user', false);
    await rowAction(chrome, 'Turn on');
    await confirm('enable', 'Enable', ['plugin', 'enable', o('chrome-devtools-mcp'), '--scope', 'user', '--json']);
    await expectListed(w, o('chrome-devtools-mcp'));
    await rowAction(chrome, 'Update');
    await confirm('update', 'Update', ['plugin', 'update', o('chrome-devtools-mcp'), '--scope', 'user', '--json']);
    await expect(lineOf(chrome)).not.toHaveText('Working…');
    // the representative installation of a plugin installed here is the project's: the change acts on it
    const design = installedRow(w, o('frontend-design'), 'project');
    await rowAction(design, 'Uninstall…');
    await confirm('uninstall', 'Uninstall', ['plugin', 'uninstall', o('frontend-design'), '--scope', 'project', '--json'], true);
    await expect(design).toHaveCount(0);
    await expect(w.locator(`[data-plugin-result="${o('frontend-design')}"]`)).toContainText('Successfully uninstalled plugin');
    expect(mutations(backend)).toEqual(shown); // G4: exactly the argument lists the sheets showed
    expect(backend.consoleErrors()).toEqual([]);
  });

  // P2-B M5 (the execution document §4 items 4 and 5; §6.2): Browse over a registry shaped like the owner's, with the
  // engine's built-in directory listing the twin of an official plugin, a directory-only plugin and the twin of an
  // installed one (which the engine leaves out with it).
  test('Browse on an owner-shaped registry: folded cards with the engine’s counts, installed cards joined in, Installed in other projects still installs here', async ({ backend }) => {
    const { page, project, userData } = backend;
    const owner = ownerShapedState(project, join(userData, 'elsewhere'));
    const twin = (name: string) => ({ name, version: null, description: `${name}, as the directory lists it`, source: { source: 'git-subdir', url: 'https://github.com/anthropics/claude-plugins-official', path: `plugins/${name}` } });
    backend.cli.setState({
      ...owner,
      marketplaces: owner.marketplaces.map((m) => (m.name === 'claude-plugins-official' ? { ...m, plugins: [...m.plugins, { name: 'pr-review-toolkit', version: '1.0.0', description: 'Review pull requests with specialised agents', author: 'Anthropic', installCount: 210_500 }] } : m)),
      directory: [twin('pr-review-toolkit'), twin('code-review'), { name: 'acme-only', version: null, description: 'Listed by the directory alone', source: { source: 'url', url: 'https://github.com/acme/only.git' } }],
    });
    const w = await openPlugins(backend);
    const o = (name: string) => `${name}@claude-plugins-official`;
    const d = (name: string) => `${name}@anthropic-plugin-directory`;
    await openBrowse(w);
    // the fold: one card, the directory's, with the official count; the official twin is no card of its own
    await expect(cardOf(w, d('pr-review-toolkit')).locator('[data-install-count]')).toHaveText('210.5K installs');
    await expect(cardOf(w, o('pr-review-toolkit'))).toHaveCount(0);
    await expect(cardOf(w, d('acme-only'))).toBeVisible();
    await expect(cardOf(w, d('acme-only')).locator('[data-install-count]')).toHaveCount(0);
    await expect(cardOf(w, d('code-review'))).toHaveCount(0); // the engine hides the twin of an installed plugin
    await expect(cardOf(w, o('code-review'))).toHaveAttribute('data-installed', 'here'); // installed here: joined back in
    await expect(cardOf(w, o('code-review')).locator('[data-install-count]')).toHaveCount(0); // never a borrowed count
    await expect(cardOf(w, o('code-review'))).toHaveAttribute('data-section', 'anthropic');
    // Filter › Source lists the sections (the community marketplace is not Anthropic's); Sort › Most popular, counts first
    await w.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('menuitemradio')).toHaveText(['All sources', 'From Anthropic & Partners', 'claude-community', 'cua', 'designer', 'doperpowers', 'ptc-tool'].map((name) => new RegExp(`${name}$`)));
    await page.getByRole('menuitemradio', { name: 'claude-community' }).click();
    await expect(browseOf(w).locator('[data-browse-card]')).toHaveCount(1);
    await expect(cardOf(w, 'eli5@claude-community')).toHaveAttribute('data-section', 'marketplace:claude-community');
    await w.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('menuitemradio', { name: 'All sources' }).click();
    await expect(browseOf(w).locator('[data-browse-card]').first()).toHaveAttribute('data-browse-card', d('pr-review-toolkit'));

    // the folded card's detail: the credit, the count, Also listed in, What's inside from the official clone
    const detail = await openCard(w, d('pr-review-toolkit'));
    await expect(detail).toContainText('from anthropic-plugin-directory · 1.0.0 · 210.5K installs');
    await expect(detail).toContainText('Also listed in claude-plugins-official');
    await expect(detail.getByRole('region', { name: 'What’s inside' })).toBeVisible();
    await detail.getByRole('button', { name: 'Back to Browse' }).click();

    // supabase: installed only in other projects (45 worktrees and one more) — Installed in other projects, and Install here
    const supabase = cardOf(w, o('supabase'));
    await expect(supabase).toHaveAttribute('data-installed', 'otherProjects');
    await expect(supabase).toContainText('Installed in other projects');
    await supabase.getByRole('button', { name: 'Install', exact: true }).click();
    const sheet = sheetOf(page, 'install');
    await sheet.getByRole('radio', { name: 'Project' }).check();
    const argv = await argvOf(sheet);
    expect(argv).toEqual(['plugin', 'install', o('supabase'), '--scope', 'project', '--json']);
    await sheet.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(supabase).toHaveAttribute('data-installed', 'here');
    await expect(lineOf(supabase)).toHaveText(`Successfully installed plugin: ${o('supabase')} (scope: project) · No running session to reload`);
    expect(backend.cli.state().installed.filter((p) => p.id === o('supabase') && p.projectPath === project).map((p) => p.scope)).toEqual(['project']); // a second project's record
    await toMyItems(w);
    await expect(w.locator(`[data-plugins-group="here"] [data-plugin-row="${o('supabase')}"]`)).toBeVisible();

    // Manage marketplaces: every marketplace the engine lists, the official one included; never the built-in directory
    const manage = await openAdd(w, 'Manage marketplaces');
    await expect(manage.locator('[data-marketplace-row]')).toHaveCount(6);
    await expect(marketplaceRow(manage, 'claude-plugins-official')).toContainText('anthropics/claude-plugins-official');
    await expect(marketplaceRow(manage, 'anthropic-plugin-directory')).toHaveCount(0);
    expect(mutations(backend)).toEqual([argv]);
    expect(backend.consoleErrors()).toEqual([]);
  });

  // P2-B M6 (§5.10): `/skills` is the skills library: 2.1.295's dialog answer (U3 F4) in My items' groups, a plugin's skill
  // under its plugin's group (the CLI stub's owner-shaped registry installs frontend-design for this project) with the
  // plugin's name as its badge, and Use in chat putting `/<skill> ` at the composer's caret and sending nothing.
  test('/skills groups the skills by where they come from, the plugin’s skill badged with its plugin; Use in chat inserts and sends nothing', async ({ backend }) => {
    const { app, page, project, userData } = backend;
    backend.cli.setState(ownerShapedState(project, join(userData, 'elsewhere')));
    const skill = (name: string, source: string, description: string) => ({ name, display_name: name, description, source, tokens: 20, state: 'on', advertised: true, handles: {} });
    const answer = {
      skills: [
        skill('frontend-design:frontend-design', 'plugin', 'Guidance for distinctive, intentional visual design'),
        skill('p2b-project', 'project', 'A skill this project keeps in .claude/skills'),
        skill('p2b-user', 'user', 'A skill of your own'),
        skill('debug', 'built-in', 'Debug the session'),
        skill('lookup', 'mcp', 'Look a thing up through a server'),
      ],
    };
    await app.evaluate((_, dialog) => void (globalThis as unknown as BackendGlobal).__maws_widget_backend.script('session.getSkillsDialog', () => dialog), answer);
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await inProject(backend); // the CLI's listing runs in the scratch project, where frontend-design is installed
    const message = page.getByRole('textbox', { name: 'Message' });
    await expect(message).toBeVisible();
    await pick(page, 'skills');
    const w = widget(page, 'skills');
    await expect(w).toHaveAttribute('data-widget-size', 'library');
    const idsIn = (group: string) => w.locator(`[data-skills-group="${group}"] [data-skill-row]`).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-skill-row')));
    await expect.poll(() => idsIn('here')).toEqual(['frontend-design:frontend-design', 'p2b-project']);
    expect(await idsIn('yours')).toEqual(['p2b-user']);
    expect(await idsIn('anthropic')).toEqual(['debug']);
    expect(await idsIn('added')).toEqual(['lookup']);
    await expect(w.locator('[data-skills-list]').getByRole('heading')).toHaveText(['In this project', 'Created by you', 'From Anthropic & Partners', 'From marketplaces you added'].map((h) => new RegExp(`^${h}`)));
    const design = w.locator('[data-skill-row="frontend-design:frontend-design"]');
    await expect(design.locator('[data-skill-name]')).toHaveText('frontend-design');
    await expect(design.locator('[data-skill-badge]')).toHaveText('Frontend design');
    await expect(w.locator('[data-skill-row="lookup"] [data-skill-badge]')).toHaveText('mcp');

    // Search, Sort › Plugin name (one list), and Escape clearing the search before it closes anything
    const search = w.getByRole('searchbox', { name: 'Search skills' });
    await search.fill('own');
    await expect(w.locator('[data-skill-row]')).toHaveCount(1);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(w).toBeVisible();
    await w.getByRole('button', { name: 'Sort by' }).click();
    await page.getByRole('menuitemradio', { name: 'Plugin name' }).click();
    await expect(w.locator('[data-skills-group]')).toHaveCount(1);
    await expect(w.locator('[data-skill-row]').first()).toHaveAttribute('data-skill-row', 'frontend-design:frontend-design');
    await w.getByRole('button', { name: 'Sort by' }).click();
    await page.getByRole('menuitemradio', { name: 'Name', exact: true }).click();

    // the detail, then Use in chat: the dialog closes and the composer holds the skill, nothing sent
    await w.locator('[data-skill-row="frontend-design:frontend-design"]').click(); // the row is one target, View <name>
    const detail = w.locator('[data-skill-detail]');
    await expect(detail).toContainText('/frontend-design:frontend-design');
    await expect(detail).toContainText('Guidance for distinctive, intentional visual design');
    const sentBefore = (await commandsOf(backend)).filter((c) => c.command === 'session.send').length;
    await detail.getByRole('button', { name: 'Use in chat' }).click();
    await expect(w).toBeHidden();
    await expect(message).toContainText('/frontend-design:frontend-design');
    expect((await commandsOf(backend)).filter((c) => c.command === 'session.send')).toHaveLength(sentBefore);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('the panel’s Plugins section counts the loaded plugins and reloads mods and skills; /skills reloads skills', async ({ appBackend: backend }) => {
    const { page } = backend;
    await holdOperations(backend, true);
    // the product's window: the session's tab and its panel summary
    await (await sidebarRow(page, { appSessionId: READY })).click();
    const plugins = page.locator('[data-region="panel"]').getByRole('region', { name: 'Plugins' });
    await expect(plugins).toContainText('Plugins · 11 loaded'); // pass2/real-settings seq 15
    const reloadMods = plugins.getByRole('button', { name: 'Reload plugins' });
    const line = reloadMods.locator('xpath=following-sibling::*[@role="status"]');
    await reloadMods.click();
    await expect(line).toHaveText('Working…');
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(line).toHaveText('Reloaded · 52 commands · 5 agents · 11 plugins · 0 errors');
    await plugins.getByRole('button', { name: 'Reload skills' }).click();
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(line).toHaveText('Reloaded · 15 skills');

    // /skills from the session's composer, as the palette opens it
    await page.locator('[data-region="main"]').getByRole('textbox', { name: 'Message' }).click();
    await page.keyboard.type('/skills');
    await expect(page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]')).toContainText('/skills');
    await page.keyboard.press('Enter');
    const skills = widget(page, 'skills');
    await skills.getByRole('button', { name: 'Reload skills' }).click(); // P2-B M6: the skills library's head
    await expect(skills.getByRole('status')).toHaveText('Working…');
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(skills.getByRole('status')).toHaveText('Reloaded · 15 skills');
    const ops = (await commandsOf(backend)).filter((c) => c.command === 'session.reloadPlugins' || c.command === 'session.reloadSkills').map((c) => c.command);
    expect(ops).toEqual(['session.reloadPlugins', 'session.reloadSkills', 'session.reloadSkills']);
    expect(backend.consoleErrors()).toEqual([]);
  });
});
