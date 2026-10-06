// C8b's agent tools end to end (C8b execution document, acceptance item 3), run by `pnpm e2e:agents` over the harness
// build: the `#panel` page under the harness scenario (main knows sessions A and B, so `layout.set` takes their panel
// keys), with C8b's block installed: the real Subagents, Background work and Log tools, the fake agent-work client whose
// wire half `agents.feed` binds to the loaded fixture's player, and the column's transcript with the real hand-offs.
// Every frame a case reacts to is in a fixture file (a recorded journal, or a derived one with a recorded pass-3 tail)
// and released through `panel.transcript('A').release(n)` with counts the fixture measures, never guessed. Every case
// that loads a fixture does it through `load` (C8a's `loadTranscript`, then `agents.feed`); `releaseTo` is C8a's, the
// seq of the first event held back.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { EngineSessionStatus } from '../src/shared/engine/status';
import type { AgentsHarnessApi } from '../src/renderer/src/harness/agents/api';
import { FAKE_STOP_REFUSAL } from '../src/renderer/src/harness/agents/api';
import type { PanelHarnessApi } from '../src/renderer/src/harness/panel/api';
import { relayText } from '../src/renderer/src/tools/agents/model/relay';
import { AGENTS_CRON_TAIL, AGENTS_RELAY_TAIL, AGENTS_STOP_SHELL_TAIL, AGENTS_STOP_WORKFLOW_TAIL, E7_NESTED_AGENTS, E7_PEER_A } from '../test/support/agents-fixtures-tail';
import { nextCronMatch, parseCron } from '../src/shared/engine/cron'; // E7
import { formatIn } from '../src/renderer/src/tools/agents/model/elapsed'; // E7
import { PANEL_CHILD_TAIL } from '../test/support/panel-child-tail';
import { REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { otherThemeColours } from './support/panel-support';

const DIR_A = '/tmp/maws-harness/a'; // session A's directory in the harness scenario
const HARNESS_ENV = { MAWS_HARNESS: '1', MAWS_SESSION_SOURCE: 'stub:test/fixtures/panel/harness-sessions.json' };
const SESSION = 'Harness A'; // A's record title: `<session>` in the tools' copy
const LOG_PAGE_BYTES = 256 * 1024; // the Log's page (C8b's log-model), which the fake answers one byte short
const FIRST = { agentId: 'ad286defbc77bc090', title: 'Read and report one.txt content' }; // pass 1's two background agents
const SECOND = { agentId: 'ae75ba6ce5d866acc', title: 'Read and report two.txt content' };
const PASS1 = { firstStart: 172, secondStart: 217, firstFinish: 335, secondFinish: 365 }; // pass1/subagent's seqs
// A task as C3's status lists it while it runs (`backgroundTasks`).
type BackgroundTask = EngineSessionStatus['backgroundTasks'][number];
const listed = (taskId: string, taskType: string, description: string) => ({ taskId, taskType, description, ambient: false }) as BackgroundTask & { taskId: string };
const WORKFLOW = listed(AGENTS_STOP_WORKFLOW_TAIL.taskId, 'local_workflow', 'Two echo agents in one phase');
const SHELL = listed(AGENTS_STOP_SHELL_TAIL.taskId, 'local_bash', 'Sleep 30s then write BG_DONE to bg.txt');
const OPEN_TURN: EngineSessionStatus['turn'] = { id: 'harness-turn' as never, origin: 'human', startedAt: '2026-09-29T10:00:00.000Z', acceptedAt: '2026-09-29T10:00:00.000Z', userMessageUuids: [] };

type HarnessWindow = { __maws_harness?: { page?: string; panel?: PanelHarnessApi; agents?: AgentsHarnessApi } };
type Fn<T> = { [M in keyof T]: T[M] extends (...args: never[]) => unknown ? M : never }[keyof T];

class Harness {
  constructor(readonly maws: MawsLaunch) {}
  get page(): Page {
    return this.maws.page;
  }
  get region(): Locator {
    return this.page.locator('[data-region="panel"]');
  }

  static async open(maws: MawsLaunch): Promise<Harness> {
    const h = new Harness(maws);
    await h.page.waitForFunction(() => (window as unknown as HarnessWindow).__maws_harness !== undefined, null, { timeout: 15_000 });
    await h.page.evaluate(() => (location.hash = '#panel'));
    await h.page.waitForFunction(() => (window as unknown as HarnessWindow).__maws_harness?.page === 'panel', null, { timeout: 15_000 });
    await h.panel('ready');
    await h.panel('hydrated');
    return h;
  }

  panel<M extends Fn<PanelHarnessApi>>(method: M, ...args: Parameters<PanelHarnessApi[M]>): Promise<Awaited<ReturnType<PanelHarnessApi[M]>>> {
    return this.page.evaluate(([m, a]) => ((window as unknown as HarnessWindow).__maws_harness!.panel![m] as (...x: unknown[]) => unknown)(...a), [method, args] as const) as never;
  }
  agents<M extends Fn<AgentsHarnessApi>>(method: M, ...args: Parameters<AgentsHarnessApi[M]>): Promise<Awaited<ReturnType<AgentsHarnessApi[M]>>> {
    return this.page.evaluate(([m, a]) => ((window as unknown as HarnessWindow).__maws_harness!.agents![m] as (...x: unknown[]) => unknown)(...a), [method, args] as const) as never;
  }
  release = (n: number) => this.page.evaluate((n) => (window as unknown as HarnessWindow).__maws_harness!.panel!.transcript('A').release(n), n);

  // The spec's helper: the transcript loaded (history below `releaseTo` released), then the fake client's wire bound to it.
  async load(id: 'A' | 'B', name: string, opts: { releaseTo?: number } = {}): Promise<void> {
    await this.panel('loadTranscript', id, name, opts);
    await this.agents('feed', id, name);
  }

  subagents = () => this.agents('subagents');
  background = () => this.agents('background');
  log = () => this.agents('log');
  drillIn = async () => (await this.subagents())?.drillIn ?? null;
  // E7: the tree's Done section is collapsed by default; this opens it (once it is listed) unless it is open already.
  async expandDone(): Promise<void> {
    const toggle = this.region.locator('section[data-section="done"] > h3 button');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  // A tool on A, selected (a single-instance tool already open is re-targeted and selected; Subagents opened with no
  // params shows its lists).
  open = (toolId: 'subagents' | 'background') => this.panel('addTool', toolId);
  tabs = () => this.panel('tabs');
  layoutOf = (id: 'A' | 'B') =>
    this.page.evaluate(async (key) => {
      const result = await window.maws.invoke('layout.get', { key: key as 'regions' });
      return result.ok ? (result.value.value as { tabs: { id: string; toolId: string }[] } | null) : null;
    }, `panel.${id}`);

  expectQuietConsole(): void {
    expect(this.maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  }
}

const titles = (rows: { title: string }[] | undefined) => rows?.map((row) => row.title) ?? [];

test.describe('the #panel harness: the agent tools', () => {
  test.use({ mawsEnv: HARNESS_ENV });
  test.beforeAll(() => mkdirSync(DIR_A, { recursive: true }));

  test('two agents show under Agents and move to Done', async ({ maws }) => {
    test.setTimeout(120_000); // one wait of up to a minute: replayed starts are hours old, so the count moves by the minute
    const h = await Harness.open(maws);
    await h.load('A', 'pass1/subagent', { releaseTo: PASS1.firstStart });
    await h.open('subagents');
    // The engine's snapshot naming the first agent comes a frame before its start: a running node whose start is unknown.
    await expect.poll(async () => (await h.subagents())?.agents).toEqual([expect.objectContaining({ agentId: FIRST.agentId, elapsed: 'elapsed unavailable' })]);

    await h.agents('releaseThrough', 'A', PASS1.secondStart);
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['Agents · 2 running']);
    const active = (await h.subagents())!.agents;
    expect(titles(active)).toEqual([FIRST.title, SECOND.title]);
    for (const row of active) expect(row.elapsed, `${row.title}: a live count`).toMatch(/^(\d+h \d{2}m|\d+m \d{2}s|\d+s)$/);
    // The elapsed ticks: the shown count moves on its own (by the minute here, the replayed start being hours old).
    const before = active[0].elapsed;
    await expect.poll(async () => (await h.subagents())?.agents[0]?.elapsed, { timeout: 65_000, intervals: [1_000] }).not.toBe(before);

    await h.agents('releaseThrough', 'A', PASS1.firstFinish);
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['Agents · 1 running', 'Done · 1']);
    await h.expandDone();
    expect((await h.subagents())!.done).toEqual([expect.objectContaining({ title: FIRST.title, status: 'completed', line: expect.stringMatching(/^finished · .+ · ONE$/) })]);
    await h.agents('releaseThrough', 'A', PASS1.secondFinish);
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['Done · 2']);
    const done = (await h.subagents())!.done;
    expect(done.map((row) => row.line)).toEqual([expect.stringMatching(/^finished · .+ · TWO$/), expect.stringMatching(/^finished · .+ · ONE$/)]); // newest end first
    h.expectQuietConsole();
  });

  test('feed after history keeps the history', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.panel('loadTranscript', 'A', 'pass1/subagent'); // everything released at load
    await h.agents('feed', 'A', 'pass1/subagent');
    await h.open('subagents');
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['Done · 2']);
    await h.expandDone();
    expect(titles((await h.subagents())!.done)).toEqual([SECOND.title, FIRST.title]);
    h.expectQuietConsole();
  });

  test('a subagent row in the transcript opens the drill-in over the child source', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.load('A', 'pass1/subagent');
    await h.agents('clickTranscriptSubagent', 1);
    await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.toolId).toBe('subagents');
    await expect.poll(async () => (await h.drillIn())?.header).toBe(FIRST.title);
    const drillIn = (await h.drillIn())!;
    expect(drillIn).toMatchObject({ agentId: FIRST.agentId, dispatchedBy: `Dispatched by ${SESSION}` });
    const body = h.region.locator('[data-view="agent"]');
    await expect(body.getByText('ONE', { exact: true }), 'its answer').toBeVisible();
    // The child's finished turn folds its work, as C6's transcript does anywhere: opened, its Read cell.
    await body.getByRole('button', { name: /^Worked for / }).click();
    await expect(body.locator('.transcript-cell-line').filter({ hasText: 'one.txt' }).first(), 'the child’s Read cell').toBeVisible();
    await expect.poll(async () => (await h.agents('childTranscript', FIRST.agentId)).keys, 'one store key for the child').toHaveLength(1);
    h.expectQuietConsole();
  });

  test('the drill-in and an agent tab share one attachment', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.load('A', 'pass1/subagent');
    await h.open('subagents');
    await h.expandDone(); // E7: the finished agent's row is under the collapsed Done section
    await h.agents('clickRow', FIRST.agentId);
    await expect.poll(async () => (await h.drillIn())?.rows ?? 0).toBeGreaterThan(0);
    await h.agents('agentTab', FIRST.agentId); // C5's agent tab, standing in: a second child transcript over the same source
    await expect.poll(() => h.agents('childTranscript', FIRST.agentId)).toMatchObject({ keys: [expect.any(String)], sources: 1, attaches: 2 });
    // C6's Transcript renders a tick after it mounts (its lazy chunk): both views catch up to the store's rows.
    await expect
      .poll(async () => {
        const child = await h.agents('childTranscript', FIRST.agentId);
        return { drillIn: child.drillInRows === child.rows, agentTab: child.agentTabRows === child.rows, rows: child.rows > 0 };
      }, 'the drill-in and the agent tab show the store’s rows')
      .toEqual({ drillIn: true, agentTab: true, rows: true });
    h.expectQuietConsole();
  });

  test("a child's permission renders inline", async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.load('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
    for (const count of PANEL_CHILD_TAIL.batches) await h.release(count);
    await h.open('subagents');
    await expect.poll(async () => (await h.subagents())?.agents.find((row) => row.agentId === FIRST.agentId)?.waiting, 'the row waits on its approval').toBe(true);
    expect((await h.subagents())!.agents.find((row) => row.agentId === FIRST.agentId)!.line).toMatch(/^Approval needed · /);
    await h.agents('clickRow', FIRST.agentId);
    await expect.poll(async () => (await h.drillIn())?.requestCards).toBe(1);
    const card = h.region.locator('[data-view="agent"] [data-request-card]');
    await expect(card.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    h.expectQuietConsole();
  });

  test('the relay shows its three observables', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.load('A', 'events/agents-relay', { releaseTo: AGENTS_RELAY_TAIL.first });
    await h.agents('patchStatus', 'A', { turn: null });
    await h.open('subagents');
    await h.agents('clickRow', AGENTS_RELAY_TAIL.agentId);
    await expect.poll(async () => (await h.drillIn())?.relay).toEqual({ label: `Relay via ${SESSION}`, disabled: null, tooltip: null, pending: null });

    await test.step('asked, with the parent idle', async () => {
      await h.agents('typeRelay', AGENTS_RELAY_TAIL.text);
      await h.agents('sendRelay');
      expect((await h.agents('calls')).steer).toEqual([{ appSessionId: 'A', content: relayText({ agentId: AGENTS_RELAY_TAIL.agentId as never, name: null }, AGENTS_RELAY_TAIL.text), priority: 'next' }]);
      await expect.poll(async () => (await h.drillIn())?.relay.pending).toMatch(new RegExp(`^Asked ${SESSION} to relay · (\\d+s|\\d+m \\d{2}s)$`));
      expect((await h.drillIn())!.relay.disabled).toBe('Waiting for the last relay');
    });
    const forwarded = `${SESSION} sent it with SendMessage after 1 parent round · ${FIRST.title} gets it at its next tool round`;
    await test.step('forwarded on the parent’s SendMessage, and resting there with no receipt (O3)', async () => {
      await h.release(AGENTS_RELAY_TAIL.batches[0]);
      await expect.poll(async () => (await h.drillIn())?.relay.pending).toBe(forwarded);
      await h.release(AGENTS_RELAY_TAIL.batches[1]); // the parent's later frames: nothing clears the line
      await expect.poll(async () => (await h.drillIn())?.relay).toEqual({ label: `Relay via ${SESSION}`, disabled: null, tooltip: null, pending: forwarded });
    });
    await test.step('with the parent’s turn open, the asked line says when it forwards', async () => {
      await h.agents('patchStatus', 'A', { turn: OPEN_TURN });
      expect((await h.drillIn())!.relay.disabled).toBeNull();
      await h.agents('typeRelay', 'And say PONG after it');
      await h.agents('sendRelay');
      expect((await h.agents('calls')).steer).toHaveLength(2);
      await expect.poll(async () => (await h.drillIn())?.relay.pending).toMatch(new RegExp(`^Asked ${SESSION} to relay · \\d+s · ${SESSION} forwards at its next tool boundary or when this turn ends$`));
    });
    await test.step('with no status the composer is disabled and says why', async () => {
      await h.panel('setStatus', 'A', null);
      await expect.poll(async () => (await h.drillIn())?.relay.disabled).toBe('Relay needs the session running here');
    });
    h.expectQuietConsole();
  });

  test("a foreground agent's composer is disabled with the reason", async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.load('A', 'events/agents-relay', { releaseTo: AGENTS_RELAY_TAIL.first });
    await h.release(AGENTS_RELAY_TAIL.batches[0]);
    await h.release(AGENTS_RELAY_TAIL.batches[1]); // R1's recorded foreground start, re-keyed
    await h.open('subagents');
    await expect.poll(async () => (await h.subagents())?.agents.map((row) => row.agentId)).toContain(AGENTS_RELAY_TAIL.foregroundAgentId);
    await h.agents('clickRow', AGENTS_RELAY_TAIL.foregroundAgentId);
    await expect.poll(async () => (await h.drillIn())?.relay).toMatchObject({
      disabled: `${SESSION} is waiting on this agent and reads messages only after it returns`,
      tooltip: 'A message sent now would resume the finished agent instead of reaching this one',
    });
    h.expectQuietConsole();
  });

  test('a nested agent renders under its parent', async ({ maws }) => {
    const h = await Harness.open(maws);
    const rows = async () => {
      const view = await h.subagents();
      return [...(view?.agents ?? []), ...(view?.done ?? []), ...(view?.disk ?? [])].map((row) => ({ agentId: row.agentId, depth: row.depth, orphan: row.orphan }));
    };
    // The recorded run: the outer agent dispatches the inner one (spawn depths 1 and 2); both finished.
    const nested = [
      { agentId: 'a38d4aebfaea9f6b1', depth: 0, orphan: false },
      { agentId: 'a425e926e506edeb1', depth: 1, orphan: false },
    ];
    await h.load('A', 'pass3/nested-agents');
    await h.open('subagents');
    await h.expandDone(); // both finished: the tree lists them under Done (E7)
    // R5 promoted live nesting: from the wire alone (the inner start's issuing Agent call), before any sidecar is read.
    await expect.poll(rows, 'nested from the wire').toEqual(nested);
    await h.agents('fixtureFs', 'nested-agents-sidecars');
    // The sidecars' parentAgentId confirms the same nesting.
    await expect.poll(rows, 'nested with the sidecars read').toEqual(nested);
    h.expectQuietConsole();
  });

  test('a workflow shows its phases and table updating per frame and stops', async ({ maws }) => {
    const h = await Harness.open(maws);
    const { progress } = AGENTS_STOP_WORKFLOW_TAIL;
    await h.load('A', 'events/agents-stop-workflow', { releaseTo: progress.releaseTo });
    await h.open('background');
    const card = async () => (await h.background())?.workflows.find((w) => w.taskId === WORKFLOW.taskId);
    await expect.poll(async () => (await card())?.title).toBe(WORKFLOW.description);
    expect((await card())!.summary).toBe('Phases arrive with the first progress frame');
    // E7: the card is compact; its phases and agents live in the run's widget.
    await h.panel('addTool', 'background', { params: { taskId: WORKFLOW.taskId, view: 'run' } });
    const widget = () => h.agents('widget');
    await expect.poll(async () => (await widget())?.header).toBe(WORKFLOW.description);
    expect((await widget())!).toMatchObject({ phases: [], note: 'Phases arrive with the first progress frame' });

    // Per frame (the recorded run's workflow_agent rows): alpha starts, alpha is done (8,861 tokens, 1.4 s) while beta
    // runs, beta is done (8,857 tokens, 1.5 s). A running agent's time counts from its start; a done one's is its own.
    const frames = [
      { count: '0/2', table: [{ label: 'alpha', tokens: '', time: /^\d+(s|m \d{2}s|h \d{2}m)$/ }, { label: 'beta', tokens: '', time: /^$/ }] },
      { count: '1/2', table: [{ label: 'alpha', tokens: '8.9k', time: /^1s$/ }, { label: 'beta', tokens: '', time: /^\d+(s|m \d{2}s|h \d{2}m)$/ }] },
      { count: '2/2', table: [{ label: 'alpha', tokens: '8.9k', time: /^1s$/ }, { label: 'beta', tokens: '8.9k', time: /^1s$/ }] },
    ];
    for (const [i, n] of progress.frames.entries()) {
      await h.release(n);
      const expected = frames[i];
      await expect
        .poll(async () => (await widget())?.phases, `frame ${i + 1}`)
        .toEqual([expect.objectContaining({ title: 'All phases' }), expect.objectContaining({ title: 'Echo', count: expected.count, selected: true })]);
      const table = (await widget())!.agents;
      expect(table.map((row) => ({ label: row.label, tokens: row.tokens })), `frame ${i + 1}: tokens`).toEqual(expected.table.map(({ label, tokens }) => ({ label, tokens })));
      for (const [j, row] of table.entries()) expect(row.time, `frame ${i + 1}: ${row.label}'s time`).toMatch(expected.table[j].time);
    }
    expect((await widget())!.line).toMatch(/^workflow maws-probe · .+ · 2 agents · .+ tokens$/);

    // As C3's status reads while the run runs, then Stop from the widget: the id is still listed when the call resolves.
    await h.agents('patchStatus', 'A', { backgroundTasks: [WORKFLOW] });
    await h.agents('answerStop', WORKFLOW.taskId, 'ok');
    await h.agents('stop', WORKFLOW.taskId);
    expect((await h.agents('calls')).stopTask).toEqual([{ appSessionId: 'A', taskId: WORKFLOW.taskId }]);
    expect((await widget())?.stopping).toBe(true);
    // The engine's first frame, the snapshot without it, with the status C3 writes from the same frame: still stopping.
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.batches[0]);
    await h.agents('patchStatus', 'A', { backgroundTasks: [] });
    await expect.poll(async () => (await h.agents('graph', 'A'))?.lastSeq, 'the snapshot batch applied').toBe(AGENTS_STOP_WORKFLOW_TAIL.first);
    expect(await widget()).toMatchObject({ stopping: true, status: '' });
    const started = Date.now();
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.batches[1]);
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.batches[2]);
    await expect.poll(async () => widget()).toMatchObject({ stopping: false, status: 'stopped', error: null });
    expect(Date.now() - started, 'stopped from the frames, well inside STOP_SETTLE_MS').toBeLessThan(await h.agents('stopSettleMs'));
    h.expectQuietConsole();
  });

  test('a refused stop says why', async ({ maws }) => {
    const h = await Harness.open(maws);
    const { progress } = AGENTS_STOP_WORKFLOW_TAIL;
    await h.load('A', 'events/agents-stop-workflow', { releaseTo: progress.releaseTo });
    for (const n of progress.frames) await h.release(n);
    await h.agents('patchStatus', 'A', { backgroundTasks: [WORKFLOW] });
    await h.open('background');
    await h.agents('answerStop', WORKFLOW.taskId, 'error');
    await h.agents('stop', WORKFLOW.taskId);
    await expect.poll(async () => (await h.background())?.workflows[0]).toMatchObject({ stopping: false, status: '', error: `Couldn't stop it: ${FAKE_STOP_REFUSAL}` });
    h.expectQuietConsole();
  });

  test('a stop for a task the engine no longer knows leaves quietly', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.load('A', 'events/agents-stop-workflow', { releaseTo: AGENTS_STOP_WORKFLOW_TAIL.progress.releaseTo });
    const ghost = listed('no-such', 'local_bash', 'a shell the engine forgot');
    await h.agents('answerStop', ghost.taskId, 'ok');
    await h.agents('patchStatus', 'A', { backgroundTasks: [ghost] }); // a snapshot-born node
    await h.open('background');
    await expect.poll(async () => (await h.background())?.shells.map((s) => s.taskId)).toEqual([ghost.taskId]);
    await h.agents('patchStatus', 'A', { backgroundTasks: [] });
    // A snapshot's silence never removes a node: the ghost stays until the stop resolves.
    await expect.poll(async () => (await h.background())?.shells.map((s) => s.taskId), 'kept after the status drops it').toEqual([ghost.taskId]);
    const settle = await h.agents('stopSettleMs');
    const stopped = Date.now();
    await h.agents('stop', ghost.taskId);
    await expect.poll(async () => (await h.background())?.shells, { timeout: 2 * settle, message: 'gone after STOP_SETTLE_MS' }).toEqual([]);
    expect(Date.now() - stopped, 'removed by the settle window, not at once').toBeGreaterThanOrEqual(settle);
    expect((await h.agents('calls')).stopTask).toEqual([{ appSessionId: 'A', taskId: ghost.taskId }]);
    h.expectQuietConsole();
  });

  test("a shell's Output opens the Log tool on its output file", async ({ maws }) => {
    const h = await Harness.open(maws);
    const { outputFile, taskId } = AGENTS_STOP_SHELL_TAIL;
    await h.load('A', 'events/agents-stop-shell', { releaseTo: AGENTS_STOP_SHELL_TAIL.first });
    const lines = Array.from({ length: 130_000 }, (_, i) => `line ${String(i + 1).padStart(7, '0')}\n`).join('');
    const spill = lines.slice(0, 1.5 * 1024 * 1024); // 1.5 MiB of numbered lines: six pages
    await h.agents('fakeFs', { spills: { [outputFile]: spill } });
    await h.open('background');
    await expect.poll(async () => (await h.background())?.shells).toEqual([expect.objectContaining({ taskId, output: 'enabled' })]);

    await h.agents('output', taskId);
    await expect.poll(async () => (await h.log())?.pages).toBe(1);
    expect(await h.log()).toMatchObject({ title: `Log · ${taskId}.output`, heading: SHELL.description, path: outputFile, size: '1.5 MB' });
    for (let i = 0; i < 3; i += 1) await h.agents('loadMore');
    expect((await h.log())!.pages).toBe(4);
    await h.agents('loadMore'); // the fifth page: the first leaves the window
    const shown = (await h.log())!;
    expect(shown.pages).toBe(4);
    const answered = (await h.agents('calls')).readSpill.map((input) => input.offset ?? 0);
    expect(answered).toEqual([0, 1, 2, 3, 4].map((i) => i * (LOG_PAGE_BYTES - 1))); // offset + the answered length, a byte short each
    expect(shown.offsets).toEqual(answered.slice(1));
    expect(shown.offsets.some((offset) => offset % LOG_PAGE_BYTES === 0)).toBe(false);
    await h.agents('showEarlier');
    expect((await h.log())!.offsets).toEqual(answered.slice(0, 4));
    expect((await h.log())!.text.startsWith('line 0000001\n')).toBe(true);

    // Stop, as the workflow's: listed while it runs, the absent list beside the tail's snapshot.
    await h.open('background');
    await h.agents('patchStatus', 'A', { backgroundTasks: [SHELL] });
    await h.agents('stop', taskId);
    await h.release(AGENTS_STOP_SHELL_TAIL.batches[0]);
    await h.agents('patchStatus', 'A', { backgroundTasks: [] });
    await h.release(AGENTS_STOP_SHELL_TAIL.batches[1]);
    await h.release(AGENTS_STOP_SHELL_TAIL.batches[2]);
    await expect.poll(async () => (await h.background())?.shells[0]?.line).toMatch(new RegExp(`^${SHELL.description} · stopped `));
    h.expectQuietConsole();
  });

  test('Open full log opens one Log per path', async ({ maws }) => {
    const h = await Harness.open(maws);
    const spillPath = /"spillPath":"([^"]+)"/.exec(readFileSync(join(REPO_ROOT, 'test/fixtures/transcript/events/spill.events.jsonl'), 'utf8'))![1];
    await h.load('A', 'events/spill');
    await h.agents('fakeFs', { spills: { [spillPath]: '[1/1200] compiling src/app.ts\n'.repeat(40) } });
    await h.agents('clickTranscriptFullLog', 1);
    await expect.poll(async () => (await h.log())?.path).toBe(spillPath);
    const logs = async () => (await h.tabs()).filter((tab) => tab.toolId === 'log');
    const [first] = await logs();
    await h.panel('showSummary');
    await h.agents('clickTranscriptFullLog', 1);
    await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.id, 'the same tab, selected').toBe(first.id);
    expect(await logs()).toHaveLength(1);

    const reads = (await h.agents('calls')).readSpill.length;
    await h.load('A', 'transcript/long-output'); // its first Bash cell: 116,891 characters kept in the transcript, no spill
    await h.agents('clickTranscriptFullLog', 1);
    await expect.poll(async () => (await h.log())?.noFile).toBe('No file to open: the engine reported no output file for this cell; the transcript shows what was kept');
    expect(await logs()).toHaveLength(2);
    expect((await h.agents('calls')).readSpill, 'nothing read for a cell with no file').toHaveLength(reads);
    h.expectQuietConsole();
  });

  test('two Log tabs are gone after a reload and a new one stays', async ({ maws }) => {
    let h = await Harness.open(maws);
    const other = '/private/tmp/claude-501/-tmp-maws-harness-a/other/tasks/other.output';
    await h.load('A', 'events/agents-stop-shell', { releaseTo: AGENTS_STOP_SHELL_TAIL.first });
    await h.agents('fakeFs', { spills: { [AGENTS_STOP_SHELL_TAIL.outputFile]: 'shell output\n', [other]: 'other output\n' } });
    await h.open('background');
    await expect.poll(async () => (await h.background())?.shells[0]?.output).toBe('enabled');
    await h.agents('output', AGENTS_STOP_SHELL_TAIL.taskId);
    await h.panel('addTool', 'log', { params: { path: other, title: 'Other shell' } });
    const logIds = (await h.tabs()).filter((tab) => tab.toolId === 'log').map((tab) => tab.id);
    expect(logIds).toHaveLength(2);
    await expect.poll(async () => (await h.layoutOf('A'))?.tabs.filter((tab) => tab.toolId === 'log').map((tab) => tab.id), 'written before the reload').toEqual(logIds);

    await h.page.reload();
    h = await Harness.open(maws);
    expect((await h.tabs()).filter((tab) => tab.toolId === 'log'), 'neither Log in the strip').toEqual([]);
    await expect.poll(async () => (await h.layoutOf('A'))?.tabs.filter((tab) => tab.toolId === 'log') ?? [], 'nor in layout.json').toEqual([]);

    const fresh = await h.panel('addTool', 'log', { params: { path: null, title: 'Log' } });
    await h.panel('showSummary');
    await h.panel('selectTab', fresh);
    await h.panel('switchSession', 'B');
    await h.panel('switchSession', 'A');
    expect((await h.tabs()).map((tab) => tab.id)).toContain(fresh);
    expect(await h.agents('instances', 'log')).toEqual([fresh]);
    h.expectQuietConsole();
  });

  test("the checklist reads the client's tasks for the status list id, the override, null and the disk-only session", async ({ maws }) => {
    const h = await Harness.open(maws);
    const task = (id: number, status: 'pending' | 'in_progress' | 'completed') => ({
      id: String(id), subject: `Task ${id}`, description: '', status, blocks: [], blockedBy: [], ...(status === 'in_progress' ? { activeForm: `Working on task ${id}` } : {}),
    });
    const statuses = ['completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending'] as const;
    await h.agents('fakeFs', { tasks: { 'sess-1': statuses.map((s, i) => task(i + 1, s)), 'team-list': [task(1, 'completed'), task(2, 'pending')] } });
    await h.open('background');
    const tasks = async () => (await h.background())?.tasks;

    await h.agents('patchStatus', 'A', { taskListId: 'sess-1' });
    await expect.poll(tasks).toEqual({ heading: 'Tasks · 4/7', label: null, rows: ['Working on task 5', 'Task 6', 'Task 7'], earlier: 4, unavailable: null });
    await h.agents('patchStatus', 'A', { taskListId: 'team-list' });
    await expect.poll(tasks).toMatchObject({ heading: 'Tasks · 1/2', rows: ['Task 2'], earlier: 1 });
    await h.agents('patchStatus', 'A', { taskListId: null });
    await expect.poll(tasks).toMatchObject({ heading: 'Tasks', rows: [], unavailable: 'Tasks unavailable until the engine reports its list' });
    await h.panel('setStatus', 'A', null);
    await h.panel('setSession', 'A', { engineSessionId: 'sess-1' as never });
    await expect.poll(tasks).toMatchObject({ heading: 'Tasks · 4/7', label: 'session list' });
    expect(existsSync(join(homedir(), '.claude', 'tasks', 'sess-1')), 'the real task store is never read or written').toBe(false);
    h.expectQuietConsole();
  });

  test('a disk-only session shows the same agents with wire facts unavailable', async ({ maws }) => {
    const h = await Harness.open(maws);
    await h.panel('setStatus', 'A', null);
    await h.agents('reset', 'A'); // the summary watched A while the page's seeded status was live: those nodes go
    await h.agents('fixtureFs', 'subagent-sidecars');
    await h.agents('fixtureFs', 'workflow-disk');
    await h.open('subagents');
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['On disk · 2']);
    const lists = (await h.subagents())!;
    expect(lists.notes).toContain('Status is known only while the session runs here');
    expect(lists.disk.map((row) => [row.agentId, row.line])).toEqual([
      [FIRST.agentId, 'status unavailable'],
      [SECOND.agentId, 'status unavailable'],
    ]);
    await h.agents('clickRow', FIRST.agentId);
    await expect.poll(async () => (await h.drillIn())?.relay.disabled).toBe('Known only from disk');

    await h.open('background');
    await expect.poll(async () => (await h.background())?.headings).toContain('Workflow runs on disk · 1');
    const view = (await h.background())!;
    expect(view.notes).toContain('Shells and monitors are known only while the session runs here');
    expect(view.workflows).toEqual([expect.objectContaining({ status: 'completed', summary: 'Done' })]);
    // E7: the run's widget lists the agents the card's table did, each opening its sidecar transcript.
    await h.panel('addTool', 'background', { params: { taskId: view.workflows[0].taskId, view: 'run' } });
    await expect.poll(async () => (await h.agents('widget'))?.agents.map((row) => [row.label, row.openable])).toEqual([
      ['alpha', true],
      ['beta', true],
    ]);
    h.expectQuietConsole();
  });

  test("the summary sections read the tools' counts", async ({ maws }) => {
    const h = await Harness.open(maws);
    const section = (name: 'Subagents' | 'Background work') => h.region.getByRole('tabpanel', { name: 'Session overview' }).getByRole('region', { name });
    await h.load('A', 'pass1/subagent', { releaseTo: PASS1.firstStart });
    await h.panel('showSummary');
    await h.agents('releaseThrough', 'A', PASS1.secondStart);
    await expect(section('Subagents')).toContainText('2 working · 0 done');
    await h.agents('releaseThrough', 'A', PASS1.secondFinish);
    await expect(section('Subagents')).toContainText('0 working · 2 done');
    await section('Subagents').getByRole('button', { name: 'Open' }).click();
    await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.toolId).toBe('subagents');

    await h.load('A', 'events/agents-stop-workflow', { releaseTo: AGENTS_STOP_WORKFLOW_TAIL.progress.releaseTo });
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.progress.frames[0]);
    await h.panel('showSummary');
    await expect(section('Background work')).toContainText('1 workflow');
    await section('Background work').getByRole('button', { name: 'Open' }).click();
    await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.toolId).toBe('background');
    h.expectQuietConsole();
  });

  test('both themes use tokens only', async ({ maws }) => {
    test.setTimeout(120_000);
    const h = await Harness.open(maws);
    const views: [string, () => Promise<void>][] = [
      [
        'the lists with a waiting badge',
        async () => {
          await h.load('A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
          for (const count of PANEL_CHILD_TAIL.batches) await h.release(count);
          await h.open('subagents'); // `open` with no params shows the lists
          await expect.poll(async () => (await h.subagents())?.agents.some((row) => row.waiting)).toBe(true);
        },
      ],
      [
        'the lists with a nested row',
        async () => {
          await h.load('A', 'pass3/nested-agents');
          await h.agents('fixtureFs', 'nested-agents-sidecars');
          await h.open('subagents');
          await h.expandDone(); // E7: both finished, under Done
          await expect.poll(async () => {
            const view = await h.subagents();
            return [...(view?.agents ?? []), ...(view?.done ?? [])].some((row) => row.depth === 1);
          }).toBe(true);
        },
      ],
      [
        'the drill-in with the pending line',
        async () => {
          await h.load('A', 'events/agents-relay', { releaseTo: AGENTS_RELAY_TAIL.first });
          await h.agents('patchStatus', 'A', { turn: null });
          await h.open('subagents');
          await h.agents('clickRow', AGENTS_RELAY_TAIL.agentId);
          await h.agents('typeRelay', AGENTS_RELAY_TAIL.text);
          await h.agents('sendRelay');
          await expect.poll(async () => (await h.drillIn())?.relay.pending).toMatch(/^Asked /);
        },
      ],
      [
        'a workflow card mid-run with stopping… and the checklist',
        async () => {
          await h.load('A', 'events/agents-stop-workflow', { releaseTo: AGENTS_STOP_WORKFLOW_TAIL.progress.releaseTo });
          for (const n of AGENTS_STOP_WORKFLOW_TAIL.progress.frames.slice(0, 2)) await h.release(n);
          await h.agents('fakeFs', { tasks: { 'theme-list': [{ id: '1', subject: 'Scan the themes', description: '', status: 'in_progress', activeForm: 'Scanning the themes', blocks: [], blockedBy: [] }] } });
          await h.agents('patchStatus', 'A', { backgroundTasks: [WORKFLOW], taskListId: 'theme-list' });
          await h.open('background');
          await h.agents('stop', WORKFLOW.taskId);
          await expect.poll(async () => (await h.background())?.workflows[0]?.stopping).toBe(true);
          await expect.poll(async () => (await h.background())?.tasks.heading).toBe('Tasks · 0/1');
        },
      ],
      [
        'the workflow widget mid-run', // E7
        async () => {
          await h.load('A', 'events/agents-stop-workflow', { releaseTo: AGENTS_STOP_WORKFLOW_TAIL.progress.releaseTo });
          for (const n of AGENTS_STOP_WORKFLOW_TAIL.progress.frames.slice(0, 2)) await h.release(n);
          await h.open('background');
          await h.panel('addTool', 'background', { params: { taskId: WORKFLOW.taskId, view: 'run' } });
          await expect.poll(async () => (await h.agents('widget'))?.agents.map((row) => row.label)).toEqual(['alpha', 'beta']);
        },
      ],
      [
        'the drill-in with its composer disabled',
        async () => {
          await h.load('A', 'events/agents-relay', { releaseTo: AGENTS_RELAY_TAIL.first });
          for (const n of AGENTS_RELAY_TAIL.batches) await h.release(n);
          await h.open('subagents');
          await h.agents('clickRow', AGENTS_RELAY_TAIL.foregroundAgentId);
          await expect.poll(async () => (await h.drillIn())?.relay.disabled).toMatch(/is waiting on this agent/);
        },
      ],
      [
        'a shell row',
        async () => {
          await h.load('A', 'events/agents-stop-shell', { releaseTo: AGENTS_STOP_SHELL_TAIL.first });
          await h.open('background');
          await expect.poll(async () => (await h.background())?.shells.map((s) => s.output)).toEqual(['enabled']);
        },
      ],
      [
        'a Log tab',
        async () => {
          await h.agents('fakeFs', { spills: { '/private/tmp/claude-501/theme/tasks/theme.output': 'themed output\n'.repeat(200) } });
          await h.panel('addTool', 'log', { params: { path: '/private/tmp/claude-501/theme/tasks/theme.output', title: 'Theme' } });
          await expect.poll(async () => (await h.log())?.pages).toBe(1);
        },
      ],
    ];
    for (const theme of ['dark', 'light'] as const) {
      await h.panel('setTheme', theme);
      await expect(h.page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const [name, show] of views) {
        await show();
        expect(await otherThemeColours(h.page), `${theme}: ${name}`).toEqual([]);
      }
    }
    h.expectQuietConsole();
  });
});

