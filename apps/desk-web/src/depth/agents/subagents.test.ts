// The DC6 plan's M2 proofs, as data, against the recorded session: the subagent tree a main-transcript subscription
// gives matches the recording's `subagents/*.meta.json` and follows the agents as they start and finish; a subagent's
// own subscription draws its transcript and its stream as the main thread's is drawn, through a reconnect, a hub
// restart, and a chunk the snapshot already held, with no gap and no duplicated text; and the two subscriptions are
// apart — a disruption of one never touches what the other drew.
import type { JsonObject, SubagentMeta } from 'desk-hub/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { agentRows, agentTree, type TaskGraph } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import { FakePlane, mount, settle, type HeldSubscription } from '../../../test/double/fake-plane';
import { readRecording, rowsBefore, scriptOf, snapshotAt, STRAY, withTextAnswer, type LiveItem } from '../../../test/double/session-stream';
import type { SessionTarget } from '../../shell/session-plane';
import { DeskTranscript, freshSource, subagentLookupOf } from '../source/desk-transcript';

const PROJECT = 'proj';
const MAIN: SessionTarget = { machine: 'mini', session: 'sess-1', agentId: null };
const recording = readRecording();
const metas: SubagentMeta[] = recording.subagents.map(({ agentId, meta }) => ({ agentId, meta }));
const [WORDS, KETTLE] = recording.subagents; // a654… reads words.txt; a73d… reads notes.md and finishes first
const agentTarget = (agentId: string): SessionTarget => ({ ...MAIN, agentId });

const rowsOf = (script: LiveItem[], cut = script.length) => script.slice(0, cut).flatMap((item) => (item.kind === 'row' ? [item.body.row] : []));

/** The rows a fresh load of one transcript's rows draws: a new store over one snapshot of them. */
async function freshRows(rows: readonly JsonObject[], agentId: string | null): Promise<Row[]> {
  const store = createTranscriptStore();
  await store.getState().attach('fresh', freshSource(rows, MAIN.session, subagentLookupOf(agentId === null ? metas : []), agentId), { agentId: agentId as never });
  return store.getState().entries.fresh.rows;
}

/** One transcript open as the depth column opens it: its controller, its subscription, MAWS's store under its key. */
class Open {
  readonly controller: DeskTranscript;
  private readonly unmount: () => void;
  /** Every block a `block-row` named that streamed text, by its row: drawn here until its row is in the store, then not. */
  readonly streamed = new Map<string, string>();

  constructor(
    readonly plane: FakePlane,
    readonly store: ReturnType<typeof createTranscriptStore>,
    target: SessionTarget,
  ) {
    this.controller = new DeskTranscript({ plane, project: PROJECT, target, store });
    this.controller.open();
    this.unmount = mount(this.controller, store);
  }

  get sub(): HeldSubscription {
    return this.plane.of(this.controller.target.agentId);
  }

  rows(): Row[] {
    return this.store.getState().entries[this.controller.key]?.rows ?? [];
  }

  drawnText(): string[] {
    return this.controller.state.getState().streaming.map((block) => block.text);
  }

  tasks(): TaskGraph {
    return this.controller.state.getState().tasks;
  }

  /** No gap and no duplicated text: each named block is drawn as streaming text or applied in the store, never both. */
  check(): void {
    const entry = this.store.getState().entries[this.controller.key];
    if (entry?.phase !== 'live') return;
    for (const [uuid] of this.streamed) {
      const applied = entry.state.seen.has(uuid as never);
      const drawn = this.controller.state.getState().streaming.some((block) => block.settledBy === uuid);
      expect(applied !== drawn, `row ${uuid}: in the store ${applied}, drawn as streaming ${drawn}`).toBe(true);
    }
    for (const text of this.drawnText()) expect(text).not.toContain(STRAY);
  }

  async step(items: LiveItem[]): Promise<void> {
    for (const item of items) {
      if (item.kind === 'block-row') {
        const { turnId, step, index } = item.body;
        const block = this.controller.state.getState().streaming.find((b) => b.turnId === turnId && b.step === step && b.index === index);
        if (block && block.text !== '') this.streamed.set(item.body.uuid, block.text);
      }
      this.sub.play([item]);
      await settle();
      this.check();
    }
  }

