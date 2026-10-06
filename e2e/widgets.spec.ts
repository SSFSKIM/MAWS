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
import { scratchMarketplace, stubCalls, writePluginCliStub, type PluginCliStub, type StubState } from '../test/support/plugin-cli-stub';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

const SCENARIO = 'stub:test/fixtures/shell/nine-sessions.json';
const READY = 'app-7412a115'; // ready, idle, routed through the relay
const READS = 'spikes/protocol-probe/fixtures/reads.jsonl';
const CONTROLS = 'test/fixtures/engine/auto-routed-controls.jsonl'; // pass2/auto-routed without the unissuable fork_conversation pair
const NAMES = ['model', 'effort', 'fast', 'permissions', 'usage', 'config', 'plugins', 'mcp', 'sandbox', 'hooks', 'memory', 'skills', 'agents', 'status', 'compact', 'context', 'rename', 'resume', 'export', 'diff', 'rewind' /* W3 */];

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
  await expect(w.locator('[data-plugins-section="installed"]')).toBeVisible();
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
const installedRow = (w: Locator, id: string, scope = 'user') => w.locator(`[data-plugins-section="installed"] [data-plugin-row="${id}"][data-plugin-scope="${scope}"]`);
const marketplaceRow = (w: Locator, name: string) => w.locator(`[data-marketplace-row="${name}"]`);
const sheetOf = (page: Page, action: string) => page.locator(`[data-plugins-sheet="${action}"]`);
const argvOf = async (sheet: Locator) => JSON.parse((await sheet.locator('[data-plugins-argv]').getAttribute('data-plugins-argv')) ?? 'null') as string[];
// Opens Available (its read runs only then) and one marketplace's group; answers the group.
async function openAvailable(w: Locator, marketplace: string, count: number): Promise<Locator> {
  const section = w.locator('[data-plugins-section="available"]');
  await section.locator('summary').first().click();
  // the group by its marketplace (its count moves when the catalogue is read again)
  const group = section.locator('details details').filter({ has: w.page().locator('summary', { hasText: new RegExp(`^${marketplace} · \\d+ plugins?$`) }) });
  await expect(group.locator('summary')).toHaveText(`${marketplace} · ${count} plugin${count === 1 ? '' : 's'}`);
  await group.locator('summary').click();
  return group;
}
// A row's own status line (the widget holds several).
const lineOf = (row: Locator) => row.getByRole('status');
// The engine's `--available` leaves out what is installed: an install's row leaves Available, its result stays beneath.
const availableResult = (w: Locator, id: string) => lineOf(w.locator(`[data-plugins-section="available"] [data-plugin-result="${id}"]`));

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
      await expect(widget(page, name).locator('footer')).toContainText('Read with');
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
    await expect(widget(page, 'sandbox')).toContainText('disabled · supported');

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
    await expect(widget(page, 'plugins').getByRole('list', { name: 'Loaded plugins' }).getByRole('listitem')).toHaveCount(11);

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

    await pick(page, 'skills'); // an empty get_skills_dialog (reads.jsonl seq 72): the catalogue's skills (seq 9)
    const skills = widget(page, 'skills').getByRole('list', { name: 'Skills' }).getByRole('listitem');
    await expect(skills).toHaveCount(18);
    await skills.filter({ hasText: '/deep-research' }).getByRole('button', { name: 'Use' }).click();
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
    // E8: Reload mods, its line beside the button (the widget's rows carry status lines of their own)
    const reloadMods = widget(page, 'plugins').getByRole('button', { name: 'Reload mods' });
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

  test('resume lists the project’s sessions', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
    await pick(page, 'resume');
    const rows = widget(page, 'resume').getByRole('list', { name: 'Sessions of this project' }).getByRole('listitem');
    await expect(rows).toHaveCount(2); // nine-sessions' proj-claude-usage-menubar, without this session
    await expect(rows.nth(0)).toContainText('Usage reset countdown');
    await expect(rows.nth(1)).toContainText('SDK wire inventory');
    // C10's resume (the session action it registers): `session.start` with no message, the record's own route
    await rows.nth(1).getByRole('button', { name: 'Resume' }).click();
    await expect(widget(page, 'resume')).toBeHidden();
    await expect.poll(async () => (await commandsOf(backend)).filter((c) => c.command === 'session.start')).toEqual([{ command: 'session.start', input: { appSessionId: 'app-1238089b', message: null, options: {} } }]);
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
    await expect(widget(page, 'sandbox')).toContainText('disabled · supported');
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

// ---- E8: plugins and marketplaces, managed through the engine's CLI ----------------------------------------------------
// E8 execution document, M3's action-to-proof matrix, the stub e2e column. The host runs the plugin CLI stub as the
// engine binary (MAWS_E2E_ENGINE_BIN), so the widget, the confirm sheet, the X2 surface, the host's runner and its result
// parsing are the product's own; the stub keeps its registry in a state file and logs every argv it ran (`calls.log`).
// The scenario's sessions have no host process, so a change reloads no session (`No running session to reload`).
test.describe('plugin management (E8)', () => {
  test('lists the engine’s plugins and marketplaces; Available is read only when its section opens', async ({ backend }) => {
    const w = await openPlugins(backend);
    const tools = installedRow(w, 'e8-tools@e8-scratch');
    await expect(tools).toContainText('1.0.0');
    await expect(tools).toContainText('user · enabled · e8-scratch');
    await expect(tools.getByRole('switch', { name: 'Enabled: e8-tools@e8-scratch' })).toHaveAttribute('aria-checked', 'true');
    const market = marketplaceRow(w, MARKET);
    await expect(market).toContainText('directory');
    await expect(market).toContainText(join(backend.userData, 'market'));
    // the foot names the config home and the global config file as `plugins.env` answers them (D-12)
    await expect(w.locator('footer')).toContainText(configHome(backend));
    await expect(w.locator('footer')).toContainText(join(configHome(backend), '.claude.json'));

    const reads = () => stubCalls(backend.cli).filter((argv) => argv[0] === 'plugin');
    expect(reads()).toContainEqual(['plugin', 'list', '--json']);
    expect(reads()).toContainEqual(['plugin', 'marketplace', 'list', '--json']);
    expect(reads().filter((argv) => argv.includes('--available'))).toEqual([]); // not before the section opens
    const group = await openAvailable(w, MARKET, 2); // the installed e8-tools is not offered
    expect(reads()).toContainEqual(['plugin', 'list', '--json', '--available']);
    await expect(group.locator('[data-plugin-row="e8-probe@e8-scratch"]').getByRole('button', { name: 'Install…' })).toBeVisible();
    await expect(group.locator('[data-plugin-row="e8-extra@e8-scratch"]').getByRole('button', { name: 'Install…' })).toBeVisible();
    await expect(group.locator('[data-plugin-row="e8-tools@e8-scratch"]')).toHaveCount(0);
    expect(mutations(backend)).toEqual([]);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('install at user scope: the sheet names the command and the writes; the row shows the CLI’s progress, then its result; the CLI ran the sheet’s argv', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    const group = await openAvailable(w, MARKET, 2);
    const row = group.locator('[data-plugin-row="e8-probe@e8-scratch"]');
    await row.getByRole('button', { name: 'Install…' }).click();
    const sheet = sheetOf(page, 'install');
    await expect(sheet.getByRole('heading', { name: 'Install e8-probe@e8-scratch?' })).toBeVisible();
    const argv = await argvOf(sheet);
    expect(argv).toEqual(['plugin', 'install', 'e8-probe@e8-scratch', '--scope', 'user', '--json']);
    await expect(sheet.locator('[data-plugins-argv]')).toHaveText('claude plugin install e8-probe@e8-scratch --scope user --json');
    const home = configHome(backend);
    await expect(sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem')).toHaveText([`${home}/settings.json`, `${home}/plugins/installed_plugins.json`, `${home}/plugins/cache/e8-scratch/e8-probe/<version>/`]);
    await expect(sheet).toContainText(`and keeps its own records in ${home}/.claude.json`);
    await expect(sheet).toContainText(/Reloads plugins in \d+ running sessions?|No running session to reload/);
    expect(mutations(backend)).toEqual([]); // nothing ran before the confirm

    backend.cli.hold(true);
    await sheet.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(lineOf(row)).toHaveText('Holding install e8-probe@e8-scratch --scope user (plugin CLI stub)'); // the CLI's progress line
    await expect(row.getByRole('button', { name: 'Stop' })).toBeVisible();
    backend.cli.hold(false);
    await expect(installedRow(w, 'e8-probe@e8-scratch')).toContainText('user · enabled · e8-scratch'); // plugins.changed reread the list
    await expect(row).toHaveCount(0); // and Available, which no longer offers it
    await expect(availableResult(w, 'e8-probe@e8-scratch')).toHaveText('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · No running session to reload');
    expect(mutations(backend)).toEqual([argv]); // G4: exactly the argument list the sheet showed
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('install at project and at local scope: the argv carries the scope and the sheet names the project’s settings file', async ({ backend }) => {
    const { page, project } = backend;
    const w = await openPlugins(backend);
    const group = await openAvailable(w, MARKET, 2);
    const shown: string[][] = [];
    for (const [plugin, scope, label, file] of [
      ['e8-probe', 'project', 'Project', '.claude/settings.json'],
      ['e8-extra', 'local', 'Local', '.claude/settings.local.json'],
    ] as const) {
      const row = group.locator(`[data-plugin-row="${plugin}@e8-scratch"]`);
      await row.getByRole('button', { name: 'Install…' }).click();
      const sheet = sheetOf(page, 'install');
      await sheet.getByRole('radio', { name: label }).check();
      await expect(sheet).toContainText(`In ${project}`);
      const argv = await argvOf(sheet);
      expect(argv).toEqual(['plugin', 'install', `${plugin}@e8-scratch`, '--scope', scope, '--json']);
      await expect(sheet.getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem').first()).toHaveText(`${project}/${file}`);
      shown.push(argv);
      await sheet.getByRole('button', { name: 'Install', exact: true }).click();
      await expect(installedRow(w, `${plugin}@e8-scratch`, scope)).toContainText(`${scope} · enabled · e8-scratch`);
      await expect(row).toHaveCount(0);
      await expect(availableResult(w, `${plugin}@e8-scratch`)).toHaveText(`Successfully installed plugin: ${plugin}@e8-scratch (scope: ${scope}) · No running session to reload`);
    }
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('the switch disables and enables after its sheet, its position from the read-back; Cancel runs nothing; Update shows the version change; Uninstall asks for the acknowledgement', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    const id = 'e8-tools@e8-scratch';
    const row = installedRow(w, id);
    const toggle = row.getByRole('switch', { name: `Enabled: ${id}` });
    const shown: string[][] = [];
    const confirm = async (action: string, submit: string, expected: string[]) => {
      const sheet = sheetOf(page, action);
      const argv = await argvOf(sheet);
      expect(argv).toEqual(expected);
      shown.push(argv);
      await sheet.getByRole('button', { name: submit, exact: true }).click();
      await expect(sheet).toBeHidden();
    };

    await toggle.click();
    await expect(sheetOf(page, 'disable').getByRole('list', { name: "The engine's CLI writes:" }).getByRole('listitem')).toHaveText([`${configHome(backend)}/settings.json`]);
    await confirm('disable', 'Disable', ['plugin', 'disable', id, '--scope', 'user', '--json']);
    await expect(lineOf(row)).toHaveText('Successfully disabled plugin: e8-tools (scope: user) · No running session to reload');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(row).toContainText('user · disabled · e8-scratch');
    await toggle.click();
    await confirm('enable', 'Enable', ['plugin', 'enable', id, '--scope', 'user', '--json']);
    await expect(lineOf(row)).toHaveText('Successfully enabled plugin: e8-tools (scope: user) · No running session to reload');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Cancel: the sheet closes and the CLI never runs: the whole calls.log, reads included, is as it was
    const log = await settledLog(backend);
    await row.getByRole('button', { name: 'Update' }).click();
    await sheetOf(page, 'update').getByRole('button', { name: 'Cancel' }).click();
    await expect(sheetOf(page, 'update')).toBeHidden();
    await page.waitForTimeout(500);
    expect(readFileSync(backend.cli.callsLog, 'utf8')).toBe(log);
    expect(mutations(backend)).toEqual(shown);

    // Update: the marketplace now offers 1.1.0
    const state = backend.cli.state();
    backend.cli.setState({ ...state, marketplaces: state.marketplaces.map((m) => ({ ...m, plugins: m.plugins.map((p) => (p.name === 'e8-tools' ? { ...p, version: '1.1.0' } : p)) })) });
    await row.getByRole('button', { name: 'Update' }).click();
    await confirm('update', 'Update', ['plugin', 'update', id, '--scope', 'user', '--json']);
    await expect(lineOf(row)).toHaveText('Plugin "e8-tools" updated from 1.0.0 to 1.1.0 for scope user. Restart to apply changes. · 1.0.0 → 1.1.0 · No running session to reload');
    await expect(row).toContainText('1.1.0');

    // Uninstall: destructive, so the default button waits for the acknowledgement; the row leaves, its result stays
    await row.getByRole('button', { name: 'Uninstall…' }).click();
    const sheet = sheetOf(page, 'uninstall');
    await expect(sheet.getByRole('button', { name: 'Uninstall', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter'); // Enter never destroys without the acknowledgement
    await expect(sheet).toBeVisible();
    await sheet.getByRole('checkbox', { name: 'I understand' }).check();
    await confirm('uninstall', 'Uninstall', ['plugin', 'uninstall', id, '--scope', 'user', '--json']);
    await expect(row).toHaveCount(0);
    await expect(w.locator(`[data-plugin-result="${id}"]`)).toContainText('Successfully uninstalled plugin: e8-tools (scope: user) · No running session to reload');
    await expect(w.locator('[data-plugins-section="installed"]')).toContainText('No plugins installed');
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('an engine error is the engine’s words and code in red; a marketplace-declared command opens a second sheet and Run it accepts it by its sha256, never -y', async ({ backend }) => {
    const { page } = backend;
    const w = await openPlugins(backend);
    const group = await openAvailable(w, MARKET, 2);

    // not_found: the catalogue the section read still offers e8-extra, which the marketplace no longer has
    const state = backend.cli.state();
    backend.cli.setState({ ...state, marketplaces: state.marketplaces.map((m) => ({ ...m, plugins: m.plugins.filter((p) => p.name !== 'e8-extra') })) });
    const extra = group.locator('[data-plugin-row="e8-extra@e8-scratch"]');
    await extra.getByRole('button', { name: 'Install…' }).click();
    const shown = [await argvOf(sheetOf(page, 'install'))]; // each argv a sheet showed and its confirm ran, in order
    await sheetOf(page, 'install').getByRole('button', { name: 'Install', exact: true }).click();
    await expect(group.locator('summary')).toHaveText('e8-scratch · 1 plugin'); // read again once the CLI ended: no longer offered
    await expect(extra).toHaveCount(0);
    const failure = availableResult(w, 'e8-extra@e8-scratch'); // the result outlives its row
    await expect(failure).toHaveText('Plugin "e8-extra" not found in marketplace "e8-scratch". Your local copy may be out of date — try `claude plugin marketplace update e8-scratch`. · not_found');
    await expect(failure).toHaveClass(/text-danger/);

    // shownCommand: the CLI refuses to run a declared command unseen; the second sheet shows it; Run it reruns the
    // request with --accept-command <sha256>
    const sha256 = 'c0ffee'.padEnd(64, '0');
    backend.cli.setState({ ...backend.cli.state(), fail: { install: { failureCode: 'command_source_refused', message: 'e8-probe declares a command to run before it installs', shownCommand: { sha256, command: ['node', './scripts/setup.js'] } } } });
    const probe = group.locator('[data-plugin-row="e8-probe@e8-scratch"]');
    await probe.getByRole('button', { name: 'Install…' }).click();
    shown.push(await argvOf(sheetOf(page, 'install')));
    await sheetOf(page, 'install').getByRole('button', { name: 'Install', exact: true }).click();
    const declared = sheetOf(page, 'install');
    await expect(declared.getByRole('heading', { name: 'Run the command e8-probe@e8-scratch declares?' })).toBeVisible();
    await expect(declared.locator('[data-plugins-declared]')).toHaveText('node ./scripts/setup.js');
    const accepted = await argvOf(declared);
    expect(accepted).toEqual(['plugin', 'install', 'e8-probe@e8-scratch', '--scope', 'user', '--accept-command', sha256, '--json']);
    await declared.getByRole('button', { name: 'Run it' }).click();
    await expect(probe).toHaveCount(0);
    await expect(availableResult(w, 'e8-probe@e8-scratch')).toHaveText('Successfully installed plugin: e8-probe@e8-scratch (scope: user) · No running session to reload');
    shown.push(accepted);
    expect(shown.slice(0, 2)).toEqual([
      ['plugin', 'install', 'e8-extra@e8-scratch', '--scope', 'user', '--json'],
      ['plugin', 'install', 'e8-probe@e8-scratch', '--scope', 'user', '--json'],
    ]);
    expect(mutations(backend)).toEqual(shown); // the rejected runs included: exactly what the three sheets showed
    expect(stubCalls(backend.cli).flat()).not.toContain('-y');
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('marketplaces: add a folder, an owner/repo and a URL; a missing folder is the engine’s invalid_source; Refresh; Remove after the acknowledgement', async ({ backend }) => {
    const { page, userData } = backend;
    const w = await openPlugins(backend);
    const field = w.getByRole('textbox', { name: 'Add marketplace' });
    const addLine = field.locator('xpath=ancestor::form[1]').getByRole('status');
    const home = configHome(backend);
    const folder = scratchMarketplace(join(userData, 'other-market'), { name: 'e8-other', plugins: [{ name: 'e8-more', version: '2.0.0', description: 'From the second folder' }] });
    const shown: string[][] = [];
    const add = async (source: string, writes: string[]) => {
      await field.fill(source);
      await w.getByRole('button', { name: 'Add…' }).click();
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
    await expect(marketplaceRow(w, 'e8-other')).toContainText(folder);
    await add('acme/tools', [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/<name>/`]);
    await expect(addLine).toHaveText('Successfully added marketplace: tools (declared in user settings)');
    await expect(marketplaceRow(w, 'tools')).toContainText('github');
    await expect(marketplaceRow(w, 'tools')).toContainText('acme/tools');
    await add('https://example.com/acme/more.git', [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/<name>/`]);
    await expect(addLine).toHaveText('Successfully added marketplace: more (declared in user settings)');
    await expect(marketplaceRow(w, 'more')).toContainText('https://example.com/acme/more.git');
    const missing = join(userData, 'e8-does-not-exist');
    await add(missing, [`${home}/settings.json`, `${home}/plugins/known_marketplaces.json`, `${home}/plugins/marketplaces/`]);
    await expect(addLine).toHaveText(`Path does not exist: ${missing} · invalid_source`);
    await expect(addLine).toHaveClass(/text-danger/);

    const scratch = marketplaceRow(w, MARKET);
    await scratch.getByRole('button', { name: 'Refresh' }).click();
    let sheet = sheetOf(page, 'marketplace-update');
    shown.push(await argvOf(sheet));
    expect(shown.at(-1)).toEqual(['plugin', 'marketplace', 'update', MARKET, '--json']);
    await sheet.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(lineOf(scratch)).toContainText('Successfully updated marketplace: e8-scratch · No running session to reload');
    await expect(lineOf(scratch)).toContainText('Validating local marketplace');

    const tools = marketplaceRow(w, 'tools');
    await tools.getByRole('button', { name: 'Remove…' }).click();
    sheet = sheetOf(page, 'marketplace-remove');
    await expect(sheet.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
    await sheet.getByRole('checkbox', { name: 'I understand' }).check();
    shown.push(await argvOf(sheet));
    expect(shown.at(-1)).toEqual(['plugin', 'marketplace', 'remove', 'tools', '--json']);
    await sheet.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(tools).toHaveCount(0);
    await expect(w.locator('[data-marketplace-result="tools"]')).toContainText('Successfully removed marketplace: tools');
    expect(mutations(backend)).toEqual(shown);
    expect(backend.consoleErrors()).toEqual([]);
  });

  test('the panel’s Plugins section counts the loaded plugins and reloads mods and skills; /skills reloads skills', async ({ appBackend: backend }) => {
    const { page } = backend;
    await holdOperations(backend, true);
    // the product's window: the session's tab and its panel summary
    await (await sidebarRow(page, { appSessionId: READY })).click();
    const plugins = page.locator('[data-region="panel"]').getByRole('region', { name: 'Plugins' });
    await expect(plugins).toContainText('Plugins · 11 loaded'); // pass2/real-settings seq 15
    const reloadMods = plugins.getByRole('button', { name: 'Reload mods' });
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
    await skills.getByRole('button', { name: 'Reload' }).click();
    await expect(skills.getByRole('status')).toHaveText('Working…');
    await expect.poll(() => settleOperations(backend)).toBe(1);
    await expect(skills.getByRole('status')).toHaveText('Reloaded · 15 skills');
    const ops = (await commandsOf(backend)).filter((c) => c.command === 'session.reloadPlugins' || c.command === 'session.reloadSkills').map((c) => c.command);
    expect(ops).toEqual(['session.reloadPlugins', 'session.reloadSkills', 'session.reloadSkills']);
    expect(backend.consoleErrors()).toEqual([]);
  });
});
