// The log plane's uplink (O10, the carriers' bound after M8): sminos's signed uploads on their way to the hub, which
// log-relay.ts hands it as each `events` frame is signed.
//
// They wait in a queue of at most UPLINK_BYTES for the hub link's socket to have room (its soft cap, send-buffer.ts),
// and go up in order; RL10 is read on meanwhile, so nothing the endpoint answers locally (`query`, `words?`,
// `rpc-result`) waits on the uplink. An upload that would take the queue past its cap is let go, its events already in
// the ledger, leaving each writer in it a hole at its first position let go. The hub stores a writer's events only in
// one run (each at its next seq, a gap answered by its own `resend`), so nothing of a writer's past its hole is queued
// until the hole is filled.
//
// Asking. sminos is asked (`resend`) for one hole at a time, once the queue is at most half full; the next is asked as
// soon as that one is filled or let go: its filling refused (by the endpoint, or by the hub), or no answer within
// ASK_MS, after which it waits as long before it is asked again. A writer sminos stopped (a refusal it takes as final,
// `HubLog.on_refused`: `conflict`, `writer-not-yours`, `bad-shape`, `too-large`) ignores a `resend` at or past where it
// was refused, so its hole is not asked for again on this connection; sminos's next connection starts every writer
// over. Only an upload of an asked hole fills it (rebuilt byte for byte from the ledger), and it alone may take
// UPLINK_RESERVE past the cap; past that it is let go, the hole asked for again later. No position is queued twice. So
// the queue holds at most UPLINK_BYTES and UPLINK_RESERVE (or one upload, while it is empty), whatever sminos sends.
//
// The hub's own `resend` for a position the endpoint signed is taken as a hole the same way, asked for once, not
// passed to sminos with each batch the hub refuses. While RL1 is down the queue is let go, its writers holed and
// nothing asked: each RL1 welcome checks the hub's `have` against the ledger (`behind`, from log-relay.ts) and asks
// from there. So a drop costs a resend, never an event, and a backlog however long reaches the hub in about one resend
// for each half queue of it.

type Frame = { t: string } & Record<string, unknown>;

/**
 * The signed uploads waiting for the hub link to have room, at most (one upload past it while the queue is empty): one
 * of sminos's upload passes (`UPLOAD_AHEAD`) and as much again, so a pass that lands while the last still drains waits
 * whole.
 */
export const UPLINK_BYTES = 8 * 1024 * 1024;

/**
 * The room past UPLINK_BYTES that a hole's filling may take, and only it (one asked for at a time): four of sminos's
 * batches (256 KiB), so the queue holds at most UPLINK_BYTES and this, whatever sminos sends.
 */
export const UPLINK_RESERVE = 1024 * 1024;

/** How long an asked hole waits for its filling before the next is asked, and then before it is asked again. */
export const ASK_MS = 30_000;

/** The refusals after which sminos uploads none of the writer from the refused position on (`HubLog.on_refused`). */
const STOPS = new Set(['conflict', 'writer-not-yours', 'bad-shape', 'too-large']);

export type UplinkContext = {
  /** The hub link: an upload sent (false while RL1 is down), and its socket's room. */
  send(frame: Frame): boolean;
  writable?(): Promise<void>;
  toSminos(frame: Frame): void;
  /** Whether the endpoint signed `writer`'s `seq` in `project` (the hub is owed it). */
  signed(project: string, writer: string, seq: number): boolean;
  now(): number;
  log(line: string): void;
  /** The cap, the reserve and the ask's wait (UPLINK_BYTES, UPLINK_RESERVE and ASK_MS unless given). */
  limits?: { bytes: number; reserve: number; askMs?: number };
};

/**
 * A writer's hole: the first position the hub is owed and the uplink let go; whether sminos was asked for it (only
 * then is an upload of it its filling); and when it may be asked (again).
 */
type Hole = { from: number; asked: boolean; due: number };

const key = (project: string, writer: string) => `${project}\n${writer}`;
const at = (project: string, e: Record<string, unknown>) => `${project}\n${e.writer as string}\n${e.seq as number}`;

export class Uplink {
  readonly #ctx: UplinkContext;
  readonly #queue: Array<{ project: string; events: Record<string, unknown>[]; bytes: number }> = [];
  #bytes = 0;
  /** The positions in the queue, by `project\nwriter\nseq`: none is queued twice. */
  readonly #queued = new Set<string>();
  #draining = false;
  /** Each writer's hole, by project, then writer. Nothing of the writer's past it is queued until it is filled. */
  readonly #holes = new Map<string, Map<string, Hole>>();
  /** Where sminos stopped each writer it stopped on this connection, by `project\nwriter` (0: the writer itself). */
  readonly #stopped = new Map<string, number>();
  /** The hole asked for last, until it is filled or let go, and when it is let go unanswered. */
  #asking: { project: string; writer: string; until: number } | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #timerAt = Infinity;

