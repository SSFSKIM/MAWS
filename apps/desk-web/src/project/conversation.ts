// The conversation's live state for one open project, beside its log: the requests (permission prompts and questions)
// the hub reports, with their settlements; each event's delivery per recipient; the RPCs this tab issued and the state
// the hub reports for each; the web `human`s on their way to the log; each session's latest compaction; the op each
// command this tab sent started, its outcome reported under the RPC's nonce (the desk control surface's M0). Requests,
// settlements, and deliveries carry codes (DX1, DX4) and are drawn only once they verify under the org key; one that
// fails is kept out and reported. Every verdict holds only under the key it was reached with.
//
// A request is known by what the hub keys it by — its machine, its session, and its id — since an id is minted per
// bridge (a synthetic `request-…`) and two sessions may raise the same one. A request raised live is timed until the
// pass that draws it (`latency/latency.ts`), from its arrival and from its call's row when a transcript holds it.
//
// A request may be raised again under its id after its settlement (a resumed session's bridge raises its still-open
// ask under its call's id, which the first process's end settled): it is pending again until a settlement of that
// raise. The order of a raise and a settlement is the socket's, as the hub sends them (DX3): a settlement comes before
// the pending set without its request, so a pending set that holds a request was sent after every settlement of it this
// tab took; and a decision the hub replays after `caught-up` was recorded before the connection's own pending set, or
// was sent to this socket live after its `settled` (MAWS #71).
import { createStore, type StoreApi } from 'zustand/vanilla';
import { verify, type Decision, type Delivery, type OpBody, type OrgKey, type PendingRequest, type Raised, type Recipient, type Rpc, type RpcOutcome, type SessionBodies, type Settled } from 'desk-hub/protocol';
import { latency } from '../latency/latency';
import { pendingCommands } from '../state/pending-commands';

export type CompactBody = SessionBodies['compact'];

/**
 * An async op receipt (the desk control surface spec, §3), by its RPC's nonce: its latest phase and the
 * body of the `op` message that carried it (a command's `end` holds `settled` and `readback`). A replay may belong
 * to another browser; pending-commands supplies this browser's ownership, not this map.
 */
export type OpEntry = { op: OpBody['op']; phase: OpBody['phase']; session: string; body: OpBody };

export type RequestRef = { machine: string; session: string; request: string };

/** A request's key in `requests` (and an RPC's `request`): the hub's identity for it, (machine, session, request). */
export const requestKey = (r: RequestRef): string => JSON.stringify([r.machine, r.session, r.request]);

export type RequestRecord = {
  /** Its key in `requests`: `requestKey` of its machine, session, and id. */
  key: string;
  /** Its id, as the bridge raised it; opaque. */
  request: string;
  machine: string;
  raised: Raised;
  /** The offset of the last log entry the browser held when it first saw the request: where the stream places it. */
  at: number;
  /** In the hub's pending set now, and not settled since. */
  pending: boolean;
  /** The hub's `terminal_only`: only the terminal can answer it. */
  terminalOnly: boolean;
  /** Its verified settlement, once one came: the latest, unless the request was raised again since. */
  settled: Settled | null;
};

/** `not-connected`: refused in the browser, the project socket being down; nothing was sent. */
export type RpcEntryState = 'sending' | RpcOutcome['state'] | 'forwarded' | 'uncertain' | 'not-connected';
/**
 * `request`: the key of the request an answer or a decision is on; dropped once a raise again after the request's
 * settlement starts it over (the RPC was on the raise that settlement ended).
 */
export type RpcEntry = { nonce: string; rpc: Rpc; state: RpcEntryState; outcome?: RpcOutcome; request?: string };

export type OutboxItem = { nonce: string; to: '*' | Recipient[]; text: string; wake: boolean; state: 'sending' | 'refused'; reason?: string };

/**
 * What failed verification, by the machine that sent it when the hub said (it does not for `deliveries` on connect);
 * a request or a settlement also by its session, `id` being the request's id.
 */
export type Unverified = { what: 'request' | 'settlement' | 'delivery'; machine: string | null; session?: string; id: string };

