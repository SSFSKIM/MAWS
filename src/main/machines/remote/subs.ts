// The RL2 link's subscriptions (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Subscriptions";
// RL3, RL §4.4): one entry per subscription, under an id that stays the same on every channel, so a lane A read can name
// it in `input.sub` after a reconnect.
//
// The cursor is what a resubscribe sends: the position of the last `ev` delivered to the sink. A `subbed {mode: 'replay'}`
// keeps it; a `subbed {mode: 'snapshot' | 'missing'}` moves it to the `subbed` position only once the snapshot that
// follows has arrived whole, so a drop in the middle of a snapshot asks again from where the sink stood. A replace-whole
// `snap` after that (lane B's parts, a cards set) doesn't move it. An `ev` at or before the last delivered position of its
// epoch is dropped (`(seq, idx ?? -1)`): the endpoint guarantees no repeat, and this is a defence.
//
// `snap` pages carry a JSON value's text: the pages `0..last` of one position are joined and parsed; a page out of order,
// or of another position, discards the assembly (the endpoint sends replace-whole state again on every resume). Each
// delivered `ev` and `snap` costs its message's UTF-8 JSON length, as the endpoint charges it, and goes back as `credit`
// in batches: the sink is in-process, so delivery is consumption.
import { base64urlEncode, SUB_CREDIT_MAX, type Cursor, type DeviceMessage, type EndpointMessage, type SessionRef } from '../../../../apps/org-protocol/src/index.ts';
import { MAX_SUBS, type RemoteTiming } from './timing';

/**
 * A session's stream, or one of the machine's feeds (P5 O7 M4 and M6, §R), each sent only to a peer that listed
 * `rl2.feeds` (an older endpoint would read a `checkout` feed as the session's own stream, and close the channel on an
 * `attention` one); for any other the subscription ends `not-offered`, never sent. Every opening of a feed is a snapshot,
 * so a feed resubscribes with no cursor and its `view` is not sent.
 */
export type SubscribeRequest = SessionSubscribeRequest | MachineFeedRequest;
export interface SessionSubscribeRequest {
  session: SessionRef;
  view?: 'full' | 'cards';
  cursor?: Cursor | null;
  /** P5 O7 M4: the session's `checkout` feed rather than its stream. */
  feed?: 'checkout';
}
/** P5 O7 M6: the machine's `attention` feed, which names no session. */
export interface MachineFeedRequest {
  feed: 'attention';
  session?: undefined;
  view?: undefined;
  cursor?: undefined;
}
export interface SubscriptionSink {
  /** A snapshot or missing starts the stream over from `at`. */
  subbed(mode: 'replay' | 'snapshot' | 'missing', at: Cursor): void;
  /** One whole snapshot or replace-whole part, its pages joined and parsed. */
  snapshot(at: Cursor, value: unknown): void;
  /** Lane B: a SessionEvent (or `{ omitted: 'too-large', bytes }`); lane A: one sminos plane message. */
  event(at: Cursor, body: unknown): void;
  /** The endpoint's ('no-app') or the link's ('offline'). */
  paused(reason: string): void;
  resumed(): void;
  /** Final; the link won't resume it. */
  ended(reason: string): void;
}
export interface Subscription {
  /** Stable across channels; a lane A read names it in input.sub. */
  readonly id: string;
  cursor(): Cursor | null;
  /** Sends unsub. */
  close(): void;
}

export interface SubTableDeps {
  /** Sends on the current channel; false when none is current. */
  send(message: DeviceMessage): boolean;
  current(): boolean;
  /** The capabilities the current channel's peer listed in `h2`; null while none is current (P5 O7 M4: feeds). */
  peerCapabilities(): readonly string[] | null;
  timing: RemoteTiming;
  log(line: string): void;
}

type Entry = {
  id: string;
  request: SubscribeRequest;
  sink: SubscriptionSink;
  /** What a resubscribe sends. */
  cursor: Cursor | null;
  /** The last position delivered in its epoch, below which an `ev` is a repeat. */
  floor: Cursor | null;
  /** A snapshot's position, taken as the cursor when the snapshot that follows the `subbed` is whole. */
  pending: Cursor | null;
  assembly: { at: Cursor; next: number; bodies: string[] } | null;
  /** Bytes delivered and not yet returned as credit. */
  owed: number;
  creditTimer: ReturnType<typeof setTimeout> | null;
  pausedOffline: boolean;
  ended: boolean;
};

const same = (a: Cursor, b: Cursor) => a.epoch === b.epoch && a.seq === b.seq && (a.idx ?? -1) === (b.idx ?? -1);
/** Whether `at` is at or before `floor` within the same epoch. */
const atOrBefore = (at: Cursor, floor: Cursor | null) => floor !== null && at.epoch === floor.epoch && (at.seq < floor.seq || (at.seq === floor.seq && (at.idx ?? -1) <= (floor.idx ?? -1)));
const cursorOf = (m: { epoch: string; seq: number; idx?: number }): Cursor => ({ epoch: m.epoch, seq: m.seq, ...(m.idx === undefined ? {} : { idx: m.idx }) });
const costOf = (message: EndpointMessage) => Buffer.byteLength(JSON.stringify(message), 'utf8');

export class SubTable {
  readonly #entries = new Map<string, Entry>();
  readonly #deps: SubTableDeps;

