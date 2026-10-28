// Lane A's subscriptions (O10 M8; RL3; DX2's session lane over RL10): sminos's session plane has no ring and numbers
// each of its subscribers' messages from a snapshot at `n` 0, so the endpoint mints lane A's cursor.
//
// A `full` subscription holds its own upstream subscription in sminos (RL10's `subscribe`, main scope), whose id, 22
// random base64url characters, is the cursor's epoch. The endpoint numbers what the subscription carries: sminos's
// snapshot at 0; then, in arrival order, every plane message of the session: its upstream subscription's own (rows,
// chunks, its `host` events, the answers to `rows`, `diff`, `output` and `read`) and the session-wide ones sminos
// publishes outside any subscription (`presence`, `raised`, `settled`, `compact`, `op`, `delivery`). sminos's own `n`
// numbers only the first kind, so the endpoint's `seq` is its own. A sub-less `host` message is not carried: the
// subscription's own stream has it. Right after the snapshot come the session's requests pending now, as `raised`
// messages, since sminos's snapshot carries none; session-wide messages that came before the snapshot follow, except
// the raises and settlements the pending set already reflects. Those are held up to EARLY_MAX; past it (sminos can take
// its time opening, waiting on a session's bridge) the subscription starts over under a fresh upstream, since a
// session-wide message dropped would be lost for good.
//
// The upstream's last RING_BYTES of messages stay in a ring. A resubscription with the epoch, by the same member's same
// device, on the same session, whose `seq` the ring still holds the next of is a `replay`; any other is a `snapshot`
// under a fresh upstream subscription, the old one ended (`unsubscribe`). A dropped channel's upstream lives on for the
// resume window, still filling its ring, then ends; an endpoint restart loses every ring, so every resume after it is a
// snapshot: no loss, no duplicate. A subscription whose unsent stream outgrows the backlog while the device's credit is
// out has lost what the ring can give it, and moves to a snapshot under a fresh upstream. sminos ending an upstream
// (the session ended, a discontinuity) ends its subscription `unavailable`; RL10 going ends them all, since sminos's
// subscriptions go with the connection.
//
// A `cards` subscription needs no upstream: it carries only the session's pending requests (`raised`, which holds the
// tool and its input) and their settlement (`settled`), from the pending sets sminos restates (`pending`) and the
// session-wide raises and settlements, never a `host` message, a row or the transcript. Its snapshot is the pending set
// with the session's launch (`{raised, launch}`: a web-cards act's context names it, and the phone sees no member frame),
// sent again whenever a restated set or the member's launch differs from what the device holds (its snapshots and the
// raises and settlements since), so a restatement after RL10 came back reconciles a settlement missed while it was
// away; every subscription and resume of it is a snapshot. A cards stream whose credit is out past the backlog gets the whole set
// in place of what waits, so it stays bounded by the set.
import { randomBytes } from 'node:crypto';
import type { Who } from './authorize';
import type { SessionLaneMessage } from './notify';
import { RESUME_MS } from './interest';
import type { SessionTarget } from './sources';
import type { Plane, Position, Subscription } from './subscriptions';

export const RING_BYTES = 2 * 1024 * 1024;
export const BACKLOG_BYTES = 2 * 1024 * 1024;
/** Session-wide messages held for an upstream before its snapshot, at most; past it, the upstream starts over. */
const EARLY_MAX = 256;

/** A plane message as RL10 carries it (DX4's envelope). */
export type PlaneMessage = SessionLaneMessage & { machine?: string; n?: number | null };
/** A pending request, as sminos's `raised` body has it. */
export type Raised = { request: string; session: string } & Record<string, unknown>;

export type PlaneAContext = {
  /** A frame down RL10 to sminos. */
  send(frame: object): void;
  connected(): boolean;
  /** The session's member, as sminos reports it. */
  member(session: string): { project: string; lane: 'A' | 'B'; launch?: string } | null;
  log(line: string): void;
  ringBytes?: number;
  backlogBytes?: number;
  resumeMs?: number;
  setTimer?(run: () => void, ms: number): () => void;
};

type Entry = { seq: number; kind: 'snap' | 'ev'; body: unknown; bytes: number };
/**
 * A cards subscription: its epoch and last seq, the pending set the device will hold once what is queued arrives
 * (`sent`), and whether its stream was dropped for the whole set, owed when credit comes (`stale`).
 */
type Card = { epoch: string; seq: number; sent: string; stale: boolean };