export type ConversationState = {
  /** By `requestKey`. */
  requests: Record<string, RequestRecord>;
  /** The latest verified delivery per event (`<writer>:<seq>`) and recipient session. */
  deliveries: Record<string, Record<string, Delivery>>;
  rpcs: Record<string, RpcEntry>;
  outbox: Record<string, OutboxItem>;
  compactions: Record<string, CompactBody>;
  /**
   * The hub's op receipts, by nonce (`OpEntry`). Unlike a compaction they are kept through a reconnect:
   * the hub replays bounded command receipts on join, so an end missed while the socket was down
   * may still come; one that does not leaves its command drawn as queued.
   */
  ops: Record<string, OpEntry>;
  /** What failed verification and is not drawn. */
  unverified: Unverified[];
  /**
   * The pending set this connection received has been checked under the current key and what it holds is in
   * `requests`: until then a request missing from them may only not be checked yet (a landing reads "Checking").
   * False again on a reconnect (`restart`), a new pending set, and a key change.
   */
  checked: boolean;
};

export const deliveryKey = (event: { writer: string; seq: number }) => `${event.writer}:${event.seq}`;

/** A request seen: where it was first seen, and every distinct content raised under it, oldest first. */
type Seen = { machine: string; at: number; payloads: Raised[] };

/** One payload once: a republished request is the same content under the same code. */
const sameRaised = (a: Raised, b: Raised) => a === b || JSON.stringify(a) === JSON.stringify(b);

export class Conversation {
  readonly store: StoreApi<ConversationState> = createStore<ConversationState>(() => ({ requests: {}, deliveries: {}, rpcs: {}, outbox: {}, compactions: {}, ops: {}, unverified: [], checked: false }));
  /** Whether this connection has had the hub's pending set yet (it comes on every connect, DX3). */
  private pendingReceived = false;
  private key: OrgKey | null = null;
  /** The recomputation under way, if any: one at a time, and one more after it when anything changed meanwhile. */
  private computing: Promise<void> | null = null;
  private again = false;
  private verdicts = new WeakMap<object, boolean>();
  /** Every request seen, by key (its content stays drawable after it leaves the set). */
  private readonly seen = new Map<string, Seen>();
  private pending: PendingRequest[] = [];
  private readonly settlements = new Map<string, { machine: string; session: string; settled: Settled }>();
  private readonly deliveries = new Map<string, { machine: string | null; delivery: Delivery }>();
  /**
   * Requests raised live and not drawn yet (`latency.ts`): when each came in, and its call's tool-use id, by key; timed
   * once a pass draws it.
   */
  private readonly raisedIn = new Map<string, { at: number; call: string }>();

  constructor(
    private readonly project: string,
    /** Where a request first seen now belongs in the stream. */
    private readonly position: () => number,
  ) {}

  /** Ownership outlives a composer and a killed page; the hub remains the authority for the eventual result. */
  rememberCommand(nonce: string, machine: string, session: string, name: string, outlives?: string): void {
    pendingCommands.remember({ project: this.project, nonce, machine, session, name, ...(outlives && { outlives }) });
  }

  setKey(key: OrgKey | null): void {
    if (key === this.key) return;
    this.key = key;
    this.store.setState({ checked: false });
    this.verdicts = new WeakMap();
    this.recompute();
  }

  // From the hub.

  /**
   * A new connection: its pending set is still to come, and a compaction under way is forgotten — the hub replays none,
   * so its end may have passed while the socket was down.
   */
  restart(): void {
    this.pendingReceived = false;
    this.store.setState({ checked: false, compactions: {} });
  }

  /**
   * The hub's log was replaced (a hub started afresh): nothing it reported belongs to the new one. Requests,
   * settlements, deliveries, and what failed verification are dropped; this tab's own RPCs and sends stay, since the
   * client still holds them.
   */
  reset(): void {
    this.seen.clear();
    this.raisedIn.clear();
    this.settlements.clear();
    this.deliveries.clear();
    this.pending = [];
    this.pendingReceived = false;
    this.store.setState({ requests: {}, deliveries: {}, unverified: [], compactions: {}, checked: false });
    this.recompute();
  }

  pendingSet(requests: PendingRequest[]): void {
    this.pendingReceived = true;
    this.store.setState({ checked: false });
    this.pending = requests;
    for (const { machine, raised } of requests) {
      this.see(machine, raised);
      this.raisedAfter(requestKey({ machine, session: raised.session, request: raised.request }));
    }
    this.recompute();
  }

  raised(machine: string, raised: Raised): void {
    const key = requestKey({ machine, session: raised.session, request: raised.request });
    if (!this.raisedIn.has(key) && !this.store.getState().requests[key]) this.raisedIn.set(key, { at: performance.now(), call: raised.toolUseId ?? raised.request });
    while (this.raisedIn.size > 64) this.raisedIn.delete(this.raisedIn.keys().next().value!);
    this.see(machine, raised);
    this.raisedAfter(key);
    this.recompute();
  }

