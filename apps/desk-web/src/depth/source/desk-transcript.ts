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
// The stream. Chunks never reach MAWS's reducer, which pairs a streaming block with its row only by an API message id
// that DX4's chunks lack: they go to the streaming layer (`stream/layer.ts`), and a block's text is dropped from it
// once the row its `block-row` named is in the store (applied, not just received: a staged rebuild may still be
// installing), so its partial text and its row are never drawn together and nothing streamed goes missing between.
// A step's `step-end` drops its blocks no `block-row` named: an aborted response's partial text goes with its request.
//
// Disruptions (DX8). A `reset` (a gap, a dropped socket, a hub restart, the bridge's own discontinuity) drops what was
// drawn: the layer is cleared, the source resets MAWS's store key, and its next snapshot waits for the fresh one the
// client subscribes for. Any other `end` keeps what was drawn and says why; `resubscribe` takes a fresh snapshot,
// which continues the held rows when it overlaps them and replaces them when it does not.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, EventId, SessionId } from '@shared/graph/ids';
import { AgentMetaSchema, TranscriptRecordSchema } from '@shared/wire/transcript';
import type { JsonObject, SessionBodies, SubagentMeta } from 'desk-hub/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createBackfillContext, recordToEvents, type BackfillContext, type SubagentLookup } from '../../../../../src/engine-host/fs/backfill';
import type { createTranscriptStore } from '../../../../../src/renderer/src/stores/transcript';
import type { TranscriptSource } from '../../../../../src/renderer/src/transcript/source/types';
import { transcriptKey, type SessionPlane, type SessionTarget, type Subscription } from '../../shell/session-plane';
import { StreamingLayer, type StreamBlock } from '../stream/layer';
import type { DepthMessage } from '../stream/step-end';

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

/** One row's X1 events under a backfill context; a row that is not a transcript record yields none. */
function eventsOf(row: JsonObject, ctx: BackfillContext): SessionEvent[] {
  const record = TranscriptRecordSchema.safeParse(row);
  return record.success ? recordToEvents(record.data, ctx) : [];
}

const contextFor = (target: SessionTarget, subagents: SubagentLookup): BackfillContext =>
  createBackfillContext({ sessionId: target.session as SessionId, agent: target.agentId === null ? null : { agentId: target.agentId as AgentId, parentToolUseId: null }, subagents });