  close(): void {
    this.unmount();
    this.controller.close();
  }
}

/** What the tree says of each agent: its section, title, type, and the call that started it. */
function treeOf(tasks: TaskGraph) {
  const tree = agentTree(tasks);
  const rows = [...tree.agents, ...tree.done, ...agentRows(tasks, 'disk').map((row) => ({ kind: 'agent' as const, ...row }))];
  return rows.flatMap((row) => {
    if (row.kind !== 'agent') return [];
    const node = tasks.tasks.get(row.taskId)!;
    return [{ agentId: String(row.taskId), status: node.status, description: node.description, type: node.agent?.subagentType ?? null, toolUseId: node.toolUseId }];
  });
}
const statusOf = (tasks: TaskGraph, agentId: string) => tasks.tasks.get(agentId as never)?.status ?? null;
/** The script index of the row with this uuid. */
const rowAt = (script: LiveItem[], uuid: unknown) => script.findIndex((item) => item.kind === 'row' && item.body.row.uuid === uuid);
/** The main transcript's row that notifies of this agent's end. */
const notificationOf = (agentId: string) => recording.session.find((row) => typeof (row.message as { content?: unknown })?.content === 'string' && String((row.message as { content: string }).content).includes(`<task-id>${agentId}</task-id>`))!;

describe('the subagent tree from the main subscription', () => {
  let plane: FakePlane;
  let main: Open;
  const script = scriptOf(recording.session, null, { subagents: metas });

  beforeEach(() => {
    plane = new FakePlane(PROJECT, metas);
    main = new Open(plane, createTranscriptStore(), MAIN);
  });
  afterEach(() => main.close());

  it('matches the recording’s subagents/*.meta.json, one node per meta', async () => {
    main.sub.snapshot(script, script.length);
    await settle();
    expect(treeOf(main.tasks())).toEqual(
      expect.arrayContaining(
        metas.map(({ agentId, meta }) => ({ agentId, status: 'completed', description: meta.description, type: meta.agentType, toolUseId: meta.toolUseId })),
      ),
    );
    expect(treeOf(main.tasks())).toHaveLength(metas.length);
  });

  it('grows as the agents start and follows each to its end', async () => {
    main.sub.snapshot(script, 0);
    await settle();
    expect(treeOf(main.tasks())).toEqual([]);
    const second = script.findLastIndex((item) => item.kind === 'subagents');
    await main.step(script.slice(0, second));
    expect(treeOf(main.tasks()).map((agent) => [agent.agentId, agent.status])).toEqual([[KETTLE.agentId, 'running']]); // the first call started the notes.md agent
    await main.step(script.slice(second, rowAt(script, notificationOf(KETTLE.agentId).uuid)));
    expect(agentTree(main.tasks()).running).toBe(2);
    await main.step(script.slice(rowAt(script, notificationOf(KETTLE.agentId).uuid), rowAt(script, notificationOf(KETTLE.agentId).uuid) + 1));
    expect([statusOf(main.tasks(), KETTLE.agentId), statusOf(main.tasks(), WORDS.agentId)]).toEqual(['completed', 'running']);
    await main.step(script.slice(rowAt(script, notificationOf(KETTLE.agentId).uuid) + 1));
    expect([statusOf(main.tasks(), KETTLE.agentId), statusOf(main.tasks(), WORDS.agentId)]).toEqual(['completed', 'completed']);
    expect(agentTree(main.tasks()).done.map((row) => row.kind === 'agent' && String(row.taskId)).sort()).toEqual(metas.map((m) => m.agentId).sort());
  });

  it('metas that arrive after the rows naming their agents give the tree a fresh load gives', async () => {
    const bare = scriptOf(recording.session, null); // no `subagents` messages: the snapshot's tree is empty
    main.sub.n = 0;
    main.sub.send('snapshot', { ...snapshotAt(bare, 0), subagents: [] });
    await settle();
    await main.step(bare);
    expect(treeOf(main.tasks())).toEqual([]);
    main.sub.send('subagents', { subagents: metas });
    await settle();
    expect(treeOf(main.tasks()).map((agent) => agent.status)).toEqual(['completed', 'completed']);
  });

  it('an interruption keeps the tree, and its fresh snapshot gives the tree live play gave at the same point', async () => {
    const middle = rowAt(script, notificationOf(KETTLE.agentId).uuid) + 1;
    main.sub.snapshot(script, 0);
    await settle();
    await main.step(script.slice(0, middle));
    const live = treeOf(main.tasks());
    main.sub.listener.interrupted();
    expect(treeOf(main.tasks())).toEqual(live);
    main.sub.snapshot(script, middle);
    await settle();
    expect(treeOf(main.tasks())).toEqual(live);
  });

  it('an agent whose call is older than the rows held is known from its meta alone until a page holds the call', async () => {
    const cut = rowAt(script, notificationOf(KETTLE.agentId).uuid); // both running, neither finished
    const held = rowsOf(script, cut);
    const call = held.findIndex((row) => row.type === 'assistant' && JSON.stringify(row.message).includes(String(WORDS.meta.toolUseId)));
    main.sub.snapshot(script, cut, held.length - call - 1); // the newest rows, starting just after the second call
    await settle();
    expect(treeOf(main.tasks()).map((agent) => agent.status)).toEqual(['unknown', 'unknown']);
    expect(agentRows(main.tasks(), 'disk')).toHaveLength(metas.length); // MAWS's On disk: status unavailable
    main.controller.loadOlder();
    main.sub.send('rows', rowsBefore(script, cut, main.sub.asked[0].before, 100));
    await settle();
    expect(treeOf(main.tasks()).map((agent) => agent.status)).toEqual(['running', 'running']);
  });

  it('an agent whose end is held but whose start is not ends as a known node, as live play leaves it', async () => {
    const all = rowsOf(script);
    const end = all.indexOf(notificationOf(KETTLE.agentId));
    main.sub.snapshot(script, script.length, all.length - end); // from the notes.md agent's notification on
    await settle();
    expect(statusOf(main.tasks(), KETTLE.agentId)).toBe('completed');
    expect(statusOf(main.tasks(), WORDS.agentId)).toBe('completed');
  });
});

