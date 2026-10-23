// M5 of the DC9 plan, in a real browser against DC3's fake machine replaying the `session-view` recording as a DC8
// producer (`fake-machine.ts`, `producer: 'dc8'`): the column's Subagents tree with every agent's status from DX4's
// widened body — the nested agent under its parent, none left under "On disk" — and an `Agent` row in the center
// opening its agent there, the column opened for it; the Jobs tab drawing the shells and the monitor with MAWS's
// `ShellRow` and `MonitorRow`, a shell's Output under its row in each of DX4's variants, and the MCP names. The same
// recording from a producer older than DC8 draws as DC6 drew it. And an interrupted turn reads stopped, not working,
// once the engine's marker row is in.
//
// DC10's web half: Stop on a running shell and a running monitor sends DX6 `stop`, reads `stopping…` while it is on its
// way, and the row reads `stopped` from the session's own body (the bridge's note the fake machine writes, which the
// session view does not draw) within 2 s
// (G1); Stop stays disabled with §5's reason on a session without the bridge, on a machine read-only or offline, and is
// not drawn on a job that has ended (G2); a stop the engine refuses shows its message under the row, which keeps its
// status (G4), as does a stop of a job the machine no longer holds as running; and a stop whose fate is unknown offers
// Retry, which the machine answers once.
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecording, SESSION_VIEW, TWO_SUBAGENTS, type Producer, type Recording, type Step } from 'desk-hub/fake-machine';
import type { JsonObject, SessionMessage } from 'desk-hub/protocol';
import { FakeMachineReplay } from './fake-machine';
import { expect, seedKey, test } from './fixtures';
import { PROJECT, stageProject } from './scene';
import type { HubDouble } from '../test/double/hub-double';

const MACHINE = 'fake';
const ALPHA = 'ad435b3acfda88bfa';
const BETA = 'afa43b5c4f84309b6';
const [SUITE, SERVE, WATCH, MONITOR] = ['bsuite7k2', 'bserve4q9', 'bwatch8m1', 'bmon3x7a0'];
const SHOTS = process.env.DESK_SHOTS;

let pageErrors: string[] = [];
let fm: FakeMachineReplay | null = null;
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) pageErrors.push(message.text());
  });
});
test.afterEach(() => {
  fm?.stop();
  fm = null;
  expect(pageErrors).toEqual([]);
});

/** The fake machine replaying `recording` as `producer`, its session joined, and the browser on its channel. */
async function openSession(page: Page, hub: HubDouble, options: { recording?: string | Recording; producer?: Producer; depthOpen?: boolean } = {}): Promise<{ fm: FakeMachineReplay; view: Locator; depth: Locator }> {
  await stageProject(hub);
  const replay = (fm = new FakeMachineReplay(hub, { project: PROJECT, machine: MACHINE }, { recording: options.recording ?? SESSION_VIEW, producer: options.producer ?? 'dc8' }));
  const policy = { read_only: false, ceiling: 'default' };
  hub.setMachines(PROJECT, [
    { machine: 'mini', online: true, policy, checkouts: [] },
    { machine: 'SK.local', online: true, policy, checkouts: [] },
    { machine: MACHINE, online: true, policy, checkouts: [{ path: replay.recording.cwd, branch: 'main' }] },
  ]);
  await hub.append(PROJECT, { writer: `${MACHINE}/${replay.session}`, kind: 'joined', session: replay.session, alias: 'fakerec', name_source: 'user', machine: MACHINE, cwd: replay.recording.cwd, worktree: '', role: '', seat: '', by: '' });
  replay.sendPresence();
  await seedKey(page, hub);
  if (options.depthOpen === false) await page.addInitScript(() => localStorage.setItem('desk.depth', JSON.stringify({ open: false, width: 380 })));
  await page.goto(`${hub.url}/p/${PROJECT}/s/${replay.session}`);
  const view = page.getByTestId('session-view');
  await expect(view).toHaveAttribute('data-session', replay.session);
  await expect.poll(() => replay.subscriptions()).toBe(1);
  return { fm: replay, view, depth: page.getByTestId('depth') };
}