  constructor(ctx: UplinkContext) {
    this.#ctx = ctx;
  }

  /** The uploads' bytes waiting for the hub link's room. */
  get queued(): number {
    return this.#bytes;
  }

  get #cap(): number {
    return this.#ctx.limits?.bytes ?? UPLINK_BYTES;
  }

  get #askMs(): number {
    return this.#ctx.limits?.askMs ?? ASK_MS;
  }

  /**
   * Signed events up, but for what lies past a writer's hole and any position queued already. Past the cap they are
   * let go, a hole left at each writer's first position among them; an upload that fills a hole sminos was asked for
   * may take the reserve too, and past that is let go, the hole asked for again.
   */
  upload(project: string, events: Record<string, unknown>[]): void {
    const holes = this.#holes.get(project);
    /** Each holed writer's next position from its hole on, as this upload fills it. */
    const filling = new Map<string, number>();
    /** The writers whose filling stops short of what this upload brings (a position refused out of its run). */
    const cut = new Set<string>();
    let fills = false;
    const admitted = events.filter((e) => {
      const { writer, seq } = e as { writer: string; seq: number };
      const queued = this.#queued.has(at(project, e));
      const hole = holes?.get(writer);
      if (hole === undefined || seq < hole.from) return !queued;
      const next = filling.get(writer) ?? hole.from;
      if (!hole.asked || seq !== next) {
        if (filling.has(writer)) cut.add(writer);
        return false;
      }
      filling.set(writer, next + 1);
      if (queued) return false;
      fills = true;
      return true;
    });
    const bytes = admitted.length === 0 ? 0 : Buffer.byteLength(JSON.stringify({ t: 'events', project, events: admitted }));
    const room = this.#cap + (fills ? (this.#ctx.limits?.reserve ?? UPLINK_RESERVE) : 0);
    if (admitted.length > 0 && this.#queue.length > 0 && this.#bytes + bytes > room) {
      if (this.#holes.size === 0) this.#ctx.log(`endpoint: the hub is taking uploads slower than sminos sends them; uploads past ${this.#cap} bytes are let go and asked again from sminos as the uplink drains`);
      for (const writer of filling.keys()) this.#again(project, writer, 0);
      for (const e of admitted) this.#hole(project, e.writer as string, e.seq as number);
    } else {
      // sminos sends a writer's positions in order from where it was asked, so the rest follows the hole's filling; a
      // filling cut short leaves the hole where it stopped, asked for again after the wait.
      for (const [writer, next] of filling) {
        this.#forget(project, writer);
        if (cut.has(writer)) this.#set(project, writer, { from: next, asked: false, due: this.#ctx.now() + this.#askMs });
      }
      if (admitted.length > 0) {
        this.#queue.push({ project, events: admitted, bytes });
        this.#bytes += bytes;
        for (const e of admitted) this.#queued.add(at(project, e));
        void this.#drain();
      }
    }
    this.#ask();
  }

  /**
   * A refusal sminos hears of `writer` at `seq` (0: the writer itself), the endpoint's or the hub's: one sminos takes as
   * final stops the writer's asking from there; any other lets go of its hole's ask, to be asked again after ASK_MS.
   */
  refused(project: string, writer: string, seq: number, reason: string): void {
    const hole = this.#holes.get(project)?.get(writer);
    if (STOPS.has(reason)) {
      if (hole === undefined && !this.#ctx.signed(project, writer, Math.max(seq, 1))) return;
      const k = key(project, writer);
      this.#stopped.set(k, Math.min(seq, this.#stopped.get(k) ?? seq));
      if (this.#isAsking(project, writer) && !this.#askable(project, writer, hole!)) this.#asking = null;
    } else if (hole !== undefined && hole.from === seq && this.#isAsking(project, writer)) {
      this.#again(project, writer, this.#ctx.now() + this.#askMs);
    }
    this.#ask();
  }

  /** The hub's `resend` of `writer` from `from`: taken as a hole when the endpoint signed it (else false, for sminos). */
  resend(project: string, writer: string, from: number): boolean {
    if (!this.#ctx.signed(project, writer, from)) return false;
    this.#hole(project, writer, from);
    this.#ask();
    return true;
  }

  /**
   * The hub's `have` after a welcome holds `writer` up to `from - 1` of what the endpoint signed (null: all of it):
   * sminos asked from there at once, with every such writer, their fillings sharing the reserve.
   */
  behind(project: string, writer: string, from: number | null): void {
    this.#forget(project, writer);
    if (from !== null) {
      this.#set(project, writer, { from, asked: true, due: this.#ctx.now() + this.#askMs });
      this.#ctx.toSminos({ t: 'resend', project, writer, from });
    }
    this.#ask();
  }

  /** sminos's connection ended: what was asked of it is lost with it, and its successor starts every writer over. */
  ended(): void {
    this.#stopped.clear();
    this.#parkAll();
  }

  /** A hole at `from` in `writer`'s uploads, to be asked for, unless it holds one no later already. */
  #hole(project: string, writer: string, from: number): void {
    const held = this.#holes.get(project)?.get(writer);
    if (held !== undefined && held.from <= from) return;
    this.#set(project, writer, { from, asked: false, due: 0 });
    if (this.#isAsking(project, writer)) this.#asking = null;
  }

  #set(project: string, writer: string, hole: Hole): void {
    let holes = this.#holes.get(project);
    if (holes === undefined) this.#holes.set(project, (holes = new Map()));
    holes.set(writer, hole);
  }

  /** `writer`'s hole to be asked for again from `due` on (its filling let go, refused or unanswered). */
  #again(project: string, writer: string, due: number): void {
    const hole = this.#holes.get(project)?.get(writer);
    if (hole !== undefined) Object.assign(hole, { asked: false, due });
    if (this.#isAsking(project, writer)) this.#asking = null;
  }

  /** `writer`'s hole filled, or asked for anew: gone. */
  #forget(project: string, writer: string): void {
    const holes = this.#holes.get(project);
    holes?.delete(writer);
    if (holes?.size === 0) this.#holes.delete(project);
    if (this.#isAsking(project, writer)) this.#asking = null;
  }

  /** Every hole counted as asked, none asked again until the next welcome's `have` (RL1, or sminos, gone). */
  #parkAll(): void {
    for (const holes of this.#holes.values()) for (const hole of holes.values()) Object.assign(hole, { asked: true, due: Infinity });
    this.#asking = null;
    this.#wake(Infinity);
  }

  #isAsking(project: string, writer: string): boolean {
    return this.#asking !== null && this.#asking.project === project && this.#asking.writer === writer;
  }

  /** Whether sminos follows a `resend` of `writer` from its hole: one before where it stopped the writer, or none. */
  #askable(project: string, writer: string, hole: Hole): boolean {
    const stopped = this.#stopped.get(key(project, writer));
    return stopped === undefined || hole.from < stopped;
  }

  /**
   * sminos asked for the next hole due, once the last one asked is filled or let go and the queue is at most half full:
   * the room its filling and what follows go up in, ahead of anything later of that writer's. Each path that lets an
   * ask go ends here, so the next is never left waiting on nothing; a deadline or a due hole arms the timer.
   */
  #ask(): void {
    const now = this.#ctx.now();
    if (this.#asking !== null && now >= this.#asking.until) {
      const { project, writer } = this.#asking;
      this.#ctx.log(`endpoint: sminos sent nothing of ${writer} in project ${project} within ${this.#askMs} ms of the endpoint's resend; the next hole is asked for`);
      this.#again(project, writer, now + this.#askMs);
    }
    if (this.#asking !== null) return this.#wake(this.#asking.until);
    if (this.#bytes > this.#cap / 2) return this.#wake(Infinity); // each send asks again
    let next = Infinity;
    for (const [project, holes] of this.#holes) {
      for (const [writer, hole] of holes) {
        if (hole.due === Infinity || !this.#askable(project, writer, hole)) continue;
        if (hole.due > now) {
          next = Math.min(next, hole.due);
          continue;
        }
        Object.assign(hole, { asked: true, due: Infinity });
        this.#asking = { project, writer, until: now + this.#askMs };
        this.#ctx.toSminos({ t: 'resend', project, writer, from: hole.from });
        return this.#wake(this.#asking.until);
      }
    }
    this.#wake(next);
  }

  /** The timer set for `at` (none for Infinity), when `#ask` looks again. */
  #wake(at: number): void {
    if (at === this.#timerAt) return;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#timerAt = at;
    if (at === Infinity) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#timerAt = Infinity;
      this.#ask();
    }, Math.max(0, at - this.#ctx.now()));
    this.#timer.unref?.();
  }

  /** Sends the queue up as the hub link has room, asking sminos for the holes as room comes. */
  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.length > 0) {
        await this.#ctx.writable?.();
        const next = this.#queue.shift()!;
        this.#bytes -= next.bytes;
        for (const e of next.events) this.#queued.delete(at(next.project, e));
        if (this.#ctx.send({ t: 'events', project: next.project, events: next.events })) {
          this.#ask();
          continue;
        }
        // RL1 is down: what was queued is let go, a hole left for each writer in it, and nothing is asked now, only
        // to be lost the same way; the next welcome checks every project's `have` against the ledger and asks then.
        for (const { project, events } of [next, ...this.#queue.splice(0)]) {
          for (const e of events) this.#hole(project, e.writer as string, e.seq as number);
        }
        this.#bytes = 0;
        this.#queued.clear();
        this.#parkAll();
      }
    } finally {
      this.#draining = false;
    }
  }
}