// E7 start (M7): the orchestration views end to end (E7 execution document, Interfaces *Harness and e2e*; G1 to G5), over
// the same harness: the run widget live and from disk, the Subagents tree, the rows between sessions (live from M0's
// recorded journal, and from its JSONL through the backfill), the read-only Tasks panel (P-20) and the Scheduled rows
// live, across a resume and disk-only. Each surface is checked in both themes against the other theme's colours, and its
// screenshots go to `MAWS_E7_SHOTS` when that names a directory (the evidence run).
const E7_SHOTS = process.env.MAWS_E7_SHOTS;
const SCHEDULED_FILE = `${DIR_A}/.claude/scheduled_tasks.json`;
const DURABLE_FIXTURE = join(REPO_ROOT, 'spikes/protocol-probe/fixtures/pass3/e7-cron-durable/scheduled_tasks.json');

// Each theme in turn: the other theme's colours absent, and the target's screenshot when shooting; light again after.
async function bothThemes(h: Harness, name: string, target: Locator): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await h.panel('setTheme', theme);
    await expect(h.page.locator('html')).toHaveAttribute('data-theme', theme);
    // polled: a control with a colour transition (the transcript's code-block Copy) reads the old theme's colour until it settles
    await expect.poll(() => otherThemeColours(h.page), `${theme}: ${name}`).toEqual([]);
    if (E7_SHOTS) {
      mkdirSync(E7_SHOTS, { recursive: true });
      await target.screenshot({ path: join(E7_SHOTS, `${name}-${theme}.png`) });
    }
  }
  await h.panel('setTheme', 'light');
}

