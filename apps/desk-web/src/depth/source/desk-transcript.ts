// One transcript of a session through DX8's session plane, as MAWS's transcript view draws it: a `TranscriptSource`
// copied and adapted from MAWS's `transcript/source/ipc.ts` (the renderer survey's copy-and-adapt), and the streaming
// layer beside it.
//
// The rows. The subscription's rows are kept in transcript order, by uuid (a row seen twice is one), and mapped to X1
// events by MAWS's backfill (`recordToEvents`), whose ids are deterministic, so MAWS's store deduplicates them as it
// does a disk transcript. The backfill's context carries turn and tool-loop state from row to row, so the rows always
// pass through it in order: a source's snapshot maps every held row with a fresh context, and the rows that arrive
// after it continue that context. Older rows (a `rows` page) go before the oldest held one, and the transcript is
// rebuilt from all of them under a new source, which MAWS's store installs staged — the old rows stay drawn until the
// new state is whole, and keep their ids — so an older page never lands after newer turns and a page boundary between
// a tool call and its result attributes nothing wrongly (the DC6 plan's M1 decision on older rows). Subagent metadata
// arriving live does the same when it names an agent call a held row was mapped without, so the rows are attributed
// as a fresh load with that metadata attributes them.
//
// The conversation the engine holds (`off-chain.ts`). The machine marks the rows off the session's live chain — on the
// snapshot and each page for their rows, on a `row` for the rows its write took off or put back — and the latest message
// about a row says. A row off the chain is not mapped, but an owner input the session never read draws as undone
// (`drawingOf`). When the marks, a repeat of an undone input's words, or a delivery's later copy change what is drawn
// of the rows already mapped, the transcript is rebuilt from the held rows, as for an older page.
//
// The stream. Chunks never reach MAWS's reducer, which pairs a streaming block with its row only by an API message id
// that DX4's chunks lack: they go to the streaming layer (`stream/layer.ts`), and a block's text is dropped from it
// once the row its `block-row` named is in the store (applied, not just received: a staged rebuild may still be
// installing), so its partial text and its row are never drawn together and nothing streamed goes missing between.
// A step's `step-end` drops its blocks no `block-row` named: an aborted response's partial text goes with its request.
//
// The subagent tree. The same rows, mapped once more under a context of the tree's own (so it never waits for the view
// to attach a source), feed MAWS's task graph beside the subscription's `subagents` metas (`agents/task-feed.ts`): it
// is rebuilt whenever the transcript is, and follows each row and each `subagents` message in between. A main-thread
// subscription carries the session's tree; a subagent's, that agent's own. The tree the rows and metas build is kept
// apart from the one published, which lays each agent's status (DX4, a producer of DC8 or later) over it.
//
// Jobs (DC9 M5). The same `subagents` body, from a producer of DC8 or later, carries the loop's background jobs and
// MCP server names (absent from an older one: null here), and a job's output is asked for on the subscription and
// answered as an `output` message (`jobs/output-requests.ts`, which also asks again what a reset or an end lost).
//
// An interrupted turn ends at the engine's marker row (`interrupt.ts`), in the mapping every rule above shares.
//
// Beside the transcript (M3). A main-thread subscription carries the session's context use and cost (DX4 `usage`, in the
// snapshot and after each main turn) and answers `diff()` with the working tree's diff against its base branch: both
// are kept in the state for the column's Info and Diff tabs. The diff is asked for only when the view says so (its tab
// opening, the reader's refresh), never polled; a request lost to a reset or an end is asked again once the fresh
// snapshot is in.
//
// Disruptions (DX8). A `reset` (a gap, a dropped socket, a hub restart, the bridge's own discontinuity) drops what was
// drawn: the layer is cleared, the source resets MAWS's store key, and its next snapshot waits for the fresh one the
// client subscribes for. Any other `end` keeps what was drawn and says why; `resubscribe` takes a fresh snapshot,
// which continues the held rows when it overlaps them and replaces them when it does not.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, EventId, SessionId } from '@shared/graph/ids';
import { AgentMetaSchema, TranscriptRecordSchema } from '@shared/wire/transcript';
import type { Job, JsonObject, McpServer, SessionBodies, SubagentMeta, Usage } from 'desk-hub/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createBackfillContext, recordToEvents, type BackfillContext, type SubagentLookup } from '../../../../../src/engine-host/fs/backfill';
import type { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { emptyGraph, type TaskGraph } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import type { TranscriptSource } from '../../../../../src/renderer/src/transcript/source/types';
import { transcriptKey, type SessionPlane, type SessionTarget, type Subscription, type SubscriptionMessage } from '../../shell/session-plane';
import { noteModel } from '../../state/models';
import { taskGraphOf, withEvents, withMetas, withStatuses } from '../agents/task-feed';
import { OutputRequests } from '../jobs/output-requests';
import { StreamingLayer, type StreamBlock } from '../stream/layer';
import { deliveryAsDrawn, deliveryFrame } from '../../conversation/delivery-frame';
import { withAppendedTurn } from './appended-turn';
import { isMirrorLine, steerAsDrawn } from './bridge-rows';
import { withWakeLine } from './bridge-wake';
import { normalizeInterruptRow, withInterruptEnd } from './interrupt';
import { drawingOf, drawingsDiffer, NONE_OFF, ownerInput, undoneEvents, type Drawing } from './off-chain';

/** What the adapter reads of MAWS's transcript store: whether a row's events have been applied under a key. */
export type TranscriptStoreApi = Pick<ReturnType<typeof createTranscriptStore>, 'getState' | 'subscribe'>;

export type DepthTranscriptState = {
  /** The source MAWS's view attaches under `key`; a new one when the transcript is rebuilt (older rows, a new subscription). */
  source: TranscriptSource;
  /**
   * `loading` until the first snapshot is in; `reconnecting` after a reset until the fresh one is (a subscription the
   * hub ended before its snapshot, `end {discontinuity}` at n 0, reaches here as a reset too); `ended` after any other
   * `end`, with its reason.
   */
  phase: 'loading' | 'reconnecting' | 'live' | 'ended';
  ended: SessionBodies['end'] | null;
  /** This transcript's blocks still streaming, in drawing order. */
  streaming: StreamBlock[];
  /** Older rows exist before the oldest held one. */
  more: boolean;
  loadingOlder: boolean;
  /** The subagent tree this subscription knows: MAWS's task graph over its metas and its held rows, each agent's DX4 status laid over it. */
  tasks: TaskGraph;
  /** The loop's background jobs and MCP server names (DX4 `subagents`); null until a producer of DC8 or later sends them. */
  jobs: Job[] | null;
  mcp: McpServer[] | null;
  /**
   * The session's context use and cost (DX4 `usage`), a main-thread subscription's only: undefined until its snapshot
   * (and after a reset, until the fresh one), null when the session has no bridge or none has come yet.
   */
  usage: Usage | null | undefined;
  /** The working tree's diff: null until asked for; `pending` while an answer is awaited, the last answer kept meanwhile. */
  diff: { pending: boolean; answer: SessionBodies['diff'] | null } | null;
  /** The model of the transcript's latest response among the held rows (DX8: the model comes from the transcript). */
  model: string | null;
};

export type DeskTranscriptOptions = {
  plane: SessionPlane;
  project: string;
  target: SessionTarget;
  store: TranscriptStoreApi;
  /** Rows asked for per older page. */
  page?: number;
};

const PAGE = 100;

type Row = JsonObject & { uuid: string };
const hasUuid = (row: JsonObject): row is Row => typeof row.uuid === 'string' && row.uuid !== '';
/** The model a response row was answered by; the engine's own rows (`<synthetic>`) name none. */
const modelOf = (row: JsonObject): string | null => {
  const model = row.type === 'assistant' ? (row.message as JsonObject | undefined)?.model : undefined;
  return typeof model === 'string' && model !== '' && model !== '<synthetic>' ? model : null;
};

/** The backfill's subagent lookup over DX4's `subagents` metas (each `subagents/*.meta.json` verbatim). */
export function subagentLookupOf(subagents: readonly SubagentMeta[]): SubagentLookup {
  return {
    byToolUseId(toolUseId) {
      for (const { agentId, meta } of subagents) {
        const parsed = AgentMetaSchema.safeParse(meta);
        if (parsed.success && parsed.data.toolUseId === toolUseId) return { agentId: agentId as AgentId, meta: parsed.data, prompt: null };
      }
      return null;
    },
  };
}

/**
 * One row's X1 events under a backfill context; a row that is not a transcript record yields none. A turn that a
 * message from the session's own subagent opens (its hand-back, an `<agent-message>` of the peer origin, which MAWS's
 * backfill reads as a `subagent.message`) is the session woken by its subagent, not a peer session's: it takes the
 * engine's origin, whose divider MAWS reads as "Continued for …", as it reads a task notification's turn. An interrupt
 * marker ends the turn it interrupted, the bridge's record of one read as its marker line alone (`interrupt.ts`). A
 * delivered send is drawn without its frame line, a peer's under a label naming it, and one that entered a running turn
 * as a prompt queued there (`conversation/delivery-frame.ts`); the held row keeps its frame. A steer the bridge appended
 * is drawn as the owner's prompt queued there too (`bridge-rows.ts`), one appended while no turn ran taken by the turn
 * that starts next (`appended-turn.ts`), the bridge's mirror of either not at all, and the bridge's wake as its own line
 * in a turn the session continued (`bridge-wake.ts`), read off the held row: a delivery whose words open with the
 * wake's line is no wake, and its drawn copy has lost the frame that says so.
 */
function eventsOf(row: JsonObject, ctx: BackfillContext): SessionEvent[] {
  if (isMirrorLine(row)) return [];
  const mapped = steerAsDrawn(deliveryAsDrawn(normalizeInterruptRow(row)));
  const record = TranscriptRecordSchema.safeParse(mapped);
  if (!record.success) return [];
  let events = withWakeLine(row, withInterruptEnd(mapped, recordToEvents(record.data, ctx), ctx), ctx);
  if (events.some((event) => event.kind === 'subagent.message')) {
    events = events.map((event) => (event.kind === 'turn.started' && event.origin === 'peer' ? { ...event, origin: 'task-notification' } : event));
  }
  return withAppendedTurn(row, events, ctx);
}

/** A held row's events as the drawing has it (`off-chain.ts`): none for a row it leaves out, an undone input's for one it draws so. */
function drawnEvents(row: JsonObject, drawing: Drawing, ctx: BackfillContext): SessionEvent[] {
  const uuid = row.uuid as string;
  if (drawing.hidden.has(uuid)) return [];
  const owner = drawing.undone.has(uuid) ? ownerInput(row) : null;
  return owner !== null ? undoneEvents(row, owner, ctx) : eventsOf(row, ctx);
}

const contextFor = (target: SessionTarget, subagents: SubagentLookup): BackfillContext =>
  createBackfillContext({ sessionId: target.session as SessionId, agent: target.agentId === null ? null : { agentId: target.agentId as AgentId, parentToolUseId: null }, subagents });

/**
 * A source over a fixed list of one transcript's rows, oldest first, as a fresh load of them draws, `off` the rows the
 * machine marks off the chain: the suites' reference.
 */
export function freshSource(rows: readonly JsonObject[], session: string, subagents: SubagentLookup, agentId: string | null = null, off: ReadonlySet<string> = NONE_OFF): TranscriptSource {
  return {
    subscribe: () => () => {},
    snapshot: async () => {
      const ctx = contextFor({ machine: '', session, agentId }, subagents);
      const drawing = drawingOf(rows, off);
      return rows.flatMap((row) => drawnEvents(row, drawing, ctx));
    },
  };
}

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

/** One generation of the transcript as MAWS's store attaches it: the held rows mapped under one context, then live. */
class RowsSource implements TranscriptSource {
  readonly key: string;
  readonly agentId?: AgentId;
  private listener: ((events: SessionEvent[]) => void) | null = null;
  private ctx: BackfillContext | null = null;

  constructor(private readonly owner: DeskTranscript) {
    this.key = owner.key;
    if (owner.target.agentId !== null) this.agentId = owner.target.agentId as AgentId;
  }

  subscribe(listener: (events: SessionEvent[]) => void): () => void {
    this.listener = listener;
    this.ctx = null;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  async snapshot(): Promise<SessionEvent[]> {
    await this.owner.whenSnapshotted();
    const ctx = this.owner.newContext();
    const events = this.owner.heldRows().flatMap((row) => this.owner.mapRow(row, ctx));
    this.ctx = ctx;
    return events;
  }

  /**
   * The transcript's one reset signal, whichever source registers on it: a rebuild publishes a new source that the
   * view attaches later (in an effect), and a reset in between must reach the one still attached.
   */
  onReset(listener: () => void): () => void {
    return this.owner.onReset(listener);
  }

  /** A row after the snapshot, under the snapshot's context; before it, the snapshot will hold the row. */
  live(row: Row): void {
    if (this.ctx === null) return;
    const events = this.owner.mapRow(row, this.ctx);
    if (events.length > 0) this.listener?.(events);
  }

  /** Its live rows wait for its next snapshot, which waits for the fresh one. */
  reset(): void {
    this.ctx = null;
  }
}

export class DeskTranscript {
  readonly key: string;
  readonly target: SessionTarget;
  readonly state: StoreApi<DepthTranscriptState>;
  private readonly plane: SessionPlane;
  private readonly project: string;
  private readonly store: TranscriptStoreApi;
  private readonly page: number;
  private subscription: Subscription | null = null;
  private rows: Row[] = [];
  private readonly uuids = new Set<string>();
  /** The rows the machine marks off the session's live chain, held or not yet: the latest message about each says. */
  private readonly off = new Set<string>();
  /** What the drawing leaves out of the held rows, and what it draws as undone (`off-chain.ts`). */
  private drawing: Drawing = drawingOf([], NONE_OFF);
  /** Held rows whose mapping gave no event under the row's own uuid: in the store as soon as they are mapped. */
  private readonly silent = new Set<string>();
  private metas: readonly SubagentMeta[] = [];
  /** The tree the held rows and metas build, before each agent's DX4 status is laid over it (`tasks` in the state). */
  private heldTasks: TaskGraph = emptyGraph();
  private subagents: SubagentLookup = subagentLookupOf([]);
  /** The tree's own backfill context, continued by each row after the held ones; null until a snapshot. */
  private treeContext: BackfillContext | null = null;
  /**
   * Agent tool calls a held row's mapping looked up before their subagent's metadata was in: metadata naming one
   * rebuilds the transcript, so the rows mapped without it are attributed as a fresh load attributes them.
   */
  private readonly unresolved = new Set<string>();
  /** The backfill's lookup as every context holds it: the current metadata, noting what it could not resolve. */
  private readonly lookup: SubagentLookup = {
    byToolUseId: (toolUseId) => {
      const found = this.subagents.byToolUseId(toolUseId);
      if (found === null) this.unresolved.add(toolUseId);
      return found;
    },
  };
  private readonly resets = new Set<() => void>();
  private readonly layer = new StreamingLayer();
  private snapshotted: Deferred = deferred();
  /** A snapshot has been served since the transcript opened or last reset: a later one rebuilds from what is held. */
  private served = false;
  private source: RowsSource;
  private offStore: (() => void) | null = null;
  /** The jobs view's open outputs, asked for on this subscription (a main-thread one's). */
  readonly outputs = new OutputRequests((taskId, tail) => {
    if (!this.served || this.subscription === null) return false;
    this.subscription.output(taskId, tail);
    return true;
  });

  constructor(options: DeskTranscriptOptions) {
    this.plane = options.plane;
    this.project = options.project;
    this.store = options.store;
    this.target = options.target;
    this.page = options.page ?? PAGE;
    this.key = transcriptKey(options.project, options.target);
    this.source = new RowsSource(this);
    this.state = createStore<DepthTranscriptState>(() => ({
      source: this.source,
      phase: 'loading',
      ended: null,
      streaming: [],
      more: false,
      loadingOlder: false,
      tasks: emptyGraph(),
      jobs: null,
      mcp: null,
      usage: undefined,
      diff: null,
      model: null,
    }));
  }

  open(): void {
    if (this.subscription) return;
    this.offStore ??= this.store.subscribe(() => {
      if (this.settleLanded()) this.publish();
    });
    this.subscribe();
  }

  close(): void {
    this.subscription?.close();
    this.subscription = null;
    this.offStore?.();
    this.offStore = null;
    this.outputs.clear();
  }

  /** After an `end` other than a reset: subscribe again; the fresh snapshot takes up from what is drawn. */
  resubscribe(): void {
    if (this.subscription || this.state.getState().phase !== 'ended') return;
    this.state.setState({ phase: 'loading' });
    this.subscribe();
  }

  /**
   * Asks for the page of rows before the oldest held one, when older rows exist and none is on its way.
   */
  loadOlder(): void {
    const { more, loadingOlder } = this.state.getState();
    const oldest = this.rows[0];
    if (!more || loadingOlder || !this.subscription || !oldest) return;
    this.state.setState({ loadingOlder: true });
    this.subscription.rows(oldest.uuid, this.page);
  }

  /**
   * Asks the session for its working tree's diff (a main-thread subscription's only): the answer arrives as a `diff`
   * message. While the subscription is down the request waits for the fresh snapshot.
   */
  requestDiff(): void {
    if (this.target.agentId !== null) return;
    this.state.setState((s) => ({ diff: { pending: true, answer: s.diff?.answer ?? null } }));
    if (this.served) this.subscription?.diff();
  }

  /** One agent's blocks still streaming on this subscription (the main one carries every agent's). */
  streamingOf(agentId: string | null): StreamBlock[] {
    return this.layer.blocks(agentId);
  }

  // What the source reads.

  whenSnapshotted(): Promise<void> {
    return this.snapshotted.promise;
  }

  heldRows(): readonly Row[] {
    return this.rows;
  }

  newContext(): BackfillContext {
    return contextFor(this.target, this.lookup);
  }

  onReset(listener: () => void): () => void {
    this.resets.add(listener);
    return () => this.resets.delete(listener);
  }

  mapRow(row: Row, ctx: BackfillContext): SessionEvent[] {
    const events = this.drawnEventsOf(row, ctx);
    if (!events.some((event) => event.id === row.uuid)) this.silent.add(row.uuid);
    return events;
  }

  private drawnEventsOf(row: Row, ctx: BackfillContext): SessionEvent[] {
    return drawnEvents(row, this.drawing, ctx);
  }

  // The subscription.

  private subscribe(): void {
    this.subscription = this.plane.subscribe(this.target, {
      message: (message) => (message.kind === 'snapshot' ? this.snapshot(message.body) : this.receive(message)),
      reset: () => this.reset(),
      end: (body) => {
        this.subscription = null;
        this.outputs.lost();
        this.state.setState({ phase: 'ended', ended: body, loadingOlder: false });
      },
    });
  }

  private snapshot(body: SessionBodies['snapshot']): void {
    this.metas = body.subagents;
    this.subagents = subagentLookupOf(body.subagents);
    this.unresolved.clear();
    const fresh = [...body.rows].reverse().filter(hasUuid);
    let more = body.more;
    if (this.served) {
      // A snapshot after an end: it continues the held rows where it overlaps them, else it replaces them.
      const at = fresh.length > 0 ? this.rows.findIndex((row) => row.uuid === fresh[0].uuid) : -1;
      if (at >= 0) more = this.state.getState().more;
      else this.off.clear();
      this.mark(fresh, body.offChain);
      this.setRows(at >= 0 ? [...this.rows.slice(0, at), ...fresh] : fresh);
      this.rebuild();
    } else {
      this.off.clear();
      this.mark(fresh, body.offChain);
      this.setRows(fresh);
      this.retree();
    }
    this.layer.load(body.streaming);
    this.served = true;
    this.snapshotted.resolve();
    this.state.setState({ phase: 'live', ended: null, more, loadingOlder: false, usage: this.target.agentId === null ? (body.usage ?? null) : undefined });
    this.setJobs(body);
    if (this.state.getState().diff?.pending) this.subscription?.diff(); // a request the reset or end lost
    this.outputs.resend(); // the outputs the reset or end lost
    this.publish();
  }

  private receive(message: Exclude<SubscriptionMessage, { kind: 'snapshot' }>): void {
    switch (message.kind) {
      case 'row':
        return this.row(message.body);
      case 'chunk':
        if (this.layer.chunk(message.body)) this.publish();
        return;
      case 'block-row':
        this.layer.blockRow(message.body);
        // Another transcript's block (a subagent's, on the main subscription): its row never comes on this
        // subscription, so the block settles now (DX4, composite cd2667d8). Only this transcript's own blocks wait.
        if (message.body.agentId !== this.target.agentId) this.layer.settle(message.body.uuid);
        return this.publish();
      case 'step-end':
        if (this.layer.stepEnd(message.body)) this.publish();
        return;
      case 'rows':
        return this.older(message.body);
      case 'subagents':
        this.metadata(message.body.subagents);
        return this.setJobs(message.body);
      case 'output':
        return this.outputs.answer(message.body);
      case 'usage':
        if (this.target.agentId === null) this.state.setState({ usage: message.body });
        return;
      case 'diff':
        return this.state.setState({ diff: { pending: false, answer: message.body } });
    }
  }

  private row({ row, offChain = [], onChain = [] }: SessionBodies['row']): void {
    // What the row's write did to the chain, whether or not the row is new: the latest message about a row says.
    let marked = false;
    for (const uuid of offChain) {
      if (this.off.has(uuid)) continue;
      this.off.add(uuid);
      marked = true;
    }
    for (const uuid of onChain) marked = this.off.delete(uuid) || marked;
    const fresh = hasUuid(row) && !this.uuids.has(row.uuid);
    if (fresh) {
      this.uuids.add(row.uuid);
      this.rows.push(row);
      const model = modelOf(row);
      if (model !== null && model !== this.state.getState().model) this.setModel(model);
    }
    // What is drawn of the rows already mapped changes only with the marks, an owner input (it may repeat an undone one's
    // words), or a delivery (a later copy of a held one): then the drawing is read again, and the transcript rebuilt
    // when it changed for any of them.
    if (marked || (fresh && (ownerInput(row) !== null || deliveryFrame(row) !== null))) {
      const drawing = drawingOf(this.rows, this.off);
      const changed = drawingsDiffer(this.drawing, drawing, fresh ? row.uuid : null);
      this.drawing = drawing;
      if (changed && this.served) {
        this.rebuild();
        return this.publish();
      }
    }
    if (!fresh) return;
    this.source.live(row);
    if (this.treeContext !== null) this.setTree(withEvents(this.heldTasks, this.drawnEventsOf(row, this.treeContext)));
    this.publish();
  }

  private metadata(subagents: readonly SubagentMeta[]): void {
    this.metas = subagents;
    this.subagents = subagentLookupOf(subagents);
    const resolved = [...this.unresolved].filter((toolUseId) => this.subagents.byToolUseId(toolUseId) !== null);
    for (const toolUseId of resolved) this.unresolved.delete(toolUseId);
    if (resolved.length > 0 && this.served) this.rebuild();
    else this.setTree(withMetas(this.heldTasks, subagents));
  }

  /** The jobs and MCP names a snapshot or `subagents` message carries; a producer older than DC8 sends neither. */
  private setJobs({ jobs, mcp }: { jobs?: Job[]; mcp?: McpServer[] }): void {
    this.state.setState({ jobs: jobs ?? null, mcp: mcp ?? null });
    if (jobs !== undefined) this.outputs.jobs(jobs);
  }

  private older(body: SessionBodies['rows']): void {
    const older = [...body.rows].reverse().filter((row): row is Row => hasUuid(row) && !this.uuids.has(row.uuid));
    // The rebuilt source first: whoever reads the page answered (loadingOlder false) reads the source that holds it.
    if (older.length > 0) {
      this.mark(older, body.offChain);
      this.setRows([...older, ...this.rows]);
      this.rebuild();
    }
    this.state.setState({ more: body.more, loadingOlder: false });
  }

  private reset(): void {
    this.off.clear();
    this.setRows([]);
    this.layer.clear();
    this.served = false;
    this.snapshotted = deferred();
    this.unresolved.clear();
    this.metas = [];
    this.treeContext = null;
    this.heldTasks = emptyGraph();
    this.outputs.lost();
    this.state.setState({ phase: 'reconnecting', ended: null, more: false, loadingOlder: false, streaming: [], tasks: this.heldTasks, jobs: null, mcp: null, usage: undefined });
    this.source.reset();
    for (const listener of [...this.resets]) listener(); // MAWS's store empties the key and hydrates it again
  }

  /** The held rows under a new source: MAWS's store rebuilds the key from all of them, staged; the tree with them. */
  private rebuild(): void {
    this.source = new RowsSource(this);
    this.state.setState({ source: this.source });
    this.retree();
  }

  /** The tree from the held rows and the metas, under a fresh context of its own that later rows continue. */
  private retree(): void {
    const ctx = this.newContext();
    this.treeContext = ctx;
    this.setTree(taskGraphOf(this.metas, this.rows.flatMap((row) => this.drawnEventsOf(row, ctx))));
  }

  /** The tree as the held rows and metas build it, published with each agent's DX4 status laid over it. */
  private setTree(held: TaskGraph): void {
    this.heldTasks = held;
    this.state.setState({ tasks: withStatuses(held, this.metas) });
  }

  /** The transcript's latest response came from `model`: the session info names it, and the pickers offer it. */
  private setModel(model: string): void {
    this.state.setState({ model });
    noteModel(this.project, model);
  }

  /** A snapshot's or a page's marks: each of its rows off the chain when it names it, on it otherwise. */
  private mark(rows: readonly Row[], offChain: readonly string[] = []): void {
    for (const row of rows) this.off.delete(row.uuid);
    for (const uuid of offChain) this.off.add(uuid);
  }

  private setRows(rows: Row[]): void {
    this.rows = rows;
    this.uuids.clear();
    this.silent.clear();
    this.drawing = drawingOf(rows, this.off);
    for (const row of rows) this.uuids.add(row.uuid);
    const latest = rows.findLast((row) => modelOf(row) !== null);
    if (latest) this.setModel(modelOf(latest)!);
  }

  /**
   * Drops from the layer each block whose named row is held and applied in the store — its events are in the key's
   * state while the key is live (not staging a rebuild), or its mapping gave none of its own. True when any was.
   */
  private settleLanded(): boolean {
    const awaited = this.layer.awaited();
    if (awaited.size === 0) return false;
    const entry = this.store.getState().entries[this.key];
    if (entry?.phase !== 'live') return false;
    let changed = false;
    for (const uuid of awaited) {
      if (!this.uuids.has(uuid)) continue;
      if (entry.state.seen.has(uuid as EventId) || this.silent.has(uuid)) changed = this.layer.settle(uuid) || changed;
    }
    return changed;
  }

  private publish(): void {
    this.settleLanded();
    this.state.setState({ streaming: this.layer.blocks(this.target.agentId) });
  }
}