  constructor(deps: SubTableDeps) {
    this.#deps = deps;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** `ended` names the link's permanent end (`removed`, `closed`) when it holds one. */
  subscribe(request: SubscribeRequest, sink: SubscriptionSink, ended: 'removed' | 'closed' | null): Subscription {
    const id = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const entry: Entry = {
      id,
      request,
      sink,
      cursor: request.cursor ?? null,
      floor: request.cursor ?? null,
      pending: null,
      assembly: null,
      owed: 0,
      creditTimer: null,
      pausedOffline: false,
      ended: false,
    };
    const subscription: Subscription = {
      id,
      cursor: () => entry.cursor,
      close: () => {
        if (entry.ended) return;
        this.#remove(entry);
        if (this.#deps.current()) this.#deps.send({ t: 'unsub', sub: id });
      },
    };
    const refusal = ended ?? (this.#entries.size >= MAX_SUBS ? 'busy' : null);
    if (refusal !== null) {
      entry.ended = true;
      queueMicrotask(() => sink.ended(refusal));
      return subscription;
    }
    this.#entries.set(id, entry);
    if (this.#deps.current()) this.#sub(entry);
    return subscription;
  }

  /** A channel became current: every subscription again, from its cursor, with fresh credit. */
  onCurrent(): void {
    for (const entry of [...this.#entries.values()]) {
      entry.assembly = null;
      entry.pending = null;
      this.#dropCredit(entry);
      this.#sub(entry);
    }
  }

  /** The link went `down` past its grace: each sink hears `paused('offline')` once. */
  onOffline(): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.pausedOffline) continue;
      entry.pausedOffline = true;
      entry.sink.paused('offline');
    }
  }

  /** The link ended for good. */
  close(reason: string): void {
    for (const entry of [...this.#entries.values()]) {
      this.#remove(entry);
      entry.sink.ended(reason);
    }
  }

  receive(message: EndpointMessage): void {
    if (!('sub' in message)) return;
    const entry = this.#entries.get(message.sub);
    if (entry === undefined) return;
    switch (message.t) {
      case 'subbed': {
        const at = cursorOf(message);
        entry.assembly = null;
        entry.pausedOffline = false;
        if (message.mode === 'replay') entry.pending = null;
        else {
          entry.pending = at;
          entry.floor = at;
        }
        return entry.sink.subbed(message.mode, at);
      }
      case 'snap':
        this.#owe(entry, costOf(message));
        return this.#page(entry, cursorOf(message), message.page, message.last, message.body);
      case 'ev': {
        this.#owe(entry, costOf(message));
        const at = cursorOf(message);
        if (atOrBefore(at, entry.floor)) return this.#deps.log(`subscription ${entry.id}: dropped a repeated event at ${at.epoch}:${at.seq}:${at.idx ?? '-'}`);
        entry.floor = at;
        entry.cursor = at;
        entry.pending = null;
        return entry.sink.event(at, message.body);
      }
      case 'paused':
        return entry.sink.paused(message.reason);
      case 'resumed':
        return entry.sink.resumed();
      case 'ended':
        this.#remove(entry);
        return entry.sink.ended(message.reason);
    }
  }

  #sub(entry: Entry): void {
    const { request } = entry;
    const credit = this.#deps.timing.SUB_INITIAL_CREDIT;
    if (request.feed === undefined) return void this.#deps.send({ t: 'sub', sub: entry.id, session: request.session, ...(request.view === undefined ? {} : { view: request.view }), cursor: entry.cursor, credit });
    // What the peer could not read never goes: the feed ends here, as the endpoint would end a name it does not offer.
    if (this.#deps.peerCapabilities()?.includes('rl2.feeds') !== true) {
      this.#remove(entry);
      return void queueMicrotask(() => entry.sink.ended('not-offered'));
    }
    if (request.feed === 'attention') return void this.#deps.send({ t: 'sub', sub: entry.id, feed: 'attention', cursor: null, credit });
    this.#deps.send({ t: 'sub', sub: entry.id, session: request.session, feed: request.feed, cursor: null, credit });
  }

  #page(entry: Entry, at: Cursor, page: number, last: boolean, body: unknown): void {
    if (page === 0) entry.assembly = { at, next: 0, bodies: [] };
    const assembly = entry.assembly;
    if (assembly === null || page !== assembly.next || !same(at, assembly.at) || typeof body !== 'string') {
      entry.assembly = null;
      return this.#deps.log(`subscription ${entry.id}: a snapshot page out of order (page ${page}); the assembly is discarded`);
    }
    assembly.bodies.push(body);
    assembly.next += 1;
    if (!last) return;
    entry.assembly = null;
    let value: unknown;
    try {
      value = JSON.parse(assembly.bodies.join(''));
    } catch {
      return this.#deps.log(`subscription ${entry.id}: a snapshot that does not parse; discarded`);
    }
    if (entry.pending !== null) {
      entry.cursor = entry.pending;
      entry.pending = null;
    }
    entry.sink.snapshot(at, value);
  }

  #owe(entry: Entry, bytes: number): void {
    entry.owed += bytes;
    if (entry.owed >= this.#deps.timing.CREDIT_BATCH_BYTES) return this.#flush(entry);
    entry.creditTimer ??= setTimeout(() => this.#flush(entry), this.#deps.timing.CREDIT_BATCH_MS);
  }

  #flush(entry: Entry): void {
    if (entry.creditTimer !== null) clearTimeout(entry.creditTimer);
    entry.creditTimer = null;
    while (entry.owed > 0 && !entry.ended) {
      const bytes = Math.min(entry.owed, SUB_CREDIT_MAX);
      if (!this.#deps.send({ t: 'credit', sub: entry.id, bytes })) break;
      entry.owed -= bytes;
    }
    entry.owed = 0;
  }

  /** A new channel's `sub` grants fresh credit: what the old one was owed is not returned. */
  #dropCredit(entry: Entry): void {
    if (entry.creditTimer !== null) clearTimeout(entry.creditTimer);
    entry.creditTimer = null;
    entry.owed = 0;
  }

  #remove(entry: Entry): void {
    entry.ended = true;
    this.#dropCredit(entry);
    this.#entries.delete(entry.id);
  }
}
