// C11's widgets end to end (C11 execution document, Acceptance item 2), on the harness's `#widgets` page; the page needs
// a harness build (`pnpm e2e:widgets` builds one and runs this file; under a plain build the cases skip). Two groups.
// Interactive: C7's composer over a scenario session (C5's `nine-sessions`), every read answered in main by the
// fixture-backed widget backend (MAWS_WIDGET_BACKEND=fixtures) from the probe's recorded answers, whatever the order;
// the cases type `/` in the composer, open widgets, and read the backend's call log in main for the payloads the
// widgets' own interactions produced. Replay conformance: C3's strict replay behind a launched session, the widgets
// mounted passively, and a scripted driver issuing exactly the fixture's recorded frames in order through
// `window.__maws_widgets.read` (the widgets' own query under their own keys) and `window.maws.invoke`; the replay ends
// on any unrecorded write, so its reaching the fixture's `meta exit` is the proof nothing else was written.
// M2 holds the read half of the interactive group and the `reads.jsonl` case; M3 adds the mutating half and
// `auto-routed-controls`.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { OperationEvent } from '@shared/engine/operations';
import type { WidgetsHarnessApi, WidgetsPane } from '../src/renderer/src/harness/widgets/api';
import type { WidgetBackend } from '../test/support/widget-backend';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));

const SCENARIO = 'stub:test/fixtures/shell/nine-sessions.json';
const READY = 'app-7412a115'; // ready, idle, routed through the relay
const READS = 'spikes/protocol-probe/fixtures/reads.jsonl';
const NAMES = ['model', 'effort', 'fast', 'permissions', 'usage', 'config', 'plugins', 'mcp', 'sandbox', 'hooks', 'memory', 'skills', 'agents', 'status', 'compact', 'context', 'rename', 'resume', 'export', 'diff'];

const test = base.extend<{ backend: MawsLaunch; replay: MawsLaunch }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the fixtures argument to be destructured
  backend: async ({}, use, testInfo) => {
    testInfo.skip(!HARNESS_BUILT, 'the widgets page needs a harness build (pnpm e2e:widgets)');
    const maws = await launchMaws({ env: { MAWS_HARNESS: '1', MAWS_SESSION_SOURCE: SCENARIO, MAWS_SCENARIO_CLOCK: 'manual', MAWS_WIDGET_BACKEND: 'fixtures' } });
    try {
      await use(maws);
    } finally {
      await maws.cleanup();
    }
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

test.describe('interactive', () => {
  test('every name opens a widget from the palette, none listed as unavailable', async ({ backend }) => {
    const { page } = backend;
    await openPage(page, { appSessionId: READY, mode: 'interactive' });
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
      await expect(widget(page, name)).toBeVisible();
      await expect(widget(page, name).locator('footer')).toContainText('Read with');
      await page.keyboard.press('Escape'); // the frame took focus when it opened
      await expect(widget(page, name)).toBeHidden();
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
});

test.describe('replay conformance', () => {
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
    await read('session.getContextUsage', { detail: 'summary' }); // seq 56: the compact widget's read (M3 renders it)
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
