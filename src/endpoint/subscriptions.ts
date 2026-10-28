// Subscriptions (O10 M8; RL3, RL §4.4; Interfaces §B): a device subscribes to a lane A or lane B session with a cursor,
// is answered `subbed` (`replay`, `snapshot` or `missing`), then gets the session's stream under the byte credit it
// grants, for as long as it keeps the grade the subscription needs. The planes run the streams (plane-a.ts: sminos's
// session plane over RL10; plane-b.ts: the engine host's events); this file keeps the table and what every subscription
// shares.
//
// The table. A `sub` is registered when it arrives, before it is authorized (authorization reads asynchronously, so the
// device's `credit` or `unsub` can come first), and handed to its plane once the gate lets it through; a refusal ends it
// (`ended {reason}`). A `sub` that names a subscription the channel already holds replaces it. A channel holds at most
// `MAX_SUBS` (`busy` past it): each lane A one holds an upstream subscription in sminos.
//
// The stream. What a subscription carries goes out in order through one outbox: `subbed`, which costs nothing, then
// `snap` pages and `ev`s, each costing its message's bytes against the credit (initially the `sub`'s, topped up by
// `credit`, never above SUB_CREDIT_MAX). A message goes while any credit is left, so one larger than the credit still
// goes once and the credit runs negative until topped up. The outbox drains through the channel's stream window
// (stream-window.ts), which keeps only a small window of stream traffic in the channel's own queue, so control messages
// (`ack`, `done`, `result`, `caps`, `paused`, `resumed`, `ended`), sent on the channel directly, never wait behind the
// stream. A snapshot is replace-whole state: one JSON value, its text cut into `snap` pages of at most SNAP_PAGE_BYTES of
// plaintext each, `last` on the final one; the device joins the pages' bodies and reads them. A snapshot of a kind (a
// lane B part, a cards set) replaces one of its kind not yet begun, so while the device's credit is out only the latest
// of each kind waits; a snapshot begun is never cut. An `ev` whose message would be over the channel's limit goes as
// `{omitted: 'too-large', bytes}` at its cursor, so a cursor never skips.
//
// Access is re-checked whenever it can change: on every change of a session's record (`RecordSource`) and every new
// head, each open subscription, and each lane A cursor a dropped channel left resumable, is authorized again. A
// subscription's stream is held from the change until the check decides, so nothing the session produces meanwhile
// reaches a viewer who lost it; one that no longer qualifies ends `removed` and its upstream subscription and retained
// cursor are dropped, so a resume can't restore what was withdrawn. A device's lane B subscriptions count as interest
// (interest.ts).
import { MESSAGE_MAX_BYTES, SUB_CREDIT_MAX, type Cursor, type EndpointMessage, type RefusalReason, type SessionRef, type SubMessage, type CreditMessage, type UnsubMessage } from 'org-protocol';
import type { AuthorizeRequest, Decision, Who } from './authorize';
import type { RemoteChannel } from './channels';
import type { Granted } from './gate';
import type { Interest } from './interest';
import type { RecordSource, SessionTarget } from './sources';
import { StreamWindow, type StreamSource } from './stream-window';

/** A `snap` page's message is at most this many bytes of plaintext. */
export const SNAP_PAGE_BYTES = 256 * 1024;
/** How many subscriptions one channel may hold at once. */
export const MAX_SUBS = 64;
export { STREAM_WINDOW_BYTES } from './stream-window';

export type Mode = 'replay' | 'snapshot' | 'missing';
/** Where a stream stands: lane A's `(epoch, seq)`, lane B's `(launchId, seq, idx)`. */
export type Position = { epoch: string; seq: number; idx?: number };

/** A plane: lane A's or lane B's half of every subscription on its lane. */
export interface Plane {
  /** An authorized subscription: answer it (`subbed`, or `end`) and stream to it. */
  open(sub: Subscription): void;
  /** The subscription is over (unsubscribed, replaced, ended, its channel gone); `retain`: keep its cursor resumable. */
  close(sub: Subscription, retain: boolean): void;
  /** The cursors a dropped channel left resumable, for the access re-check (lane A's). */
  retained?(): Array<{ key: string; session: SessionRef; view: 'full' | 'cards'; who: Who }>;
  /** A retained cursor that no longer qualifies: dropped. */
  forget?(key: string): void;
  stop(): void;
}

/** A queued stream message: its credit cost (`subbed` costs none) and size; a snapshot page, its snapshot and kind. */
type Out = { message: EndpointMessage; cost: number; bytes: number; group?: number; key?: string };

