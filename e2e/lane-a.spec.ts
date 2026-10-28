// e2e:lane-a (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M5 "Proves"; acceptance 1, 2, 4 and 6): a
// terminal session on this Mac driven from MAWS through its bridge, the bridge being the fake (test/support/
// fake-bridge.ts) on the launch's scratch sminos home, and no `claude` running. Each control's body as the fake receives
// it; sends in order, a refusal keeping its draft, a held send's strip; a side question answered from its op's end; the
// gaps greyed with their reasons; no bridge as before; the reply streaming, then its row; a pane opened mid-reply, and
// that turn aborted with no `step end`.
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { FULL_CAPABILITIES, startFakeBridge, type FakeBridge } from '../test/support/fake-bridge';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { assistantRecord, backgroundAgentRecords, backgroundAgentSidecars, backgroundBashRecords, CATALOG, editTurnRecords, taskNotificationRecord, terminalSession, userRecord, type TerminalSession } from './support/lane-a';
import { openSurface } from './support/shell';
import { sidebarRow } from './support/sidebar';

function invoke<N extends CommandName>(page: Page, name: N, input: CommandInput<N>): Promise<CommandResult<N>> {
  return page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name as string, input as unknown] as const) as Promise<CommandResult<N>>;
}

function value<N extends CommandName>(result: CommandResult<N>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

interface Case {
  maws: MawsLaunch;
  page: Page;
  store: StoreFixture;
  repo: ScratchRepo;
  sid: string;
  appId: string;
  transcript: string;
  terminal: TerminalSession | null;
}

const T0 = '2026-10-28T10:00:00.000Z';
const main = (page: Page) => page.locator('[data-region="main"]');
const editor = (page: Page) => main(page).getByRole('textbox', { name: 'Message' });
const notice = (page: Page) => main(page).getByRole('note');
const strip = (page: Page) => main(page).getByRole('list', { name: 'Messages not confirmed yet' });

// The bridge's sentence as MAWS shows one: its first letter capitalised (session/controls/lane-a.ts).
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The fake's commands of one op, their bodies in order.
const bodies = (bridge: FakeBridge, op: string) => bridge.commands.filter((c) => c.op === op).map((c) => c.body);

test.describe('lane A: a terminal session driven through its bridge', () => {
  let current: Case | null = null;
  test.afterEach(async () => {
    const c = current;
    current = null;
    if (!c) return;
    try {
      await c.terminal?.close();
      await c.maws.cleanup();
    } finally {
      c.repo.dispose();
      await c.store.dispose();
    }
  });

  // A launch over an engine store holding the session's transcript (one exchange, then the rows `more` gives after its
  // answer), the session in the sidebar.
  async function begin(more: (sid: string, cwd: string, after: string) => Record<string, unknown>[] = () => []): Promise<Case> {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = randomUUID();
    const prompt = randomUUID();
    const answer = randomUUID();
    const transcript = await store.addTranscript(repo.root, sid, [
      JSON.stringify(userRecord(sid, repo.root, prompt, null, 'Tell me a story.', T0)),
      JSON.stringify(assistantRecord(sid, repo.root, answer, prompt, 'A short one, then.', '2026-10-28T10:00:02.000Z')),
      ...more(sid, repo.root, answer).map((row) => JSON.stringify(row)),
    ]);
    const maws = await launchMaws({ env: { CLAUDE_CONFIG_DIR: store.configHome } });
    const { page } = maws;
    await expect(main(page)).toBeVisible();
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const appId = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!.appId;
    current = { maws, page, store, repo, sid, appId, transcript, terminal: null };
    return current;
  }

  // The terminal holds the session (with its bridge unless `bridged` is false), and its pane is open.
  async function drive(c: Case, opts: { bridged?: boolean; open?: boolean } = {}): Promise<TerminalSession> {
    c.terminal = await terminalSession({ store: c.store, sminosHome: c.maws.sminosHome, sessionId: c.sid, cwd: c.repo.root, bridged: opts.bridged ?? true });
    await expect.poll(async () => value(await invoke(c.page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('terminal');
    if (opts.open !== false) await open(c);
    return c.terminal;
  }

  async function open(c: Case): Promise<void> {
    await (await sidebarRow(c.page, { appSessionId: c.appId })).click();
    await expect(editor(c.page), 'the composer, in place of the holder notice').toBeVisible({ timeout: 15_000 });
  }

  async function typeAndSend(page: Page, text: string): Promise<void> {
    const box = editor(page);
    await box.click();
    await box.pressSequentially(text);
    await box.press('Enter');
  }

  async function clear(box: Locator): Promise<void> {
    await box.click();
    await box.press('ControlOrMeta+a');
    await box.press('Backspace');
  }

  test('no bridge: the holder notice and Take over here, as before; a live bridge then gives the composer, its gaps greyed with their reasons', async () => {
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      return [userRecord(sid, cwd, ask, after, 'Change once to twice.', '2026-10-28T10:00:03.000Z'), ...editTurnRecords(sid, cwd, ask, { file: `${cwd}/notes.md`, at: '2026-10-28T10:00:04.000Z' })];
    });
    const { page } = c;
    c.terminal = await terminalSession({ store: c.store, sminosHome: c.maws.sminosHome, sessionId: c.sid, cwd: c.repo.root, bridged: false });
    await expect.poll(async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('terminal');
    await (await sidebarRow(page, { appSessionId: c.appId })).click();
    await expect(notice(page)).toContainText(`Live in Terminal · pid ${c.terminal.pid} · read-only`);
    await expect(notice(page).getByRole('button', { name: 'Take over here' })).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
    expect(value(await invoke(page, 'laneA.list', undefined)).states, 'no answering bridge, no state').toEqual([]);

    // its bridge comes up: the composer replaces the notice, and what lane A can't do is greyed with why
    const bridge = await startFakeBridge({ home: c.maws.sminosHome, session: c.sid, pid: c.terminal.pid, sessionInfo: { session: c.sid, cwd: c.repo.root, model: 'claude-opus-4-5', version: '2.1.300' } });
    bridge.emit({ type: 'catalog', ...CATALOG });
    const registryOnly = c.terminal;
    c.terminal = { bridge, pid: registryOnly.pid, close: async () => (await bridge.close(), await registryOnly.close()) };
    await expect(editor(page)).toBeVisible({ timeout: 15_000 });
    await expect(notice(page)).toHaveCount(0);
    // acceptance 2: each gap in place with its reason, the bridge's words from the capability fixture
    const reasonOf = (key: string) => sentence(FULL_CAPABILITIES.controls![key]!.reason!);
    await expect(main(page).getByRole('button', { name: /^Permission mode/ })).toHaveAttribute('title', "A terminal session's mode is changed in the terminal");
    await editor(page).click();
    await editor(page).pressSequentially('/doc');
    await expect(page.getByRole('option', { name: /doctor/ }), 'a command only the terminal runs, listed with why').toContainText(/runs only in the terminal/i);
    await clear(editor(page));
    await editor(page).pressSequentially('/rewind');
    await expect(page.getByRole('option', { name: /rewind/ }).first(), 'rewind, a terminal panel').toContainText('Rewind is a terminal panel: use /rewind there');
    await page.keyboard.press('Escape');
    await clear(editor(page));
    await main(page).getByRole('button', { name: 'Turn summary' }).last().click();
    const restore = page.getByRole('button', { name: 'Restore files to before this turn' });
    await expect(restore, 'file rollback, in place').toBeDisabled();
    await expect(restore).toHaveAttribute('title', reasonOf('rewind-files'));
    await page.keyboard.press('Escape');
    // Session info lists every control the bridge doesn't reach, with its reason. Forget and the queue have no control of
    // their own on a terminal session; the cards' gaps (deny-and-interrupt, an edited input, a plan's clear, a form) are
    // each card's (M6's scene); MCP disable is the /mcp widget's (the controls scene).
    await openSurface(page, 'Session info');
    const info = page.locator('[data-region="panel"] [data-surface][aria-label="Session info"]');
    await expect(info).toContainText('Not available here');
    for (const [label, reason] of [
      ['Permission mode', "A terminal session's mode is changed in the terminal"],
      ['Rewind', 'Rewind is a terminal panel: use /rewind there'],
      ['Forget a message', reasonOf('forget')],
      ['Roll back files', reasonOf('rewind-files')],
      ['Deny and interrupt', reasonOf('decide.interrupt')],
      ['Answer a form', 'Answer this form in the terminal'],
      ['Disable an MCP server', reasonOf('mcp.disable')],
      ['Queue', 'The terminal keeps its own queue'],
    ] as const) {
      await expect(info, label).toContainText(label);
      await expect(info, label).toContainText(reason);
    }
    // the session menu offers Take over in MAWS, the pane no longer showing the notice that carried it
    await (await sidebarRow(page, { appSessionId: c.appId })).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Take over in MAWS' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('the jobs list: a background shell the transcript started runs, its Stop reaches the bridge, and the transcript ending it ends it', async () => {
    const shellJob = { taskId: 'bsleep01', command: 'sleep 600', description: 'Wait ten minutes', at: '2026-10-28T10:00:03.000Z' };
    const c = await begin((sid, cwd, after) => backgroundBashRecords(sid, cwd, after, shellJob));
    const { page } = c;
    const { bridge } = await drive(c);
    await openSurface(page, 'Background work');
    const shell = page.locator('[data-shell="bsleep01"]');
    await expect(shell, 'derived by main from the transcript, carried by the watch').toContainText('Wait ten minutes · running', { timeout: 15_000 });
    await expect(shell.getByRole('button', { name: 'Output' }), 'a local job has no output tail').toHaveCount(0);
    await shell.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(() => bodies(bridge, 'stop')).toEqual([{ op: 'stop', taskId: 'bsleep01' }]);
    await expect(shell.getByRole('button', { name: 'stopping…' })).toBeVisible();
    // the engine's notification that it ended, as the transcript records it
    await c.store.appendLines(c.transcript, [JSON.stringify(taskNotificationRecord(c.sid, c.repo.root, randomUUID(), { taskId: 'bsleep01', status: 'killed', summary: 'Background command "Wait ten minutes" was stopped', at: '2026-10-28T10:00:09.000Z' }))]);
    await expect(shell).toContainText('Wait ten minutes · stopped', { timeout: 10_000 });
    await expect(shell.getByRole('button')).toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('sends: two in order; one refused at once keeps its draft with the reason; one held past 5 s goes to the strip, which shows its refusal and lets an entered one go, the new draft untouched', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);

    await typeAndSend(page, 'first words');
    await expect(editor(page)).toHaveText('');
    await typeAndSend(page, 'second words');
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual(['first words', 'second words']);
    expect(bodies(bridge, 'deliver').map((b) => (b.key as { seq: number }).seq), 'keys in order').toEqual([1, 2]);

    bridge.answer('deliver', () => ({ status: 200, body: { ok: false, code: 'busy', error: 'the terminal is busy' } }));
    await typeAndSend(page, 'refuse me');
    await expect(page.getByText('the terminal is busy', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(editor(page), 'the refused draft stays').toHaveText('refuse me');
    await clear(editor(page));

    // held: the bridge takes the key and names no fate; at 5 s the composer clears and the strip keeps the words
    bridge.answer('deliver', () => ({ status: 200, body: { ok: true, result: { submitted: true } } }));
    await typeAndSend(page, 'held words');
    const held = strip(page).locator('li', { hasText: 'held words' });
    await expect(held).toHaveAttribute('data-pending-send', 'sending', { timeout: 15_000 });
    await expect(editor(page)).toHaveText('');
    await editor(page).pressSequentially('a new draft');
    const heldKey = bodies(bridge, 'deliver').at(-1)!.key;
    bridge.emit({ type: 'delivered', key: heldKey, outcome: 'refused', reason: 'the prompt was cleared in the terminal' });
    await expect(held).toHaveAttribute('data-pending-send', 'refused', { timeout: 10_000 });
    await expect(held).toContainText('Not entered: the prompt was cleared in the terminal');
    await expect(held.getByRole('button', { name: 'Send again' })).toBeVisible();
    await expect(editor(page), 'the draft typed since is untouched').toHaveText('a new draft');

    // another held one, then entered: its entry leaves, the refused one stays
    await editor(page).press('Enter');
    const second = strip(page).locator('li', { hasText: 'a new draft' });
    await expect(second).toHaveAttribute('data-pending-send', 'sending', { timeout: 15_000 });
    bridge.emit({ type: 'delivered', key: bodies(bridge, 'deliver').at(-1)!.key, outcome: 'entered', uuid: randomUUID() });
    await expect(second).toHaveCount(0, { timeout: 10_000 });
    await expect(held).toHaveCount(1);
    await held.getByRole('button', { name: 'Dismiss' }).click();
    await expect(strip(page)).toHaveCount(0);
  });

  test('each control reaches the bridge with its body: the model chip, a slash command, interrupt, compact with instructions, MCP reconnect and enable, a side question answered from its op’s end, and the agent and shell stops', async () => {
    test.setTimeout(150_000);
    const agent = { agentId: 'a1e2e000000000001', description: 'Count the words', prompt: 'Count the words in notes.md.', at: '2026-10-28T10:00:03.000Z' };
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      return [userRecord(sid, cwd, ask, after, 'Count the words in the background.', '2026-10-28T10:00:03.000Z'), ...backgroundAgentRecords(sid, cwd, ask, agent)];
    });
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, agent);
    const { page } = c;
    const { bridge } = await drive(c);

    // the model chip: the catalog's models, a pick sending only the model
    await main(page).getByRole('button', { name: /^Model / }).click();
    await page.getByRole('button', { name: /· Select model$/ }).click(); // the chip opens on the effort view
    await page.getByRole('menuitemradio', { name: /^sonnet/ }).click();
    await expect.poll(() => bodies(bridge, 'model')).toEqual([{ op: 'model', model: 'sonnet', effort: null }]); // main keeps the effort the bridge holds
    await page.keyboard.press('Escape');
    // the effort on its own: main reads the model fresh and sends it unchanged beside the new effort
    await main(page).getByRole('button', { name: /^Model / }).click();
    await page.getByRole('slider', { name: 'Effort' }).locator('[data-level="high"]').click();
    await expect.poll(() => bodies(bridge, 'model')).toEqual([
      { op: 'model', model: 'sonnet', effort: null },
      { op: 'model', model: 'sonnet', effort: 'high' },
    ]);
    await page.keyboard.press('Escape');

    // a runnable slash command, its outcome from its op's `run` end (each run's id is its argument, as the MCP runs' below)
    bridge.answer('command', (body) => ({ status: 200, body: { ok: true, result: { started: true, id: `run:${String(body.args)}` } } }));
    const ended = (args: string, text: string, name = 'mcp') => bridge.emit({ type: 'run', phase: 'end', id: `run:${args}`, name, readback: { how: 'text', text } });
    await typeAndSend(page, '/rename o9-sitting');
    await expect.poll(() => bodies(bridge, 'command')).toEqual([{ op: 'command', name: 'rename', args: 'o9-sitting' }]);
    ended('o9-sitting', 'Session renamed to o9-sitting.', 'rename');
    await expect(page.getByText('/rename: Session renamed to o9-sitting.', { exact: true })).toBeVisible({ timeout: 10_000 });

    // interrupt, while a turn runs
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-i' });
    const stop = main(page).getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeVisible({ timeout: 10_000 });
    await stop.click();
    await expect.poll(() => bodies(bridge, 'interrupt')).toEqual([{ op: 'interrupt' }]);
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-i' });

    // compact, with the instructions typed after it
    await editor(page).click();
    await editor(page).pressSequentially('/compact keep the file list');
    await editor(page).press('Enter');
    await page.getByRole('button', { name: 'Compact now' }).click();
    await expect.poll(() => bodies(bridge, 'compact')).toEqual([{ op: 'compact', instructions: 'keep the file list' }]);

    // MCP: the bridge's read lists a connected server; Reconnect and Enable run `/mcp <verb> <name>`
    bridge.answer('read', (body) =>
      body.what === 'mcp'
        ? { status: 200, body: { ok: true, result: { exact: false, servers: [{ name: 'probe', status: 'connected', tools: 1 }] } } }
        : { status: 200, body: { ok: true, result: { version: { version: '2.1.300' }, model: 'claude-opus-4-5', cwd: c.repo.root, root: c.repo.root, repo: null, surfaces: [], override: null } } },
    );
    await clear(editor(page));
    await editor(page).pressSequentially('/mcp');
    await editor(page).press('Enter');
    // each run's end (the mod's `run end`) frees the widget for the next; Disable stays in place, closed with the route
    // table's reason (acceptance 2)
    const server = page.locator('[data-mcp-server="probe"]');
    await expect(server.getByRole('button', { name: 'Disable' })).toBeDisabled();
    await expect(server.getByRole('button', { name: 'Disable' })).toHaveAttribute('title', sentence(FULL_CAPABILITIES.controls!['mcp.disable']!.reason!));
    await server.getByRole('button', { name: 'Reconnect' }).click();
    await expect.poll(() => bodies(bridge, 'command').length).toBe(2);
    ended('reconnect probe', 'Reconnected to probe.');
    await expect(page.getByRole('status').filter({ hasText: 'Reconnected to probe.' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('textbox', { name: 'Server to enable' }).fill('github');
    await page.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect.poll(() => bodies(bridge, 'command').length).toBe(3);
    ended('enable github', 'Enabled github.');
    await expect.poll(() => bodies(bridge, 'command').slice(1)).toEqual([
      { op: 'command', name: 'mcp', args: 'reconnect probe' },
      { op: 'command', name: 'mcp', args: 'enable github' },
    ]);
    await page.keyboard.press('Escape');

    // a side question, answered from its op's end
    bridge.answer('btw', () => ({ status: 200, body: { ok: true, result: { started: true, id: 'btw-1' } } }));
    await clear(editor(page));
    await typeAndSend(page, '/btw why so short?');
    await expect.poll(() => bodies(bridge, 'btw')).toEqual([{ op: 'btw', prompt: 'why so short?' }]);
    bridge.emit({ type: 'btw', phase: 'start', id: 'btw-1' });
    bridge.emit({ type: 'btw', phase: 'end', id: 'btw-1', text: 'Because you asked for a short one.' });
    await expect(page.getByText('Because you asked for a short one.')).toBeVisible({ timeout: 10_000 });

    // the agents tool: the subagent the transcript started (its sidecars on disk), told through the drill-in's box, then
    // stopped through its Stop (the jobs list's stop has its own scene)
    await openSurface(page, 'Subagents');
    await page.locator('[data-agent-row]').filter({ hasText: agent.description }).click();
    const relay = page.locator('[data-region="panel"] [data-key-sink="composer"]'); // the drill-in's box, not the pane's composer
    await relay.getByRole('textbox', { name: /^Message / }).fill('wrap up');
    await relay.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => bodies(bridge, 'tell')).toEqual([{ op: 'tell', agentId: agent.agentId, text: 'wrap up' }]);
    await page.getByRole('button', { name: 'Stop agent' }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).last().click(); // the confirm
    await expect.poll(() => bodies(bridge, 'stop-agent')).toEqual([{ op: 'stop-agent', agentId: agent.agentId }]);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('the reply streams as it is written, then its row replaces it', async () => {
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const step = { turnId: 'turn-s', agentId: null, step: 0 };
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-s' });
    bridge.emit({ type: 'step', phase: 'start', ...step });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Once upon' } });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 1, chunk: { kind: 'text', index: 0, text: ' a time' } });
    await expect(main(page).getByText('Once upon a time', { exact: true })).toBeVisible({ timeout: 10_000 });

    const row = randomUUID();
    bridge.emit({ type: 'block-row', ...step, uuid: row, index: 0 });
    await c.store.appendLines(c.transcript, [JSON.stringify(assistantRecord(c.sid, c.repo.root, row, randomUUID(), 'Once upon a time, the end.', '2026-10-28T10:01:00.000Z'))]);
    await expect(main(page).getByText('Once upon a time, the end.')).toBeVisible({ timeout: 10_000 });
    await expect(main(page).getByText('Once upon a time', { exact: true }), 'the streamed text left with its row').toHaveCount(0);
    bridge.emit({ type: 'step', phase: 'end', ...step });
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-s' });
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('a pane opened mid-reply shows what already streamed; the turn aborting with no step end leaves no streaming text', async () => {
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c, { open: false });
    const step = { turnId: 'turn-m', agentId: null, step: 0 };
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-m' });
    bridge.emit({ type: 'step', phase: 'start', ...step });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 0, chunk: { kind: 'text', index: 0, text: 'Half a story' } });
    await open(c);
    await expect(main(page).getByText('Half a story', { exact: true })).toBeVisible({ timeout: 10_000 });
    bridge.emit({ type: 'chunk', ...step, chunkIndex: 1, chunk: { kind: 'text', index: 0, text: ' and more' } });
    await expect(main(page).getByText('Half a story and more', { exact: true })).toBeVisible({ timeout: 10_000 });
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-m' }); // aborted: no step end, no block-row
    await expect(main(page).getByText('Half a story and more', { exact: true })).toHaveCount(0, { timeout: 10_000 });
    expect(c.maws.consoleErrors()).toEqual([]);
  });
});
