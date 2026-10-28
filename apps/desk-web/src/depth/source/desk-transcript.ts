// One transcript of a session through DX8's session plane, as MAWS's transcript view draws it: a `TranscriptSource`
// copied and adapted from MAWS's `transcript/source/ipc.ts` (the renderer survey's copy-and-adapt), and the streaming
// layer beside it.
//
// The rows. The subscription's rows are kept in transcript order, by uuid (a row seen twice is one, whether two messages
// carry it or one snapshot or page carries it twice), and mapped to X1 events by MAWS's backfill (`recordToEvents`),
// whose ids are deterministic, so MAWS's store deduplicates them as it does a disk transcript. The backfill's context
// carries turn and tool-loop state from row to row, so the rows always
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
// (`drawingOf`). When the marks, a repeat of an undone input, a response that reads one, or a delivery's later copy
// change what is drawn of the rows already mapped, the transcript is rebuilt from the held rows, as for an older page.
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
// answered as an `output` message (`jobs/output-requests.ts`, which also asks again what an interruption or an end lost).
//
// An interrupted turn ends at the engine's marker row (`interrupt.ts`), in the mapping every rule above shares.
//
// Beside the transcript (M3). A main-thread subscription carries the session's context use and cost (DX4 `usage`, in the
// snapshot and after each main turn) and answers `diff()` with the working tree's diff against its base branch: both
// are kept in the state for the column's Info and Diff tabs. The diff is asked for only when the view says so (its tab
// opening, the reader's refresh), never polled; a request lost to an interruption or an end is asked again once the fresh
// snapshot is in. The engine's status (`read status`, the desk control surface spec's M0) is read when the Info tab says
// so and again once per subscription open after that — a reload in the session can change it — never on a presence; a
// Refresh's answer is the one kept, the answer before it drawn until it comes.
//
// Disruptions (DX8). An interruption (a gap, a dropped socket, a hub restart, the bridge's own discontinuity) keeps what
// is drawn — the held rows and their marks, the tree, the jobs, the usage, the streaming layer's blocks — while the
// client subscribes again: what the subscription delivered stays valid, and a machine's reconnect of a second must not
// blank the reader's view and reload it (desk ticket #57). What needs the live subscription (an older page, the diff,
// an output) waits for its fresh snapshot, as a request made while it is down does. An `end` keeps what was drawn too,
// and says why; `resubscribe` takes a fresh snapshot. A fresh snapshot after either is merged into the held rows, not
// swapped in: rows are keyed by uuid and a snapshot is a contiguous window of the newest rows, so where its oldest row
// is held the result is the held rows before it, its own rows, then any held row newer than its newest (one the old
// subscription delivered past the new snapshot's cut, which arrives again live and is one row by its uuid), and `more`
// stays as held — the older pages the reader loaded stay drawn. A snapshot that marks (`offChain`) is merged only where
// its marks agree with the held ones on every row both hold, both hold one of them on the chain (not a progress row,
// which the machine never marks), and no row it brings that was not held was written under a row outside it: a branch
// in the gap (a /rewind, a second append under a tool call) can leave held rows older than the snapshot off the chain
// with nothing but their own page to say so, and the overlap disagreeing, holding no row on the chain to vouch for them,
// or a row branching from outside the snapshot's window (from a held row, or from one older than every held row), is
// how it shows; then, as when the snapshot overlaps nothing held, it replaces the held rows, the older ones paging back
// in with their own marks. An older producer's, which marks nothing, is merged wherever it overlaps. Either way the
// transcript is rebuilt under a new source, which MAWS's store installs staged, so the old rows stay drawn until the new
// state is whole; a block the snapshot no longer streams (its row written, or its step ended, in the gap) stays drawn
// until the rows the snapshot brought have landed, and one a `block-row` named before the disruption until its own row
// has, wherever that row is sure to come, so no block leaves before its row is drawn. A request the snapshot holds less
// of than was drawn (a producer that went back) is kept as drawn, and the live part after the snapshot's cut goes on
// from there.
//
// Latency (desk ticket #57). The hops this transcript sees are timed for `latency/latency.ts`: a main thread's first rows
// (subscribe, snapshot, drawn), each live row that draws and each of its own chunks from the machine's stamp until
// drawn, the owner's own send until its row, each tool call's time (a raised request's anchor), each resume's gap, and
// each older page. A subscription's samples name it by its id (`sub`), which the machine's per-open log line names too.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, EventId, SessionId } from '@shared/graph/ids';
import { AgentMetaSchema, TranscriptRecordSchema } from '@shared/wire/transcript';
import type { Job, JsonObject, McpServer, SessionBodies, StatusRead, SubagentMeta, Usage } from 'desk-hub/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createBackfillContext, recordToEvents, type BackfillContext, type SubagentLookup } from '../../../../../src/engine-host/fs/backfill';
import type { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import { emptyGraph, type TaskGraph } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import type { TranscriptSource } from '../../../../../src/renderer/src/transcript/source/types';
import { ReadError, transcriptKey, type SessionPlane, type SessionTarget, type Subscription, type SubscriptionMessage } from '../../shell/session-plane';
import { noteModel } from '../../state/models';
import { taskGraphOf, withEvents, withMetas, withStatuses } from '../agents/task-feed';
import { OutputRequests } from '../jobs/output-requests';
import { StreamingLayer, type StreamBlock } from '../stream/layer';
import { deliveredLines, deliveryAsDrawn, deliveryFrame } from '../../conversation/delivery-frame';
import { framePattern } from '../../conversation/tail';
import { latency } from '../../latency/latency';
import { withAppendedTurn } from './appended-turn';
import { withAnswerLines } from './ask-answer';
import { isMirrorLine, steerAsDrawn } from './bridge-rows';
import { withWakeLine } from './bridge-wake';
import { normalizeInterruptRow, withInterruptEnd } from './interrupt';
import { drawingOf, drawingsDiffer, isResponse, NONE_OFF, ownerInput, undoneEvents, type Drawing } from './off-chain';

/** What the adapter reads of MAWS's transcript store: whether a row's events have been applied under a key. */
export type TranscriptStoreApi = Pick<ReturnType<typeof createTranscriptStore>, 'getState' | 'subscribe'>;

export type DepthTranscriptState = {
  /** The source MAWS's view attaches under `key`; a new one when the transcript is rebuilt (older rows, a new subscription). */
  source: TranscriptSource;
  /**
   * The held rows, oldest first, as `heldRows()` returns them: a new array whenever one is added or the set is
   * replaced (a snapshot, an older page), so a view that reads them follows them through its subscription.
   */
  held: readonly Row[];
  /**
   * `loading` until the first snapshot is in; `reconnecting` while a fresh one is awaited after an interruption (a
   * subscription the hub ended before its snapshot, `end {discontinuity}` at n 0, reaches here as one too) or, for a
   * transcript served before, after `resubscribe`; `ended` after any other `end`, with its reason. What was drawn stays
   * drawn through each of them.
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
   * The session's context use and cost (DX4 `usage`), a main-thread subscription's only: undefined until its first
   * snapshot, kept through a disruption until a fresh one says again, null when the session has no bridge or none has
   * come yet.
   */
  usage: Usage | null | undefined;
  /** The working tree's diff: null until asked for; `pending` while an answer is awaited, the last answer kept meanwhile. */
  diff: { pending: boolean; answer: SessionBodies['diff'] | null } | null;
  /**
   * The engine's status (`read status`), a main-thread subscription's only: null until asked for; `pending` while an
   * answer is awaited, the last answer kept meanwhile; `error` the read's refusal when the latest ask was refused.
   */
  status: { pending: boolean; answer: StatusRead | null; error: string | null } | null;
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
/** The row types the machine marks on or off the session's chain; it never marks another (a progress row). */
const CHAIN_TYPES: ReadonlySet<string> = new Set(['user', 'assistant', 'system', 'attachment']);
const hasUuid = (row: JsonObject): row is Row => typeof row.uuid === 'string' && row.uuid !== '';
/**
 * A snapshot's or a page's rows (newest first, as the plane sends them) oldest first, each uuid once: a row the message
 * carries twice is held at its oldest place, as a row that arrives live again is the one already held.
 */
function oldestFirst(rows: readonly JsonObject[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows.toReversed()) {
    if (!hasUuid(row) || seen.has(row.uuid)) continue;
    seen.add(row.uuid);
    out.push(row);
  }
  return out;
}
/** The model a response row was answered by; the engine's own rows (`<synthetic>`) name none. */
const modelOf = (row: JsonObject): string | null => {
  const model = row.type === 'assistant' ? (row.message as JsonObject | undefined)?.model : undefined;
  return typeof model === 'string' && model !== '' && model !== '<synthetic>' ? model : null;
};

/** Each tool call a response row makes, told to `latency.ts` with the row's time: the anchor of a request it raises. */
function noteCalls(row: JsonObject): void {
  if (row.type !== 'assistant') return;
  const content = (row.message as JsonObject | undefined)?.content;
  if (!Array.isArray(content)) return;
  for (const block of content as JsonObject[]) if (block?.type === 'tool_use' && typeof block.id === 'string') latency.noteCall(block.id, row.timestamp);
}

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
 * wake's line is no wake, and its drawn copy has lost the frame that says so. The ask mod's answer to an async question
 * is drawn as a line naming the answers where it reached the model, its idle prompt's turn one the session continued
 * (`ask-answer.ts`).
 */
function eventsOf(row: JsonObject, ctx: BackfillContext): SessionEvent[] {
  if (isMirrorLine(row)) return [];
  const mapped = steerAsDrawn(deliveryAsDrawn(normalizeInterruptRow(row)));
  const record = TranscriptRecordSchema.safeParse(mapped);
  if (!record.success) return [];
  let events = withAnswerLines(row, withWakeLine(row, withInterruptEnd(mapped, recordToEvents(record.data, ctx), ctx), ctx), ctx);
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
   * A row after the snapshot, under the snapshot's context; before it, the snapshot will hold the row. Its hop from its
   * engine timestamp until drawn (`latency.ts`) is timed once the store has applied its events: a row that draws nothing
   * (a progress row, a row off the chain) or reaches no store yet gives no sample.
   */
  live(row: Row): void {
    if (this.ctx === null) return;
    const events = this.owner.mapRow(row, this.ctx);
    if (events.length === 0 || this.listener === null) return;
    this.listener(events);
    latency.drawn('stream.row', Date.parse(String(row.timestamp)), true);
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
  private readonly layer = new StreamingLayer();
  private readonly snapshotted: Deferred = deferred();
  /** A snapshot has been served since the transcript opened: the held rows are a transcript's, and a later one is merged into them. */
  private held = false;
  /** The subscription open now has served its snapshot: what it is asked (an older page, the diff, an output) is answered. */
  private serving = false;
  private source: RowsSource;
  private offStore: (() => void) | null = null;
  /** A main thread's first rows on their way (`latency.ts`): when it subscribed, and when the snapshot came in. */
  private firstRows: { subscribed: number; snapshot: number | null } | null = null;
  /** When the disruption the next snapshot resumes from began (`latency.ts`'s resume gap). */
  private disruptedAt: number | null = null;
  /** When the older page on its way was asked for (`latency.ts`'s older page). */
  private olderAsked: number | null = null;
  /** The id of the subscription whose snapshot is held (`latency.ts` names its samples by it). */
  private sub: string | undefined = undefined;
  /** The asks of `read status` made so far: an answer is taken only for the latest. */
  private statusAsks = 0;
  /** The jobs view's open outputs, asked for on this subscription (a main-thread one's). */
  readonly outputs = new OutputRequests((taskId, tail) => {
    if (!this.serving || this.subscription === null) return false;
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
      held: this.rows,
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
      status: null,
      model: null,
    }));
  }

  open(): void {
    if (this.subscription) return;
    this.offStore ??= this.store.subscribe(() => {
      if (this.settleLanded()) this.publish();
      this.firstRowsDrawn();
    });
    if (!this.held && this.target.agentId === null) this.firstRows = { subscribed: performance.now(), snapshot: null };
    this.subscribe();
  }

  close(): void {
    this.subscription?.close();
    this.subscription = null;
    this.offStore?.();
    this.offStore = null;
    this.outputs.clear();
  }

  /** After an `end`: subscribe again; the fresh snapshot is merged into what is drawn, which stays drawn meanwhile. */
  resubscribe(): void {
    if (this.subscription || this.state.getState().phase !== 'ended') return;
    this.state.setState({ phase: this.held ? 'reconnecting' : 'loading' });
    this.subscribe();
  }

  /**
   * Asks for the page of rows before the oldest held one, when older rows exist and none is on its way. Not while the
   * subscription is down or its fresh snapshot is not in: the hub drops `rows` on a subscription it has not served, and
   * the pane asks again once the snapshot is in.
   */
  loadOlder(): void {
    const { more, loadingOlder } = this.state.getState();
    const oldest = this.rows[0];
    if (!more || loadingOlder || !this.serving || !this.subscription || !oldest) return;
    this.state.setState({ loadingOlder: true });
    this.olderAsked = performance.now();
    this.subscription.rows(oldest.uuid, this.page);
  }

  /**
   * Asks the session for its working tree's diff (a main-thread subscription's only): the answer arrives as a `diff`
   * message. While the subscription is down the request waits for the fresh snapshot.
   */
  requestDiff(): void {
    if (this.target.agentId !== null) return;
    this.state.setState((s) => ({ diff: { pending: true, answer: s.diff?.answer ?? null } }));
    if (this.serving) this.subscription?.diff();
  }

  /**
   * Reads the engine's status (a main-thread subscription's only), and again on each fresh subscription after this. While
   * the subscription is down the read waits for the fresh snapshot.
   */
  requestStatus(): void {
    if (this.target.agentId !== null) return;
    this.state.setState((s) => ({ status: { pending: true, answer: s.status?.answer ?? null, error: null } }));
    if (this.serving) this.readStatus();
  }

  private readStatus(): void {
    const subscription = this.subscription;
    if (subscription === null) return;
    const ask = ++this.statusAsks;
    this.state.setState((s) => ({ status: { pending: true, answer: s.status?.answer ?? null, error: null } }));
    subscription.read('status').then(
      (answer) => {
        if (ask === this.statusAsks) this.state.setState({ status: { pending: false, answer: answer as StatusRead, error: null } });
      },
      (error: unknown) => {
        // Cut by a disruption: the fresh subscription asks again.
        if (ask !== this.statusAsks || (error instanceof ReadError && error.code === 'interrupted')) return;
        this.state.setState((s) => ({ status: { pending: false, answer: s.status?.answer ?? null, error: error instanceof Error ? error.message : String(error) } }));
      },
    );
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
      message: (message) => (message.kind === 'snapshot' ? this.snapshot(message.body, message.sub) : this.receive(message)),
      interrupted: () => this.interrupted(),
      end: (body) => {
        this.subscription = null;
        this.serving = false;
        this.disruptedAt ??= performance.now();
        this.olderAsked = null;
        this.outputs.lost();
        this.state.setState({ phase: 'ended', ended: body, loadingOlder: false });
      },
    });
  }

  private snapshot(body: SessionBodies['snapshot'], sub: string): void {
    this.sub = sub;
    this.metas = body.subagents;
    this.subagents = subagentLookupOf(body.subagents);
    this.unresolved.clear();
    const fresh = oldestFirst(body.rows);
    let more = body.more;
    if (this.held) {
      // A snapshot after a disruption: merged into the held rows, or replacing them (the module's header says when).
      const merged = this.merged(fresh, body.offChain);
      if (merged !== null) more = this.state.getState().more;
      else this.off.clear();
      const before = new Set(this.uuids);
      this.mark(fresh, body.offChain);
      this.setRows(merged ?? fresh);
      // The newest row the snapshot brought lands once the rebuild below is installed; until then a block the snapshot
      // no longer streams stays drawn. A row a `block-row` named lands too when it is held now, and, where the snapshot
      // was merged, when it is not: the held rows ran up to the newest the old subscription delivered and the merge kept
      // them all, so a named row neither they nor the snapshot hold is newer than the snapshot's cut, and comes live.
      // After a replace it may be older than the snapshot's window instead, to come only with a page.
      const landing = this.rows.findLast((row) => !before.has(row.uuid))?.uuid ?? null;
      this.layer.resume(body.streaming, landing, (uuid) => merged !== null || this.uuids.has(uuid));
      this.rebuild();
    } else {
      this.off.clear();
      this.mark(fresh, body.offChain);
      this.setRows(fresh);
      this.retree();
      this.layer.load(body.streaming);
      if (this.firstRows !== null) {
        this.firstRows.snapshot = performance.now();
        latency.record('view.snapshot', this.firstRows.snapshot - this.firstRows.subscribed, sub);
        if (fresh.length === 0) this.firstRows = null; // nothing to draw: no first rows to time
      }
    }
    for (const row of fresh) noteCalls(row);
    if (this.held && this.disruptedAt !== null) {
      latency.record('resume.gap', performance.now() - this.disruptedAt, sub);
      latency.count('subscription.resumes');
    }
    this.disruptedAt = null;
    this.held = true;
    this.serving = true;
    this.snapshotted.resolve();
    this.state.setState({ phase: 'live', ended: null, more, loadingOlder: false, usage: this.target.agentId === null ? (body.usage ?? null) : undefined });
    this.setJobs(body);
    if (this.state.getState().diff?.pending) this.subscription?.diff(); // a request the disruption lost
    if (this.state.getState().status !== null) this.readStatus(); // once per subscription open, once the tab has asked
    this.outputs.resend(); // the outputs the disruption lost
    this.publish();
  }

  private receive(message: Exclude<SubscriptionMessage, { kind: 'snapshot' }>): void {
    switch (message.kind) {
      case 'row':
        return this.row(message.body);
      case 'chunk': {
        if (!this.layer.chunk(message.body)) return;
        this.publish();
        // The bridge's stamp, ms on the machine's clock (absent from an older producer).
        const { t } = message.body;
        if (message.body.agentId === this.target.agentId && typeof t === 'number' && Number.isFinite(t)) latency.drawn('stream.chunk', t, true);
        return;
      }
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
      this.rows = [...this.rows, row];
      const model = modelOf(row);
      if (model !== null && model !== this.state.getState().model) this.setModel(model);
      this.noteRow(row);
    }
    // What is drawn of the rows already mapped changes only with the marks, an owner input (it may repeat an undone one's
    // words), a delivery (a later copy of a held one), or, while an input draws as undone, a response (the session read
    // what it answers, and only an undone input can turn read): then the drawing is read again, and the transcript
    // rebuilt when it changed for any of them.
    const reads = this.drawing.undone.size > 0 && isResponse(row);
    if (marked || (fresh && (ownerInput(row) !== null || deliveryFrame(row) !== null || reads))) {
      const drawing = drawingOf(this.rows, this.off);
      const changed = drawingsDiffer(this.drawing, drawing, fresh ? row.uuid : null);
      this.drawing = drawing;
      if (changed && this.held) {
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
    if (resolved.length > 0 && this.held) this.rebuild();
    else this.setTree(withMetas(this.heldTasks, subagents));
  }

  /** The jobs and MCP names a snapshot or `subagents` message carries; a producer older than DC8 sends neither. */
  private setJobs({ jobs, mcp }: { jobs?: Job[]; mcp?: McpServer[] }): void {
    this.state.setState({ jobs: jobs ?? null, mcp: mcp ?? null });
    if (jobs !== undefined) this.outputs.jobs(jobs);
  }

  private older(body: SessionBodies['rows']): void {
    if (this.olderAsked !== null) latency.record('view.older-page', performance.now() - this.olderAsked, this.sub);
    this.olderAsked = null;
    const older = oldestFirst(body.rows).filter((row) => !this.uuids.has(row.uuid));
    // The rebuilt source first: whoever reads the page answered (loadingOlder false) reads the source that holds it.
    if (older.length > 0) {
      this.mark(older, body.offChain);
      this.setRows([...older, ...this.rows]);
      this.rebuild();
    }
    this.state.setState({ more: body.more, loadingOlder: false });
  }

  /**
   * The client lost the subscription and subscribes again: everything drawn stays as it is, and what needs the live
   * subscription waits for the fresh snapshot (an older page on its way is lost with it, and asked again after).
   */
  private interrupted(): void {
    this.serving = false;
    this.disruptedAt ??= performance.now();
    this.olderAsked = null;
    this.outputs.lost();
    this.state.setState({ phase: 'reconnecting', ended: null, loadingOlder: false });
  }

  /**
   * What a live row tells `latency.ts` as it is received: a tool call's time, for the request it may raise, and, for the
   * owner's own send delivered here, from its sending until its row was written. Its hop until drawn is the source's to
   * time (`RowsSource.live`), once its events are in the store.
   */
  private noteRow(row: Row): void {
    noteCalls(row);
    if (this.target.agentId !== null || deliveryFrame(row)?.own !== true) return;
    const lines = deliveredLines(row);
    latency.ownerRow((ref) => {
      const frame = framePattern({ ...ref, from: 'human' });
      return lines.some((line) => frame.test(line));
    }, row.timestamp);
  }

  /** A main thread's first rows are in the store: drawn at the next frame. */
  private firstRowsDrawn(): void {
    const first = this.firstRows;
    if (first === null || first.snapshot === null) return;
    const entry = this.store.getState().entries[this.key];
    if (entry?.phase !== 'live' || entry.rows.length === 0) return;
    this.firstRows = null;
    latency.drawn('view.drawn', first.snapshot, false, this.sub);
    latency.drawn('view.first-rows', first.subscribed, false, this.sub);
  }

  /**
   * The held rows with a fresh snapshot's (oldest first) merged in, or null when it replaces them: it overlaps nothing
   * held, or it marks a row both hold otherwise than the held marks do, or none of the rows both hold is one the chain
   * carries on it, or a row it brings was written under a row it does not hold.
   */
  private merged(fresh: readonly Row[], offChain: readonly string[] | undefined): Row[] | null {
    const at = fresh.length === 0 ? -1 : this.rows.findIndex((row) => row.uuid === fresh[0].uuid);
    if (at < 0) return null;
    const inSnapshot = new Set(fresh.map((row) => row.uuid));
    if (offChain !== undefined) {
      const off = new Set(offChain);
      const overlap = fresh.filter((row) => this.uuids.has(row.uuid));
      if (overlap.some((row) => this.off.has(row.uuid) !== off.has(row.uuid))) return null;
      // Agreeing marks vouch for the held rows older than the snapshot only through a row both hold on the chain: each of
      // those the held marks put on the chain is that row's ancestor, so on it still, and each they put off is no ancestor
      // of it, so off it still. A row the producer never marks (a progress row) vouches for nothing.
      if (!overlap.some((row) => CHAIN_TYPES.has(row.type as string) && !off.has(row.uuid))) return null;
      // That holds only while the chain has not forked before the snapshot's window. A row the gap wrote under a row the
      // snapshot does not hold is such a fork, its point outside the window whether held or older than every held row
      // (paged history can hold a call's appends and result without the call), and it can take held rows older than
      // the window off the chain while every row the window holds stays on (a second append under a tool call leaves
      // the first, while the call's result stays), so the overlap cannot vouch for them. A fork inside the window is the
      // snapshot's own marks to say. A row under no parent (a compaction's boundary) continues the chain; a tool result
      // written in the gap under a call outside the window is not told from a branch here, and costs only a staged
      // replace.
      const forked = (row: Row) => !this.uuids.has(row.uuid) && typeof row.parentUuid === 'string' && row.parentUuid !== '' && !inSnapshot.has(row.parentUuid);
      if (fresh.some(forked)) return null;
    }
    return [...this.rows.slice(0, at), ...fresh, ...this.rows.slice(at).filter((row) => !inSnapshot.has(row.uuid))];
  }

  /** The held rows under a new source: MAWS's store rebuilds the key from all of them, staged; the tree with them. */
  private rebuild(): void {
    this.source = new RowsSource(this);
    this.state.setState({ source: this.source, held: this.rows });
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
    this.state.setState({ streaming: this.layer.blocks(this.target.agentId), held: this.rows });
  }
}
