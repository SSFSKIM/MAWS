// One session's depth as the fake machine serves it: DX4's producer rules over a replayed timeline. It keeps what the
// bridge's endpoint keeps (each message still streaming, per block, with its watermark; the subagent tree; the last
// usage) and what the daemon reads from disk (each transcript's rows so far), and serves subscriptions from them:
//
// - subscribe before snapshot: a subscription takes the bridge's state and joins the live stream in one step, then
//   reads its rows (a wait in which the replay may go on: `duringSnapshot`), sends the snapshot, and then what arrived
//   meanwhile, dropping rows the snapshot holds (by uuid) and chunks at or below their message's watermark;
// - a block leaves the snapshot state when its `block-row` is applied, and its whole message at its step's end (DX5's
//   child does the same), so an aborted block reaches no later subscriber;
// - `step-end` follows every `block-row` of its step, since the timeline keeps the bridge's order; a step still open
//   when its turn ends gets one then;
// - a main-scope subscription carries every agent's chunks, `block-row`s, and `step-end`s, the tree, and `usage`, and
//   its own transcript's rows; an agent-scope one carries that agent's alone.
import type { JsonObject } from '../src/protocol/json';
import type { SessionBodies, SessionMessage, Streaming, StreamingBlock, SubagentMeta, SubscriptionKind, Usage } from '../src/protocol/session';
import type { Recording, Row, Step } from './recording';

type Live = {
  turnId: string;
  agentId: string | null;
  step: number;
  model?: string;
  upTo: number;
  blocks: Map<number, StreamingBlock>;
  settled: Set<number>;
  /** The last chunk applied, kept to replay an overlap (`overlap`). */
  last: SessionBodies['chunk'] | null;
};

type Out = { [K in SubscriptionKind]: { kind: K; body: SessionBodies[K] } }[SubscriptionKind];

type Sub = {
  agentId: string | null;
  n: number;
  ready: boolean;
  queue: Out[];
  /** Rows the snapshot held, and each streaming message's watermark in it: what the live part drops. */
  held: Set<string>;
  marks: Map<string, number>;
};

export type SnapshotOptions = {
  /** Runs while the snapshot is being built, after the subscription joined the live stream and before its rows are
   * read: what happens here (the replay going on) reaches the subscriber after the snapshot, never inside it twice. */
  duringSnapshot?: () => Promise<void>;
  /** Also hands the live part what the snapshot already holds — its newest row, and each streaming message's last
   * chunk — as a transcript tail that started before the read would: the watermark and the row ids must drop them. */
  overlap?: boolean;
  /** About how many bytes of rows the snapshot carries (SNAPSHOT_ROW_BUDGET by default); older rows come as pages. */
  budget?: number;
};

const BLOCK_KINDS: Record<string, StreamingBlock['kind']> = { text: 'text', thinking: 'thinking', redacted_thinking: 'thinking', tool: 'tool', input: 'tool' };

const keyOf = (m: { turnId: string; agentId: string | null; step: number }) => `${m.turnId}\u0000${m.agentId ?? ''}\u0000${m.step}`;

/** About as much as one snapshot carries of rows, in bytes of JSON: older rows come as `rows` pages. */
export const SNAPSHOT_ROW_BUDGET = 256 * 1024;

export class SessionDepth {
  /** Rows on disk so far, per transcript (`main` and each agent), oldest first. */
  readonly rows = new Map<string, Row[]>();
  private readonly live = new Map<string, Live>();
  private readonly ended = new Set<string>();
  private readonly tree = new Map<string, JsonObject>();
  private readonly subs = new Map<string, Sub>();
  usage: Usage | null = null;
  presence: JsonObject | null = { status: 'idle', waitingFor: null, needs: null };
  /** The main loop's turn running now, or null. */
  mainTurn: string | null = null;

  constructor(
    readonly id: string,
    private readonly recording: Recording | null,
    private readonly send: (message: SessionMessage) => void,
    private readonly where: { project: string; machine: string },
    readonly bridge = true,
  ) {
    this.rows.set('main', []);
  }

  get cwd(): string | null {
    return this.recording?.cwd ?? null;
  }

  get diffText(): string {
    return this.recording?.diff ?? '';
  }

  /** The session's subagent tree: each started subagent's `meta.json`. */
  subagents(): SubagentMeta[] {
    return [...this.tree].map(([agentId, meta]) => ({ agentId, meta }));
  }

  hasAgent(agentId: string): boolean {
    return this.tree.has(agentId) || this.rows.has(agentId);
  }