const nestedOf = (recording: Recording) => Object.keys(recording.meta).find((agentId) => recording.meta[agentId].parentAgentId === ALPHA)!;
const agentRow = (depth: Locator, agentId: string) => depth.locator(`[data-agent-row="${agentId}"]`);
const isRowNaming = (text: string) => (step: Step) => step.k === 'row' && JSON.stringify(step.row).includes(text);
const jobRow = (depth: Locator, taskId: string) => depth.locator('[data-job-row]').filter({ has: depth.page().locator(`[data-task-id="${taskId}"]`) });
const outputOf = (depth: Locator, taskId: string) => depth.locator(`[data-testid="job-output"][data-task="${taskId}"]`);

/** Scrolls the virtualized list a step at a time (`direction` -1 up, 1 down) until `target` is drawn. */
async function scrollUntil(page: Page, scroller: Locator, target: Locator, direction: 1 | -1, steps = 80): Promise<void> {
  await scroller.dispatchEvent('wheel', { deltaY: -200 }); // the reader owns this history walk
  for (let i = 0; i < steps; i++) {
    if ((await target.count()) > 0) return target.first().scrollIntoViewIfNeeded();
    await scroller.evaluate((el, d) => el.scrollBy({ top: d * el.clientHeight * 0.6 }), direction);
    await page.waitForTimeout(60);
  }
  throw new Error(`not drawn within ${steps} steps of the list`);
}

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('the tree carries every agent’s DX4 status: the nested agent under its parent while it runs, and none left on disk', async ({ page, hub }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fm, depth } = await openSession(page, hub);
  const nested = nestedOf(fm.recording);
  fm.playThrough((step) => step.k === 'agent' && step.agentId === nested);
  await depth.getByTestId('depth-tab-subagents').click();
  const tree = depth.getByTestId('depth-subagents');
  await expect(agentRow(tree, nested)).toHaveAttribute('data-status', 'running');
  await expect(agentRow(tree, nested)).toHaveAttribute('data-depth', '1'); // under its parent, whose spawn is in alpha's transcript
  await expect(agentRow(tree, ALPHA)).toHaveAttribute('data-depth', '0');
  const order = await tree.locator('[data-agent-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-agent-row')));
  expect(order.indexOf(nested)).toBe(order.indexOf(ALPHA) + 1);
  await expect(tree.locator('[data-section="disk"]')).toHaveCount(0);
  await shot(page, 'm5-subagents-running');

  fm.playThrough();
  await expect(tree.locator('[data-section="done"]')).toContainText('Done · 3'); // the two roots and the nested agent under alpha
  const done = tree.locator('[data-section="done"] h3 button');
  if ((await done.getAttribute('aria-expanded')) === 'false') await done.click();
  for (const agentId of [ALPHA, BETA, nested]) await expect(agentRow(tree, agentId)).toHaveAttribute('data-status', 'completed');
  await expect(agentRow(tree, nested)).toHaveAttribute('data-depth', '1');
  await expect(tree.locator('[data-section="disk"]')).toHaveCount(0);
  await shot(page, 'm5-subagents-done');
});

test('an Agent row in the center opens its agent in the column, opening the column for it', async ({ page, hub }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fm, view, depth } = await openSession(page, hub, { depthOpen: false });
  await expect(depth).toHaveCount(0);
  // The agents' launch, while their turn still works: the full transcript draws its open turn's rows, the Agent calls'
  // row among them (the report keeps a working turn's calls inside its record).
  fm.playThrough(isRowNaming('"status":"async_launched","agentId":"' + BETA));
  await view.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Transcript' }).click();
  // A one-agent row is itself the button; a grouped row's glyph is (MAWS's `SubagentRow`).
  const glyph = view.locator('button.transcript-subagent-line', { hasText: 'Alpha reply' }).or(view.getByRole('button', { name: 'Open Alpha reply' }));
  await scrollUntil(page, view.locator('[data-transcript-scroller]').first(), glyph, -1);
  await glyph.click();
  await expect(depth).toBeVisible();
  await expect(depth.getByTestId('depth-tab-subagents')).toHaveAttribute('aria-selected', 'true');
  await expect(depth.getByTestId('depth-subagent')).toHaveAttribute('data-agent', ALPHA);
  await expect(depth.getByTestId('depth-subagent')).toContainText('Alpha reply');
});

