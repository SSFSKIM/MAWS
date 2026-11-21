// e2e:lane-a (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M5 "Proves"; acceptance 1, 2, 4 and 6): a
// terminal session on this Mac driven from MAWS through its bridge, the bridge being the fake (test/support/
// fake-bridge.ts) on the launch's scratch sminos home, and no `claude` running. Each control's body as the fake receives
// it; sends in order, a refusal keeping its draft, a held send's strip; a side question answered from its op's end; the
// gaps greyed with their reasons; no bridge as before; the reply streaming, then its row; a pane opened mid-reply, and
// that turn aborted with no `step end`, its text kept settled. M6 (acceptance 3 and 5): the requests the bridge raises, as attention items and
// docked cards answered through the port, each decision's body as the fake receives it, and the race with the terminal.
// UX wave U8d (M4; docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md, acceptance 2, 3, 4 and 8): the
// session's subagents with the statuses main derives from its transcript, its sidecars and the bridge's agents, on the
// Subagents card and in the panel, the rows the engine writes at an agent's end as probes P1 and P2 recorded them.
// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Proof 1's `e2e:lane-a` row): those
// cards are drawn in the session's transcript now, a question's form in the row of its call (when the transcript holds
// it) and every other request at the transcript's end; an asynchronous question's answer and dismissal stand on its row,
// before and after a reload; a prompt its terminal settles leaves its receipt at the end for SETTLED_MS.
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { FULL_CAPABILITIES, startFakeBridge, type FakeBridge, type FakeBridgeOptions } from '../test/support/fake-bridge';
import { ScratchRepo } from '../test/support/scratch-repo';
import { StoreFixture } from '../test/support/store-fixture';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { consentMessage } from '../src/shared/engine/arrival';
import { agentNotificationRecord, assistantRecord, backgroundAgentRecords, backgroundAgentSidecars, backgroundBashRecords, CATALOG, editTurnRecords, nestedAgentRecords, pluginStopNoteRecord, probeTerminalRecords, queuedNotificationRecords, taskNotificationRecord, terminalSession, turnEndRecords, userRecord, type BackgroundAgent, type TerminalSession } from './support/lane-a';
import { addressed } from './support/address';
import { menu } from './support/menu';
import { openSurface, sessionCard, showSessionCards, sideColumn, surface } from './support/shell';
import { END_ROW, rowOf } from './support/request-keys';
import { stopRecord } from './support/stop-record';
import { markPixels, minimalPdf } from './support/media-fixtures'; // UX wave U6b-2
import { created } from './support/nothing-created'; // UX wave U6b-2: B8
import { sidebarOf, sidebarRow } from './support/sidebar';
import { FINISHED_TURN_LINE } from './support/turn-line'; // the word cut (T1)

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

// M6: the pane's request card, and the decisions the fake took, each with its request. UX wave U1b: the card is drawn in
// the session's transcript (in its call's row, or at the end), never in the composer's place.
const card = (page: Page) => main(page).locator('[data-request-card]');
// UX wave U1b: the transcript's end (§E `EndRegion`), and the row the transcript draws for a question's call.
const end = (page: Page) => main(page).locator('[data-request-end]');
const questionRow = (page: Page, call: string) => main(page).locator(`[data-row-id="question:${call}"] .transcript-row`);
// A question receipt's lines as the row reads them: "header→answer" each (the arrow is the row's own glyph).
const receiptLines = (row: Locator) => row.locator('[data-question]').allTextContents();
const decided = (bridge: FakeBridge) => bridge.decisions.map((d) => ({ request: d.request, ...d.body }));
const AS_MAWS = { by: 'maws', launch: 'launch-1' }; // every decision MAWS posts names itself and the launch it was read under
const badge = (maws: MawsLaunch) => maws.app.evaluate(({ app }) => app.dock?.getBadge() ?? '');

