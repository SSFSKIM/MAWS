// The conversation's live state for one open project, beside its log: the requests (permission prompts and questions)
// the hub reports, with their settlements; each event's delivery per recipient; the RPCs this tab issued and the state
// the hub reports for each; the web `human`s on their way to the log; each session's latest compaction. Requests,
// settlements, and deliveries carry codes (DX1, DX4) and are drawn only once they verify under the org key; one that
// fails is kept out and reported. Every verdict holds only under the key it was reached with.
import { createStore, type StoreApi } from 'zustand/vanilla';
import { verify, type Decision, type Delivery, type OrgKey, type PendingRequest, type Raised, type Recipient, type Rpc, type RpcOutcome, type SessionBodies, type Settled } from 'desk-hub/protocol';

export type CompactBody = SessionBodies['compact'];

export type RequestRecord = {
  request: string;
  machine: string;
  raised: Raised;
  /** The offset of the last log entry the browser held when it first saw the request: where the stream places it. */
  at: number;
  /** In the hub's pending set now. */
  pending: boolean;
  /** The hub's `terminal_only`: only the terminal can answer it. */
  terminalOnly: boolean;
  /** Its verified settlement, once one came. */
  settled: Settled | null;
};

export type RpcEntryState = 'sending' | RpcOutcome['state'] | 'forwarded' | 'uncertain';
export type RpcEntry = { nonce: string; rpc: Rpc; state: RpcEntryState; outcome?: RpcOutcome; request?: string };

export type OutboxItem = { nonce: string; to: '*' | Recipient[]; text: string; wake: boolean; state: 'sending' | 'refused'; reason?: string };

/** What failed verification, by the machine that sent it when the hub said (it does not for `deliveries` on connect). */
export type Unverified = { what: 'request' | 'settlement' | 'delivery'; machine: string | null; id: string };