/** One subscription of one channel. */
export class Subscription implements StreamSource {
  readonly id: string;
  readonly channel: RemoteChannel;
  readonly who: Who;
  readonly session: SessionRef;
  readonly view: 'full' | 'cards';
  readonly cursor: Cursor | null;
  /** The `sub` message it answers (a later `sub` of the same id replaces it). */
  readonly message: SubMessage;
  /** The session as authorization placed it, once authorized. */
  target: SessionTarget | null = null;
  /** The plane's hook, run when credit arrives (lane B reads more from the journal). */
  onCredit: (() => void) | null = null;
  #credit: number;
  readonly #out: Out[] = [];
  #backlog = 0;
  #ended = false;
  /** Held while its access is checked again: nothing more goes until a current decision grants it. */
  #held = false;
  #groups = 0;
  /** The snapshot whose first page went and whose last hasn't: never cut, never replaced. */
  #started: number | null = null;
  readonly #window: StreamWindow;
  readonly #over: (sub: Subscription) => void;

  constructor(channel: RemoteChannel, message: SubMessage, window: StreamWindow, over: (sub: Subscription) => void) {
    this.id = message.sub;
    this.channel = channel;
    this.who = { member: channel.member, device: channel.device, clientClass: channel.clientClass };
    this.session = message.session;
    this.view = message.view ?? 'full';
    this.cursor = message.cursor;
    this.message = message;
    this.#credit = Math.min(message.credit, SUB_CREDIT_MAX);
    this.#window = window;
    this.#over = over;
  }

  get ended(): boolean {
    return this.#ended || this.channel.closed;
  }

  /** The stream's bytes queued and not yet sent. */
  get backlog(): number {
    return this.#backlog;
  }

  credit(bytes: number): void {
    this.#credit = Math.min(this.#credit + bytes, SUB_CREDIT_MAX);
    this.#window.ready(this);
    this.onCredit?.();
  }

  /** Its access is being checked again: the stream waits. */
  hold(): void {
    this.#held = true;
  }

  /** A current decision granted it: the stream goes on. */
  unhold(): void {
    if (!this.#held) return;
    this.#held = false;
    this.#window.ready(this);
  }

  /** `subbed` in the stream's order: the position the stream goes on after. */
  subbed(mode: Mode, at: Position): void {
    const message: EndpointMessage = { t: 'subbed', sub: this.id, mode, ...at };
    this.#push({ message, cost: 0, bytes: byteLength(message) });
  }

  /**
   * Replace-whole state at `at`, in pages. One of a `key` (a kind of state, which each one replaces whole) replaces any of
   * that key still wholly unsent: only the latest of each kind waits for the device's credit.
   */
  snap(at: Position, value: unknown, key?: string): void {
    if (this.ended) return;
    if (key !== undefined) this.#unqueue((out) => out.key === key && out.group !== this.#started);
    const group = ++this.#groups;
    const text = JSON.stringify(value);
    for (const page of pagesOf(text, (body, n, last): EndpointMessage => ({ t: 'snap', sub: this.id, ...at, page: n, last, body }))) {
      const bytes = byteLength(page);
      this.#push({ message: page, cost: bytes, bytes, group, ...(key === undefined ? {} : { key }) });
    }
  }

  /** One message of the stream at `at`. */
  ev(at: Position, body: unknown): void {
    let message: EndpointMessage = { t: 'ev', sub: this.id, ...at, body };
    let bytes = byteLength(message);
    if (bytes > MESSAGE_MAX_BYTES - 1024) {
      message = { t: 'ev', sub: this.id, ...at, body: { omitted: 'too-large', bytes } };
      bytes = byteLength(message);
    }
    this.#push({ message, cost: bytes, bytes });
  }

  /** A control message, now: never behind the stream. */
  control(message: EndpointMessage): void {
    if (!this.ended) this.channel.send(message);
  }

  /** What is queued and unsent is dropped (the stream starts over), but for the rest of a snapshot already begun. */
  clear(): void {
    this.#unqueue((out) => out.group === undefined || out.group !== this.#started);
  }

  /** The subscription ends with `reason` (`ended`); its plane lets go of it. */
  end(reason: RefusalReason | string): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#drop();
    if (!this.channel.closed) this.channel.send({ t: 'ended', sub: this.id, reason });
    this.#over(this);
  }

  /** Marks it over without a word (replaced, unsubscribed, its channel gone). */
  close(): void {
    this.#ended = true;
    this.#drop();
  }

