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
import { AGENTS_RELAY_TAIL, AGENTS_STOP_SHELL_TAIL, AGENTS_STOP_WORKFLOW_TAIL } from '../test/support/agents-fixtures-tail';
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

  test('two agents show under Active and move to Done', async ({ maws }) => {
    test.setTimeout(120_000); // one wait of up to a minute: replayed starts are hours old, so the count moves by the minute
    const h = await Harness.open(maws);
    await h.load('A', 'pass1/subagent', { releaseTo: PASS1.firstStart });
    await h.open('subagents');
    // The engine's snapshot naming the first agent comes a frame before its start: a running node whose start is unknown.
    await expect.poll(async () => (await h.subagents())?.active).toEqual([expect.objectContaining({ agentId: FIRST.agentId, elapsed: 'elapsed unavailable' })]);

    await h.agents('releaseThrough', 'A', PASS1.secondStart);
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['Active · 2']);
    const active = (await h.subagents())!.active;
    expect(titles(active)).toEqual([FIRST.title, SECOND.title]);
    for (const row of active) expect(row.elapsed, `${row.title}: a live count`).toMatch(/^(\d+h \d{2}m|\d+m \d{2}s|\d+s)$/);
    // The elapsed ticks: the shown count moves on its own (by the minute here, the replayed start being hours old).
    const before = active[0].elapsed;
    await expect.poll(async () => (await h.subagents())?.active[0]?.elapsed, { timeout: 65_000, intervals: [1_000] }).not.toBe(before);

    await h.agents('releaseThrough', 'A', PASS1.firstFinish);
    await expect.poll(async () => (await h.subagents())?.headings).toEqual(['Active · 1', 'Done · 1']);
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
    await expect.poll(async () => (await h.subagents())?.active.find((row) => row.agentId === FIRST.agentId)?.waiting, 'the row waits on its approval').toBe(true);
    expect((await h.subagents())!.active.find((row) => row.agentId === FIRST.agentId)!.line).toMatch(/^Approval needed · /);
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
    await expect.poll(async () => (await h.subagents())?.active.map((row) => row.agentId)).toContain(AGENTS_RELAY_TAIL.foregroundAgentId);
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
      return [...(view?.active ?? []), ...(view?.done ?? []), ...(view?.disk ?? [])].map((row) => ({ agentId: row.agentId, depth: row.depth, orphan: row.orphan }));
    };
    // The recorded run: the outer agent dispatches the inner one (spawn depths 1 and 2); both finished.
    const nested = [
      { agentId: 'a38d4aebfaea9f6b1', depth: 0, orphan: false },
      { agentId: 'a425e926e506edeb1', depth: 1, orphan: false },
    ];
    await h.load('A', 'pass3/nested-agents');
    await h.open('subagents');
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
    expect((await card())!.phases).toEqual([]);

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
      await expect.poll(async () => (await card())?.phases, `frame ${i + 1}`).toEqual([expect.objectContaining({ title: 'Echo', count: expected.count })]);
      const table = (await card())!.table;
      expect(table.map((row) => ({ label: row.label, tokens: row.tokens })), `frame ${i + 1}: tokens`).toEqual(expected.table.map(({ label, tokens }) => ({ label, tokens })));
      for (const [j, row] of table.entries()) expect(row.time, `frame ${i + 1}: ${row.label}'s time`).toMatch(expected.table[j].time);
    }
    expect((await card())!.line).toMatch(/^workflow maws-probe · .+ · 2 agents · .+ tokens$/);

    // As C3's status reads while the run runs, then Stop: the id is still listed when the call resolves.
    await h.agents('patchStatus', 'A', { backgroundTasks: [WORKFLOW] });
    await h.agents('answerStop', WORKFLOW.taskId, 'ok');
    await h.agents('stop', WORKFLOW.taskId);
    expect((await h.agents('calls')).stopTask).toEqual([{ appSessionId: 'A', taskId: WORKFLOW.taskId }]);
    expect((await card())?.stopping).toBe(true);
    // The engine's first frame, the snapshot without it, with the status C3 writes from the same frame: still stopping.
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.batches[0]);
    await h.agents('patchStatus', 'A', { backgroundTasks: [] });
    await expect.poll(async () => (await h.agents('graph', 'A'))?.lastSeq, 'the snapshot batch applied').toBe(AGENTS_STOP_WORKFLOW_TAIL.first);
    expect(await card()).toMatchObject({ stopping: true, status: '' });
    const started = Date.now();
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.batches[1]);
    await h.release(AGENTS_STOP_WORKFLOW_TAIL.batches[2]);
    await expect.poll(async () => card()).toMatchObject({ stopping: false, status: 'stopped', error: null });
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
    expect(view.workflows).toEqual([expect.objectContaining({ status: 'completed', table: [expect.objectContaining({ label: 'alpha' }), expect.objectContaining({ label: 'beta' })] })]);
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
          await expect.poll(async () => (await h.subagents())?.active.some((row) => row.waiting)).toBe(true);
        },
      ],
      [
        'the lists with a nested row',
        async () => {
          await h.load('A', 'pass3/nested-agents');
          await h.agents('fixtureFs', 'nested-agents-sidecars');
          await h.open('subagents');
          await expect.poll(async () => {
            const view = await h.subagents();
            return [...(view?.active ?? []), ...(view?.done ?? [])].some((row) => row.depth === 1);
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