// UX wave U1b: rows of a terminal session's file, chained after `after`, as the engine writes them (the recorded shapes of
// spikes/protocol-probe/fixtures/uxwave/u3-sminos-r1-terminal.transcript.jsonl and of the arrivals reader's tests,
// src/shared/engine/arrival.test.ts; the content invented). The stand-in bridge writes nothing into the transcript
// (test/support/fake-bridge.ts), so a scene writes the call a question names, and later the answer's delivery, itself.
function fileRows(sessionId: string, cwd: string, after: string, at: string) {
  let last = after;
  let tick = Date.parse(at);
  const next = (row: Record<string, unknown>): Record<string, unknown> => {
    const uuid = randomUUID();
    const record = { cwd, sessionId, timestamp: new Date((tick += 1_000)).toISOString(), isSidechain: false, userType: 'external', version: '2.1.300', ...row, uuid, parentUuid: last };
    last = uuid;
    return record;
  };
  const message = (content: unknown[], stop: string) => ({ id: `msg_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model: 'claude-opus-4-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } });
  return {
    prompt: (text: string) => next({ type: 'user', message: { role: 'user', content: text } }),
    call: (id: string, name: string, input: Record<string, unknown>) => next({ type: 'assistant', message: message([{ type: 'tool_use', id, name, input }], 'tool_use') }),
    result: (id: string, text: string, toolUseResult: unknown = text) => next({ type: 'user', toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }),
    text: (text: string) => next({ type: 'assistant', message: message([{ type: 'text', text }], 'end_turn') }),
    turnEnd: () => [
      next({ type: 'system', subtype: 'stop_hook_summary', hookCount: 0, hookInfos: [], hookErrors: [], preventedContinuation: false, stopReason: '', hasOutput: false, level: 'suggestion' }),
      next({ type: 'system', subtype: 'turn_duration', durationMs: 1200, isMeta: false }),
    ],
    // The two ways the ask mod's delivery is held in the file: the session idle, a prompt the plugin submits, which opens
    // a turn (the engine's framing around the plugin's text); a turn running, a hook's context on the next call's result.
    pluginPrompt: (text: string) =>
      next({ type: 'user', origin: { kind: 'plugin', name: 'sminos' }, message: { role: 'user', content: `The sminos plugin sent a message:\n${text}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns — it starts this turn in the user's place. Address the message above.` } }),
    hookContext: (text: string, call: string) => next({ type: 'attachment', attachment: { type: 'hook_additional_context', content: [text], hookName: 'tool.call', toolUseID: `${call}-context`, hookEvent: 'PostToolUse' } }),
    // a recorded row's own fields (its kind, message, origin and flags), chained here (probe 9b's records)
    recorded: (row: Record<string, unknown>) => next(Object.fromEntries(Object.entries(row).filter(([key]) => RECORDED_FIELDS.has(key)))),
  };
}
const RECORDED_FIELDS = new Set(['type', 'message', 'isMeta', 'origin', 'subtype', 'content', 'level', 'toolUseResult']);

// UX wave U1b, probe 9b: what the two Stop scenes stage is read from the records by `stopRecord` (e2e/support/stop-record.ts,
// checked on both records by test/support/stop-record.test.ts).

// The ask mod's asynchronous call (sminos 1.47.0): its tool, what it returns at once, and its delivery's sentences.
const ASK_TOOL = 'mcp__sminos__AskUserQuestion';
const ASYNC_RESULT = 'Your questions are waiting for the human; this call does not wait for them. Their answer will reach you in a later message that quotes each question. Go on with work that does not depend on it.';
const DISMISSED = 'The human dismissed these questions without answering them; no answer will come. Do not wait for one.';
const delivery = (call: string, summary: string) => `The human responded to your async AskUserQuestion (call ${call}): ${summary}`;
const answered = (answers: Record<string, string>) =>
  `Your questions have been answered: ${Object.entries(answers).map(([question, answer]) => `"${question}"="${answer}"`).join(', ')}. You can now continue with these answers in mind.`;
const single = (question: string, header: string, labels: string[]) => ({ question, header, options: labels.map((label) => ({ label })), multiSelect: false });

// MAWS's answer went: the bridge settles the request as MAWS's, and the card leaves at once (only another's win lingers).
async function settledHere(page: Page, bridge: FakeBridge, request: string, outcome = 'allow'): Promise<void> {
  bridge.settle(request, 'web', outcome);
  await expect(card(page)).toHaveCount(0, { timeout: 5_000 });
}

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
  // answer; or, UX wave U1c, the rows `seed` gives in their place), the session in the sidebar.
  async function begin(more: (sid: string, cwd: string, after: string) => Record<string, unknown>[] = () => [], seed?: (sid: string, cwd: string) => Record<string, unknown>[]): Promise<Case> {
    const repo = await ScratchRepo.create();
    const store = await StoreFixture.create();
    const sid = randomUUID();
    const prompt = randomUUID();
    const answer = randomUUID();
    const rows = seed?.(sid, repo.root) ?? [
      userRecord(sid, repo.root, prompt, null, 'Tell me a story.', T0),
      assistantRecord(sid, repo.root, answer, prompt, 'A short one, then.', '2026-10-28T10:00:02.000Z'),
      ...more(sid, repo.root, answer),
    ];
    const transcript = await store.addTranscript(repo.root, sid, rows.map((row) => JSON.stringify(row)));
    const maws = await launchMaws({ env: { CLAUDE_CONFIG_DIR: store.configHome } });
    const { page } = maws;
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => value(await invoke(page, 'session.list', {})).sessions.some((r) => r.engineSessionId === sid), { timeout: 20_000 }).toBe(true);
    const appId = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)!.appId;
    current = { maws, page, store, repo, sid, appId, transcript, terminal: null };
    return current;
  }

  // The terminal holds the session (with its bridge unless `bridged` is false), and its pane is open.
  async function drive(c: Case, opts: { bridged?: boolean; open?: boolean; bridge?: Partial<FakeBridgeOptions> } = {}): Promise<TerminalSession> {
    c.terminal = await terminalSession({ store: c.store, sminosHome: c.maws.sminosHome, sessionId: c.sid, cwd: c.repo.root, bridged: opts.bridged ?? true, ...(opts.bridge && { bridge: opts.bridge }) });
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
    // the word cut (C128): the line reads who holds the session and read-only; its pid waits on the line, its description
    const heldLine = notice(page).getByText('Live in Terminal · read-only', { exact: true });
    await expect(heldLine).toBeVisible();
    await expect(heldLine).toHaveAccessibleDescription(`pid ${c.terminal.pid}`);
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
    // the owner's Q1: its tab marks it Terminal, titled with the hover card's line
    const marker = page.locator('[role="tab"][aria-selected="true"] [data-holder-marker]');
    await expect(marker).toHaveText('Terminal');
    await expect(marker).toHaveAttribute('title', 'Running in Terminal'); // the word cut (C130): who holds it, not how
    // acceptance 2: each gap in place with its reason, the bridge's words from the capability fixture
    const reasonOf = (key: string) => sentence(FULL_CAPABILITIES.controls![key]!.reason!);
    // the O9 sitting: no mode is reported, so the chip names none, only why
    const mode = main(page).getByRole('button', { name: 'Permission mode not reported' });
    await expect(mode).toHaveAttribute('title', 'Not reported by the terminal session: its mode is changed in the terminal');
    await expect(mode).toHaveText(/^Mode/);
    await editor(page).click();
    // UX wave U4a (decision 17 f): a row that cannot run from here is listed, greyed, once the typed text matches its
    // name, and its reason is in the popover beside the highlighted row
    await editor(page).pressSequentially('/doc');
    const doctor = page.getByRole('option', { name: /doctor/ });
    await expect(doctor, 'a command only the terminal runs, greyed').toHaveAttribute('aria-disabled', 'true');
    await doctor.hover();
    await expect(doctor).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tooltip'), 'listed with why').toContainText(/runs only in the terminal/i);
    // the list and its popover close before the box is cleared: the popover stands over the box and takes its click
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
    await clear(editor(page));
    await editor(page).pressSequentially('/rewind');
    const rewind = page.getByRole('option', { name: /rewind/ }).first();
    await expect(rewind, 'rewind, a terminal panel, greyed').toHaveAttribute('aria-disabled', 'true');
    await rewind.hover();
    await expect(rewind).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tooltip'), 'rewind, a terminal panel').toContainText('Rewind is a terminal panel: use /rewind there');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeHidden();
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

  // sminos 1.27.14: the bridge's heartbeat carries the mode the session last reported (a switch in the terminal rides the
  // next one); MAWS shows it with how long ago, and still sets none.
  test('the mode the terminal reports: none until it reports one, then the chip and Session info name it with its age, and follow a switch', async () => {
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c, { bridge: { capabilities: { ...FULL_CAPABILITIES, sminos: '1.27.14' } } });
    const chip = main(page).getByRole('button', { name: /^Permission mode/ });
    const reported = (mode: string) => async () => {
      await expect(chip).toHaveAttribute('aria-label', `Permission mode ${mode}`);
      await expect(chip).toHaveText(new RegExp(`^${mode}`));
      await expect(chip).toHaveAttribute('title', /^Reported (now|1 minute ago) · A terminal session's mode is changed in the terminal$/);
    };
    bridge.heartbeat(); // the session's start reports none
    await expect(chip).toHaveAttribute('aria-label', 'Permission mode not reported');
    await expect(chip).toHaveAttribute('title', 'Not reported by the terminal session: its mode is changed in the terminal');

    bridge.setMode({ mode: 'plan', at: Date.now(), from: 'UserPromptSubmit' });
    bridge.heartbeat();
    await reported('Plan')();
    await openSurface(page, 'Session info');
    const info = page.locator('[data-region="panel"] [data-surface][aria-label="Session info"]');
    await expect(info).toContainText(/Plan · Reported (now|1 minute ago)/);

    // Shift+Tab in the terminal: the engine's switch record, on the next heartbeat
    bridge.setMode({ mode: 'default', at: Date.now(), from: 'permission_mode_changed' });
    bridge.heartbeat();
    await reported('Manual')();
    await expect(info).toContainText(/Manual · Reported (now|1 minute ago)/);
    // UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, §I; B9 and Decision Log 10 (ix)):
    // ⇧Tab in this composer asks nothing, since the chip takes no change here, so its live region says nothing; the
    // region is mounted as on the composer's route, whose scene in e2e/composer.spec.ts ("⇧Tab says the mode") is this
    // one's control: there the same region reads the sentence after the same press.
    const said = main(page).locator('[data-mode-announcement]');
    await expect(said, 'the composer’s live region, mounted').toHaveCount(1);
    await editor(page).click();
    await page.keyboard.press('Shift+Tab');
    await reported('Manual')();
    await expect(said, 'nothing said on a terminal session').toHaveText('');
    // the menu still sets nothing: the reported mode checked, each choice closed with why
    await chip.click();
    await expect(page.getByRole('menuitemradio', { name: /^Manual/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitemradio', { name: /^Plan/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // The O9 sitting (item 6): after `/exit` the session left the sidebar. The terminal ending (its registry record and its
  // bridge gone) leaves it listed, as an ended lane B session is, and no longer marked Terminal.
  test('the terminal ending: the session stays listed, held by nothing, its bridge state gone', async () => {
    const c = await begin();
    const { page } = c;
    const terminal = await drive(c);
    const row = await sidebarRow(page, { appSessionId: c.appId });
    await expect(page.locator('[role="tab"][aria-selected="true"] [data-holder-marker]')).toHaveText('Terminal');
    await terminal.close();
    c.terminal = null;
    await expect.poll(async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('none');
    await expect.poll(async () => value(await invoke(page, 'laneA.state', { appSessionId: c.appId })), { timeout: 10_000 }).toBeNull();
    await expect(page.locator('[role="tab"][aria-selected="true"] [data-holder-marker]')).toHaveCount(0);
    expect(value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.archived).toBe(false);
    await expect(row, 'still listed once nothing holds it').toBeVisible();
    await expect((await sidebarRow(page, { appSessionId: c.appId })), 'and found again from the list').toBeVisible();
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('the jobs list: a background shell the transcript started runs, its Stop reaches the bridge, and the transcript ending it ends it', async () => {
    const shellJob = { taskId: 'bsleep01', command: 'sleep 600', description: 'Wait ten minutes', at: '2026-10-28T10:00:03.000Z' };
    const c = await begin((sid, cwd, after) => backgroundBashRecords(sid, cwd, after, shellJob));
    const { page } = c;
    const { bridge } = await drive(c);
    await openSurface(page, 'Background tasks');
    const tool = surface(page, 'background');
    const shell = tool.locator('[data-shell="bsleep01"]');
    await expect(shell, 'derived by main from the transcript, carried by the watch').toContainText('Wait ten minutes · running', { timeout: 15_000 });
    await expect(shell.getByRole('button', { name: 'Output' }), 'a local job has no output tail').toHaveCount(0);
    await shell.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(() => bodies(bridge, 'stop')).toEqual([{ op: 'stop', taskId: 'bsleep01' }]);
    await expect(shell.getByRole('button', { name: 'stopping…' })).toBeVisible();
    // the engine's notification that it ended, as the transcript records it
    await c.store.appendLines(c.transcript, [JSON.stringify(taskNotificationRecord(c.sid, c.repo.root, randomUUID(), { taskId: 'bsleep01', status: 'killed', summary: 'Background command "Wait ten minutes" was stopped', at: '2026-10-28T10:00:09.000Z' }))]);
    // UX wave U8b (M7): an ended task leaves Running for Done, which is folded at first and counts it by its kind
    await expect(tool.locator('section[data-section="running"]'), 'nothing runs').toHaveCount(0, { timeout: 10_000 });
    await expect(tool.getByText('Nothing running', { exact: true })).toBeVisible();
    const done = tool.locator('section[data-section="done"]');
    await expect(done).toHaveAttribute('aria-label', 'Done 1 · 1 shell');
    await done.getByRole('heading').getByRole('button').click();
    await expect(shell).toContainText('Wait ten minutes · stopped');
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
    await expect(held).toContainText('Not sent: the prompt was cleared in the terminal'); // the word cut (C79)
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

  // M7 (acceptance 7): files dropped on the real composer go through its serialization, `laneA.media` and main's save,
  // and the fake receives `media {upload, root, files}` naming files under the root that hold the bytes, then the words.
  test('attachments: an image and a PDF dropped on the composer reach the bridge’s media op as saved files, then the words; each file’s state shows', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
    const drop = (files: { name: string; type: string; base64: string }[]) =>
      editor(page).evaluate((target, given) => {
        const data = new DataTransfer();
        for (const f of given) data.items.add(new File([Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0))], f.name, { type: f.type }));
        const box = target.getBoundingClientRect();
        target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: box.left + 5, clientY: box.top + 5, bubbles: true, cancelable: true }));
      }, files);
    const attached = main(page).getByRole('list', { name: 'attachments' });
    const uploads = main(page).getByRole('list', { name: 'Images and PDFs sent to the terminal session' });
    const fileRow = (name: string) => uploads.locator('[data-upload-state]', { hasText: name });

    await drop([{ name: 'shot.png', type: 'image/png', base64: PNG }, { name: 'notes.pdf', type: 'application/pdf', base64: PDF.toString('base64') }]);
    await expect(attached.getByText('shot.png')).toBeVisible();
    await expect(attached.getByText('notes.pdf')).toBeVisible();
    await typeAndSend(page, 'what are these?');
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual(['what are these?']);
    expect(bridge.commands.map((cmd) => cmd.op).filter((op) => op === 'media' || op === 'deliver'), 'the files first, then the words').toEqual(['media', 'deliver']);
    await expect(attached).toHaveCount(0);

    const [media] = bodies(bridge, 'media') as { upload: string; root: string; files: { n: number; path: string; name: string; mediaType: string }[] }[];
    const root = join(realpathSync(c.repo.root), '.claude', 'desk-uploads', c.sid);
    expect(media).toEqual({
      op: 'media', upload: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as unknown, root,
      files: [
        { n: 0, path: join(root, `${media!.upload}.0.png`), name: 'shot.png', mediaType: 'image/png' },
        { n: 1, path: join(root, `${media!.upload}.1.pdf`), name: 'notes.pdf', mediaType: 'application/pdf' },
      ],
    });
    expect(readFileSync(media!.files[0]!.path).subarray(0, 8), 'the composer’s image, a PNG').toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(readFileSync(media!.files[1]!.path), 'the PDF as dropped').toEqual(PDF);
    expect(readFileSync(join(c.repo.root, '.git', 'info', 'exclude'), 'utf8')).toContain('**/.claude/desk-uploads/');

    // each file's state as the bridge says it: read, then one sent on to the model and one that failed, which stays
    await expect(fileRow('shot.png')).toHaveAttribute('data-upload-state', 'queued');
    const { upload } = media!;
    const said = (index: number, state: string, phase: 'start' | 'end', attachments: { index: number; state: string; reason?: string }[]) =>
      bridge.emit({ type: 'media', id: upload, upload, index, state, phase, attachments, ...(attachments[index]?.reason !== undefined && { reason: attachments[index]!.reason }) });
    said(0, 'read', 'start', [{ index: 0, state: 'read' }, { index: 1, state: 'pending' }]);
    await expect(fileRow('shot.png')).toContainText('Read', { timeout: 5_000 });
    const reason = 'the Read returned no image or document';
    said(1, 'failed', 'start', [{ index: 0, state: 'read' }, { index: 1, state: 'failed', reason }]);
    said(0, 'forwarded', 'end', [{ index: 0, state: 'forwarded' }, { index: 1, state: 'failed', reason }]);
    await expect(fileRow('shot.png')).toContainText('Sent to the model', { timeout: 5_000 });
    await expect(fileRow('notes.pdf')).toContainText(`Not read: ${reason}`);

    // an image alone: no words go, and once it went on to the model its entry leaves by itself; the upload with a file
    // that did not go on stays until dismissed
    await drop([{ name: 'again.png', type: 'image/png', base64: PNG }]);
    await expect(attached.getByText('again.png')).toBeVisible();
    await editor(page).press('Enter');
    await expect.poll(() => bodies(bridge, 'media').length, { timeout: 10_000 }).toBe(2);
    expect(bodies(bridge, 'deliver')).toHaveLength(1);
    const second = (bodies(bridge, 'media')[1] as { upload: string }).upload;
    bridge.emit({ type: 'media', id: second, upload: second, index: 0, state: 'forwarded', phase: 'end', attachments: [{ index: 0, state: 'forwarded' }] });
    await expect(fileRow('again.png')).toContainText('Sent to the model', { timeout: 5_000 });
    await expect(fileRow('again.png')).toHaveCount(0, { timeout: 10_000 });
    await expect(fileRow('notes.pdf'), 'a file that did not go on stays until dismissed').toHaveCount(1);
    await uploads.getByRole('button', { name: 'Dismiss' }).click();
    await expect(uploads).toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6; B5): a terminal session on this Mac
  // is read by the same files service as a session MAWS runs, so a PDF of its folder, opened from Files' tree, is drawn
  // beside the chat by Chromium's viewer from a token, the toolbar hidden there, Open externally in the bar.
  test('a PDF of the terminal session’s folder is drawn beside the chat, as for a session MAWS runs', async () => {
    const c = await begin();
    const { page, maws } = c;
    const path = c.repo.path('notes.pdf');
    writeFileSync(path, minimalPdf());
    await drive(c);
    const before = await created(page, maws.userData, c.appId);
    await openSurface(page, 'Files');
    // UX wave U6b-3a (Decision Log 14, ruling 1): the tree's row by its `data-kind`; the new PDF's row in the Changed group
    // above the tree has the same `data-path`, and `.first()` would take it
    const row = surface(page, 'files').locator(`[role="treeitem"][data-kind][data-path="${path}"]`).first();
    await expect(row, 'the PDF in Files’ tree of the terminal session’s folder').toBeVisible({ timeout: 20_000 });
    await row.click();
    const viewer = sideColumn(page).locator(`[data-file-viewer][data-path="${path}"]`);
    await expect(viewer, 'drawn in its frame').toHaveAttribute('data-frame', 'pdf', { timeout: 20_000 });
    const frame = viewer.locator('[data-artifact-frame="pdf"]');
    await expect(frame).toHaveAttribute('src', /^maws-artifact:\/\/[0-9a-f]{32}\/notes\.pdf#toolbar=0&navpanes=0$/);
    const src = (await frame.getAttribute('src'))!;
    const url = src.slice(0, src.indexOf('#'));
    // Chromium's viewer beneath the frame (its extension's frame, whose parent is the token's)
    await expect
      .poll(() => maws.app.evaluate(({ BrowserWindow }, root) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'))!.webContents.mainFrame.framesInSubtree.filter((f) => f.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/') && (f.parent?.url ?? '').startsWith(root)).length, url), { timeout: 20_000, message: 'Chromium’s viewer in the frame' })
      .toBe(1);
    await expect.poll(() => markPixels(maws.app, page, frame), { timeout: 15_000, message: 'the page drawn: its black square' }).toBeGreaterThan(2_000);
    await expect(viewer.locator('[data-external-row]'), 'no row').toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Open externally', exact: true }), 'Open externally in the bar').toBeVisible();
    expect(await created(page, maws.userData, c.appId), 'nothing created').toEqual(before);
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('each control reaches the bridge with its body: the model chip, a slash command, interrupt, compact with instructions, MCP reconnect and enable, a side question answered from its op’s end, and the agent and shell stops', async () => {
    test.setTimeout(150_000);
    const agent = { agentId: 'a1e2e000000000001', description: 'Count the words', prompt: 'Count the words in notes.md.', at: '2026-10-28T10:00:03.000Z' };
    let last = '';
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      const turn = backgroundAgentRecords(sid, cwd, ask, agent);
      last = turn.at(-1)!.uuid as string;
      return [userRecord(sid, cwd, ask, after, 'Count the words in the background.', '2026-10-28T10:00:03.000Z'), ...turn];
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
    // stopped through its Stop (the jobs list's stop has its own scene). UX wave U8d (M4 decision 1): main derives its
    // status from the transcript's launch, so the panel lists it under Running, its status known.
    await openSurface(page, 'Subagents');
    const agents = surface(page, 'subagents');
    const running = agents.locator('section[data-section="running"]');
    await expect(running, 'the agent the transcript launched runs').toHaveAttribute('aria-label', 'Running 1', { timeout: 15_000 });
    await expect(agents.locator('section[data-section="disk"]'), 'nothing is left On disk').toHaveCount(0);
    await expect(agents.getByText('Status is known only while the session runs here'), 'its status is reported: the sentence is not drawn').toHaveCount(0);
    await running.locator(`[data-agent-row="${agent.agentId}"]`).click();
    const relay = page.locator('[data-region="panel"] [data-key-sink="composer"]'); // the drill-in's box, not the pane's composer
    await relay.getByRole('textbox', { name: /^Message / }).fill('wrap up');
    await relay.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => bodies(bridge, 'tell')).toEqual([{ op: 'tell', agentId: agent.agentId, text: 'wrap up' }]);
    await page.getByRole('button', { name: 'Stop agent' }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).last().click(); // the confirm
    await expect.poll(() => bodies(bridge, 'stop-agent')).toEqual([{ op: 'stop-agent', agentId: agent.agentId }]);
    // what the stop writes (P2, u8d-p2-bg-r1): the bridge's stop event, the plugin's note, then the engine's `killed`
    // notification; the row's last word is "stopped", whichever of the bridge's event and the row is read first (N9)
    bridge.agentStopped(agent.agentId, { status: 'killed' });
    const note = pluginStopNoteRecord(c.sid, c.repo.root, last, { agentId: agent.agentId, at: '2026-10-28T10:02:00.000Z' });
    const killed = queuedNotificationRecords(c.sid, c.repo.root, note.uuid as string, {
      taskIds: [agent.agentId], toolUseId: `toolu_${agent.agentId}`, outputFile: `/tmp/claude/tasks/${agent.agentId}.output`, status: 'killed', summary: `Agent "${agent.description}" was stopped by Claude`, at: '2026-10-28T10:02:00.200Z',
    });
    await c.store.appendLines(c.transcript, [note, ...killed].map((row) => JSON.stringify(row)));
    await expect(agents.getByRole('button', { name: /^(Stop agent|stopping…)$/ }), 'the agent ended: no stop is offered').toHaveCount(0, { timeout: 15_000 });
    await agents.getByRole('button', { name: '‹ Subagents', exact: true }).click();
    const done = agents.locator('section[data-section="done"]');
    await expect(done, 'the rows say how it ended').toHaveAttribute('aria-label', 'Done 1 · 1 stopped', { timeout: 15_000 });
    await expect(running, 'nothing runs').toHaveCount(0);
    const unfold = done.getByRole('heading').getByRole('button');
    if ((await unfold.getAttribute('aria-expanded')) !== 'true') await unfold.click(); // Done is folded at first
    await expect(done.locator(`[data-agent-row="${agent.agentId}"]`)).toContainText('stopped');
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

  // The M8 sitting: an interrupt's partial reply stays, settled (no longer streaming). The M10 sitting: the session kept
  // none of it, so it is marked cut off, never drawn as the turn's reply.
  test('a pane opened mid-reply shows what already streamed; the turn aborting with no step end leaves its text settled, none streaming, marked cut off', async () => {
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
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-m', reason: 'aborted' }); // no step end, no block-row
    await expect(main(page).locator('.transcript-prose-live')).toHaveCount(0, { timeout: 10_000 });
    const cut = main(page).locator('[data-cut]');
    await expect(cut.getByText('Half a story and more', { exact: true })).toBeVisible();
    await expect(cut.getByText('Cut off · not kept by the session')).toBeVisible(); // the word cut (T65)
    await expect(main(page).locator('.transcript-answer').getByText('Half a story and more', { exact: true }), 'never drawn as the reply').toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // The M10 sitting: a terminal session's engine runs an agent in the background, so the turn that started it ends at
  // once; the row of its Agent call stays in view while the agent works, then folds with the turn's other work.
  test('an agent started in the background: its row stays in view under the ended turn while it works, then folds', async () => {
    const agent = { agentId: 'a1e2e000000000002', description: 'Sleep a while', prompt: 'Run sleep 200.', at: '2026-10-28T10:00:03.000Z' };
    let last = '';
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      const turn = backgroundAgentRecords(sid, cwd, ask, agent);
      last = (turn.at(-1)!.uuid as string);
      return [userRecord(sid, cwd, ask, after, 'Spawn an agent.', '2026-10-28T10:00:03.000Z'), ...turn, ...turnEndRecords(sid, cwd, last, '2026-10-28T10:00:04.000Z')];
    });
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, agent);
    const { page } = c;
    await drive(c);
    const row = main(page).locator('.transcript-subagent', { hasText: 'Sleep a while' });
    await expect(main(page).getByText('It is working in the background.')).toBeVisible({ timeout: 15_000 });
    await expect(row, 'the turn ended while its agent works: the call stays in view').toBeVisible();
    // the word cut (T86): a working agent's line is the running ring, named Working, and the description its parent gave
    await expect(row.getByRole('img', { name: 'Working', exact: true })).toBeVisible();
    await expect(row.locator('.transcript-subagent-sentence')).toHaveText('Sleep a while');
    await c.store.appendLines(c.transcript, [JSON.stringify(taskNotificationRecord(c.sid, c.repo.root, last, { taskId: agent.agentId, toolUseId: `toolu_${agent.agentId}`, status: 'completed', summary: 'Slept.', at: '2026-10-28T10:00:09.000Z' }))]);
    await expect(row, 'the agent ended: its row folds with the turn').toHaveCount(0, { timeout: 10_000 });
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // UX wave U8b (A2; M5 decision 5, M8) and U8d (M4 decision 1; acceptance 2, 3 and 4): the card column of a terminal
  // session this Mac drives. Main derives its shells and its agents from its transcript, its sidecars and its bridge, and
  // its watch carries them, so a running shell gives the Background tasks card and a running agent the Subagents card,
  // with the nested agent under its parent's "(+1)". The cards for running work are the column's last, so their going
  // moves no card above them.
  test('the card column of a terminal session this Mac drives: the Subagents and Background tasks cards while its agent and its shell run, a nested agent under its parent’s (+1); each card leaves with the last of its kind and moves no card above it', async () => {
    test.setTimeout(120_000);
    const agent = { agentId: 'a1e2e000000000003', description: 'Index the notes', prompt: 'Index notes.md.', at: '2026-10-28T10:00:04.000Z' };
    const nested = { agentId: 'a1e2e000000000006', description: 'Index the headings', prompt: 'Index the headings of notes.md.', at: '2026-10-28T10:00:06.000Z' };
    const job = { taskId: 'bwatch03', command: 'sleep 600', description: 'Watch the build', at: '2026-10-28T10:00:03.000Z' };
    let last = '';
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      const shell = backgroundBashRecords(sid, cwd, ask, job);
      const turn = backgroundAgentRecords(sid, cwd, shell.at(-1)!.uuid as string, agent);
      const end = turnEndRecords(sid, cwd, turn.at(-1)!.uuid as string, '2026-10-28T10:00:05.000Z');
      last = end.at(-1)!.uuid as string;
      return [userRecord(sid, cwd, ask, after, 'Watch the build and index the notes.', '2026-10-28T10:00:03.000Z'), ...shell, ...turn, ...end];
    });
    const parentFile = await backgroundAgentSidecars(c.store, c.sid, c.repo.root, agent);
    const { page } = c;
    const { bridge } = await drive(c);
    const row = main(page).locator('.transcript-subagent', { hasText: agent.description });
    await expect(row, 'the transcript: the agent works under the ended turn').toBeVisible({ timeout: 15_000 });

    await showSessionCards(page);
    const subagents = sessionCard(page, 'Subagents');
    const background = sessionCard(page, 'Background tasks');
    const parentRow = subagents.locator(`[data-agent-row="${agent.agentId}"]`);
    await expect(parentRow, 'the agent, as the session’s watch carries its status').toContainText(agent.description, { timeout: 15_000 });
    await expect(subagents.getByRole('button', { name: 'Subagents 1 running', exact: true })).toBeVisible();
    await expect(background.locator(`[data-task-id="${job.taskId}"]`), 'the shell, as the session’s watch carries it').toContainText(job.description, { timeout: 15_000 });
    await expect(background.getByRole('button', { name: 'Background tasks 1 running', exact: true })).toBeVisible();
    const [agentsBox, tasksBox] = [await subagents.boundingBox(), await background.boundingBox()];
    expect(agentsBox !== null && tasksBox !== null && agentsBox.y < tasksBox.y, 'Subagents above Background tasks').toBe(true);
    const above = sessionCard(page, 'Connectors');
    // Read once the Environment card's own reads have answered, since each that lands grows it, which is no move the
    // card's leaving made: git's (its branch and push rows), then the pull request's, whose row is drawn only once
    // `scm.status` answers. That answer waits for gh's probe (`gh auth status`, which may ask GitHub) even for a folder not
    // trusted, so it can land well after the rest; this checkout is not trusted, so the row then says so and nothing more
    // is asked.
    await expect(sessionCard(page, 'Environment').getByTestId('pr-line'), 'the Environment card’s last read has answered').toHaveText(
      'Trust this folder to see PR state',
      { timeout: 40_000 },
    );
    const before = await above.boundingBox();
    expect(before, 'the card above it is drawn').not.toBeNull();

    // the agent dispatches its own in the background: its sidecars, its call in the agent's own file, the bridge's spawn
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, nested, agent.agentId);
    const nestedCall = nestedAgentRecords(c.sid, c.repo.root, agent.agentId, parentFile.last, nested);
    await c.store.appendLines(parentFile.transcript, nestedCall.map((r) => JSON.stringify(r)));
    bridge.agentSpawned({ agentId: nested.agentId, toolUseId: `toolu_${nested.agentId}`, parentAgentId: agent.agentId, description: nested.description });
    await expect(subagents.getByRole('button', { name: 'Subagents 2 running', exact: true }), 'every running agent, the nested one too').toBeVisible({ timeout: 15_000 });
    await expect(subagents.locator('[data-agent-row]'), 'first-level agents only').toHaveCount(1);
    const under = parentRow.locator('[data-part="under"]');
    await expect(under).toHaveText('(+1)');
    await under.click();
    await expect(subagents.locator(`[data-agent-row="${nested.agentId}"]`), 'the nested agent beneath its parent').toHaveAttribute('data-depth', '1');

    // the nested agent ends (its notification in its parent's file), then the agent (in the main transcript). The bridge
    // still holds the nested agent running, so only the parent's file, read by its follower, can end it here; the bridge's
    // stop comes after (P2 recorded either order).
    await c.store.appendLines(parentFile.transcript, [JSON.stringify(agentNotificationRecord(c.sid, c.repo.root, agent.agentId, nestedCall.at(-1)!.uuid as string, {
      taskIds: [nested.agentId], toolUseId: `toolu_${nested.agentId}`, outputFile: `/tmp/claude/tasks/${nested.agentId}.output`, status: 'completed', summary: `Agent "${nested.description}" finished`, at: '2026-10-28T10:00:08.000Z',
    }))]);
    await expect(subagents.getByRole('button', { name: 'Subagents 1 running', exact: true }), 'the nested agent ended, from its parent’s file alone').toBeVisible({ timeout: 15_000 });
    await expect(subagents.locator(`[data-agent-row="${nested.agentId}"]`)).toHaveCount(0);
    await expect(under, 'no agent runs under it: neither count nor arrow').toHaveCount(0);
    bridge.agentStopped(nested.agentId);
    const agentEnd = taskNotificationRecord(c.sid, c.repo.root, last, { taskId: agent.agentId, toolUseId: `toolu_${agent.agentId}`, status: 'completed', summary: 'Indexed.', at: '2026-10-28T10:00:09.000Z' });
    await c.store.appendLines(c.transcript, [JSON.stringify(agentEnd)]);
    await expect(subagents, 'its last running agent ended: the card leaves').toHaveCount(0, { timeout: 15_000 });
    expect(await above.boundingBox(), 'and the card above it has not moved').toEqual(before);
    await expect(background, 'the shell still runs').toBeVisible();

    await c.store.appendLines(c.transcript, [JSON.stringify(taskNotificationRecord(c.sid, c.repo.root, agentEnd.uuid as string, { taskId: job.taskId, status: 'completed', summary: 'Background command "Watch the build" completed (exit code 0)', at: '2026-10-28T10:00:10.000Z' }))]);
    await expect(background, 'its last running task ended: the card leaves').toHaveCount(0, { timeout: 10_000 });
    expect(await above.boundingBox(), 'and the card above it has not moved').toEqual(before);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // UX wave U8b (A7, M6; X-168) and U8d (M4 decision 1; acceptance 8): a terminal session's engine runs an agent in the
  // background, so its turn ends while the agent works, and the transcript never says the agent ended when the terminal
  // closes (P3: nothing that names it reaches the main transcript). The terminal going (its registry record and its bridge
  // gone) ends the agents it left running: their row folds with the turn, the Subagents card leaves, and the panel's Done
  // reads "ended with the session". A resume in a terminal ends the orphan with the engine's `stopped` block before any
  // prompt (P1, u8d-p1-one-r1), so the agent it then starts is alone on the card; that terminal going ends it as well.
  test('X-168: an agent started in the background whose terminal goes: its row folds with the ended turn, the Subagents card leaves and Done reads ended with the session; resumed in a terminal, the orphan reads stopped and the next agent is alone on the card, then ends the same way once that terminal goes too', async () => {
    test.setTimeout(120_000);
    const first: BackgroundAgent = { agentId: 'a1e2e000000000004', description: 'Sort the notes', prompt: 'Sort notes.md.', at: '2026-10-28T10:00:03.000Z' };
    const second: BackgroundAgent = { agentId: 'a1e2e000000000005', description: 'Tidy the notes', prompt: 'Tidy notes.md.', at: '2026-10-28T10:01:03.000Z' };
    let last = '';
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      const turn = backgroundAgentRecords(sid, cwd, ask, first);
      const end = turnEndRecords(sid, cwd, turn.at(-1)!.uuid as string, '2026-10-28T10:00:04.000Z');
      last = end.at(-1)!.uuid as string;
      return [userRecord(sid, cwd, ask, after, 'Sort them in the background.', '2026-10-28T10:00:03.000Z'), ...turn, ...end];
    });
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, first);
    const { page } = c;
    const holder = async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind;
    const rowOf = (agent: BackgroundAgent) => main(page).locator('.transcript-subagent', { hasText: agent.description });
    const card = sessionCard(page, 'Subagents');
    const onCard = (agent: BackgroundAgent) => card.locator(`[data-agent-row="${agent.agentId}"]`);
    // the panel's Done, unfolded, once its heading reads `heading`
    const doneReads = async (heading: string): Promise<Locator> => {
      await openSurface(page, 'Subagents');
      const tool = surface(page, 'subagents');
      const done = tool.locator('section[data-section="done"]');
      await expect(done).toHaveAttribute('aria-label', heading, { timeout: 15_000 });
      await expect(tool.locator('section[data-section="running"]'), 'nothing under Running').toHaveCount(0);
      const unfold = done.getByRole('heading').getByRole('button');
      if ((await unfold.getAttribute('aria-expanded')) !== 'true') await unfold.click(); // Done is folded at first
      return done;
    };
    const terminal = await drive(c);
    // the word cut (T86): the running ring, named Working, and the description alone
    await expect(rowOf(first).locator('.transcript-subagent-sentence'), 'the turn ended while its agent works: the call stays in view').toHaveText(first.description, { timeout: 15_000 });
    await expect(rowOf(first).getByRole('img', { name: 'Working', exact: true })).toBeVisible();
    await showSessionCards(page);
    await expect(onCard(first), 'the agent on the Subagents card').toContainText(first.description, { timeout: 15_000 });
    await expect(card.getByRole('button', { name: 'Subagents 1 running', exact: true })).toBeVisible();

    await terminal.close();
    c.terminal = null;
    await expect.poll(holder, { timeout: 10_000 }).toBe('none');
    await expect(rowOf(first), 'its terminal went: the agent ended with it, and its row folds with the turn').toHaveCount(0, { timeout: 15_000 });
    await expect(card, 'nothing of the session runs: the Subagents card leaves').toHaveCount(0, { timeout: 15_000 });
    await expect((await doneReads('Done 1')).locator(`[data-agent-row="${first.agentId}"]`)).toContainText('ended with the session');

    // resumed in a terminal: the engine ends the orphan first (one block, its output file, `stopped`: a queue record, a
    // dequeue and a user row), then the session starts another agent in the background and ends its turn
    await drive(c, { open: false });
    const orphan = queuedNotificationRecords(c.sid, c.repo.root, last, {
      taskIds: [first.agentId], outputFile: `/tmp/claude/tasks/${first.agentId}.output`, status: 'stopped', summary: `Background agent "${first.description}" didn't finish before the previous session ended`, at: '2026-10-28T10:01:01.000Z',
    }, { resume: true });
    await c.store.appendLines(c.transcript, orphan.map((r) => JSON.stringify(r)));
    const ask = randomUUID();
    const turn = backgroundAgentRecords(c.sid, c.repo.root, ask, second);
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, second);
    await c.store.appendLines(c.transcript, [userRecord(c.sid, c.repo.root, ask, orphan.at(-1)!.uuid as string, 'Now tidy them in the background.', '2026-10-28T10:01:03.000Z'), ...turn, ...turnEndRecords(c.sid, c.repo.root, turn.at(-1)!.uuid as string, '2026-10-28T10:01:04.000Z')].map((r) => JSON.stringify(r)));
    await expect(rowOf(second).locator('.transcript-subagent-sentence'), 'the resumed session’s agent works: its call stays in view').toHaveText(second.description, { timeout: 15_000 });
    await expect(rowOf(second).getByRole('img', { name: 'Working', exact: true })).toBeVisible();
    await expect(rowOf(first), 'the first stays ended').toHaveCount(0);
    await showSessionCards(page);
    await expect(onCard(second), 'the second agent on the card').toContainText(second.description, { timeout: 15_000 });
    await expect(card.getByRole('button', { name: 'Subagents 1 running', exact: true }), 'the orphan ended at the resume: the second agent alone').toBeVisible();
    await expect(onCard(first)).toHaveCount(0);

    await c.terminal!.close();
    c.terminal = null;
    await expect.poll(holder, { timeout: 10_000 }).toBe('none');
    await expect(rowOf(second), 'that terminal went too: the second agent ended with it').toHaveCount(0, { timeout: 15_000 });
    await expect(card, 'the Subagents card leaves again').toHaveCount(0, { timeout: 15_000 });
    const done = await doneReads('Done 2 · 1 stopped');
    await expect(done.locator(`[data-agent-row="${second.agentId}"]`)).toContainText('ended with the session');
    await expect(done.locator(`[data-agent-row="${first.agentId}"]`), 'the orphan keeps the word its resume gave it').toContainText('stopped');
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // Ticket 701: the terminal's bridge goes (its socket gone, its child restarting) while the terminal's process runs.
  // Main reads that as the bridge alone going: the agent and the shell it drove are no longer known to run, so neither
  // card holds them and nothing reads "ended with the session" (the panel lists the agent on disk, its status
  // unavailable) until the bridge answers again and its watch says they run. The process then ending ends them.
  test('a bridge that goes while its terminal runs: the cards leave and nothing reads ended with the session, the agent on disk with its status unavailable; the bridge back, both run again; the terminal going then ends them with the session', async () => {
    test.setTimeout(120_000);
    const agent: BackgroundAgent = { agentId: 'a1e2e000000000007', description: 'Count the notes', prompt: 'Count notes.md.', at: '2026-10-28T10:00:04.000Z' };
    const job = { taskId: 'bwatch07', command: 'sleep 600', description: 'Watch the tests', at: '2026-10-28T10:00:03.000Z' };
    const c = await begin((sid, cwd, after) => {
      const ask = randomUUID();
      const shell = backgroundBashRecords(sid, cwd, ask, job);
      const turn = backgroundAgentRecords(sid, cwd, shell.at(-1)!.uuid as string, agent);
      return [userRecord(sid, cwd, ask, after, 'Watch the tests and count the notes.', '2026-10-28T10:00:03.000Z'), ...shell, ...turn, ...turnEndRecords(sid, cwd, turn.at(-1)!.uuid as string, '2026-10-28T10:00:05.000Z')];
    });
    await backgroundAgentSidecars(c.store, c.sid, c.repo.root, agent);
    const { page } = c;
    const holder = async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind;
    const states = async () => value(await invoke(page, 'laneA.list', undefined)).states.length;
    const subagents = sessionCard(page, 'Subagents');
    const background = sessionCard(page, 'Background tasks');
    const running = async () => {
      await showSessionCards(page);
      await expect(subagents.locator(`[data-agent-row="${agent.agentId}"]`), 'the agent on the Subagents card').toContainText(agent.description, { timeout: 15_000 });
      await expect(background.locator(`[data-task-id="${job.taskId}"]`), 'the shell on the Background tasks card').toContainText(job.description, { timeout: 15_000 });
    };
    // the panel's section `name`, unfolded, once its heading reads `heading`
    const section = async (name: string, heading: string): Promise<Locator> => {
      await openSurface(page, 'Subagents');
      const found = surface(page, 'subagents').locator(`section[data-section="${name}"]`);
      await expect(found).toHaveAttribute('aria-label', heading, { timeout: 15_000 });
      const unfold = found.getByRole('heading').getByRole('button');
      if ((await unfold.getAttribute('aria-expanded')) !== 'true') await unfold.click();
      return found;
    };
    const terminal = await drive(c);
    await running();

    await terminal.bridge.close();
    await expect.poll(states, { timeout: 10_000, message: 'its bridge gone: no lane A state' }).toBe(0);
    expect(await holder(), 'the terminal still holds the session').toBe('terminal');
    await expect(subagents, 'the agent is no longer known to run: the Subagents card leaves').toHaveCount(0, { timeout: 15_000 });
    await expect(background, 'nor the shell: the Background tasks card leaves').toHaveCount(0, { timeout: 15_000 });
    const disk = await section('disk', 'On disk 1');
    await expect(disk.locator(`[data-agent-row="${agent.agentId}"]`), 'its status unknown, not ended').toContainText('status unavailable');
    await expect(surface(page, 'subagents').locator('section[data-section="done"]'), 'nothing reads ended').toHaveCount(0);
    await expect(surface(page, 'subagents')).not.toContainText('ended with the session');

    // the bridge answers again under the same terminal: its watch says both run
    const back = await startFakeBridge({ home: c.maws.sminosHome, session: c.sid, pid: terminal.pid, sessionInfo: { session: c.sid, cwd: c.repo.root, model: 'claude-opus-4-5', version: '2.1.300' } });
    back.emit({ type: 'catalog', ...CATALOG });
    c.terminal = { bridge: back, pid: terminal.pid, close: async () => (await terminal.close(), await back.close()) };
    await expect.poll(states, { timeout: 15_000, message: 'its bridge back' }).toBe(1);
    await running();

    // the terminal's process ends: what ran ended with the session
    await c.terminal.close();
    c.terminal = null;
    await expect.poll(holder, { timeout: 10_000 }).toBe('none');
    await expect(subagents, 'nothing of the session runs').toHaveCount(0, { timeout: 15_000 });
    await expect((await section('done', 'Done 1')).locator(`[data-agent-row="${agent.agentId}"]`)).toContainText('ended with the session');
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('a permission the bridge raised: Needs you and the pane within 1 s, the hover preview, the Overview card and the badge; allowed here, then answered in the terminal, then a late answer reading who won', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page, maws } = c;
    const { bridge } = await drive(c);
    const sidebar = sidebarOf(page);

    bridge.raise({ request: 'toolu_allow', tool: 'Bash', input: { command: 'ls -la' } });
    await expect(end(page).locator('[data-request-card]').getByRole('button', { name: 'Allow once', exact: true }), 'at the transcript’s end within 1 s').toBeVisible({ timeout: 1_000 });
    await expect(editor(page), 'U1b: the composer stays beside it').toBeEditable();
    await expect(sidebar.getByRole('heading', { name: 'Needs you · 1' }), 'in Needs you within 1 s').toBeVisible({ timeout: 1_000 });
    await expect(sidebar.getByRole('list', { name: 'Needs you' }).getByRole('button')).toHaveAccessibleName(/ · Approval needed$/);
    await expect(card(page), 'the terminal asks it too (Q3)').toContainText('Also asked in the terminal: the first answer wins');
    await expect.poll(() => badge(maws), 'the dock badge counts it (Q5)').toBe('1');

    // the hover preview and the Overview card show it as any session's
    const row = await sidebarRow(page, { appSessionId: c.appId });
    await expect(row.getByRole('img', { name: 'Needs approval' }), 'its open item wins over the holder glyph (Q1)').toBeVisible();
    const hover = page.locator('[data-hover-card]');
    await expect(async () => {
      await page.mouse.move(700, 20);
      await row.hover();
      await expect(hover).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 10_000 });
    await expect(hover.getByRole('group', { name: /^Approval needed/ })).toBeVisible();
    await page.mouse.move(700, 20);
    await maws.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab.overview')?.click());
    const overview = main(page).getByRole('dialog', { name: 'Overview' });
    await expect(overview.locator(`[data-card="${await addressed(page, c.appId)}"]`).getByRole('button', { name: 'Allow once', exact: true }), 'the card answers it through the port').toBeVisible({ timeout: 10_000 });
    await overview.getByRole('button', { name: 'Close Overview' }).click();
    await expect(overview).toHaveCount(0);

    // allowed in MAWS: the fake takes Interfaces §D's body. U1a §B: the request stops waiting when the bridge takes the
    // answer (its 200), before its `settled`: the card, Needs you and the badge go then, and the settle changes nothing
    await card(page).getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: 'toolu_allow', behavior: 'allow', ...AS_MAWS }]);
    await expect(card(page), 'gone at the 200, before the settle').toHaveCount(0, { timeout: 1_000 });
    await expect(sidebar.getByRole('heading', { name: /^Needs you/ })).toHaveCount(0, { timeout: 1_000 });
    await expect.poll(() => badge(maws)).toBe('');
    bridge.settle('toolu_allow', 'web', 'allow');
    await page.waitForTimeout(300);
    await expect(card(page), 'the settle changes nothing').toHaveCount(0);
    await expect(sidebar.getByRole('heading', { name: /^Needs you/ })).toHaveCount(0);
    expect(await badge(maws)).toBe('');

    // answered in the terminal first, the only request at the end (UX wave U1b, acceptance 12; decision 20): the card goes
    // and its receipt stands where it stood, "<summary> · <the settlement's words>", a status line with no control that
    // nothing counts as waiting (no Needs you, no badge), held by the store past the card; then it goes, and the end with it
    bridge.raise({ request: 'toolu_term', tool: 'Bash', input: { command: 'git status' } });
    await expect(end(page).locator('[data-request-card]').getByRole('button', { name: 'Allow once', exact: true })).toBeVisible({ timeout: 1_000 });
    // how long the receipt stands, read by the page itself (its own clock, from its drawing to its going): a lower bound
    // only, and a staging limit as much as a measure: the store's timer starts at its write, a little before the DOM shows
    // the line, so the drawn span can fall short of SETTLED_MS by that delay; 2.5 s leaves it room
    await page.evaluate(() => {
      const seen: { shown: number | null; gone: number | null } = { shown: null, gone: null };
      (window as unknown as { __u1bSettling: typeof seen }).__u1bSettling = seen;
      const look = () => {
        const held = document.querySelector('[data-settling]') !== null;
        if (held && seen.shown === null) seen.shown = performance.now();
        if (!held && seen.shown !== null && seen.gone === null) seen.gone = performance.now();
      };
      new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
    });
    bridge.settle('toolu_term', 'terminal', 'allow');
    const receipt = end(page).locator('[data-settling]');
    await expect(receipt).toHaveText('Bash: git status · Answered in the terminal: Allowed', { timeout: 2_000 });
    await expect(receipt).toHaveRole('status');
    await expect(card(page), 'the card went with its request').toHaveCount(0);
    await expect(end(page).getByRole('button'), 'the receipt has no control').toHaveCount(0);
    await expect(sidebar.getByRole('heading', { name: /^Needs you/ }), 'nothing counts it as waiting').toHaveCount(0);
    await expect.poll(() => badge(maws)).toBe('');
    await expect(receipt, 'still held').toHaveCount(1);
    await expect(main(page).getByRole('button', { name: 'Needs your input. Scroll to the request' }), 'nor the jump button').toHaveCount(0);
    await expect(end(page), 'the receipt goes after SETTLED_MS, and the end row with it').toHaveCount(0, { timeout: 8_000 });
    await expect(main(page).locator(END_ROW)).toHaveCount(0);
    const stood = await page.evaluate(() => {
      const seen = (window as unknown as { __u1bSettling: { shown: number | null; gone: number | null } }).__u1bSettling;
      return seen.shown === null || seen.gone === null ? null : seen.gone - seen.shown;
    });
    expect(stood, 'the receipt was drawn and went').not.toBeNull();
    // SETTLED_MS is 3 s (lane-a/race.ts), its timer started when the follower wrote the receipt, a frame or so before it
    // was drawn: it stood near three seconds, never a blink
    expect(stood!, 'the receipt stood for its three seconds').toBeGreaterThanOrEqual(2_500);

    // an answer the bridge refuses because another won reads as that settlement, never an error
    bridge.raise({ request: 'toolu_late', tool: 'Bash', input: { command: 'rm notes.md' } });
    bridge.answer('decision:toolu_late', () => ({ status: 409, body: { error: 'already settled', settled: { request: 'toolu_late', winner: 'terminal', outcome: 'deny', by: 'terminal' } } }));
    await card(page).getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(card(page).getByRole('status')).toHaveText('Answered in the terminal: Denied', { timeout: 5_000 });
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    expect(decided(bridge).map((d) => d.request), 'the refused one taken by no one').toEqual(['toolu_allow']);
    bridge.settle('toolu_late', 'terminal', 'deny');
    await expect(card(page)).toHaveCount(0, { timeout: 5_000 });
    expect(maws.consoleErrors()).toEqual([]);
  });

  test('a permission card’s options: a scoped allow sends the one suggestion with its destination, two suggestions offer no scope, deny-and-interrupt and an edited input are never sent, a background request past its window is the terminal’s', async () => {
    test.setTimeout(120_000);
    const c = await begin();
    const { page } = c;
    const { bridge } = await drive(c);
    const one = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };

    // U1a §D: a localSettings suggestion puts "Always allow in <project>" third, and the session scope in the menu on Allow once.
    // U1b: each prompt here is a card at the transcript's end (the session's file holds none of these calls)
    await expect(end(page)).toHaveCount(0);
    bridge.raise({ request: 'toolu_scoped', tool: 'Bash', input: { command: 'npm test' }, suggestions: [one] });
    await expect(end(page).locator('[data-request-card]').getByRole('button', { name: /^Always allow in / })).toBeVisible({ timeout: 5_000 });
    await card(page).getByRole('button', { name: 'More allow options' }).click();
    await page.getByRole('menuitem', { name: 'Allow for this session' }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: 'toolu_scoped', behavior: 'allow', updatedPermissions: [{ ...one, destination: 'session' }], ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_scoped');

    // two suggestions: no scope; deny-and-interrupt closed with its reason; an edited input refused before the bridge
    bridge.raise({ request: 'toolu_two', tool: 'Bash', input: { command: 'npm test' }, suggestions: [one, { ...one, destination: 'session' }] });
    const offers2 = "A scoped allow takes the request's one suggestion; this request offers 2";
    const always = card(page).getByRole('button', { name: /^Always allow in / });
    await expect(always).toBeDisabled({ timeout: 5_000 });
    await expect(always).toHaveAttribute('title', offers2);
    await card(page).getByRole('button', { name: 'More allow options' }).click();
    const session = page.getByRole('menuitem', { name: 'Allow for this session' });
    await expect(session).toHaveAttribute('aria-disabled', 'true');
    await expect(session).toHaveAttribute('title', offers2);
    await page.keyboard.press('Escape');
    await card(page).getByRole('button', { name: 'More deny options' }).click();
    const stop = page.getByRole('menuitem', { name: 'Deny and stop the turn' });
    await expect(stop).toHaveAttribute('aria-disabled', 'true');
    await expect(stop).toHaveAttribute('title', 'Deny-and-interrupt is answered in the terminal');
    await page.keyboard.press('Escape');
    const edited = value(await invoke(page, 'laneA.answer', { appSessionId: c.appId, request: 'toolu_two', answer: { kind: 'permission', decision: 'allow', scope: 'once', updatedInput: { command: 'npm test -- --watch' } } }));
    expect(edited, 'no MAWS control edits an input; the port refuses one').toEqual({ outcome: 'refused', code: 'unsupported', message: 'an edited input is answered in the terminal' });
    await card(page).getByRole('button', { name: 'Deny', exact: true }).click();
    await expect.poll(() => decided(bridge).slice(1)).toEqual([{ request: 'toolu_two', behavior: 'deny', ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_two', 'deny');

    // a background subagent's request: answerable in its window, the terminal's once it closes
    bridge.raise({ request: 'toolu_bg', tool: 'Bash', input: { command: 'make' }, agentId: 'a1e2e000000000002', deadline: Date.now() + 4_000 });
    const allow = card(page).getByRole('button', { name: 'Allow once', exact: true });
    await expect(allow).toBeEnabled({ timeout: 1_000 });
    await expect(card(page).getByText('Answer this in the terminal')).toBeVisible({ timeout: 8_000 });
    for (const name of ['Deny', 'Allow for this session', 'Allow once']) {
      const button = card(page).getByRole('button', { name, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('title', 'Answer this in the terminal');
    }
    expect(decided(bridge)).toHaveLength(2);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // UX wave U1b: the first question's call is in the session's file, so its form stands in that call's row and its
  // answer reads there after; the others name no call the file holds and are cards at the transcript's end.
  test('questions and plans: answers, a native question skipped as a decline, an async one answered and never skipped; a plan implemented, kept with feedback and without, its clear and implement closed', async () => {
    test.setTimeout(150_000);
    const asked = (question: string, labels: string[]) => ({ questions: [{ question, header: question.slice(0, 8), options: labels.map((label) => ({ label })), multiSelect: false }] });
    const c = await begin((sid, cwd, after) => {
      const rows = fileRows(sid, cwd, after, '2026-10-28T10:00:03.000Z');
      return [rows.prompt('Ask me which colour to use.'), rows.call('toolu_q1', 'AskUserQuestion', asked('Which colour?', ['Red', 'Blue']))];
    });
    const { page } = c;
    const { bridge } = await drive(c);
    const pick = async (question: string, label: string) => card(page).getByRole('radiogroup', { name: question }).getByRole('radio', { name: label }).click();
    let n = 0;
    const lastDecision = () => decided(bridge).slice(n);

    bridge.raise({ request: 'toolu_q1', tool: 'AskUserQuestion', input: asked('Which colour?', ['Red', 'Blue']) });
    const q1 = questionRow(page, 'toolu_q1');
    await expect(q1.locator('[data-request-card]'), 'the form in its call’s row').toBeVisible({ timeout: 5_000 });
    await expect(end(page), 'and nothing at the end').toHaveCount(0);
    await pick('Which colour?', 'Red');
    await card(page).getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_q1', behavior: 'allow', updatedInput: { answers: { 'Which colour?': 'Red' } }, ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_q1');
    await expect.poll(() => receiptLines(q1), { message: 'the row reads the answer this window gave' }).toEqual(['Which co→Red']);
    n = 1;

    // every question skipped on a native question: the request declined
    bridge.raise({ request: 'toolu_q2', tool: 'AskUserQuestion', input: asked('Which size?', ['Small', 'Large']) });
    await expect(end(page).locator('[data-request-card]'), 'no row holds its call: a card at the end').toBeVisible({ timeout: 5_000 });
    await card(page).getByRole('button', { name: 'Skip', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_q2', behavior: 'deny', ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_q2', 'deny');
    n = 2;

    // an async question (the ask mod's): its Skip closed, its answer sent
    bridge.raise({ request: 'toolu_q3', tool: 'mcp__plugin_sminos_ask__ask', async: true, input: asked('Ship it?', ['Yes', 'Not yet']) });
    const skip = card(page).getByRole('button', { name: 'Skip', exact: true });
    await expect(skip).toBeDisabled({ timeout: 5_000 });
    await expect(skip).toHaveAttribute('title', 'An async question needs an answer');
    await pick('Ship it?', 'Yes');
    await card(page).getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_q3', behavior: 'allow', updatedInput: { answers: { 'Ship it?': 'Yes' } }, ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_q3');
    n = 3;

    // a plan: clear and implement closed with its reason; Implement allows
    const plan = { plan: '1. Write the tests.\n2. Ship.' };
    bridge.raise({ request: 'toolu_p1', tool: 'ExitPlanMode', input: plan });
    const clear = card(page).getByRole('button', { name: 'Clear context and implement' });
    await expect(clear).toBeDisabled({ timeout: 5_000 });
    await expect(clear).toHaveAttribute('title', '/clear runs in the terminal');
    await card(page).getByRole('button', { name: 'Implement', exact: true }).click();
    await expect.poll(lastDecision).toEqual([{ request: 'toolu_p1', behavior: 'allow', ...AS_MAWS }]);
    await settledHere(page, bridge, 'toolu_p1');
    n = 4;

    // keep planning, with feedback (its message) and without (no message key)
    for (const [request, feedback] of [['toolu_p2', 'Smaller steps, please.'], ['toolu_p3', '']] as const) {
      bridge.raise({ request, tool: 'ExitPlanMode', input: plan });
      await card(page).getByRole('button', { name: 'Keep planning' }).click();
      if (feedback !== '') await card(page).getByRole('textbox', { name: 'What should change in the plan' }).fill(feedback);
      await card(page).getByRole('button', { name: 'Send feedback' }).click();
      await expect.poll(lastDecision).toEqual([{ request, behavior: 'deny', ...(feedback !== '' && { message: feedback }), ...AS_MAWS }]);
      await settledHere(page, bridge, request, 'deny');
      n += 1;
    }
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // U1a (A5, A18; §G): a terminal session's asynchronous question does not stop the agent, so its row reads "Question
  // waiting" in the calm tone, and Esc ends nothing. Its form's Dismiss sends the bridge's dismissal where the bridge
  // declares `decide.dismiss` (sminos 1.47.0), and is closed with its reason where it does not (the plugin as installed).
  for (const declared of [false, true]) {
    test(`an asynchronous question reads "Question waiting"; its Dismiss ${declared ? 'sends the bridge’s dismissal and the card leaves at the 200' : 'is closed: dismiss it in the terminal'}`, async () => {
      test.setTimeout(120_000);
      const c = await begin();
      const { page } = c;
      const controls = { ...FULL_CAPABILITIES.controls, ...(declared && { 'decide.dismiss': { available: true } }) };
      const { bridge } = await drive(c, { bridge: { capabilities: { ...FULL_CAPABILITIES, controls } } });
      bridge.raise({ request: 'toolu_async', tool: 'mcp__plugin_sminos_ask__ask', async: true, input: { questions: [{ question: 'Ship it today?', header: 'Ship it', options: [{ label: 'Yes' }, { label: 'Not yet' }], multiSelect: false }] } });
      const dismiss = card(page).getByRole('button', { name: 'Dismiss', exact: true }); // the form's own: every question card has one
      await expect(dismiss).toBeVisible({ timeout: 5_000 });
      const row = await sidebarRow(page, { appSessionId: c.appId });
      await expect(row.getByRole('img', { name: 'Question waiting' }), 'the calm tone on its row').toBeVisible();
      await expect(sidebarOf(page).getByRole('list', { name: 'Needs you' }).getByRole('button')).toHaveAccessibleName(/ · Question waiting$/);

      // Esc on the form sends nothing (O-22). UX wave U1b: the keyboard on the transcript row that holds it, which owns
      // the card's keys (the session's file holds no call for it, so it is the end row)
      await expect(end(page).locator('[data-request-card]')).toBeVisible();
      await rowOf(card(page)).focus();
      await expect(rowOf(card(page))).toBeFocused();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      expect(decided(bridge), 'Esc sends nothing').toEqual([]);

      if (!declared) {
        await expect(dismiss).toBeDisabled();
        await expect(dismiss).toHaveAttribute('title', 'Dismiss it in the terminal');
      } else {
        await expect(dismiss).toBeEnabled();
        await dismiss.click();
        await expect.poll(() => decided(bridge)).toEqual([{ request: 'toolu_async', behavior: 'dismiss', ...AS_MAWS }]);
        await expect(card(page), 'the card leaves at the 200, before any settle').toHaveCount(0, { timeout: 2_000 });
        await expect(row.getByRole('img', { name: 'Question waiting' }), 'the row no longer counts the question').toHaveCount(0);
      }
      expect(c.maws.consoleErrors()).toEqual([]);
    });
  }

  // UX wave U1b (acceptance 4, 5 and 8; Interfaces §D "A waiting row", "A question's receipt", §G "The receipt"; decisions
  // 8 and 10; the owner's "Form header", "Two lines"; ruling A2). Four asynchronous questions the agent asked in its file,
  // each raised by the bridge in turn: its form stands in its call's row, the composer free beside it; then the row reads
  // what is known, by the first source that has it: answered here ("header→answer" at once), answered in the terminal
  // (the settlement's words until the delivery), dismissed here or in the terminal ("Dismissed"). The deliveries are
  // written in both shapes the file holds (the plugin's prompt carrying an answer and a dismissal; a hook's context on a
  // tool result, one each), and the rows read them; after a reload the rows read the same from the file alone (this
  // window's own receipts are gone with the reload: the answer given here would otherwise read "Answered in MAWS").
  test('an asynchronous question’s form stands in its call’s row under its two-line header, the composer free; answered here or in the terminal, or dismissed, its row says so at once, after the delivery and after a reload', async () => {
    test.setTimeout(180_000);
    const week = 'Which day should the printed week start on?';
    const cover = 'Which colour for the cover?';
    const door = 'Which finish for the shed door?';
    const ASKS = {
      notes: { call: 'toolu_u1b_notes', questions: [single(week, 'Week start', ['Monday', 'Sunday']), single(cover, 'Cover', ['Blue', 'Green'])] },
      door: { call: 'toolu_u1b_door', questions: [single(door, 'Door finish', ['Oil paint', 'Wood stain'])] },
      window: { call: 'toolu_u1b_window', questions: [single('Should the reopening dates go in the newsletter?', 'Release window', ['Yes', 'No'])] },
      rota: { call: 'toolu_u1b_rota', questions: [single('Who takes the first rota slot?', 'Rota', ['Ana', 'Ben'])] },
    };
    let rows!: ReturnType<typeof fileRows>;
    const c = await begin((sid, cwd, after) => {
      rows = fileRows(sid, cwd, after, '2026-10-28T10:00:03.000Z');
      return [
        rows.prompt('Lay out the garden notes; ask me what you cannot decide.'),
        ...Object.values(ASKS).flatMap((ask) => [rows.call(ask.call, ASK_TOOL, { questions: ask.questions, async: true }), rows.result(ask.call, ASYNC_RESULT)]),
        rows.text('I will go on with the layout while you decide.'),
        ...rows.turnEnd(),
      ];
    });
    const { page } = c;
    const controls = { ...FULL_CAPABILITIES.controls, 'decide.dismiss': { available: true } }; // sminos 1.47.0: Dismiss is sent
    const { bridge } = await drive(c, { bridge: { capabilities: { ...FULL_CAPABILITIES, controls } } });
    const raise = (ask: (typeof ASKS)[keyof typeof ASKS]) => bridge.raise({ request: ask.call, tool: ASK_TOOL, async: true, input: { questions: ask.questions, async: true } });
    const formIn = (call: string) => questionRow(page, call).locator('[data-request-card]');
    const pickIn = (form: Locator, question: string, label: string) => form.getByRole('radiogroup', { name: question }).getByRole('radio', { name: label }).click();
    for (const ask of Object.values(ASKS)) {
      await expect.poll(() => receiptLines(questionRow(page, ask.call)), { timeout: 15_000, message: `${ask.call}: its row before any request` }).toEqual(ask.questions.map((q) => `${q.header}→Not answered`));
    }

    // answered here: the form in its row, nothing at the end, the session reading "Question waiting", the composer free
    raise(ASKS.notes);
    const notes = formIn(ASKS.notes.call);
    await expect(notes, 'the form in its call’s row').toBeVisible({ timeout: 5_000 });
    await expect(notes).toHaveRole('group');
    await expect(notes).toHaveAccessibleName('Question waiting');
    await expect(end(page), 'nothing at the end').toHaveCount(0);
    await expect((await sidebarRow(page, { appSessionId: c.appId })).getByRole('img', { name: 'Question waiting' })).toBeVisible();
    await editor(page).click();
    await editor(page).pressSequentially('A note while it waits');
    await expect(editor(page), 'the composer takes text beside the form').toHaveText('A note while it waits');
    await clear(editor(page));

    // The owner's form header (2026-11-15, "Two lines"): above the step, two lines, each one line high: the kind line with
    // the count, and the terminal note; no heading, no "asks" line, no "from" for the session's own question; nothing in
    // the card above the form's body
    const header = await notes.evaluate((card) => {
      const step = card.querySelector('[data-question-step]');
      const head = card.querySelector('[data-form-header]');
      const lines = Array.from(head?.children ?? []).map((child) => {
        const box = child.getBoundingClientRect();
        const style = getComputedStyle(child);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        return { text: child.textContent, top: Math.round(box.top), oneLine: box.height > 0 && box.height < 2 * line };
      });
      return { bodyFirst: card.firstElementChild === step, headerFirst: step !== null && step.firstElementChild === head, headings: card.querySelectorAll('h1, h2, h3, h4').length, lines };
    });
    expect(header.bodyFirst, 'nothing in the card above the form’s body').toBe(true);
    expect(header.headerFirst, 'the form opens on its header').toBe(true);
    expect(header.headings, 'no title line').toBe(0);
    expect(header.lines.map((l) => l.text), 'the kind line with the count, then the terminal note').toEqual(['?Question waiting· 2 questions', 'Also asked in the terminal: the first answer wins']);
    expect(new Set(header.lines.map((l) => l.top)).size, 'two lines').toBe(2);
    expect(header.lines.every((l) => l.oneLine), 'each one line high').toBe(true);

    await pickIn(notes, week, 'Monday');
    await notes.getByRole('button', { name: 'Next', exact: true }).click();
    await pickIn(notes, cover, 'Blue');
    await notes.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: ASKS.notes.call, behavior: 'allow', updatedInput: { answers: { [week]: 'Monday', [cover]: 'Blue' } }, ...AS_MAWS }]);
    await expect(notes, 'the form goes at the bridge’s 200').toHaveCount(0, { timeout: 2_000 });
    await expect.poll(() => receiptLines(questionRow(page, ASKS.notes.call)), { message: 'the answer this window gave, at once' }).toEqual(['Week start→Monday', 'Cover→Blue']);
    bridge.settle(ASKS.notes.call, 'web', 'answered');

    // answered in the terminal: a Skip that would leave every question unanswered is closed with its reason; the row
    // reads the settlement's words, and the end draws none (the row says it)
    raise(ASKS.door);
    const doorForm = formIn(ASKS.door.call);
    const skip = doorForm.getByRole('button', { name: 'Skip', exact: true });
    await expect(skip).toBeDisabled({ timeout: 5_000 });
    await expect(skip).toHaveAttribute('title', 'An async question needs an answer');
    bridge.settle(ASKS.door.call, 'terminal', 'answered');
    await expect(doorForm).toHaveCount(0, { timeout: 2_000 });
    await expect.poll(() => receiptLines(questionRow(page, ASKS.door.call))).toEqual(['Door finish→Answered in the terminal']);
    await expect(end(page), 'its receipt is the row’s, not the end’s').toHaveCount(0);

    // dismissed here: "Dismissed" at the press; the header whole beside it, on the real layout (ruling A2)
    raise(ASKS.window);
    const windowForm = formIn(ASKS.window.call);
    await windowForm.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect.poll(() => decided(bridge).slice(1)).toEqual([{ request: ASKS.window.call, behavior: 'dismiss', ...AS_MAWS }]);
    await expect(windowForm).toHaveCount(0, { timeout: 2_000 });
    const windowRow = questionRow(page, ASKS.window.call);
    await expect.poll(() => receiptLines(windowRow)).toEqual(['Release window→Dismissed']);
    const label = windowRow.locator('[data-question-label]');
    await expect(label).toHaveText('Release window');
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth), 'the header is not cut beside Dismissed').toBe(true);
    bridge.settle(ASKS.window.call, 'web', 'withdrawn', 'maws');

    // dismissed in the terminal
    raise(ASKS.rota);
    await expect(formIn(ASKS.rota.call)).toBeVisible({ timeout: 5_000 });
    bridge.settle(ASKS.rota.call, 'terminal', 'withdrawn', 'terminal');
    await expect(formIn(ASKS.rota.call)).toHaveCount(0, { timeout: 2_000 });
    await expect.poll(() => receiptLines(questionRow(page, ASKS.rota.call))).toEqual(['Rota→Dismissed']);
    expect(decided(bridge), 'the terminal’s answers sent nothing from here').toHaveLength(2);

    // the deliveries, in both shapes: the plugin's prompt (the session idle) carrying this window's answer and dismissal,
    // then, in the turn it opens, a hook's context on each of two results, the terminal's answer and its dismissal
    const bash = (id: string) => [rows.call(id, 'Bash', { command: 'ls notes', description: 'List the notes' }), rows.result(id, 'garden.md', { stdout: 'garden.md', stderr: '', interrupted: false, isImage: false })];
    await c.store.appendLines(
      c.transcript,
      [
        rows.pluginPrompt(`${delivery(ASKS.notes.call, answered({ [week]: 'Monday', [cover]: 'Blue' }))}\n\n${delivery(ASKS.window.call, DISMISSED)}`),
        ...bash('toolu_u1b_ls1'),
        rows.hookContext(delivery(ASKS.door.call, answered({ [door]: 'Oil paint' })), 'toolu_u1b_ls1'),
        ...bash('toolu_u1b_ls2'),
        rows.hookContext(delivery(ASKS.rota.call, DISMISSED), 'toolu_u1b_ls2'),
        rows.text('Noted: Monday, a blue cover, oil paint on the door.'),
        ...rows.turnEnd(),
      ].map((row) => JSON.stringify(row)),
    );
    const delivered = [
      [ASKS.notes.call, ['Week start→Monday', 'Cover→Blue']],
      [ASKS.door.call, ['Door finish→Oil paint']],
      [ASKS.window.call, ['Release window→Dismissed']],
      [ASKS.rota.call, ['Rota→Dismissed']],
    ] as const;
    for (const [call, lines] of delivered) await expect.poll(() => receiptLines(questionRow(page, call)), { timeout: 15_000, message: `${call}: its row after the delivery` }).toEqual(lines);
    await expect(main(page).getByText('The sminos plugin sent a message'), 'no bubble holds the engine’s framing').toHaveCount(0);
    await expect(main(page).getByText(/The human responded to your async AskUserQuestion/)).toHaveCount(0);

    // acceptance 5's fold (decision 9, with the ruling on D-7 (b)): the delivery's turn has other work (two commands and a
    // reply), so its "answered: …" lines (U3a's notice, still derived) fold with it: folded, none stands outside the fold,
    // and the questions' rows above still read their answers; opened, the lines are there
    const answerLines = main(page).locator('.transcript-row[data-kind="notice"]').filter({ hasText: /answered: / });
    const turnLine = main(page).locator('.transcript-row[data-kind="divider"] button.transcript-disclosure').filter({ hasText: FINISHED_TURN_LINE }).last();
    await expect(turnLine, 'the delivery’s turn reads its duration and its work (the word cut, T1): it has other work').toBeVisible({ timeout: 15_000 });
    if ((await turnLine.getAttribute('aria-expanded')) === 'true') await turnLine.click();
    await expect(turnLine).toHaveAttribute('aria-expanded', 'false');
    await expect(answerLines, 'folded, no answer line stands outside the fold').toHaveCount(0);
    for (const [call, lines] of delivered) expect(await receiptLines(questionRow(page, call)), `${call}: its row, the turn folded`).toEqual(lines);
    await turnLine.click();
    await expect(turnLine).toHaveAttribute('aria-expanded', 'true');
    await expect(answerLines, 'opened, the answer’s own lines are there').not.toHaveCount(0);

    // after a reload, the rows read the same from the file
    await page.reload();
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    await open(c);
    for (const [call, lines] of delivered) await expect.poll(() => receiptLines(questionRow(page, call)), { timeout: 15_000, message: `${call}: its row after the reload` }).toEqual(lines);
    expect(c.maws.consoleErrors()).toEqual([]);
  });
  // UX wave U1b, decision 8a (the architect's ruling of 2026-11-15): a question MAWS answers that was answered elsewhere
  // first. The bridge refuses the answer with 404 and names no settlement (no request pending under that id: its own
  // record of the request has gone ahead of its stream), so the driver says not pending with no winner and lane A's
  // controls inject no settlement; the card says "Answered elsewhere" (the word cut, N107) for its two seconds and closes, while the
  // bridge still lists the request. Through that gap the row draws no form and no control, and each line reads the
  // existing sentence, past the two seconds and through a remount, until the row carries its own answers. The column's
  // card still lists the item; its line goes to a request that is closed, so it says the request is gone and moves the
  // keyboard nowhere that answers (decision 19).
  test('a question answered elsewhere while its row waits: Answered elsewhere on each line, no form and no control, past two seconds and a remount; the column’s line says it is gone; then the row’s own answers', async () => {
    test.setTimeout(150_000);
    const week = 'Which day should the printed week start on?';
    const cover = 'Which colour for the cover?';
    const ask = { call: 'toolu_u1b_elsewhere', questions: [single(week, 'Week start', ['Monday', 'Sunday']), single(cover, 'Cover', ['Blue', 'Green'])] };
    let rows!: ReturnType<typeof fileRows>;
    const c = await begin((sid, cwd, after) => {
      rows = fileRows(sid, cwd, after, '2026-10-28T10:00:03.000Z');
      return [rows.prompt('Lay out the garden notes; ask me what you cannot decide.'), rows.call(ask.call, ASK_TOOL, { questions: ask.questions, async: true }), rows.result(ask.call, ASYNC_RESULT), rows.text('I will go on with the layout.'), ...rows.turnEnd()];
    });
    const { page } = c;
    const { bridge } = await drive(c);
    const row = questionRow(page, ask.call);
    const form = row.locator('[data-request-card]');
    const elsewhere = ['Week start→Answered elsewhere', 'Cover→Answered elsewhere']; // the word cut (N107)
    await expect.poll(() => receiptLines(row), { timeout: 15_000, message: 'its row before any request' }).toEqual(['Week start→Not answered', 'Cover→Not answered']);

    // the bridge takes no answer for it: 404, no settlement named
    bridge.answer(`decision:${ask.call}`, () => ({ status: 404, body: { error: `no request ${ask.call} is pending in this session` } }));
    bridge.raise({ request: ask.call, tool: ASK_TOOL, async: true, input: { questions: ask.questions, async: true } });
    await expect(form, 'the form in its call’s row').toBeVisible({ timeout: 5_000 });
    await form.getByRole('radiogroup', { name: week }).getByRole('radio', { name: 'Monday' }).click();
    await form.getByRole('button', { name: 'Next', exact: true }).click();
    await form.getByRole('radiogroup', { name: cover }).getByRole('radio', { name: 'Blue' }).click();
    await form.getByRole('button', { name: 'Submit', exact: true }).click();
    expect(decided(bridge), 'the bridge recorded no decision').toEqual([]);

    // past the card's two seconds: no form, no control, each line the sentence; the bridge still lists the request
    await expect.poll(() => receiptLines(row), { timeout: 15_000, message: 'each line says it was answered elsewhere' }).toEqual(elsewhere);
    await expect(form, 'no form').toHaveCount(0);
    await expect(row.getByRole('button'), 'no control').toHaveCount(0);
    await expect(row.getByRole('radio'), 'no option').toHaveCount(0);
    const listed = async () => value(await invoke(page, 'attention.list', undefined)).filter((i) => i.request.requestId === ask.call).map((i) => i.state);
    expect(await listed(), 'the premise: the item is still listed').not.toEqual([]);
    await expect(end(page), 'nothing at the end for it').toHaveCount(0);

    // the column's card still lists it; its line finds the request closed: gone, said once, the keyboard moved nowhere that answers
    const column = (await showSessionCards(page)).getByRole('region', { name: 'Waiting for you', exact: true });
    const line = column.locator(`[data-waiting-card-line="${await addressed(page, value(await invoke(page, 'attention.list', undefined)).find((i) => i.request.requestId === ask.call)!.id)}"]`);
    await expect(line).toBeVisible();
    await line.click();
    const toasts = page.locator('[data-toast-viewport]');
    await expect(toasts.getByText('That request is no longer waiting'), 'said once').toHaveCount(1);
    const held = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return 'nothing';
      if (element.closest('[data-request-card], .transcript-row') !== null) return 'a request or a row';
      return element.hasAttribute('data-waiting-card-line') ? 'the line' : 'elsewhere';
    });
    expect(held, 'the keyboard is on nothing that answers').not.toBe('a request or a row');
    expect(await receiptLines(row), 'and the row unchanged').toEqual(elsewhere);

    // remounted: the pane shows another tab, then the session again; the row reads the same
    await menu(c.maws.app, 'diagnostics.open');
    await expect(row, 'the transcript left the page').toHaveCount(0);
    await open(c);
    await expect.poll(() => receiptLines(row), { timeout: 15_000, message: 'after the remount' }).toEqual(elsewhere);
    await expect(form, 'still no form').toHaveCount(0);

    // the delivery of the answer that won: the row reads its own answers
    await c.store.appendLines(c.transcript, [rows.pluginPrompt(delivery(ask.call, answered({ [week]: 'Sunday', [cover]: 'Green' }))), rows.text('Noted: Sunday, a green cover.'), ...rows.turnEnd()].map((r) => JSON.stringify(r)));
    await expect.poll(() => receiptLines(row), { timeout: 15_000, message: 'the row’s own answers win' }).toEqual(['Week start→Sunday', 'Cover→Green']);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // UX wave U1b, acceptance 4's last sentence ("Stop ends the turn and leaves the question open"; probe 9b, the architect's
  // ruling of 2026-11-15): Stop posts the interrupt; the bridge ends the turn (`aborted`) and keeps the sminos
  // asynchronous question pending, and nobody writes a settlement. So the form stays in its call's row and answers. Staged
  // from the record (`stopRecord`): the file's rows to the running Bash call, the bridge's turn and its raise, its answer to
  // the interrupt, and the interrupt's rows and the turn's end as the engine and the bridge wrote them.
  async function stoppedWhileAsked(then: 'answer' | 'dismiss') {
    const record = stopRecord(then, REPO_ROOT);
    let rows!: ReturnType<typeof fileRows>;
    const c = await begin((sid, cwd, after) => {
      rows = fileRows(sid, cwd, after, '2026-10-28T10:00:03.000Z');
      return record.before.map((row) => rows.recorded(row));
    });
    const { page } = c;
    const controls = { ...FULL_CAPABILITIES.controls, 'decide.dismiss': { available: true } }; // sminos 1.47.0: Dismiss is sent
    const { bridge } = await drive(c, { bridge: { capabilities: { ...FULL_CAPABILITIES, controls } } });
    bridge.answer('interrupt', () => ({ status: 200, body: record.interrupted }));
    const row = questionRow(page, record.call);
    const form = row.locator('[data-request-card]');
    await expect.poll(() => receiptLines(row), { timeout: 15_000, message: 'its row before any request' }).toEqual([`${record.question.header}→Not answered`]);
    bridge.emit(record.turn);
    bridge.raise(record.raised);
    await expect(form, 'the form in its call’s row').toBeVisible({ timeout: 5_000 });
    const stop = main(page).getByRole('button', { name: 'Stop', exact: true });
    await expect(stop, 'the turn runs').toBeVisible({ timeout: 10_000 });

    await stop.click();
    await expect.poll(() => bodies(bridge, 'interrupt')).toEqual([{ op: 'interrupt' }]);
    await c.store.appendLines(c.transcript, record.afterStop.map((r) => JSON.stringify(rows.recorded(r))));
    bridge.emit(record.aborted);
    await expect(stop, 'the turn ended').toHaveCount(0, { timeout: 10_000 });

    // the question is still open: its form in its row, nothing at the end, the item listed, no decision posted
    await expect(form, 'the form stays in its row after Stop').toBeVisible();
    await expect(end(page), 'nothing at the end').toHaveCount(0);
    const listed = async () => value(await invoke(page, 'attention.list', undefined)).filter((i) => i.request.requestId === record.call).map((i) => i.state);
    expect(await listed(), 'the item still waits').toEqual(['pending']);
    expect(decided(bridge), 'nothing decided').toEqual([]);
    return { c, bridge, rows, record, row, form, listed };
  }

  test('Stop while a terminal session’s asynchronous question waits ends the turn and leaves the question open: its form stays in its row and answers, and the row reads the answer once delivered (probe 9b, stop then answer)', async () => {
    test.setTimeout(150_000);
    const { c, bridge, rows, record, row, form, listed } = await stoppedWhileAsked('answer');
    const { page } = c;
    const answer = record.answer!; // the record's answer, as its delivery quotes it (the staging test pins it)
    await form.getByRole('radiogroup', { name: record.question.question }).getByRole('radio', { name: answer }).click();
    await form.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: record.call, behavior: 'allow', updatedInput: { answers: { [record.question.question]: answer } }, ...AS_MAWS }]);
    expect(bridge.requestReads, 'read at its request URL first, still pending there').toContain(record.call);
    await expect(form).toHaveCount(0, { timeout: 2_000 });
    await expect.poll(() => receiptLines(row), { message: 'the answer this window gave, at once' }).toEqual([`${record.question.header}→${answer}`]);
    bridge.settle(record.call, record.settled.winner, record.settled.outcome, record.settled.by);
    await expect.poll(listed, { message: 'it leaves the list at its settlement' }).toEqual([]);

    // the delivery as recorded: the plugin's prompt opens a new turn on the idle session, and the reply
    await c.store.appendLines(c.transcript, record.afterAnswer.map((r) => JSON.stringify(rows.recorded(r))));
    await expect(main(page).getByText(/The answer reached me/).first(), 'the delivery’s turn is drawn').toBeVisible({ timeout: 15_000 });
    expect(await receiptLines(row), 'the row reads the answer after the delivery').toEqual([`${record.question.header}→${answer}`]);
    await expect(main(page).getByText('The sminos plugin sent a message'), 'no bubble holds the engine’s framing').toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('Stop while a terminal session’s asynchronous question waits, then Dismiss: the bridge settles it withdrawn by MAWS and nothing reaches the session; the row reads Dismissed from the settlement, after a reload too (probe 9b, stop then dismiss)', async () => {
    test.setTimeout(150_000);
    const { c, bridge, record, row, form, listed } = await stoppedWhileAsked('dismiss');
    const { page } = c;
    expect(record.settled, 'the record: withdrawn, by MAWS').toMatchObject({ winner: 'web', outcome: 'withdrawn', by: 'maws' });
    expect(record.afterAnswer, 'the record: no row reached the session').toEqual([]);
    // a premise of the staging: the stand-in bridge writes no row on a decision, so the file's length only says the scene
    // wrote none; what MAWS sends is read at the bridge (below)
    const linesBefore = readFileSync(c.transcript, 'utf8').trim().split('\n').length;
    const commandsAtDismiss = bridge.commands.length;
    await form.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect.poll(() => decided(bridge)).toEqual([{ request: record.call, behavior: 'dismiss', ...AS_MAWS }]);
    await expect(form).toHaveCount(0, { timeout: 2_000 });
    bridge.settle(record.call, record.settled.winner, record.settled.outcome, record.settled.by);
    await expect.poll(listed, { message: 'it leaves the list at its settlement' }).toEqual([]);
    await expect.poll(() => receiptLines(row)).toEqual([`${record.question.header}→Dismissed`]);

    // this window's own dismissal goes with a reload; the bridge's snapshot still lists the settlement, and no row came
    await page.reload();
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    await open(c);
    await expect.poll(() => receiptLines(row), { timeout: 15_000, message: 'from the settlement alone' }).toEqual([`${record.question.header}→Dismissed`]);
    expect(readFileSync(c.transcript, 'utf8').trim().split('\n').length, 'the staging wrote no row').toBe(linesBefore);
    // the delivery boundary: MAWS's whole say after the Stop is the one dismissal; it posted no message, steer or
    // other control that could reach the session
    expect(decided(bridge), 'one decision, the dismissal').toEqual([{ request: record.call, behavior: 'dismiss', ...AS_MAWS }]);
    expect(bridge.commands.slice(commandsAtDismiss).map((cmd) => cmd.op).filter((op) => op !== 'read' && op !== 'ping'), 'no command after the dismissal').toEqual([]);
    await expect(end(page)).toHaveCount(0);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  // ---- UX wave U1c: "Approve and retry" on a terminal session (S4) -----------------------------------------------------
  // (docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md, §H S4, Acceptance 7a to 7c; Decision Log 11, 36 to
  // 39.) Probe T's recorded transcripts (`probeTerminalRecords`): the session's file holds a run to the moment of the press,
  // the press reaches the fake bridge, and the scene writes the rows the bridge and the engine wrote after it, as recorded,
  // in that state, in steps that stop at the state's read boundary (findings-uxwave-u1c-terminal-grant.txt; Decision Log 38
  // and 39): idle, the row the bridge submitted; running, the running call's result; stopped, the bridge's wake. Every
  // state is offered (`TERMINAL_OFFERED`, M4), and each part first asserts the state the window recognises. The run's
  // lines are the findings' numbers.
  const BLOCKED_MARKER = 'curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"'; // run 1 of each state
  const APPROVE = 'Approve and retry';
  const labelOf = (cell: Locator) => cell.locator('.transcript-cell-label');
  const recordLines = (records: Record<string, unknown>[], from: number, to: number) => records.slice(from - 1, to).map((row) => JSON.stringify(row));
  // the call auto mode blocked (its result row carries `toolDenialKind: "automode-blocked"`), and the marker's call after the grant
  const blockedId = (records: Record<string, unknown>[]) => (records.find((row) => row.toolDenialKind === 'automode-blocked')!.message as { content: { tool_use_id: string }[] }).content[0]!.tool_use_id;
  const retryId = (records: Record<string, unknown>[], after: number) => records.slice(after).flatMap((row) => (row.type === 'assistant' ? (row.message as { content: { type: string; id?: string; input?: { command?: string } }[] }).content : [])).find((block) => block.type === 'tool_use' && block.input?.command === BLOCKED_MARKER)!.id!;
  // the bridge enters each delivery as the row the recording names, as the bridge's stream tells it (`delivered`, `entered`)
  const entersAs = (bridge: FakeBridge, uuid: unknown) =>
    bridge.answer('deliver', (body) => {
      bridge.emit({ type: 'delivered', key: body.key, outcome: 'submitted' });
      bridge.emit({ type: 'delivered', key: body.key, outcome: 'entered', uuid });
      return { status: 200, body: { ok: true, result: { submitted: true } } };
    });
  // The blocked row, its turn's count clicked (the ended turn folds its work).
  async function openBlocked(page: Page, toolUseId: string): Promise<Locator> {
    const count = main(page).getByRole('link', { name: '1 auto-denied' });
    await expect(count).toBeVisible({ timeout: 15_000 });
    await count.click();
    const row = main(page).locator(`[data-cell-id="cell:${toolUseId}"]`);
    await expect(labelOf(row)).toHaveText(`Auto mode blocked: ${BLOCKED_MARKER}`);
    return row;
  }
  // The state the window gives the session, as `terminalStateOf` reads it: the bridge's word on the main loop's turn
  // (`laneA.state`), and, when no turn runs, whether the newest turn's line reads stopped.
  async function recognisedAs(page: Page, appId: string, state: 'idle' | 'running' | 'stopped'): Promise<void> {
    await expect.poll(async () => value(await invoke(page, 'laneA.state', { appSessionId: appId }))?.turn, { timeout: 10_000 }).toEqual({ running: state === 'running', unknown: false });
    if (state !== 'running') await expect(main(page).locator('.transcript-divider .transcript-disclosure').last(), `the newest turn's line reads ${state === 'stopped' ? 'stopped' : 'not stopped'}`).toHaveText(state === 'stopped' ? /^You stopped after/ : FINISHED_TURN_LINE);
  }
  // The newest line the session's follower has read, as the window hears it: each `fs.followState` names its chain's
  // leaf, reported whenever the chain grows. A positive sign of a read where the lines read draw nothing.
  async function followerLeaves(page: Page, appId: string): Promise<() => Promise<(string | null)[]>> {
    await page.evaluate((id) => {
      const w = window as unknown as { __u1cLeaves: (string | null)[] };
      w.__u1cLeaves = [];
      window.maws.on('fs.followState', (e) => {
        if (e.appSessionId === id && e.agentId === null) w.__u1cLeaves.push(e.leafUuid);
      });
    }, appId);
    return () => page.evaluate(() => (window as unknown as { __u1cLeaves: (string | null)[] }).__u1cLeaves);
  }
  // At its read boundary: the row reads approved and offers nothing, the grant is the approval's line.
  async function approvedAt(page: Page, row: Locator): Promise<void> {
    await expect(labelOf(row)).toHaveText(`Auto mode blocked: ${BLOCKED_MARKER} · approved`, { timeout: 15_000 });
    await expect(row.getByRole('button', { name: APPROVE })).toHaveCount(0);
    await expect(main(page).locator('.transcript-consent')).toHaveText(`You approved ${BLOCKED_MARKER}`);
  }
  // After the retry's turn has ended: the retry, in the newest turn (folded when it ended), ran.
  async function retried(page: Page, retry: string): Promise<void> {
    const cell = main(page).locator(`[data-cell-id="cell:${retry}"]`);
    await expect(async () => {
      const line = main(page).locator('.transcript-divider .transcript-disclosure').last();
      if ((await line.getAttribute('aria-expanded')) === 'false') await line.click();
      await expect(cell).toBeVisible({ timeout: 1_000 });
    }, 'the newest turn opened to the retry').toPass();
    await expect(cell, 'the retry ran').toHaveAttribute('data-status', 'done');
  }

  test('U1c S4, idle (u1c-t-idle-1): held in the holder’s words before the bridge is live, then offered; the press is one delivery of the grant, and the row the bridge submitted draws the line, the row reads approved and the retry runs', async () => {
    test.setTimeout(120_000);
    const run = 'u1c-t-idle-1';
    const c = await begin(undefined, (sid, cwd) => probeTerminalRecords(run, sid, cwd).slice(0, 49)); // to the block's turn end (48, 49)
    const { page } = c;
    const records = probeTerminalRecords(run, c.sid, c.repo.root);

    // the terminal holds it and no bridge answers: read-only, the button held in the holder's words, nothing sent
    c.terminal = await terminalSession({ store: c.store, sminosHome: c.maws.sminosHome, sessionId: c.sid, cwd: c.repo.root, bridged: false });
    await expect.poll(async () => value(await invoke(page, 'session.get', { appSessionId: c.appId }))?.holder.kind, { timeout: 10_000 }).toBe('terminal');
    await (await sidebarRow(page, { appSessionId: c.appId })).click();
    await expect(notice(page)).toContainText('read-only');
    const row = await openBlocked(page, blockedId(records));
    const button = row.getByRole('button', { name: APPROVE });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /^Held by /);
    await test.info().attach('u1c-s4-held', { body: await main(page).screenshot(), contentType: 'image/png' });

    // its bridge comes up, the session idle: offered
    const bridge = await startFakeBridge({ home: c.maws.sminosHome, session: c.sid, pid: c.terminal.pid, sessionInfo: { session: c.sid, cwd: c.repo.root, model: 'claude-opus-4-5', version: '2.1.300' } });
    bridge.emit({ type: 'catalog', ...CATALOG });
    const registryOnly = c.terminal;
    c.terminal = { bridge, pid: registryOnly.pid, close: async () => (await bridge.close(), await registryOnly.close()) };
    await expect(editor(page)).toBeVisible({ timeout: 15_000 });
    await recognisedAs(page, c.appId, 'idle');
    await expect(button).toBeEnabled();
    await test.info().attach('u1c-s4-idle-offered', { body: await main(page).screenshot(), contentType: 'image/png' });

    entersAs(bridge, records[52]!.uuid); // line 53, the row the bridge submitted as the user
    await button.click();
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual([consentMessage('command', BLOCKED_MARKER)]);
    await c.store.appendLines(c.transcript, recordLines(records, 50, 53)); // the bridge's submit: the queue's rows (50, 51), a snapshot, the row it submitted (53)
    await approvedAt(page, row); // read at the row the bridge submitted, which opens its turn
    await c.store.appendLines(c.transcript, recordLines(records, 54, 61)); // the retry (56, 57), the reply, the turn's end
    await retried(page, retryId(records, 53));
    await test.info().attach('u1c-s4-idle-approved', { body: await main(page).screenshot(), contentType: 'image/png' });
    expect(bodies(bridge, 'deliver'), 'one delivery').toHaveLength(1);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('U1c S4, running (u1c-t-busy-1): offered while a turn runs; the grant the bridge appended waits in the stack at the next step with the button greyed until the running call’s result, then the row reads approved and the retry runs', async () => {
    test.setTimeout(120_000);
    const run = 'u1c-t-busy-1';
    const c = await begin(undefined, (sid, cwd) => probeTerminalRecords(run, sid, cwd).slice(0, 51)); // to the 30 s call (51)
    const { page } = c;
    const records = probeTerminalRecords(run, c.sid, c.repo.root);
    const { bridge } = await drive(c);
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-wait' }); // the bridge says a turn runs
    const row = await openBlocked(page, blockedId(records));
    await recognisedAs(page, c.appId, 'running');
    const button = row.getByRole('button', { name: APPROVE });
    await expect(button).toBeEnabled();

    entersAs(bridge, records[51]!.uuid); // line 52, the row the bridge appended into the turn
    await button.click();
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual([consentMessage('command', BLOCKED_MARKER)]);
    await c.store.appendLines(c.transcript, recordLines(records, 52, 53)); // the appended row and the bridge's mirror line
    const waiting = main(page).getByRole('region', { name: 'Queued messages' }).locator('li');
    await expect(waiting.locator('[data-row-text]'), 'the approval waits above the composer as the line it becomes').toHaveText(`You approved ${BLOCKED_MARKER}`, { timeout: 15_000 });
    await expect(waiting.locator('[data-mark]')).toHaveText('Next step');
    await expect(button, 'greyed while it waits').toBeDisabled();
    await expect(labelOf(row), 'not approved before the engine reads it').toHaveText(`Auto mode blocked: ${BLOCKED_MARKER}`);
    await test.info().attach('u1c-s4-running-waiting', { body: await main(page).screenshot(), contentType: 'image/png' });

    await c.store.appendLines(c.transcript, recordLines(records, 54, 54)); // the running call's result (54): the engine reads the grant in the request after it
    await approvedAt(page, row);
    await expect(main(page).getByRole('region', { name: 'Queued messages' }), 'nothing waits').toHaveCount(0);
    await c.store.appendLines(c.transcript, recordLines(records, 55, records.length)); // the request (55), the retry (58, 59), the reply, the turn's end
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-wait' });
    await retried(page, retryId(records, 53));
    await test.info().attach('u1c-s4-running-approved', { body: await main(page).screenshot(), contentType: 'image/png' });
    expect(bodies(bridge, 'deliver'), 'one delivery').toHaveLength(1);
    expect(c.maws.consoleErrors()).toEqual([]);
  });

  test('U1c S4, stopped (u1c-t-esc-1): offered after an Esc; the grant the bridge appended is read at the bridge’s wake, then the row reads approved and the retry runs', async () => {
    test.setTimeout(120_000);
    const run = 'u1c-t-esc-1';
    const c = await begin(undefined, (sid, cwd) => probeTerminalRecords(run, sid, cwd).slice(0, 55)); // to the rejected call (54) and the interruption line (55)
    const { page } = c;
    const records = probeTerminalRecords(run, c.sid, c.repo.root);
    const { bridge } = await drive(c);
    bridge.emit({ type: 'turn', phase: 'start', turnId: 'turn-esc' });
    bridge.emit({ type: 'turn', phase: 'complete', turnId: 'turn-esc', reason: 'aborted' }); // the Esc: no turn runs, the newest reads stopped
    const row = await openBlocked(page, blockedId(records));
    await recognisedAs(page, c.appId, 'stopped');
    const button = row.getByRole('button', { name: APPROVE });
    await expect(button).toBeEnabled();
    await test.info().attach('u1c-s4-stopped-offered', { body: await main(page).screenshot(), contentType: 'image/png' });

    entersAs(bridge, records[55]!.uuid); // line 56, the row the bridge appended after the Stop
    await button.click();
    await expect.poll(() => bodies(bridge, 'deliver').map((b) => b.text), { timeout: 10_000 }).toEqual([consentMessage('command', BLOCKED_MARKER)]);
    await expect(button, 'the grant is out').toBeDisabled();
    const leaves = await followerLeaves(page, c.appId);
    await c.store.appendLines(c.transcript, recordLines(records, 56, 60)); // the appended row (56), the mirror line (57), the queue's rows (58, 59), 60
    // Lines 56 to 60 draw nothing after a Stop (the grant waits for the wake, the mirror is its second carrier, the rest
    // carry nothing), so the checkpoint is the follower's: its chain has grown to the mirror line, the last line with a uuid
    // before the wake, and 58 to 60 came in the same write.
    await expect.poll(async () => (await leaves()).at(-1), { timeout: 10_000, message: 'the follower has read to the mirror line (57)' }).toBe(String(records[56]!.uuid));
    // Read, and nothing reads approved: no approval row comes, so the grant out ends by its clock (SETTLE_MS after the
    // delivery's outcome) and the button is back, the row unapproved and no "You approved" line drawn
    await expect(button, 'no approval before the wake').toBeEnabled({ timeout: 15_000 });
    await expect(labelOf(row)).toHaveText(`Auto mode blocked: ${BLOCKED_MARKER}`);
    await expect(main(page).locator('.transcript-consent')).toHaveCount(0);
    await test.info().attach('u1c-s4-stopped-before-wake', { body: await main(page).screenshot(), contentType: 'image/png' });
    await c.store.appendLines(c.transcript, recordLines(records, 61, 61)); // the bridge's wake (61), whose turn reads the grant
    await approvedAt(page, row);
    await c.store.appendLines(c.transcript, recordLines(records, 62, records.length)); // the request (62), the retry (70, 71), the reply, the turn's end
    await retried(page, retryId(records, 56));
    await test.info().attach('u1c-s4-stopped-approved', { body: await main(page).screenshot(), contentType: 'image/png' });
    expect(bodies(bridge, 'deliver'), 'one delivery').toHaveLength(1);
    expect(c.maws.consoleErrors()).toEqual([]);
  });
});
