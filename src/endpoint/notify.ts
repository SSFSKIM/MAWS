// RL1's `notify` (O10 M3; RL §7.4): what the hub pushes to a session's owners while their apps are closed. A `waiting`
// or a `wrote` pushes to the owners the session's listing names; `settled` only updates the badge count the hub shows
// the org's apps. So a notify is sent only for a session that is listed now (listings.ts): a `private` session, or one
// in a project the endpoint doesn't relay, has no listing, and the hub would push it to no one while still learning its
// id and its count.
//
// The counts come from sminos's pending sets (M6: each project's whole set, restated after every RL10 welcome). A rise
// in a session's count is a new request waiting, `waiting` with the count; a fall is `settled` with what remains, which
// pushes nothing. The hub is told each change once: what it was last told is kept, and a change made while no connection
// was up is told at the next welcome. A count above 0 the hub was told is kept on disk (`notified.json`), so after a
// restart the first pending set that leaves its session out still tells it `settled 0`; the hub keeps a count until it
// is told otherwise. Any other session's first count after a restart is told as it is (`settled 0` clears a badge left
// from before).
//
// `wrote` is a to-human message: a session-lane `host` message sent outside any subscription whose event is a
// `message`, which O12's phase 2 sends as each is written, whether or not a device is subscribed. It is told once per
// event, by the event's `(writer, seq)` in the host store, however often sminos sends it again. One that can't go yet is
// held (a few, the newest), since an owner with every app closed is whom it is for: while no connection is up, until
// the next welcome; and for a session whose listing is still being signed (a session's `member` and its first messages
// come together), until the listing is sent. A welcome drops what it still can't send for want of a listing.
//
// A count, likewise, is told once the session is listed: a listing just made tells what was held back for it.
import type { NotifyFrame } from 'org-protocol';
import type { NotifiedFile } from './state/store';

export type NotifyContext = {
  send(frame: NotifyFrame): boolean;
  /** The project of a session listed now, its listing current at the hub, or null. */
  listed(session: string): { project: string } | null;
  /** The counts above 0 the hub was last told (`notified.json`). */
  store: { read(): NotifiedFile; write(file: NotifiedFile): void };
  log(line: string): void;
};

/** A session-lane message as sminos sends it on RL10 (DX4's envelope; a `host` one's body is `{event}`). */
export type SessionLaneMessage = { kind: string; session: string | null; project: string; sub: string | null; body: unknown };

/** How many `(writer, seq)`s are remembered for deduplication. */
const SEEN_LIMIT = 4096;
/** How many `wrote`s are held for the next welcome. */
const HELD_LIMIT = 64;

export class Notifier {
  readonly #ctx: NotifyContext;
  readonly #counts = new Map<string, number>();
  /** What the hub was last told of each session; read from the store at first use (the store opens at the module's start). */
  #toldNow: Map<string, number> | null = null;
  readonly #inProject = new Map<string, Set<string>>();
  readonly #seen = new Set<string>();
  /** Sessions owed a `wrote`, oldest first. */
  #held: string[] = [];

  constructor(ctx: NotifyContext) {
    this.#ctx = ctx;
  }