describe('a subagent’s transcript through its own subscription', () => {
  for (const agent of [WORDS, KETTLE]) {
    describe(`agent ${agent.agentId}`, () => {
      let plane: FakePlane;
      let open: Open;
      const rows = withTextAnswer(agent.rows);

      beforeEach(() => {
        plane = new FakePlane(PROJECT, []);
        open = new Open(plane, createTranscriptStore(), agentTarget(agent.agentId));
      });
      afterEach(() => open.close());

      it('subscribes with its agentId and draws its stream settling into the rows a fresh load of it draws', async () => {
        expect(plane.current.target).toEqual(agentTarget(agent.agentId));
        const script = scriptOf(rows, agent.agentId, { lateRows: true, strayAfterBlockRow: 1 });
        open.sub.snapshot(script, 0);
        await settle();
        await open.step(script);
        expect(open.streamed.size).toBeGreaterThanOrEqual(1); // the answer's text streamed and settled
        expect(open.controller.state.getState().streaming).toEqual([]);
        expect(open.rows()).toEqual(await freshRows(rowsOf(script), agent.agentId));
      });

      it('a reconnect in the middle of its response ends with no gap and no duplicated text', async () => {
        const script = scriptOf(rows, agent.agentId);
        const middle = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 2;
        open.sub.snapshot(script, 0);
        await settle();
        await open.step(script.slice(0, middle));
        const drawn = open.drawnText();
        expect(drawn.join('')).not.toBe('');
        const rowsBefore = open.rows();
        open.sub.listener.interrupted();
        expect(open.drawnText()).toEqual(drawn); // kept until the fresh snapshot
        expect(open.rows()).toBe(rowsBefore);
        open.sub.snapshot(script, middle + 1);
        await settle();
        await open.step(script.slice(middle + 1));
        expect(open.rows()).toEqual(await freshRows(rowsOf(script), agent.agentId));
      });

      it('a hub restart loses what was in flight; the fresh snapshot holds it, and its stream goes on', async () => {
        const script = scriptOf(rows, agent.agentId, { lateRows: true });
        const firstText = script.findIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text');
        open.sub.snapshot(script, 0);
        await settle();
        await open.step(script.slice(0, firstText + 2));
        open.sub.listener.interrupted();
        const lost = firstText + 6;
        open.sub.snapshot(script, lost);
        await settle();
        await open.step(script.slice(lost));
        expect(open.rows()).toEqual(await freshRows(rowsOf(script), agent.agentId));
      });

      it('a chunk that arrives while its snapshot is built is in the snapshot already and drawn once', async () => {
        const script = scriptOf(rows, agent.agentId);
        const cut = script.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 1;
        open.sub.snapshot(script, cut);
        await settle();
        const before = open.drawnText().join('');
        expect(before).not.toBe('');
        open.sub.play(script.slice(cut - 2, cut));
        await settle();
        expect(open.drawnText().join('')).toBe(before);
        await open.step(script.slice(cut));
        expect(open.rows()).toEqual(await freshRows(rowsOf(script), agent.agentId));
      });
    });
  }
});