class Upstream {
  readonly epoch = randomBytes(16).toString('base64url');
  readonly ring: Entry[] = [];
  bytes = 0;
  next = 0;
  snapshot = false;
  readonly early: PlaneMessage[] = [];
  sub: Subscription | null = null;
  cancel: (() => void) | null = null;
  constructor(
    readonly session: string,
    readonly project: string,
    readonly who: Who,
  ) {}

  /** Whether the ring holds everything after `seq` (or `seq` is the last numbered). */
  covers(seq: number): boolean {
    const last = this.next - 1;
    if (seq > last || seq < 0) return false;
    return seq === last || (this.ring.length > 0 && this.ring[0].seq <= seq + 1);
  }
}

/** Each project's pending requests: restated whole by `pending`, moved by the session-wide `raised` and `settled`. */
export class PendingSets {
  readonly #projects = new Map<string, Map<string, Raised>>();

  set(project: string, raised: readonly unknown[]): void {
    const set = new Map<string, Raised>();
    for (const r of raised) if (isRaised(r)) set.set(r.request, r);
    this.#projects.set(project, set);
  }

  /** A session-wide `raised` or `settled`. */
  update(m: PlaneMessage): void {
    const body = m.body as Record<string, unknown> | null;
    if (m.kind === 'raised' && isRaised(body)) {
      let set = this.#projects.get(m.project);
      if (set === undefined) this.#projects.set(m.project, (set = new Map()));
      set.set(body.request, body);
    } else if (m.kind === 'settled' && typeof body?.request === 'string') this.#projects.get(m.project)?.delete(body.request);
  }

  /** The session's pending requests, oldest first. */
  of(session: string): Raised[] {
    const out: Raised[] = [];
    for (const set of this.#projects.values()) for (const r of set.values()) if (r.session === session) out.push(r);
    return out;
  }
}

const isRaised = (r: unknown): r is Raised => typeof r === 'object' && r !== null && typeof (r as Raised).request === 'string' && typeof (r as Raised).session === 'string';
const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export class PlaneA implements Plane {
  readonly #ctx: PlaneAContext;
  readonly pending = new PendingSets();
  readonly #upstreams = new Map<string, Upstream>();
  readonly #of = new Map<Subscription, Upstream>();
  /** `cards` subscriptions. */
  readonly #cards = new Map<Subscription, Card>();

  constructor(ctx: PlaneAContext) {
    this.#ctx = ctx;
  }

  get #ring(): number {
    return this.#ctx.ringBytes ?? RING_BYTES;
  }