  /** A project's whole pending set: each session's count, and 0 for one its last set, or the hub's count, held that this one doesn't. */
  pendingSet(project: string, raised: ReadonlyArray<{ session: string }>): void {
    this.#restore();
    const counts = new Map<string, number>();
    for (const item of raised) counts.set(item.session, (counts.get(item.session) ?? 0) + 1);
    for (const session of this.#inProject.get(project) ?? []) if (!counts.has(session)) counts.set(session, 0);
    this.#inProject.set(project, new Set([...counts].filter(([, n]) => n > 0).map(([session]) => session)));
    for (const [session, count] of counts) this.pending(session, count);
  }

  /** A session's pending count now. */
  pending(session: string, count: number): void {
    this.#counts.set(session, count);
    this.#tell(session);
  }

  /**
   * A listed session of `project` is being withdrawn (it left, or became `private`), its last listing still the hub's: a
   * count the hub was told is settled to 0 now, and nothing held for it goes later.
   */
  withdrawn(session: string, project: string): void {
    if ((this.#told.get(session) ?? 0) > 0) this.#ctx.send({ t: 'notify', session, project, kind: 'settled', pending: 0 });
    this.#setTold(session, project, undefined);
    this.#held = this.#held.filter((held) => held !== session);
  }

  /** A session left the machine. */
  forget(session: string): void {
    this.#counts.delete(session);
    this.#setTold(session, '', undefined);
  }

  /** A session-lane message: a to-human `host` message outside any subscription is a `wrote`, once per event. */
  hostMessage(message: SessionLaneMessage): void {
    if (message.kind !== 'host' || message.sub !== null || message.session === null) return;
    const event = (message.body as { event?: { kind?: unknown; writer?: unknown; seq?: unknown } } | null)?.event;
    if (event?.kind !== 'message') return;
    if (typeof event.writer !== 'string' || !Number.isSafeInteger(event.seq)) {
      return this.#ctx.log('endpoint: a to-human message with no (writer, seq) was not notified');
    }
    const id = `${event.writer}\n${event.seq as number}`;
    if (this.#seen.has(id)) return;
    this.#seen.add(id);
    if (this.#seen.size > SEEN_LIMIT) this.#seen.delete(this.#seen.values().next().value as string);
    this.#held.push(message.session);
    if (this.#held.length > HELD_LIMIT) this.#held.shift();
    this.#flush(message.session, false);
  }

  /** A session's listing is current at the hub (just sent, or judged unchanged): its count and its held `wrote`s follow it. */
  listed(session: string): void {
    this.#tell(session);
    this.#flush(session, false);
  }

  /** A connection was welcomed: every count the hub wasn't told goes now, then the held `wrote`s. */
  welcome(): void {
    for (const session of this.#counts.keys()) this.#tell(session);
    this.#flush(null, true);
  }

  /** Sends the held `wrote`s (of `only`, or all); one still unlisted is kept, unless `dropUnlisted`. */
  #flush(only: string | null, dropUnlisted: boolean): void {
    const kept: string[] = [];
    for (const session of this.#held) {
      if (only !== null && session !== only) {
        kept.push(session);
        continue;
      }
      const listed = this.#ctx.listed(session);
      if (listed === null) {
        if (!dropUnlisted) kept.push(session);
        continue;
      }
      if (!this.#ctx.send({ t: 'notify', session, project: listed.project, kind: 'wrote', pending: this.#counts.get(session) ?? 0 })) kept.push(session);
    }
    this.#held = kept;
  }

  #tell(session: string): void {
    const count = this.#counts.get(session);
    const listed = this.#ctx.listed(session);
    if (count === undefined || listed === null) return;
    const told = this.#told.get(session);
    if (told === count) return;
    const kind = count > (told ?? 0) ? 'waiting' : 'settled';
    if (this.#ctx.send({ t: 'notify', session, project: listed.project, kind, pending: count })) this.#setTold(session, listed.project, count);
  }

  get #told(): Map<string, number> {
    return this.#restore();
  }

  /** What the hub was told before a restart, from the store, once: each session's count, and in its project's set. */
  #restore(): Map<string, number> {
    if (this.#toldNow !== null) return this.#toldNow;
    this.#toldNow = new Map();
    for (const [session, { project, pending }] of Object.entries(this.#ctx.store.read())) {
      this.#toldNow.set(session, pending);
      this.#inProject.set(project, new Set([...(this.#inProject.get(project) ?? []), session]));
    }
    return this.#toldNow;
  }

  /** What the hub was told of a session (`undefined`: nothing to keep), and on disk when it is above 0. */
  #setTold(session: string, project: string, count: number | undefined): void {
    if (count === undefined) this.#told.delete(session);
    else this.#told.set(session, count);
    const file = this.#ctx.store.read();
    const kept = count !== undefined && count > 0;
    if (!kept && !(session in file)) return;
    if (kept && file[session]?.project === project && file[session]?.pending === count) return;
    const next = { ...file };
    if (kept) next[session] = { project, pending: count };
    else delete next[session];
    this.#ctx.store.write(next);
  }
}