  /** The stream window's turn: the next message, if the device's credit (and no hold) allows one. */
  next(): { message: EndpointMessage; bytes: number } | null {
    if (this.ended || this.#held || this.#out.length === 0) return null;
    const head = this.#out[0];
    if (head.cost > 0 && this.#credit <= 0) return null;
    this.#out.shift();
    this.#backlog -= head.cost;
    this.#credit -= head.cost;
    if (head.group !== undefined) this.#started = (head.message as { last?: boolean }).last === true ? null : head.group;
    return { message: head.message, bytes: head.bytes };
  }

  #push(out: Out): void {
    if (this.ended) return;
    this.#out.push(out);
    this.#backlog += out.cost;
    this.#window.ready(this);
  }

  #unqueue(drop: (out: Out) => boolean): void {
    for (let i = this.#out.length - 1; i >= 0; i--) {
      if (!drop(this.#out[i])) continue;
      this.#backlog -= this.#out[i].cost;
      this.#out.splice(i, 1);
    }
  }

  #drop(): void {
    this.#out.length = 0;
    this.#backlog = 0;
    this.#started = null;
  }
}

export type SubscriptionsContext = {
  authorize(request: AuthorizeRequest, who: Who, now: number): Promise<Decision>;
  planes: { A: Plane; B: Plane };
  interest: Interest;
  records: RecordSource;
  now(): number;
  log(line: string): void;
};

export class Subscriptions {
  readonly #ctx: SubscriptionsContext;
  readonly #channels = new Map<RemoteChannel, Map<string, Subscription>>();
  readonly #windows = new Map<RemoteChannel, StreamWindow>();
  /** Re-checks begun per subscription or retained cursor: only the latest one's verdict is taken. */
  readonly #checks = new Map<unknown, number>();
  readonly #off: () => void;

  constructor(ctx: SubscriptionsContext) {
    this.#ctx = ctx;
    this.#off = ctx.records.onChange((target) => this.recheck(target));
  }