  open(sub: Subscription): void {
    if (sub.view === 'cards') return this.#openCards(sub);
    if (!this.#ctx.connected()) return sub.end('unavailable');
    const cursor = sub.cursor;
    const up = cursor === null ? undefined : this.#upstreams.get(cursor.epoch);
    if (cursor !== null && up !== undefined) {
      if (up.session === sub.session.id && up.who.member === sub.who.member && up.who.device === sub.who.device) {
        // The device's own resumable cursor (a channel it left half-open gives its upstream up).
        if (up.sub !== null && up.sub !== sub) {
          const old = up.sub;
          this.#detach(up);
          old.end('restart');
        }
        if (up.covers(cursor.seq)) {
          this.#attach(up, sub);
          sub.subbed('replay', { epoch: up.epoch, seq: cursor.seq });
          for (const entry of [...up.ring]) if (entry.seq > cursor.seq && up.sub === sub) this.#emit(up, entry);
          return;
        }
        this.#drop(up);
      }
    }
    this.#fresh(sub);
  }

  close(sub: Subscription, retain: boolean): void {
    this.#cards.delete(sub);
    const up = this.#of.get(sub);
    if (up === undefined) return;
    this.#detach(up);
    if (!retain) return this.#drop(up);
    const timer = this.#ctx.setTimer ?? defaultTimer;
    up.cancel = timer(() => this.#drop(up), this.#ctx.resumeMs ?? RESUME_MS);
  }

  retained(): Array<{ key: string; session: { lane: 'A'; id: string }; view: 'full'; who: Who }> {
    return [...this.#upstreams.values()].filter((up) => up.sub === null).map((up) => ({ key: up.epoch, session: { lane: 'A', id: up.session }, view: 'full', who: up.who }));
  }

  forget(key: string): void {
    const up = this.#upstreams.get(key);
    if (up !== undefined && up.sub === null) this.#drop(up);
  }

  /** The upstream a subscription holds, for its `rows`, `diff`, `output` and `read` (calls.ts). */
  upstreamOf(sub: Subscription): { epoch: string; project: string; session: string } | null {
    const up = this.#of.get(sub);
    return up === undefined ? null : { epoch: up.epoch, project: up.project, session: up.session };
  }

  /** A session-lane message from sminos (RL10's `onSession`). */
  message(m: PlaneMessage): void {
    if (m.sub !== null) return this.#own(m);
    if (m.session === null) return;
    if (m.kind === 'raised' || m.kind === 'settled') {
      this.pending.update(m);
      for (const [sub, card] of this.#cards) if (sub.session.id === m.session && !sub.ended) this.#cardEv(sub, card, m);
    }
    if (m.kind === 'host') return;
    for (const up of [...this.#upstreams.values()]) {
      if (up.session !== m.session || up.project !== m.project) continue;
      if (up.snapshot) this.#add(up, 'ev', m);
      else if (up.early.length < EARLY_MAX) up.early.push(m);
      else this.#restart(up, 'more session-wide messages came before its snapshot than it holds');
    }
  }

  /** A project's pending set, restated whole (RL10's `pending`). */
  pendingSet(project: string, raised: readonly unknown[]): void {
    this.pending.set(project, raised);
    for (const [sub, card] of this.#cards) {
      if (sub.ended || this.#ctx.member(sub.session.id)?.project !== project) continue;
      this.#cardSnap(sub, card);
    }
  }

  /** RL10 went (or a new sminos connection replaced it): every upstream subscription went with it. */
  linkLost(): void {
    for (const up of [...this.#upstreams.values()]) {
      up.cancel?.();
      this.#upstreams.delete(up.epoch);
      const sub = up.sub;
      if (sub !== null) {
        this.#detach(up);
        sub.end('unavailable');
      }
    }
  }

  stop(): void {
    for (const up of [...this.#upstreams.values()]) this.#drop(up);
    this.#cards.clear();
  }

  // ---- Inside -------------------------------------------------------------------------------------------------------

  #openCards(sub: Subscription): void {
    const epoch = randomBytes(16).toString('base64url');
    const card: Card = { epoch, seq: 0, sent: '', stale: false };
    this.#cards.set(sub, card);
    // Room again (credit came, the stream drained, a hold ended): a stale view gets its whole set.
    sub.onRoom = () => {
      if (card.stale) this.#cardSnap(sub, card);
    };
    sub.subbed('snapshot', { epoch, seq: 0 });
    this.#cardSnap(sub, card);
  }

  /**
   * A cards subscription's pending set, whole, unless it already stands so at the device (`sent`: the set as the device
   * will have it once what is queued arrives, snapshots and the raises and settlements since).
   */
  #cardSnap(sub: Subscription, card: Card): void {
    card.stale = false;
    const body = this.#cardBody(sub);
    const text = JSON.stringify(body);
    if (text === card.sent) return;
    card.sent = text;
    sub.snap({ epoch: card.epoch, seq: card.seq }, body, 'cards');
  }

  /**
   * A cards view's whole state: the session's pending requests, and its launch from sminos's member record, which a
   * web-cards act's context needs (`{lane: 'A', session, launch}`) and the phone sees no member frame to learn. Null
   * with no bridge (no launch), where an act is refused `unavailable` anyway. The endpoint never fills a device's
   * context for it: the launch goes to the phone, which signs it.
   */
  #cardBody(sub: Subscription): { raised: Raised[]; launch: string | null } {
    return { raised: this.pending.of(sub.session.id), launch: this.#ctx.member(sub.session.id)?.launch ?? null };
  }

  /**
   * A session's record moved (sminos's `member`): a cards view whose launch moved is sent again. The table calls it after
   * holding the session's subscriptions for their re-check, so what it sends waits for a current grant.
   */
  recordChanged(target: SessionTarget): void {
    if (target.lane !== 'A') return;
    for (const [sub, card] of this.#cards) if (sub.session.id === target.session && !sub.ended) this.#cardSnap(sub, card);
  }

  /**
   * A raise or a settlement to a cards subscription. One whose unsent stream is past the backlog (its credit out, or
   * held while its access is checked) drops what waits and owes the whole pending set, sent when there is room again
   * (credit, the stream drained, the hold over) or on a restatement, so a cards stream stays bounded by the set itself.
   */
  #cardEv(sub: Subscription, card: Card, m: PlaneMessage): void {
    if (card.stale) return;
    if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) {
      sub.clear();
      card.sent = '';
      card.stale = true;
      return;
    }
    sub.ev({ epoch: card.epoch, seq: ++card.seq }, m);
    card.sent = JSON.stringify(this.#cardBody(sub));
  }

  /** An upstream that can't keep its stream whole starts over: a fresh upstream subscription and its snapshot. */
  #restart(up: Upstream, why: string): void {
    const sub = up.sub;
    this.#ctx.log(`endpoint: a lane A subscription starts over under a fresh upstream: ${why}`);
    this.#drop(up);
    if (sub === null || sub.ended) return;
    sub.clear();
    this.#fresh(sub);
  }

  /** A fresh upstream subscription for `sub`, answered `snapshot` at its new epoch. */
  #fresh(sub: Subscription): void {
    const member = this.#ctx.member(sub.session.id);
    if (member === null || member.lane !== 'A') return sub.end('unavailable');
    const up = new Upstream(sub.session.id, member.project, sub.who);
    this.#upstreams.set(up.epoch, up);
    this.#attach(up, sub);
    this.#ctx.send({ t: 'subscribe', project: up.project, session: up.session, agentId: null, sub: up.epoch });
    sub.subbed('snapshot', { epoch: up.epoch, seq: 0 });
  }

  #attach(up: Upstream, sub: Subscription): void {
    up.cancel?.();
    up.cancel = null;
    up.sub = sub;
    this.#of.set(sub, up);
  }

  #detach(up: Upstream): void {
    if (up.sub !== null) this.#of.delete(up.sub);
    up.sub = null;
  }

  /** The upstream ends: out of the table, and sminos told (`unsubscribe`). */
  #drop(up: Upstream): void {
    up.cancel?.();
    up.cancel = null;
    this.#detach(up);
    if (this.#upstreams.get(up.epoch) !== up) return;
    this.#upstreams.delete(up.epoch);
    if (this.#ctx.connected()) this.#ctx.send({ t: 'unsubscribe', project: up.project, sub: up.epoch });
  }

  /** A message of an upstream subscription's own stream. */
  #own(m: PlaneMessage): void {
    const up = this.#upstreams.get(m.sub!);
    if (up === undefined) return;
    if (m.kind === 'end') {
      const reason = (m.body as { reason?: unknown } | null)?.reason;
      if (reason === 'unsubscribed') return;
      // sminos ended it (the session ended, a discontinuity, an error): nothing more comes on it.
      this.#upstreams.delete(up.epoch);
      up.cancel?.();
      const sub = up.sub;
      this.#detach(up);
      this.#ctx.log(`endpoint: sminos ended a lane A subscription (${typeof reason === 'string' ? reason.slice(0, 32) : 'no reason'})`);
      return sub?.end('unavailable');
    }
    if (up.snapshot) return this.#add(up, 'ev', m);
    if (m.kind !== 'snapshot') return;
    up.snapshot = true;
    this.#add(up, 'snap', m);
    // What is pending now (sminos's snapshot carries none), then what came before the snapshot.
    for (const raised of this.pending.of(up.session)) {
      this.#add(up, 'ev', { project: up.project, machine: m.machine, session: up.session, kind: 'raised', sub: null, n: null, body: raised });
    }
    for (const early of up.early.splice(0)) if (early.kind !== 'raised' && early.kind !== 'settled') this.#add(up, 'ev', early);
  }

  /** Numbers a message into the upstream's ring and sends it on to its subscription. */
  #add(up: Upstream, kind: Entry['kind'], body: unknown): void {
    const entry: Entry = { seq: up.next++, kind, body, bytes: byteLength(body) };
    up.ring.push(entry);
    up.bytes += entry.bytes;
    while (up.bytes > this.#ring && up.ring.length > 1) up.bytes -= up.ring.shift()!.bytes;
    if (up.sub !== null) this.#emit(up, entry);
  }

  #emit(up: Upstream, entry: Entry): void {
    const sub = up.sub!;
    const at: Position = { epoch: up.epoch, seq: entry.seq };
    if (entry.kind === 'snap') return sub.snap(at, entry.body);
    // The device's credit has been out longer than the ring holds: what it lacks is gone, so a fresh snapshot.
    if (sub.backlog > (this.#ctx.backlogBytes ?? BACKLOG_BYTES)) return this.#restart(up, 'its device’s credit was out longer than its ring holds');
    sub.ev(at, entry.body);
  }
}

function defaultTimer(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