/** A source over a fixed list of rows, oldest first, as a fresh load of them draws: the suites' reference. */
export function freshSource(rows: readonly JsonObject[], session: string, subagents: SubagentLookup): TranscriptSource {
  return {
    subscribe: () => () => {},
    snapshot: async () => {
      const ctx = contextFor({ machine: '', session, agentId: null }, subagents);
      return rows.flatMap((row) => eventsOf(row, ctx));
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
  private readonly store: TranscriptStoreApi;
  private readonly page: number;
  private subscription: Subscription | null = null;
  private rows: Row[] = [];
  private readonly uuids = new Set<string>();
  /** Held rows whose mapping gave no event under the row's own uuid: in the store as soon as they are mapped. */
  private readonly silent = new Set<string>();
  private subagents: SubagentLookup = subagentLookupOf([]);
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

  constructor(options: DeskTranscriptOptions) {
    this.plane = options.plane;
    this.store = options.store;
    this.target = options.target;
    this.page = options.page ?? PAGE;
    this.key = transcriptKey(options.project, options.target);
    this.source = new RowsSource(this);
    this.state = createStore<DepthTranscriptState>(() => ({ source: this.source, phase: 'loading', ended: null, streaming: [], more: false, loadingOlder: false }));
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
  }

  /** After an `end` other than a reset: subscribe again; the fresh snapshot takes up from what is drawn. */
  resubscribe(): void {
    if (this.subscription || this.state.getState().phase !== 'ended') return;
    this.state.setState({ phase: 'loading' });
    this.subscribe();
  }

  /** Asks for the page of rows before the oldest held one, when older rows exist and none is on its way. */
  loadOlder(): void {
    const { more, loadingOlder } = this.state.getState();
    const oldest = this.rows[0];
    if (!more || loadingOlder || !this.subscription || !oldest) return;
    this.state.setState({ loadingOlder: true });
    this.subscription.rows(oldest.uuid, this.page);
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
    const events = eventsOf(row, ctx);
    if (!events.some((event) => event.id === row.uuid)) this.silent.add(row.uuid);
    return events;
  }

  // The subscription.

  private subscribe(): void {
    this.subscription = this.plane.subscribe(this.target, {
      message: (delivered) => {
        const message = delivered as DepthMessage; // `step-end` too, until DX8's type carries it (`stream/step-end.ts`)
        return message.kind === 'snapshot' ? this.snapshot(message.body) : this.receive(message);
      },
      reset: () => this.reset(),
      end: (body) => {
        this.subscription = null;
        this.state.setState({ phase: 'ended', ended: body, loadingOlder: false });
      },
    });
  }

  private snapshot(body: SessionBodies['snapshot']): void {
    this.subagents = subagentLookupOf(body.subagents);
    this.unresolved.clear();
    const fresh = [...body.rows].reverse().filter(hasUuid);
    let more = body.more;
    if (this.served) {
      // A snapshot after an end: it continues the held rows where it overlaps them, else it replaces them.
      const at = fresh.length > 0 ? this.rows.findIndex((row) => row.uuid === fresh[0].uuid) : -1;
      if (at >= 0) more = this.state.getState().more;
      this.setRows(at >= 0 ? [...this.rows.slice(0, at), ...fresh] : fresh);
      this.rebuild();
    } else this.setRows(fresh);
    this.layer.load(body.streaming);
    this.served = true;
    this.snapshotted.resolve();
    this.state.setState({ phase: 'live', ended: null, more, loadingOlder: false });
    this.publish();
  }

  private receive(message: Exclude<DepthMessage, { kind: 'snapshot' }>): void {
    switch (message.kind) {
      case 'row':
        return this.row(message.body.row);
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
        return this.metadata(message.body.subagents);
      default:
        return; // `diff` and `usage` are the diff view's and session info's (M3)
    }
  }

  private row(row: JsonObject): void {
    if (!hasUuid(row) || this.uuids.has(row.uuid)) return;
    this.uuids.add(row.uuid);
    this.rows.push(row);
    this.source.live(row);
    this.publish();
  }

  private metadata(subagents: readonly SubagentMeta[]): void {
    this.subagents = subagentLookupOf(subagents);
    const resolved = [...this.unresolved].filter((toolUseId) => this.subagents.byToolUseId(toolUseId) !== null);
    if (resolved.length === 0) return;
    for (const toolUseId of resolved) this.unresolved.delete(toolUseId);
    if (this.served) this.rebuild();
  }

  private older(body: SessionBodies['rows']): void {
    const older = [...body.rows].reverse().filter((row): row is Row => hasUuid(row) && !this.uuids.has(row.uuid));
    this.state.setState({ more: body.more, loadingOlder: false });
    if (older.length === 0) return;
    this.setRows([...older, ...this.rows]);
    this.rebuild();
  }

  private reset(): void {
    this.setRows([]);
    this.layer.clear();
    this.served = false;
    this.snapshotted = deferred();
    this.unresolved.clear();
    this.state.setState({ phase: 'reconnecting', ended: null, more: false, loadingOlder: false, streaming: [] });
    this.source.reset();
    for (const listener of [...this.resets]) listener(); // MAWS's store empties the key and hydrates it again
  }

  /** The held rows under a new source: MAWS's store rebuilds the key from all of them, staged. */
  private rebuild(): void {
    this.source = new RowsSource(this);
    this.state.setState({ source: this.source });
  }

  private setRows(rows: Row[]): void {
    this.rows = rows;
    this.uuids.clear();
    this.silent.clear();
    for (const row of rows) this.uuids.add(row.uuid);
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