  /** Applies one step of the timeline: the bridge's state changes, and every subscriber it reaches hears of it. */
  apply(step: Step): void {
    switch (step.k) {
      case 'turn-start':
        if (step.agentId === null) this.mainTurn = step.turnId;
        return;
      case 'step-start': {
        const key = keyOf(step);
        this.ended.delete(key);
        this.live.set(key, { turnId: step.turnId, agentId: step.agentId, step: step.step, ...(step.model && { model: step.model }), upTo: -1, blocks: new Map(), settled: new Set(), last: null });
        return;
      }
      case 'chunk': {
        const body: SessionBodies['chunk'] = { turnId: step.turnId, agentId: step.agentId, step: step.step, chunkIndex: step.chunkIndex, chunk: step.chunk };
        this.fold(body);
        this.fanOut(step.agentId, { kind: 'chunk', body }, true);
        return;
      }
      case 'block-row': {
        const m = this.live.get(keyOf(step.body));
        if (m) {
          m.blocks.delete(step.body.index);
          m.settled.add(step.body.index);
        }
        this.fanOut(step.body.agentId, { kind: 'block-row', body: step.body }, true);
        return;
      }
      case 'step-end':
        this.endStep(step.body.turnId, step.body.agentId, step.body.step);
        return;
      case 'turn-end':
        for (const m of [...this.live.values()]) if (m.turnId === step.turnId && m.agentId === step.agentId) this.endStep(m.turnId, m.agentId, m.step);
        if (step.agentId === null && this.mainTurn === step.turnId) this.mainTurn = null;
        return;
      case 'row':
        this.appendRow(step.agentId, step.row);
        return;
      case 'agent': {
        this.tree.set(step.agentId, this.recording?.meta[step.agentId] ?? { agentType: 'general-purpose' });
        if (!this.rows.has(step.agentId)) this.rows.set(step.agentId, []);
        this.fanOut(null, { kind: 'subagents', body: { subagents: this.subagents() } }, false);
        return;
      }
      case 'usage':
        this.usage = step.body;
        this.fanOut(null, { kind: 'usage', body: step.body }, false);
        return;
      default:
        return;
    }
  }

  /** A row reaches the disk: its transcript's subscribers receive it. */
  appendRow(agentId: string | null, row: Row): void {
    const key = agentId ?? 'main';
    let list = this.rows.get(key);
    if (!list) this.rows.set(key, (list = []));
    if (list.some((r) => r.uuid === row.uuid)) return;
    list.push(row);
    for (const [sub, s] of this.subs) if (s.agentId === agentId) this.deliver(sub, s, { kind: 'row', body: { row, agentId } });
  }

  /** Folds a chunk into its block, as DX5's child does: a chunk that does not follow its message's watermark (one was
   * lost) takes the message out, and a chunk of a settled block, or of an ended step, changes nothing. */
  private fold(body: SessionBodies['chunk']): void {
    const key = keyOf(body);
    if (this.ended.has(key)) return;
    let m = this.live.get(key);
    if (!m && body.chunkIndex === 0) {
      m = { turnId: body.turnId, agentId: body.agentId, step: body.step, upTo: -1, blocks: new Map(), settled: new Set(), last: null };
      this.live.set(key, m);
    }
    if (!m) return;
    if (body.chunkIndex !== m.upTo + 1) {
      this.live.delete(key);
      return;
    }
    m.upTo = body.chunkIndex;
    m.last = body;
    const chunk = body.chunk;
    const index = chunk.index;
    const kind = BLOCK_KINDS[String(chunk.kind)];
    if (typeof index !== 'number' || !kind || m.settled.has(index)) return;
    let block = m.blocks.get(index);
    if (!block) m.blocks.set(index, (block = { index, kind, text: '', upTo: -1 }));
    if (chunk.kind === 'tool') {
      if (typeof chunk.id === 'string') block.id = chunk.id;
      if (typeof chunk.name === 'string') block.name = chunk.name;
    } else if (chunk.kind === 'input') block.text += String(chunk.json ?? '');
    else block.text += String(chunk.text ?? '');
    block.upTo = body.chunkIndex;
  }

  private endStep(turnId: string, agentId: string | null, step: number): void {
    const key = keyOf({ turnId, agentId, step });
    this.live.delete(key);
    this.ended.add(key);
    this.fanOut(agentId, { kind: 'step-end', body: { turnId, agentId, step } }, true);
  }

  /** To the main-scope subscriptions (each agent's stream when `everyAgent`, else only the main loop's) and to the
   * subscription of the agent it belongs to. */
  private fanOut(agentId: string | null, out: Out, everyAgent: boolean): void {
    // Without the bridge a session's depth is its rows alone (§5): no stream, no usage.
    if (!this.bridge && out.kind !== 'subagents') return;
    for (const [sub, s] of this.subs) {
      if (s.agentId === null ? everyAgent || agentId === null : s.agentId === agentId) this.deliver(sub, s, out);
    }
  }