test('the jobs view: shells and the monitor with MAWS’s rows, Stop offered on each running job, each Output variant under its row, the MCP names', async ({ page, hub }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fm, depth } = await openSession(page, hub);
  fm.playThrough(isRowNaming(`"taskId":"${MONITOR}"`)); // the monitor's start: its file not named yet
  const tab = depth.getByTestId('depth-tab-jobs');
  await expect(tab).toHaveText('Jobs · 4 running');
  await tab.click();
  const jobs = depth.getByTestId('depth-jobs');
  await expect(jobs.locator('[data-section="shells"]')).toContainText('Shells · 3 running');
  await expect(jobs.locator('[data-section="monitors"]')).toContainText('Monitors · 1');
  await expect(jobRow(jobs, MONITOR)).toContainText('No output file yet: a monitor names none at its start.');
  for (const taskId of [SUITE, SERVE, WATCH, MONITOR]) {
    const stop = jobRow(jobs, taskId).getByRole('button', { name: 'Stop' });
    await expect(stop).toBeEnabled();
    await expect(stop).not.toHaveAttribute('title');
  }

  // ok: the file's tail as plain text.
  await jobRow(jobs, SUITE).getByRole('button', { name: 'Output' }).click();
  await expect(outputOf(jobs, SUITE)).toHaveAttribute('data-phase', 'ok');
  await expect(outputOf(jobs, SUITE).locator('[data-part="tail"]')).toContainText('ok test_');
  await expect(jobRow(jobs, SUITE)).toHaveAttribute('data-open', 'true'); // the output opens inside the row's border

  // unknown-task: the request raced the index; the next subagents carries the task, and it is asked again.
  let races = 1;
  fm.answerOutput = (taskId) => (taskId === SERVE && races-- > 0 ? { taskId, result: 'unknown-task' } : null);
  await jobRow(jobs, SERVE).getByRole('button', { name: 'Output' }).click();
  await expect(outputOf(jobs, SERVE)).toContainText(`Checking with ${MACHINE}…`);
  fm.playThrough((step) => isRowNaming(`<task-id>${SUITE}</task-id>`)(step)); // the suites' completion: a subagents message
  await expect(outputOf(jobs, SERVE)).toHaveAttribute('data-phase', 'missing');
  await expect(outputOf(jobs, SERVE)).toContainText(`The output file is gone from ${MACHINE}.`);
  await shot(page, 'm5-jobs-running');

  fm.playThrough();
  await expect(tab).toHaveText('Jobs · 4');
  await expect(jobRow(jobs, SUITE)).toContainText('completed');
  await expect(jobRow(jobs, SERVE)).toContainText('stopped');
  // Its file is still gone; its summary, from the notification, stands under MAWS's row beside the open output.
  await expect(outputOf(jobs, SERVE)).toHaveAttribute('data-phase', 'missing');
  await expect(jobRow(jobs, SERVE).locator('[data-part="summary"]')).toBeVisible();
  await expect(jobRow(jobs, SERVE).locator('[data-part="summary"]')).toHaveText('Task "Serve the mockups" was stopped by the user');
  await expect(jobRow(jobs, WATCH)).toContainText('ended with the session');
  await expect(jobRow(jobs, MONITOR)).not.toContainText('No output file yet');

  // refused: the path the rows named fails containment; its reason, and no Refresh.
  await jobRow(jobs, WATCH).getByRole('button', { name: 'Output' }).click();
  await expect(outputOf(jobs, WATCH)).toHaveAttribute('data-phase', 'refused');
  await expect(outputOf(jobs, WATCH).getByRole('alert')).toContainText(`${MACHINE} would not read it:`);
  await expect(outputOf(jobs, WATCH).getByRole('button', { name: 'Refresh' })).toHaveCount(0);

  // missing with no path for a job that has ended, in a session that has: no file will be named, and none is promised.
  fm.answerOutput = (taskId) => (taskId === SUITE ? { taskId, result: 'missing', path: null } : null);
  await outputOf(jobs, SUITE).getByRole('button', { name: 'Refresh' }).click();
  await expect(outputOf(jobs, SUITE)).toContainText('No output file was named for this job.');
  await expect(outputOf(jobs, SUITE)).not.toContainText('asks again');
  fm.answerOutput = null;

  await expect(jobs.locator('[data-section="mcp"]')).toContainText('MCP servers · 2');
  await expect(jobs.getByTestId('depth-mcp').locator('li')).toHaveText(['doperpowers', 'plugin:cua:cua_repl']);
  await shot(page, 'm5-jobs-ended');
});