  settled(machine: string, session: string, settled: Settled): void {
    this.settlements.set(requestKey({ machine, session, request: settled.request }), { machine, session, settled });
    this.recompute();
  }

  /**
   * A decision from the project's audit record (DX3 `decided`): the `raised` it settled (verbatim, or null when the hub
   * no longer held it) is seen as any request is — at `at` when this tab never saw it — and its `settled` taken as the
   * request's settlement. Both are verified before anything of them is drawn. So a card settled before the tab
   * connected (a reload, another device) is drawn settled. A decision on a request the hub holds pending is passed over:
   * it settled an earlier raise under the request's id, or it is the `settled` this tab has just taken live.
   */
  decided(decision: Decision, at: number): void {
    const key = requestKey({ machine: decision.machine, session: decision.session, request: decision.settled.request });
    if (this.pending.some((p) => requestKey({ machine: p.machine, session: p.raised.session, request: p.raised.request }) === key)) return;
    if (decision.raised) this.see(decision.machine, decision.raised, at);
    this.settlements.set(key, { machine: decision.machine, session: decision.session, settled: decision.settled });
    this.recompute();
  }

  delivery(machine: string | null, delivery: Delivery): void {
    this.deliveries.set(`${deliveryKey(delivery.event)}|${delivery.session}`, { machine, delivery });
    this.recompute();
  }

  compact(session: string, body: CompactBody): void {
    this.store.setState((s) => ({ compactions: { ...s.compactions, [session]: body } }));
  }

  /**
   * An op's start or end (DX4 `op`), kept by its RPC's nonce — an op with no nonce (the CLI's) is passed over — its end
   * never replaced by a start the daemon sends again.
   */
  op(session: string, body: OpBody): void {
    const nonce = body.rpc;
    if (typeof nonce !== 'string') return;
    const known = this.store.getState().ops[nonce];
    if (known?.phase === 'end' && body.phase !== 'end') return;
    this.store.setState((s) => ({ ops: { ...s.ops, [nonce]: { op: body.op, phase: body.phase, session, body } } }));
    if (body.phase === 'end' && known?.phase !== 'end') latency.commandEnded(nonce);
  }

  rpcState(nonce: string, state: 'forwarded' | 'done' | 'failed' | 'uncertain', outcome?: RpcOutcome): void {
    const entry = this.store.getState().rpcs[nonce];
    if (entry?.rpc.rpc === 'command' && state === 'done') latency.commandQueued(nonce);
    this.store.setState((s) => {
      const entry = s.rpcs[nonce];
      return entry ? { rpcs: { ...s.rpcs, [nonce]: { ...entry, state, ...(outcome && { outcome }) } } } : s;
    });
  }

  // From this tab.

  /** `request`: the key of the request an answer or a decision is on. */
  rpcSent(rpc: Rpc, request?: string): void {
    this.store.setState((s) => ({ rpcs: { ...s.rpcs, [rpc.nonce]: { nonce: rpc.nonce, rpc, state: 'sending', ...(request && { request }) } } }));
  }

  /** The RPC was refused in the browser: the project socket was down, so nothing was sent. */
  rpcNotConnected(nonce: string): void {
    this.store.setState((s) => (s.rpcs[nonce] ? { rpcs: { ...s.rpcs, [nonce]: { ...s.rpcs[nonce], state: 'not-connected' } } } : s));
  }

  retrying(nonce: string): void {
    this.store.setState((s) => (s.rpcs[nonce] ? { rpcs: { ...s.rpcs, [nonce]: { ...s.rpcs[nonce], state: 'sending', outcome: undefined } } } : s));
  }

  outboxAdd(item: OutboxItem): void {
    this.store.setState((s) => ({ outbox: { ...s.outbox, [item.nonce]: item } }));
  }

  outboxStored(nonce: string): void {
    this.store.setState((s) => {
      if (!(nonce in s.outbox)) return s;
      const outbox = { ...s.outbox };
      delete outbox[nonce];
      return { outbox };
    });
  }

  outboxRefused(nonce: string, reason: string): void {
    this.store.setState((s) => (s.outbox[nonce] ? { outbox: { ...s.outbox, [nonce]: { ...s.outbox[nonce], state: 'refused', reason } } } : s));
  }

  // Internals.