export type ConversationState = {
  requests: Record<string, RequestRecord>;
  /** The latest verified delivery per event (`<writer>:<seq>`) and recipient session. */
  deliveries: Record<string, Record<string, Delivery>>;
  rpcs: Record<string, RpcEntry>;
  outbox: Record<string, OutboxItem>;
  compactions: Record<string, CompactBody>;
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

type Seen = { machine: string; raised: Raised; at: number };

export class Conversation {
  readonly store: StoreApi<ConversationState> = createStore<ConversationState>(() => ({ requests: {}, deliveries: {}, rpcs: {}, outbox: {}, compactions: {}, unverified: [], checked: false }));
  /** Whether this connection has had the hub's pending set yet (it comes on every connect, DX3). */
  private pendingReceived = false;
  private key: OrgKey | null = null;
  /** Counts recomputations: only the newest commits, so a slower older one never overwrites a newer one. */
  private run = 0;
  private verdicts = new WeakMap<object, boolean>();
  /** Every request seen, by id, with where it was first seen (its content stays drawable after it leaves the set). */
  private readonly seen = new Map<string, Seen>();
  private pending: PendingRequest[] = [];
  private readonly settlements = new Map<string, { machine: string; settled: Settled }>();
  private readonly deliveries = new Map<string, { machine: string | null; delivery: Delivery }>();

  constructor(
    private readonly project: string,
    /** Where a request first seen now belongs in the stream. */
    private readonly position: () => number,
  ) {}

  setKey(key: OrgKey | null): void {
    if (key === this.key) return;
    this.key = key;
    this.store.setState({ checked: false });
    this.verdicts = new WeakMap();
    void this.recompute();
  }

  // From the hub.

  /** A new connection: its pending set is still to come. */
  restart(): void {
    this.pendingReceived = false;
    this.store.setState({ checked: false });
  }

  pendingSet(requests: PendingRequest[]): void {
    this.pendingReceived = true;
    this.store.setState({ checked: false });
    this.pending = requests;
    for (const { machine, raised } of requests) this.see(machine, raised);
    void this.recompute();
  }

  raised(machine: string, raised: Raised): void {
    this.see(machine, raised);
    void this.recompute();
  }

  settled(machine: string, settled: Settled): void {
    this.settlements.set(settled.request, { machine, settled });
    void this.recompute();
  }

  /**
   * A decision from the project's audit record (DX3 `decided`): the `raised` it settled (verbatim, or null when the hub
   * no longer held it) is seen as any request is — at `at` when this tab never saw it — and its `settled` taken as the
   * request's settlement. Both are verified before anything of them is drawn. So a card settled before the tab
   * connected (a reload, another device) is drawn settled.
   */
  decided(decision: Decision, at: number): void {
    if (decision.raised) {
      const known = this.seen.get(decision.raised.request);
      this.seen.set(decision.raised.request, known ?? { machine: decision.machine, raised: decision.raised, at });
    }
    this.settlements.set(decision.settled.request, { machine: decision.machine, settled: decision.settled });
    void this.recompute();
  }

  delivery(machine: string | null, delivery: Delivery): void {
    this.deliveries.set(`${deliveryKey(delivery.event)}|${delivery.session}`, { machine, delivery });
    void this.recompute();
  }

  compact(session: string, body: CompactBody): void {
    this.store.setState((s) => ({ compactions: { ...s.compactions, [session]: body } }));
  }

  rpcState(nonce: string, state: 'forwarded' | 'done' | 'failed' | 'uncertain', outcome?: RpcOutcome): void {
    this.store.setState((s) => {
      const entry = s.rpcs[nonce];
      return entry ? { rpcs: { ...s.rpcs, [nonce]: { ...entry, state, ...(outcome && { outcome }) } } } : s;
    });
  }

  // From this tab.

  rpcSent(rpc: Rpc, request?: string): void {
    this.store.setState((s) => ({ rpcs: { ...s.rpcs, [rpc.nonce]: { nonce: rpc.nonce, rpc, state: 'sending', ...(request && { request }) } } }));
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

  private see(machine: string, raised: Raised): void {
    const known = this.seen.get(raised.request);
    // A request id is opaque and names one request; a later raise under it with other content replaces the content.
    this.seen.set(raised.request, { machine, raised, at: known?.at ?? this.position() });
  }

  private async check(kind: 'raised' | 'settled' | 'delivery', shape: object): Promise<boolean> {
    const known = this.verdicts.get(shape);
    if (known !== undefined) return known;
    const key = this.key;
    const verdict = key !== null && (await verify(key, kind, this.project, shape));
    if (key === this.key) this.verdicts.set(shape, verdict);
    return verdict;
  }

  private async recompute(): Promise<void> {
    const run = ++this.run;
    if (this.key === null) {
      this.store.setState({ requests: {}, deliveries: {}, unverified: [], checked: false });
      return;
    }
    const unverified: Unverified[] = [];
    const requests: Record<string, RequestRecord> = {};
    const pendingNow = new Map(this.pending.map((p) => [p.raised.request, p]));
    for (const [id, seen] of this.seen) {
      // The request as pending now, or as last seen.
      const live = pendingNow.get(id);
      const raised = live?.raised ?? seen.raised;
      const machine = live?.machine ?? seen.machine;
      if (!(await this.check('raised', raised))) {
        unverified.push({ what: 'request', machine, id });
        continue;
      }
      const settlement = this.settlements.get(id);
      let settled: Settled | null = null;
      if (settlement) {
        if (await this.check('settled', settlement.settled)) settled = settlement.settled;
        else unverified.push({ what: 'settlement', machine: settlement.machine, id });
      }
      requests[id] = { request: id, machine, raised, at: seen.at, pending: live !== undefined && settled === null, terminalOnly: live?.terminal_only ?? false, settled };
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
    if (run !== this.run) return;
    // The newest recomputation commits alone, and every pending set starts one: it covers the latest set.
    this.store.setState({ requests, deliveries, unverified, checked: this.pendingReceived });
  }
}