// The widget as the owner reads it, without its clock: what a live replay and the disk snapshot must agree on.
const widgetFacts = (view: Awaited<ReturnType<AgentsHarnessApi['widget']>>) =>
  view && { header: view.header, phases: view.phases.map(({ title, count }) => ({ title, count })), agents: view.agents.map(({ label, model, state, tokens, openable }) => ({ label, model, state, tokens, openable })) };

// A derived fixture's events, as far as the cases read them (their kind, tool use and time).
const fixtureEvents = (name: string) =>
  readFileSync(join(REPO_ROOT, `test/fixtures/transcript/events/${name}.events.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind: string; toolUseId?: string; at: string });
// A tool use's time in the derived cron fixture (a job's `createdAt` is its call's).
const callAt = (toolUseId: string): number => Date.parse(fixtureEvents('agents-cron').find((event) => event.kind === 'tool.use' && event.toolUseId === toolUseId)!.at);
// A job's next run as the row reads it relative to `now`: a recurring job's next match from now, a one-shot's single
// fire after its call (null once that is past: the row is gone).
function nextIn(job: { cron: string; toolUseId: string }, recurring: boolean, now: number): string | null {
  const next = nextCronMatch(parseCron(job.cron)!, recurring ? now : callAt(job.toolUseId));
  return next === null || next < now ? null : formatIn(next - now);
}

test.describe('E7: the orchestration views', () => {
  test.use({ mawsEnv: HARNESS_ENV });
  test.beforeAll(() => mkdirSync(DIR_A, { recursive: true }));

  test('G1: a workflow run opens from the summary into its widget, and the disk-only ref opens the same widget', async ({ maws }) => {
    const h = await Harness.open(maws);
    const { progress } = AGENTS_STOP_WORKFLOW_TAIL;
    await h.load('A', 'events/agents-stop-workflow', { releaseTo: progress.releaseTo });
    for (const n of progress.frames) await h.release(n); // the recorded run through its last progress frame: Echo 2/2
    await h.panel('showSummary');
    const summary = h.region.getByRole('tabpanel', { name: 'Session overview' });
    await expect(summary.getByRole('region', { name: 'Background work' })).toContainText('1 workflow');
    await summary.getByRole('region', { name: 'Background work' }).getByRole('button', { name: 'Open' }).click();
    await expect.poll(async () => (await h.background())?.workflows.map((card) => card.taskId)).toEqual([WORKFLOW.taskId]);
    await h.region.locator(`[data-workflow="${WORKFLOW.taskId}"] h4 button`).click(); // the card's title
    const widget = () => h.agents('widget');
    await expect.poll(async () => (await widget())?.taskId).toBe(WORKFLOW.taskId);
    const live = (await widget())!;
    expect(live.phases).toEqual([
      { title: 'All phases', count: '', state: '', selected: false },
      { title: 'Echo', count: '2/2', state: 'done', selected: true }, // no phase runs: the last one
    ]);
    expect(live.agents.map((row) => [row.label, row.tokens, row.time, row.openable])).toEqual([
      ['alpha', '8.9k', '1s', true],
      ['beta', '8.9k', '1s', true],
    ]);
    await h.agents('selectPhase', 0);
    await expect.poll(async () => (await widget())?.phases.map((phase) => phase.selected)).toEqual([true, false]);
    expect((await widget())!.agents.map((row) => row.label)).toEqual(['alpha', 'beta']);
    await h.agents('selectPhase', 1);
    // read as the run was then: the clock a moment after its last progress frame (the replay's own times are days old)
    const lastFrame = fixtureEvents('agents-stop-workflow').findLast((event) => event.kind === 'workflow.progress')!;
    await h.agents('setClock', new Date(Date.parse(lastFrame.at) + 2_000).toISOString());
    await bothThemes(h, 'g1-widget', h.region);
    const liveFacts = widgetFacts(await widget());
    // the transcript's workflow ref, on the live session, opens the same widget
    await h.panel('showSummary');
    await h.agents('clickTranscriptSubagent', 1);
    await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.toolId).toBe('background');
    await expect.poll(async () => widgetFacts(await widget()), 'the ref opens the run it names').toEqual(liveFacts);

    await test.step('the transcript’s workflow ref on a disk-only session opens the same widget, its agents their transcripts', async () => {
      await h.load('A', 'pass2/workflow'); // the same run recorded live: its Workflow call names the run's ids
      await h.agents('clearStatus', 'A');
      await h.agents('fixtureFs', 'workflow-disk');
      await h.panel('showSummary');
      await h.agents('clickTranscriptSubagent', 1); // the workflow ref
      await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.toolId).toBe('background');
      await expect.poll(async () => widgetFacts(await widget()), 'the disk snapshot reads as the live frames did').toEqual(liveFacts);
      await h.region.locator('[data-view="run"] tbody tr').filter({ hasText: 'alpha' }).getByRole('button').click();
      await expect.poll(async () => (await h.tabs()).find((tab) => tab.active)?.toolId).toBe('subagents');
      await expect.poll(async () => (await h.drillIn())?.relay.disabled).toBe('Known only from disk');
    });
    h.expectQuietConsole();
  });

  test('G2: the Subagents tree nests the inner agent, folds it once done, and lists finished roots under Done', async ({ maws }) => {
    const h = await Harness.open(maws);
    const { outer, inner } = E7_NESTED_AGENTS;
    const tree = async () => (await h.agents('tree'))?.map(({ kind, agentId, depth, count, expanded, section }) => ({ kind, agentId, depth, count, expanded, section }));
    await h.load('A', 'pass3/nested-agents', { releaseTo: E7_NESTED_AGENTS.innerStart + 1 });
    await h.open('subagents');
    await expect.poll(tree, 'running: the inner agent at depth 1 under the outer').toEqual([
      { kind: 'agent', agentId: outer, depth: 0, count: null, expanded: null, section: 'agents' },
      { kind: 'agent', agentId: inner, depth: 1, count: null, expanded: null, section: 'agents' },
    ]);
    expect((await h.subagents())!.headings).toEqual(['Agents · 2 running']);

    await h.agents('releaseThrough', 'A', E7_NESTED_AGENTS.innerFinish);
    await expect.poll(tree, 'the finished inner agent folds under the running outer').toEqual([
      { kind: 'agent', agentId: outer, depth: 0, count: null, expanded: null, section: 'agents' },
      { kind: 'done-fold', agentId: outer, depth: 1, count: 1, expanded: false, section: 'agents' },
    ]);
    await h.agents('setClock', new Date(Date.parse(E7_NESTED_AGENTS.innerFinishAt) + 3_000).toISOString()); // the run's own time
    await h.agents('toggleFold', outer);
    await expect.poll(tree).toEqual([
      { kind: 'agent', agentId: outer, depth: 0, count: null, expanded: null, section: 'agents' },
      { kind: 'done-fold', agentId: outer, depth: 1, count: 1, expanded: true, section: 'agents' },
      { kind: 'agent', agentId: inner, depth: 1, count: null, expanded: null, section: 'agents' },
    ]);
    await bothThemes(h, 'g2-tree', h.region);

    await h.agents('releaseThrough', 'A', E7_NESTED_AGENTS.outerFinish);
    await expect.poll(async () => (await h.subagents())?.headings, 'both finished: one root under Done').toEqual(['Done · 2']);
    expect(await tree(), 'Done is collapsed by default').toEqual([]);
    await h.expandDone();
    await expect.poll(tree).toEqual([
      { kind: 'agent', agentId: outer, depth: 0, count: null, expanded: null, section: 'done' },
      { kind: 'agent', agentId: inner, depth: 1, count: null, expanded: null, section: 'done' },
    ]);
    await h.agents('clickRow', inner);
    await expect.poll(async () => (await h.drillIn())?.agentId).toBe(inner);
    h.expectQuietConsole();
  });

  test('G3: a message from another session draws with its sender, the listing as lists, and Reply walks to sent', async ({ maws }) => {
    const h = await Harness.open(maws);
    const { address, name, text } = E7_PEER_A;
    const peerRows = () => h.agents('peerRows');
    const expandAll = () => h.page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness!.panel!.transcript('A').expandAll());
    const inbound = (preview: string) => ({ kind: 'message', direction: 'inbound', who: `@ ${name}`, address, preview, result: null, resultText: null });
    const outbound = (to: string, preview: string, result: string) => ({ kind: 'message', direction: 'outbound', who: `To @ ${name}`, address: to, preview, result });
    await h.load('A', 'pass3/e7-peer-a', { releaseTo: E7_PEER_A.replyFrom });
    await h.agents('patchStatus', 'A', { turn: null });

    await test.step('closed turns keep the message from another session, with Reply; the listing and the agent’s own send fold', async () => {
      await expect.poll(peerRows).toEqual([{ ...inbound('E7 probe: hello from B'), reply: true, line: null }]);
      await expandAll();
      await expect.poll(async () => (await peerRows()).length, 'the folded rows shown').toBe(3);
      const rows = await peerRows();
      expect(rows[0]).toMatchObject({ kind: 'listing', self: expect.stringMatching(/^This session is \S+ \[[0-9a-f]+\]$/), sections: [{ heading: 'Peer sessions · 1', rows: [{ name, ref: expect.stringMatching(/^[0-9a-f]+$/), extras: expect.stringMatching(/^interactive · idle · started \d+s ago$/) }] }] });
      expect(rows.slice(1)).toEqual([
        { ...inbound('E7 probe: hello from B'), reply: true, line: null },
        expect.objectContaining({ ...outbound(name, 'Hello from A — received your probe message.', 'sent'), reply: false, line: null }), // the agent's unasked reply, by B's name
      ]);
      const texts = await h.agents('columnTexts');
      expect(texts.some((line) => line.includes('<cross-session-message')), 'no raw envelope bubble').toBe(false);
    });

    await test.step('Reply sends the peer relay text as a next steer; the line walks asked, replying, replied', async () => {
      await h.agents('reply', 1, text);
      expect((await h.agents('calls')).steer).toEqual([{ appSessionId: 'A', content: relayText({ kind: 'peer', address, name, mode: 'reply' }, text), priority: 'next' }]);
      const line = async () => (await peerRows()).flatMap((row) => (row.kind === 'message' && row.line !== null ? [row.line] : []))[0];
      await expect.poll(line).toMatch(new RegExp(`^Asked ${SESSION} to reply · \\d+s$`));
      await h.agents('releaseThrough', 'A', E7_PEER_A.replySend);
      await expect.poll(line).toBe(`${SESSION} is replying with SendMessage`);
      await h.agents('releaseThrough', 'A', E7_PEER_A.replyResult);
      await expect.poll(line).toBe(`${SESSION} replied with SendMessage`);
      // the evidence: the listing, the message with its Reply walked to replied, and the sends after it
      await expandAll();
      const width = await h.agents('setColumnWidth', 480); // the strip's widest, nearer a session column's width
      await h.agents('scrollColumnTo', 'This session is');
      await bothThemes(h, 'g3-rows', h.page.locator('[data-agents-harness-transcript]'));
      await h.agents('setColumnWidth', width);
    });

    await test.step('a mid-turn message draws as the idle one did; a send to nobody reads Not sent with the engine’s reason', async () => {
      await h.agents('releaseThrough', 'A', E7_PEER_A.failureResult);
      await expandAll();
      const rows = (await peerRows()).filter((row) => row.kind === 'message');
      expect(rows.map((row) => row.kind === 'message' && [row.direction, row.who, row.preview, row.result])).toEqual([
        ['inbound', `@ ${name}`, 'E7 probe: hello from B', null],
        ['outbound', `To @ ${name}`, 'Hello from A — received your probe message.', 'sent'],
        ['outbound', `To @ ${name}`, text, 'sent'], // the owner's reply, to the envelope's address
        ['inbound', `@ ${name}`, 'E7 probe: second message while you work', null],
        ['outbound', 'To @ nobody-e7', 'E7 probe: nobody', 'failed'],
      ]);
      expect(rows.at(-1)).toMatchObject({ resultText: "No agent named 'nobody-e7' is reachable.\nUse ListAgents to see everyone you can message." });
    });

    await test.step('from its JSONL, on a session not running here: the same rows, Reply closed with the reason', async () => {
      await h.load('A', 'events/agents-peer'); // the backfill of A's recorded transcript
      await h.agents('clearStatus', 'A');
      await expandAll();
      await expect.poll(async () => (await peerRows()).map((row) => (row.kind === 'message' ? [row.direction, row.preview, row.result, row.reply] : [row.kind, row.sections.map((s) => s.heading)]))).toEqual([
        ['listing', ['Peer sessions · 1']],
        ['inbound', 'E7 probe: hello from B', null, true],
        ['outbound', 'Hello from A — received your probe message.', 'sent', false],
        ['outbound', text, 'sent', false],
        ['inbound', 'E7 probe: second message while you work', null, true],
        ['outbound', 'E7 probe: nobody', 'failed', false],
      ]);
      await expect(h.agents('reply', 1, text)).rejects.toThrow('Replying needs the session running here');
      expect((await h.agents('calls')).steer, 'nothing more asked').toHaveLength(1);
    });
    h.expectQuietConsole();
  });

  test('G4: the Tasks panel opens on its target, re-targets the open tab, follows the list, and edits nothing', async ({ maws }) => {
    const h = await Harness.open(maws);
    const task = (id: number, status: 'pending' | 'in_progress' | 'completed') => ({
      id: String(id), subject: `Task ${id}`, description: '', status, blocks: [], blockedBy: [], ...(status === 'in_progress' ? { activeForm: `Working on task ${id}` } : {}),
    });
    const statuses = ['completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending'] as const;
    await h.agents('fakeFs', { tasks: { 'e7-list': statuses.map((s, i) => task(i + 1, s)) } });
    await h.agents('patchStatus', 'A', { taskListId: 'e7-list' });
    const tasks = () => h.agents('tasks');
    const selected = async () => (await tasks())?.rows.filter((row) => row.selected).map((row) => row.id);

    const first = await h.panel('addTool', 'tasks', { params: { target: '6' } });
    await expect.poll(tasks).toEqual({
      progress: '4 of 7 completed', label: null, completedToggle: '4 earlier tasks completed', note: null,
      rows: [
        { id: '5', subject: 'Working on task 5', status: 'in_progress', selected: false },
        { id: '6', subject: 'Task 6', status: 'pending', selected: true },
        { id: '7', subject: 'Task 7', status: 'pending', selected: false },
      ],
    });
    const second = await h.panel('addTool', 'tasks', { params: { target: '2' } }); // show_pane's second call: the same tab
    expect(second).toBe(first);
    expect(await h.agents('instances', 'tasks')).toEqual([first]);
    await expect.poll(selected, 'a completed target opens the fold').toEqual(['2']);
    expect((await tasks())!.rows.map((row) => row.id)).toEqual(['5', '6', '7', '1', '2', '3', '4']);
    await expect(h.region.locator('[data-tool="tasks"] li[aria-current="true"]')).toBeInViewport();

    const next = [...statuses.map((s, i) => task(i + 1, i === 5 ? 'completed' : s)), task(8, 'pending')];
    await h.agents('pushTasks', 'e7-list', next);
    await expect.poll(async () => (await tasks())?.progress, 'the list follows fs.tasksChanged').toBe('5 of 8 completed');
    expect((await tasks())!.rows.map((row) => [row.id, row.status])).toEqual([
      ['5', 'in_progress'], ['7', 'pending'], ['8', 'pending'], ['1', 'completed'], ['2', 'completed'], ['3', 'completed'], ['4', 'completed'], ['6', 'completed'],
    ]);
    expect(await selected()).toEqual(['2']);
    const controls = h.region.locator('[data-tool="tasks"]').locator('button, input, textarea, select, [role="menu"]');
    await expect(controls, 'read-only: the fold toggle is its one control').toHaveCount(1);
    await bothThemes(h, 'g4-tasks', h.region);
    expect(existsSync(join(homedir(), '.claude', 'tasks', 'e7-list')), 'no task file is read or written for real').toBe(false);
    h.expectQuietConsole();
  });

  test('G5: scheduled jobs list with their next run and open their creating turn, live, across the resume and disk-only', async ({ maws }) => {
    const h = await Harness.open(maws);
    const { jobs } = AGENTS_CRON_TAIL;
    const scheduled = () => h.agents('scheduled');
    const cell = (toolUseId: string) => h.page.locator(`[data-agents-harness-transcript] [data-cell-id="cell:${toolUseId}"]`);
    await h.load('A', 'events/agents-cron', { releaseTo: AGENTS_CRON_TAIL.firstTurnEnd + 1 });
    await h.agents('patchStatus', 'A', { turn: null });
    const durable = readFileSync(DURABLE_FIXTURE, 'utf8'); // written by the engine at the third turn's durable CronCreate
    const owner = (JSON.parse(durable) as { tasks: { createdBySessionId: string }[] }).tasks[0].createdBySessionId;
    await h.panel('setSession', 'A', { engineSessionId: owner as never }); // the session whose durable job it is
    await h.open('background');

    await test.step('the first turn’s two session-only jobs, each with its next run', async () => {
      let now = Date.parse('2026-10-06T11:13:00.000Z');
      await h.agents('setClock', new Date(now).toISOString());
      await expect.poll(async () => (await scheduled())?.rows.map((row) => row.id)).toEqual([jobs.tick.id, jobs.oneShot.id].filter((id) => id !== jobs.oneShot.id || nextIn(jobs.oneShot, false, now) !== null));
      const view = (await scheduled())!;
      expect(view.rows[0]).toEqual({
        id: jobs.tick.id, store: 'session', schedule: 'Every 2 minutes', kind: 'recurring · session-only', prompt: 'E7 cron tick', dormant: false, link: true,
        when: expect.stringMatching(new RegExp(`^Next ≈ .+ \\(${nextIn(jobs.tick, true, now)}\\) · Expires .+$`)),
      });
      if (view.rows[1]) expect(view.rows[1]).toMatchObject({ kind: 'one-shot · session-only', prompt: 'E7 one-shot', when: expect.stringMatching(new RegExp(`^Next ≈ .+ \\(${nextIn(jobs.oneShot, false, now)}\\)$`)) });
      now = Date.parse('2026-10-06T11:20:00.000Z');
      await h.agents('setClock', new Date(now).toISOString());
      await expect.poll(async () => (await scheduled())?.rows.find((row) => row.id === jobs.tick.id)?.when).toMatch(new RegExp(`^Next ≈ .+ \\(${nextIn(jobs.tick, true, now)}\\) · `));
      await h.agents('openCreatingTurn', jobs.tick.id);
      await expect(cell(jobs.tick.toolUseId), 'the CronCreate cell, scrolled into view').toBeInViewport();
    });

    await test.step('CronDelete removes the job; the later turn’s durable job reads from the file, the session-only one from the transcript', async () => {
      await h.agents('releaseThrough', 'A', AGENTS_CRON_TAIL.deleteResult);
      await expect.poll(async () => (await scheduled())?.rows.map((row) => row.id)).not.toContain(jobs.tick.id);
      await h.agents('releaseThrough', 'A', AGENTS_CRON_TAIL.lastLaunchEnd);
      await h.agents('fakeFs', { files: { [SCHEDULED_FILE]: durable } });
      await expect.poll(async () => (await scheduled())?.rows.map((row) => [row.id, row.store, row.kind, row.schedule, row.link])).toEqual([
        [jobs.durable.id, 'durable-this', 'recurring · durable · this session', 'Every Monday at 9:00 AM', true],
        [jobs.nightly.id, 'session', 'recurring · session-only', 'Every day at 3:00 AM', true],
      ]);
    });

    await test.step('after the resume the session-only job is still listed and still opens its creating turn', async () => {
      await h.agents('releaseThrough', 'A', Number.MAX_SAFE_INTEGER); // e7-cron-resume's launch
      await expect.poll(async () => (await scheduled())?.heading).toBe('Scheduled · 2');
      const now = Date.parse('2026-10-06T11:20:00.000Z');
      expect((await scheduled())!.rows.find((row) => row.id === jobs.nightly.id)!.when).toMatch(new RegExp(`^Next ≈ .+ \\(${nextIn(jobs.nightly, true, now)}\\) · Expires .+$`));
      await bothThemes(h, 'g5-scheduled', h.region);
      await h.agents('openCreatingTurn', jobs.nightly.id);
      await expect(cell(jobs.nightly.toolUseId)).toBeInViewport();
    });

    await test.step('disk-only: the session-only job resumes with the session; a refused file read says why', async () => {
      await h.agents('clearStatus', 'A');
      await expect.poll(async () => (await scheduled())?.rows.map((row) => [row.id, row.dormant, row.when])).toEqual([
        [jobs.durable.id, false, expect.stringMatching(/^Next ≈ /)],
        [jobs.nightly.id, true, expect.stringMatching(/^Resumes with the session/)],
      ]);
      await h.agents('fakeFs', { refusals: { [SCHEDULED_FILE]: 'the harness refused this read' } });
      await expect.poll(async () => (await scheduled())?.error).toBe('Scheduled jobs unavailable: the harness refused this read');
      expect((await scheduled())!.rows.map((row) => row.id), 'the transcript’s job stays').toEqual([jobs.nightly.id]);
    });
    h.expectQuietConsole();
  });
});
// E7 end