describe('the main thread and a subagent, apart', () => {
  let plane: FakePlane;
  let store: ReturnType<typeof createTranscriptStore>;
  let main: Open;
  let sub: Open;
  const mainScript = scriptOf(recording.session, null, { subagents: metas });
  const subScript = scriptOf(withTextAnswer(WORDS.rows), WORDS.agentId);
  const midMain = mainScript.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 2;
  const midSub = subScript.findLastIndex((item) => item.kind === 'chunk' && item.body.chunk.kind === 'text') - 2;

  beforeEach(async () => {
    plane = new FakePlane(PROJECT, metas);
    store = createTranscriptStore(); // one store, as the column's: two keys
    main = new Open(plane, store, MAIN);
    sub = new Open(plane, store, agentTarget(WORDS.agentId));
    main.sub.snapshot(mainScript, 0);
    sub.sub.snapshot(subScript, 0);
    await settle();
    await main.step(mainScript.slice(0, midMain));
    await sub.step(subScript.slice(0, midSub));
    expect(main.drawnText().join('')).not.toBe('');
    expect(sub.drawnText().join('')).not.toBe('');
  });
  afterEach(() => {
    sub.close();
    main.close();
  });

  const drawn = (open: Open) => ({ rows: open.rows(), streaming: open.controller.state.getState().streaming, phase: open.controller.state.getState().phase, tasks: open.tasks() });

  it('a subagent’s interruption and end never touch the main thread’s view', async () => {
    const before = drawn(main);
    const subscriptions = plane.subs.length;
    const subRows = sub.rows();
    sub.sub.listener.interrupted();
    await settle();
    expect(sub.rows()).toBe(subRows); // its own view keeps what it drew
    expect(drawn(main)).toEqual(before);
    expect(main.rows()).toBe(before.rows); // the same state object: nothing in it moved
    sub.sub.snapshot(subScript, midSub + 1);
    await settle();
    sub.sub.listener.end({ reason: 'session-ended' });
    await settle();
    expect(sub.controller.state.getState().phase).toBe('ended');
    expect(main.rows()).toBe(before.rows);
    expect(main.controller.state.getState()).toMatchObject({ phase: 'live', ended: null });
    expect(plane.subs.length).toBe(subscriptions); // the main thread was not subscribed again
    await main.step(mainScript.slice(midMain));
    expect(main.rows()).toEqual(await freshRows(rowsOf(mainScript), null));
  });

  it('the main thread’s interruption and end never touch the subagent’s view', async () => {
    const before = drawn(sub);
    const mainRows = main.rows();
    main.sub.listener.interrupted();
    await settle();
    expect(main.rows()).toBe(mainRows); // its own view keeps what it drew
    expect(drawn(sub)).toEqual(before);
    expect(sub.rows()).toBe(before.rows);
    main.sub.listener.end({ reason: 'machine-offline' });
    await settle();
    expect(sub.rows()).toBe(before.rows);
    expect(sub.controller.state.getState()).toMatchObject({ phase: 'live', ended: null });
    await sub.step(subScript.slice(midSub));
    expect(sub.rows()).toEqual(await freshRows(rowsOf(subScript), WORDS.agentId));
  });
});