  /** The channel's `sub` route: registered now, then `authorized` (the gate, which calls `start` or `refused`). */
  receive(channel: RemoteChannel, m: SubMessage, authorized: (channel: RemoteChannel, m: SubMessage) => void): void {
    if (channel.closed) return;
    let subs = this.#channels.get(channel);
    if (subs === undefined) {
      const mine = new Map<string, Subscription>();
      subs = mine;
      this.#channels.set(channel, mine);
      this.#windows.set(channel, new StreamWindow(channel));
      channel.onClose((reason) => this.#channelClosed(channel, mine, reason));
    }
    const before = subs.get(m.sub);
    if (before !== undefined) this.#close(before, false);
    if (subs.size >= MAX_SUBS) return void channel.send({ t: 'ended', sub: m.sub, reason: 'busy' });
    subs.set(m.sub, new Subscription(channel, m, this.#windows.get(channel)!, (sub) => this.#ended(sub)));
    authorized(channel, m);
  }

  /** The gate's `sub` executor: the subscription authorized, to its plane. */
  start(channel: RemoteChannel, m: SubMessage, decision: Granted): void {
    const sub = this.#channels.get(channel)?.get(m.sub);
    if (sub === undefined || sub.message !== m || sub.ended) return;
    sub.target = decision.target ?? null;
    this.#ctx.planes[m.session.lane].open(sub);
    this.#report(channel);
  }

  /**
   * The gate refused it: it ends with the reason. A `sub` already replaced by a newer one of its id, or unsubscribed,
   * is answered nothing: an `ended` under its id would end the newer one at the device.
   */
  refused(channel: RemoteChannel, m: SubMessage, reason: string): void {
    const sub = this.#channels.get(channel)?.get(m.sub);
    if (sub === undefined || sub.message !== m) return;
    this.#channels.get(channel)?.delete(m.sub);
    sub.close();
    if (!channel.closed) channel.send({ t: 'ended', sub: m.sub, reason });
  }

  /** The channel's subscription `sub`, or null. */
  get(channel: RemoteChannel, sub: string): Subscription | null {
    return this.#channels.get(channel)?.get(sub) ?? null;
  }

  credit(channel: RemoteChannel, m: CreditMessage): void {
    this.#channels.get(channel)?.get(m.sub)?.credit(m.bytes);
  }

  unsub(channel: RemoteChannel, m: UnsubMessage): void {
    const sub = this.#channels.get(channel)?.get(m.sub);
    if (sub !== undefined) this.#close(sub, false);
  }

  /**
   * Access may have changed (a record moved, `target`; a new head, everything): every open subscription, and every
   * retained cursor, on it is authorized again, and ends `removed` (or is dropped) when it no longer qualifies.
   */
  recheck(target?: SessionTarget): void {
    for (const subs of this.#channels.values()) {
      for (const sub of subs.values()) {
        if (sub.target === null || sub.ended || (target !== undefined && !concerns(sub.target, target))) continue;
        // Uncertain until decided: what the session produces meanwhile waits, and goes only if access still holds.
        sub.hold();
        this.#check(sub, sub.message, sub.who, (ok) => (ok ? sub.unhold() : sub.end('removed')));
      }
    }
    for (const lane of ['A', 'B'] as const) {
      const plane = this.#ctx.planes[lane];
      for (const kept of plane.retained?.() ?? []) {
        if (target !== undefined && !(target.lane === kept.session.lane && (target.session === kept.session.id || (target.lane === 'B' && target.appSessionId === kept.session.id)))) continue;
        const message: SubMessage = { t: 'sub', sub: kept.key, session: kept.session, view: kept.view, cursor: null, credit: 1 };
        this.#check(kept.key, message, kept.who, (ok) => ok || plane.forget?.(kept.key));
      }
    }
  }

  stop(): void {
    this.#off();
    for (const [channel, subs] of this.#channels) {
      for (const sub of [...subs.values()]) this.#close(sub, false);
      this.#ctx.interest.closed(viewerOf(channel));
    }
    this.#channels.clear();
    this.#windows.clear();
    this.#ctx.planes.A.stop();
    this.#ctx.planes.B.stop();
    this.#ctx.interest.stop();
  }

  #check(key: unknown, message: SubMessage, who: Who, verdict: (ok: boolean) => void): void {
    const n = (this.#checks.get(key) ?? 0) + 1;
    this.#checks.set(key, n);
    this.#ctx
      .authorize({ kind: 'sub', name: 'sub', input: message }, who, this.#ctx.now())
      .then((decision) => {
        if (this.#checks.get(key) !== n) return;
        this.#checks.delete(key);
        // An answer the endpoint can't give now (the engine host away) withdraws nothing.
        verdict(decision.ok || decision.reason === 'unavailable');
      })
      .catch((error: unknown) => {
        if (this.#checks.get(key) !== n) return;
        this.#checks.delete(key);
        this.#ctx.log(`endpoint: a subscription's access could not be checked again: ${(error as Error).message}`);
        // No decision is no grant: a held subscription ends (the device subscribes again), a retained cursor goes.
        if (key instanceof Subscription) key.end('unavailable');
        else verdict(false);
      });
  }

  /** A subscription ended by its plane (`end`): out of the table. */
  #ended(sub: Subscription): void {
    const subs = this.#channels.get(sub.channel);
    if (subs?.get(sub.id) === sub) subs.delete(sub.id);
    this.#ctx.planes[sub.session.lane].close(sub, false);
    this.#report(sub.channel);
  }

  #close(sub: Subscription, retain: boolean): void {
    const subs = this.#channels.get(sub.channel);
    if (subs?.get(sub.id) === sub) subs.delete(sub.id);
    sub.close();
    if (sub.target !== null) this.#ctx.planes[sub.session.lane].close(sub, retain);
    this.#report(sub.channel);
  }

  /** A channel closed: its subscriptions end with it, a lane A cursor resumable for the window unless the device was removed. */
  #channelClosed(channel: RemoteChannel, subs: Map<string, Subscription>, reason: string): void {
    for (const sub of [...subs.values()]) this.#close(sub, reason !== 'removed');
    this.#channels.delete(channel);
    this.#windows.delete(channel);
    this.#ctx.interest.closed(viewerOf(channel));
  }

  /** The channel's lane B sessions, as its viewer's interest. */
  #report(channel: RemoteChannel): void {
    if (channel.closed) return;
    const sessions = [...(this.#channels.get(channel)?.values() ?? [])].filter((s) => s.session.lane === 'B' && s.target !== null && !s.ended).map((s) => s.session.id);
    this.#ctx.interest.report(viewerOf(channel), sessions);
  }
}

/** A channel as one viewer of OX5's union. */
export const viewerOf = (channel: RemoteChannel): string => `${channel.device}/${channel.key}`;

/** Whether a record change of `changed` can move what `target` rests on. */
function concerns(target: SessionTarget, changed: SessionTarget): boolean {
  if (target.lane !== changed.lane) return false;
  return target.session === changed.session || (target.lane === 'B' && changed.lane === 'B' && changed.appSessionId !== '' && target.appSessionId === changed.appSessionId);
}

const byteLength = (message: unknown): number => Buffer.byteLength(JSON.stringify(message));

/**
 * `text` cut into pages whose whole message (`make`) is at most SNAP_PAGE_BYTES of JSON, never between the two halves of
 * a surrogate pair; at least one page.
 */
export function pagesOf<M>(text: string, make: (body: string, page: number, last: boolean) => M, limit = SNAP_PAGE_BYTES - 64): M[] {
  const pages: M[] = [];
  let at = 0;
  do {
    let n = Math.min(text.length - at, limit);
    for (;;) {
      if (n < text.length - at && isHigh(text.charCodeAt(at + n - 1))) n--;
      const bytes = byteLength(make(text.slice(at, at + n), pages.length, at + n >= text.length));
      if (bytes <= limit || n <= 1) break;
      n = Math.max(1, Math.floor((n * limit) / bytes) - 16);
    }
    pages.push(make(text.slice(at, at + n), pages.length, at + n >= text.length));
    at += n;
  } while (at < text.length);
  return pages;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