test('an unknown task that the next subagents does not carry is said to be unknown', async ({ page, hub }) => {
  const { fm, depth } = await openSession(page, hub);
  fm.playThrough(isRowNaming(`"taskId":"${MONITOR}"`));
  fm.answerOutput = (taskId) => ({ taskId, result: 'unknown-task' });
  await depth.getByTestId('depth-tab-jobs').click();
  const jobs = depth.getByTestId('depth-jobs');
  await jobRow(jobs, SERVE).getByRole('button', { name: 'Output' }).click();
  await expect(outputOf(jobs, SERVE)).toContainText(`Checking with ${MACHINE}…`);
  fm.playThrough(isRowNaming(`<task-id>${SUITE}</task-id>`)); // the next subagents carries it: asked again, still unknown
  await expect(outputOf(jobs, SERVE)).toContainText(`${MACHINE} does not know this task.`);
});

test('from a producer older than DC8 the column draws as DC6 drew it: the nested agent on disk, no jobs reported', async ({ page, hub }) => {
  const { fm, depth } = await openSession(page, hub, { producer: 'dc3' });
  fm.playThrough();
  await depth.getByTestId('depth-tab-subagents').click();
  const tree = depth.getByTestId('depth-subagents');
  const nested = nestedOf(fm.recording);
  await expect(tree.locator('[data-section="disk"]')).toContainText('On disk · 1');
  await expect(agentRow(tree, nested)).toHaveAttribute('data-status', 'unknown');
  await depth.getByTestId('depth-tab-jobs').click();
  await expect(depth.getByRole('tabpanel', { name: 'Jobs' })).toContainText(`${MACHINE}'s daemon does not report background jobs`);
});

test('an interrupted turn reads stopped once the engine’s marker row is in, not working', async ({ page, hub }) => {
  const recording = withInterruptedTurn(loadRecording(TWO_SUBAGENTS));
  const { fm, view } = await openSession(page, hub, { recording, producer: 'dc3' });
  fm.playThrough((step) => step.k === 'row' && step.row.uuid === recording.rows.main.at(-2)!.uuid); // the turn's work, not its marker
  await view.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Transcript' }).click();
  const last = view.locator('[data-row-id^="divider:"]').last();
  await expect(last).toContainText('Working');
  fm.playThrough();
  await expect(last).toContainText('You stopped after');
});

/** The jobs tab of the session-view replay at the monitor's start: three shells and the monitor running. */
async function runningJobs(page: Page, hub: HubDouble): Promise<{ fm: FakeMachineReplay; jobs: Locator }> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fm, depth } = await openSession(page, hub);
  fm.playThrough(isRowNaming(`"taskId":"${MONITOR}"`));
  await depth.getByTestId('depth-tab-jobs').click();
  await expect(depth.getByTestId('depth-tab-jobs')).toHaveText('Jobs · 4 running');
  return { fm, jobs: depth.getByTestId('depth-jobs') };
}

const stopsSent = (hub: HubDouble) => hub.rpcs(PROJECT).filter((rpc) => rpc.rpc === 'stop');
const STOP_BUTTON = /^(Stop|stopping…)$/;