  /** A request id names one request of its session; a later raise under it with other content is its newest content. */
  private see(machine: string, raised: Raised, at?: number): void {
    const key = requestKey({ machine, session: raised.session, request: raised.request });
    const known = this.seen.get(key);
    if (!known) {
      this.seen.set(key, { machine, at: at ?? this.position(), payloads: [raised] });
      return;
    }
    // The same content again (a republished pending set) keeps its object, and so its verdict, and becomes the newest.
    const same = known.payloads.find((p) => sameRaised(p, raised));
    known.payloads = [...known.payloads.filter((p) => p !== same), same ?? raised];
  }

  /**
   * A request raised, live or in a pending set: a settlement this tab holds for it settled an earlier raise under its
   * id, so neither that settlement nor this tab's decisions on that raise draw it any more.
   */
  private raisedAfter(key: string): void {
    if (!this.settlements.delete(key)) return;
    this.store.setState((s) => {
      const ended = Object.values(s.rpcs).filter((entry) => entry.request === key);
      if (ended.length === 0) return s;
      const rpcs = { ...s.rpcs };
      for (const entry of ended) {
        const kept = { ...entry };
        delete kept.request;
        rpcs[entry.nonce] = kept;
      }
      return { rpcs };
    });
  }

  private async check(kind: 'raised' | 'settled' | 'delivery', shape: object): Promise<boolean> {
    const known = this.verdicts.get(shape);
    if (known !== undefined) return known;
    const key = this.key;
    const verdict = key !== null && (await verify(key, kind, this.project, shape));
    if (key === this.key) this.verdicts.set(shape, verdict);
    return verdict;
  }

  /**
   * Single-flight: a change while a pass runs asks for one more pass after it, never a second pass beside it, so a
   * reconnect replaying many deliveries checks each once (every verdict is kept) rather than once per pass.
   */
  private recompute(): void {
    this.again = true;
    if (this.computing) return;
    this.computing = (async () => {
      try {
        while (this.again) {
          this.again = false;
          await this.computeOnce();
        }
      } finally {
        this.computing = null;
      }
    })();
  }

  private async computeOnce(): Promise<void> {
    if (this.key === null) {
      this.store.setState({ requests: {}, deliveries: {}, unverified: [], checked: false });
      return;
    }
    const unverified: Unverified[] = [];
    const requests: Record<string, RequestRecord> = {};
    const pendingNow = new Map(this.pending.map((p) => [requestKey({ machine: p.machine, session: p.raised.session, request: p.raised.request }), p]));
    for (const [key, seen] of this.seen) {
      const live = pendingNow.get(key);
      // The latest content that verifies is drawn; any newer one that fails is reported.
      let raised: Raised | null = null;
      for (let i = seen.payloads.length - 1; i >= 0; i--) {
        const payload = seen.payloads[i];
        if (await this.check('raised', payload)) {
          raised = payload;
          break;
        }
        unverified.push({ what: 'request', machine: seen.machine, session: payload.session, id: payload.request });
      }
      if (raised === null) continue;
      const settlement = this.settlements.get(key);
      let settled: Settled | null = null;
      if (settlement) {
        if (await this.check('settled', settlement.settled)) settled = settlement.settled;
        else unverified.push({ what: 'settlement', machine: settlement.machine, session: settlement.session, id: settlement.settled.request });
      }
      requests[key] = { key, request: raised.request, machine: seen.machine, raised, at: seen.at, pending: live !== undefined && settled === null, terminalOnly: live?.terminal_only ?? false, settled };
    }
    const deliveries: Record<string, Record<string, Delivery>> = {};
    for (const [id, { machine, delivery }] of this.deliveries) {
      if (!(await this.check('delivery', delivery))) {
        unverified.push({ what: 'delivery', machine, id });
        continue;
      }
      const key = deliveryKey(delivery.event);
      deliveries[key] = { ...deliveries[key], [delivery.session]: delivery };
    }
    // Something changed meanwhile: the next pass, which covers it, commits instead (every pending set starts one).
    if (this.again) return;
    this.store.setState({ requests, deliveries, unverified, checked: this.pendingReceived });
    for (const [key, { at, call }] of this.raisedIn) {
      if (!requests[key]) continue;
      this.raisedIn.delete(key);
      latency.drawn('request.drawn', at, false, requests[key].request);
      const written = latency.callAt(call);
      if (written !== undefined) latency.drawn('request.row', written, true, requests[key].request);
    }
  }
}