  private deliver(sub: string, s: Sub, out: Out): void {
    if (!s.ready) {
      s.queue.push(out);
      return;
    }
    if (out.kind === 'row' && s.held.has(out.body.row.uuid as string)) return;
    if (out.kind === 'chunk' && out.body.chunkIndex <= (s.marks.get(keyOf(out.body)) ?? -1)) return;
    this.emit(sub, s, out);
  }

  private emit(sub: string, s: Sub, out: Out): void {
    this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: out.kind, sub, n: s.n++, body: out.body } as SessionMessage);
  }

  /** The bridge's snapshot entries for a scope: copies, blocks in index order. */
  private streaming(agentId: string | null): Streaming[] {
    return [...this.live.values()]
      .filter((m) => agentId === null || m.agentId === agentId)
      .map((m) => ({
        turnId: m.turnId,
        agentId: m.agentId,
        step: m.step,
        ...(m.model && { model: m.model }),
        upTo: m.upTo,
        blocks: [...m.blocks.values()].sort((a, b) => a.index - b.index).map((b) => ({ ...b })),
      }));
  }

  /** Serves a subscription: the snapshot (n 0), then the live part, under DX4's rules. */
  async subscribe(sub: string, agentId: string | null, options: SnapshotOptions = {}): Promise<void> {
    if (this.subs.has(sub)) return;
    if (agentId !== null && !this.hasAgent(agentId)) {
      this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: 'end', sub, n: 0, body: { reason: 'error', message: `no subagent ${agentId} in this session` } });
      return;
    }
    // One step: the bridge's state (its streaming messages and each loop's cut) and the subscriber joining the stream.
    const streaming = this.bridge ? this.streaming(agentId) : [];
    const scope = this.rows.get(agentId ?? 'main') ?? [];
    const cut = scope.length;
    const s: Sub = { agentId, n: 1, ready: false, queue: [], held: new Set(), marks: new Map() };
    this.subs.set(sub, s);
    if (options.overlap) {
      const newest = scope[cut - 1];
      if (newest) s.queue.push({ kind: 'row', body: { row: newest, agentId } });
      for (const m of this.live.values()) if ((agentId === null || m.agentId === agentId) && m.last) s.queue.push({ kind: 'chunk', body: m.last });
    }
    await options.duringSnapshot?.();
    await Promise.resolve();
    if (this.subs.get(sub) !== s) return;
    // The rows, read up to the cut taken with the state: newest first, as many as the budget holds.
    const rows: Row[] = [];
    let bytes = 0;
    for (let i = cut - 1; i >= 0; i--) {
      bytes += JSON.stringify(scope[i]).length;
      if (rows.length && bytes > (options.budget ?? SNAPSHOT_ROW_BUDGET)) break;
      rows.push(scope[i]);
    }
    for (const r of scope.slice(0, cut)) s.held.add(r.uuid);
    for (const m of streaming) s.marks.set(keyOf(m), m.upTo);
    const body: SessionBodies['snapshot'] = {
      rows,
      more: rows.length < cut,
      subagents: agentId === null ? this.subagents() : [],
      presence: { record: this.presence, bridge: this.bridge },
      streaming,
      ...(agentId === null && { usage: this.bridge ? this.usage : null }),
    };
    this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: 'snapshot', sub, n: 0, body });
    s.ready = true;
    for (const out of s.queue.splice(0)) this.deliver(sub, s, out);
  }

  /** Ends a subscription with `reason`, at the next `n` (0 before its snapshot). */
  end(sub: string, reason: SessionBodies['end']['reason'], message?: string): void {
    const s = this.subs.get(sub);
    if (!s) return;
    this.subs.delete(sub);
    const n = s.ready ? s.n : 0;
    this.send({ project: this.where.project, machine: this.where.machine, session: this.id, kind: 'end', sub, n, body: { reason, ...(message && { message }) } });
  }

  /** Forgets every subscription without a word: the connection they ran on is gone. */
  forgetAll(): void {
    this.subs.clear();
  }

  holds(sub: string): boolean {
    return this.subs.has(sub);
  }

  openSubs(): string[] {
    return [...this.subs.keys()];
  }

  /** Older rows of the subscription's transcript, before row `before`, newest first. */
  page(sub: string, before: string, limit: number): void {
    const s = this.subs.get(sub);
    if (!s) return;
    const scope = this.rows.get(s.agentId ?? 'main') ?? [];
    const at = scope.findIndex((r) => r.uuid === before);
    const older = at < 0 ? [] : scope.slice(0, at);
    const rows = older.slice(-limit).reverse();
    this.deliver(sub, s, { kind: 'rows', body: { rows, before, more: older.length > rows.length } });
  }

  /** The working tree's diff, on a main-scope subscription. */
  diff(sub: string): void {
    const s = this.subs.get(sub);
    if (!s || s.agentId !== null) return;
    this.deliver(sub, s, { kind: 'diff', body: { base: 'main', text: this.diffText } });
  }
}