test('G1: Stop on a running shell and a running monitor sends stop, reads stopping… on its way, and the row reads stopped from the session’s body within 2 s', async ({ page, hub }) => {
  const { fm, jobs } = await runningJobs(page, hub);
  fm.holdStops = true;
  for (const taskId of [WATCH, MONITOR]) {
    const row = jobRow(jobs, taskId);
    await row.getByRole('button', { name: 'Stop' }).click();
    await expect(row.getByRole('button', { name: 'stopping…' })).toBeDisabled();
    await expect(row).toHaveAttribute('data-stop', 'stopping');
    await expect.poll(() => stopsSent(hub).at(-1)?.args).toEqual({ session: fm.session, taskId });
    if (taskId === WATCH) await shot(page, 'dc10-stopping');
    await expect.poll(() => fm.stopsHeld).toBe(1);
    expect(fm.releaseStops()).toBe(1);
    await expect(row).toContainText('stopped', { timeout: 2000 });
    await expect(row.getByRole('button', { name: STOP_BUTTON })).toHaveCount(0);
  }
  // Each stop answered done; the rows read stopped from the bridge's notes the machine wrote (DX4's case 16).
  for (const rpc of stopsSent(hub)) expect(hub.rpcState(PROJECT, rpc.nonce)).toBe('done');
  const notes = fm.depth.rows.get('main')!.filter((r) => r.isMeta === true && JSON.stringify(r).includes('was stopped from the desk'));
  expect(notes).toHaveLength(2);
  // The note is the model's, not a message: neither the report nor the full transcript draws it.
  const view = page.getByTestId('session-view');
  await expect(view).not.toContainText('was stopped from the desk');
  await view.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Transcript' }).click();
  await expect(view.locator('[data-transcript-scroller]').first()).toBeVisible();
  await expect(view).not.toContainText('was stopped from the desk');
  await shot(page, 'dc10-transcript-after-stop');
  await expect(page.getByTestId('depth-tab-jobs')).toHaveText('Jobs · 2 running');
  await expect(jobRow(jobs, SUITE).getByRole('button', { name: 'Stop' })).toBeEnabled();
  await shot(page, 'dc10-stopped');
});

test('G4: a stop the engine refuses shows its message under the row, which keeps running with Stop offered again; so does a job the machine no longer holds', async ({ page, hub }) => {
  const { fm, jobs } = await runningJobs(page, hub);
  const engine = `Task ${SERVE} could not be stopped: the process ignored the signal`;
  fm.answerStop = (taskId) => (taskId === SERVE ? { state: 'failed', error: { code: 'failed', message: engine } } : null);
  const serve = jobRow(jobs, SERVE);
  await serve.getByRole('button', { name: 'Stop' }).click();
  await expect(serve).toContainText(`Couldn't stop it: ${engine}`);
  await expect(serve).toHaveAttribute('data-stop', 'failed');
  await expect(serve.locator('[data-part="line"]')).toContainText('running');
  await expect(serve.getByRole('button', { name: 'Stop' })).toBeEnabled();
  await shot(page, 'dc10-failed');

  // The machine's index no longer holds it as running (the web's view lagged): refused unknown-task, said the same way.
  fm.answerStop = (taskId) => (taskId === SUITE ? { state: 'failed', error: { code: 'unknown-task', message: `${taskId} is not a running job` } } : null);
  await jobRow(jobs, SUITE).getByRole('button', { name: 'Stop' }).click();
  await expect(jobRow(jobs, SUITE)).toContainText(`Couldn't stop it: ${MACHINE} does not hold that job as running`);

  // Pressed again, the engine lets it go: the message leaves with the job's status.
  fm.answerStop = null;
  await serve.getByRole('button', { name: 'Stop' }).click();
  await expect(serve).toContainText('stopped', { timeout: 2000 });
  await expect(serve).not.toContainText("Couldn't stop it");
});

test('a stop whose machine dropped before answering offers Retry, and the retry, answered once, stops the job', async ({ page, hub }) => {
  const { fm, jobs } = await runningJobs(page, hub);
  fm.holdStops = true;
  const row = jobRow(jobs, WATCH);
  await row.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => stopsSent(hub).length).toBe(1);
  const [sent] = stopsSent(hub);
  hub.answerRpc(PROJECT, sent.nonce, 'uncertain');
  await expect(row.getByRole('status')).toContainText(`${MACHINE} dropped before answering: it may or may not have happened.`);
  await expect(row.getByRole('button', { name: 'Stop' })).toBeEnabled();
  await shot(page, 'dc10-uncertain');
  await row.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => stopsSent(hub).length).toBe(2);
  expect(stopsSent(hub)[1].nonce).toBe(sent.nonce); // the same sealed stop
  await expect.poll(() => fm.stopsHeld).toBe(2);
  expect(fm.releaseStops()).toBe(2); // the first answers it; the retry is answered from the ledger
  await expect(row).toContainText('stopped', { timeout: 2000 });
  const notes = fm.depth.rows.get('main')!.filter((r) => JSON.stringify(r).includes(`Task ${WATCH}, a background task, was stopped from the desk`));
  expect(notes).toHaveLength(1);
});

test('G2: Stop stays disabled with §5’s reason without the bridge, on a read-only machine and an offline one, and is not drawn on an ended job', async ({ page, hub }) => {
  const { fm, jobs } = await runningJobs(page, hub);
  const stop = () => jobRow(jobs, WATCH).getByRole('button', { name: 'Stop' });
  const presence = (bridge: boolean) =>
    hub.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: fm.session, kind: 'presence', sub: null, n: null, body: { record: fm.depth.presence, bridge } } as SessionMessage);
  const fake = (over: { online?: boolean; read_only?: boolean }) =>
    hub.setMachines(PROJECT, [{ machine: MACHINE, online: over.online ?? true, policy: { read_only: over.read_only ?? false, ceiling: 'default' }, checkouts: [{ path: fm.recording.cwd, branch: 'main' }] }]);

  presence(false);
  await expect(stop()).toBeDisabled();
  await expect(stop()).toHaveAttribute('title', 'fakerec runs without the bridge: stop its jobs in its terminal');
  await shot(page, 'dc10-no-bridge');
  presence(true);
  await expect(stop()).toBeEnabled();
  await expect(stop()).not.toHaveAttribute('title');

  fake({ read_only: true });
  await expect(stop()).toBeDisabled();
  await expect(stop()).toHaveAttribute('title', `${MACHINE} is read-only: it runs nothing sent from outside it`);
  fake({});
  await expect(stop()).toBeEnabled();

  // Offline: the column still draws the jobs as last reported, and none can be stopped.
  fake({ online: false });
  await expect(stop()).toBeDisabled();
  await expect(stop()).toHaveAttribute('title', `${MACHINE} is offline`);
  await expect(jobs.getByRole('button', { name: 'Stop', disabled: false })).toHaveCount(0);
  fake({});
  expect(stopsSent(hub)).toHaveLength(0);

  // A job that has ended draws no Stop at all: its row says how it ended.
  fm.playThrough(isRowNaming(`<task-id>${SUITE}</task-id>`));
  await expect(jobRow(jobs, SUITE)).toContainText('completed');
  await expect(jobRow(jobs, SUITE).getByRole('button', { name: STOP_BUTTON })).toHaveCount(0);
});

/**
 * The recording with one more turn after its last row: a prompt, a Bash call and its result, then Esc's marker; its
 * machine reports the session busy from the prompt on, as it does for a turn it runs.
 */
function withInterruptedTurn(recording: Recording): Recording {
  const main = recording.rows.main;
  const lastRow = main.at(-1)!;
  const end = recording.steps.findIndex((step) => step.k === 'presence' && step.record === null);
  const at = (end < 0 ? recording.steps.at(-1)!.at : recording.steps[end].at) - 1;
  const base = Date.parse(String(lastRow.timestamp)) + 60_000;
  let parent = lastRow.uuid;
  const envelope = (i: number) => {
    const uuid = `5e550000-0000-4000-8000-00000000000${i}`;
    const row = { uuid, parentUuid: parent, timestamp: new Date(base + i * 1000).toISOString(), sessionId: recording.session, isSidechain: false, userType: 'external', cwd: lastRow.cwd, version: lastRow.version, entrypoint: 'cli' };
    parent = uuid;
    return row;
  };
  const rows: JsonObject[] = [
    { ...envelope(1), type: 'user', origin: { kind: 'human' }, promptId: 'p-interrupt', message: { role: 'user', content: 'List the files, then describe each one at length.' } },
    { ...envelope(2), type: 'assistant', message: { id: 'msg_interrupt1', role: 'assistant', model: 'claude-haiku-5-5', type: 'message', content: [{ type: 'tool_use', id: 'toolu_interrupt1', name: 'Bash', input: { command: 'ls', description: 'List files' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } },
    { ...envelope(3), type: 'user', promptId: 'p-interrupt', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_interrupt1', content: 'notes.md\nwords.txt', is_error: false }] }, toolUseResult: { stdout: 'notes.md\nwords.txt', stderr: '', interrupted: false, isImage: false } },
    // Esc's marker as 2.1.300 writes it: one text block, no origin, the interrupted response named.
    { ...envelope(4), type: 'user', promptId: 'p-interrupt', interruptedMessageId: 'msg_interrupt2', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  ];
  const steps: Step[] = [{ at, k: 'presence', record: { status: 'busy', waitingFor: null, needs: null } }, ...rows.map((row): Step => ({ at, k: 'row', agentId: null, row: row as never }))];
  return {
    ...recording,
    rows: { ...recording.rows, main: [...main, ...(rows as never[])] },
    steps: end < 0 ? [...recording.steps, ...steps] : [...recording.steps.slice(0, end), ...steps, ...recording.steps.slice(end)],
  };
}

test('a subagent’s own shell stands above its transcript in the drill-in, and its Stop stops it the same way', async ({ page, hub }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { fm, depth } = await openSession(page, hub);
  fm.playThrough((step) => step.k === 'agent' && step.agentId === ALPHA);
  await depth.getByTestId('depth-tab-subagents').click();
  await agentRow(depth.getByTestId('depth-subagents'), ALPHA).click();
  await expect(depth.getByTestId('depth-subagent')).toHaveAttribute('data-agent', ALPHA);
  await expect.poll(() => fm.subscriptions(ALPHA)).toBe(1);
  await expect(depth.getByTestId('depth-agent-jobs')).toHaveCount(0); // none yet: nothing is drawn

  // The agent starts a background shell in its own loop.
  const taskId = 'bagent001';
  const stamp = new Date().toISOString();
  const envelope = { sessionId: fm.session, isSidechain: true, agentId: ALPHA, timestamp: stamp };
  fm.depth.appendRow(ALPHA, { ...envelope, type: 'assistant', uuid: 'a9e10000-0000-4000-8000-000000000001', message: { id: 'msg_agent_bash', type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_agent_bash', name: 'Bash', input: { command: 'pnpm dev', description: 'Run the dev server', run_in_background: true } }], usage: { input_tokens: 1, output_tokens: 1 } } });
  fm.depth.appendRow(ALPHA, { ...envelope, type: 'user', uuid: 'a9e10000-0000-4000-8000-000000000002', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_agent_bash', content: `Command running in background with ID: ${taskId}.` }] }, toolUseResult: { backgroundTaskId: taskId } });

  const jobs = depth.getByTestId('depth-agent-jobs');
  const row = jobRow(jobs, taskId);
  await expect(row).toContainText('Run the dev server');
  await expect(jobs.locator('[data-section="mcp"]')).toHaveCount(0);
  await shot(page, 'dc10-agent-jobs');
  await row.getByRole('button', { name: 'Stop' }).click();
  await expect(row).toContainText('stopped', { timeout: 2000 });
  expect(stopsSent(hub).at(-1)?.args).toEqual({ session: fm.session, taskId });
  // The bridge's note is in the main transcript alone, and the agent's job read it there, as the plane reads it.
  expect(fm.depth.rows.get('main')!.some((r) => JSON.stringify(r).includes(`Task ${taskId}, a background task, was stopped from the desk`))).toBe(true);
  expect(fm.depth.rows.get(ALPHA)!.some((r) => JSON.stringify(r).includes(taskId) && r.type !== 'assistant' && !('toolUseResult' in r))).toBe(false);
});
