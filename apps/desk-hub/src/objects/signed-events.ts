// RL8's v2 log signatures as a Project checks them (O11 M5): against the org-state head the Project caches from its
// Registry (`Registry.head()`), through the protocol package's `verifyEvent` and nothing else. The hub's check is a
// courtesy (RL §5.5): machines and apps verify for themselves, and it refuses early what they would refuse.
//
// The cache is the object's memory alone: an eviction forgets it, and the next event reads the head afresh. It is read
// again
//   - on each announcement of a newer version (`Project.stateAdvanced`, M3);
//   - on an unknown signer, at most once a second, so a device paired or a machine listed a moment ago is met;
//   - whenever it is older than STATE_MAX_AGE_MS at the moment an event needs it, so a lost announcement costs at most
//     a minute of staleness.
// No head older than the newest announced version is trusted, whichever way it was read: a read sent before an
// announcement is sent again. A read is bounded (STATE_READ_TIMEOUT_MS); one that stalls fails, and the next check
// sends another. An event no head can be had for, young enough and no older than the announcement, is refused
// `state-unavailable`, and its sender retries. A v2 event is never stored unchecked.
//
// A batch (one upload) is judged against one head: once every event is checked, any checked against a head older than
// the newest held or announced, or against the newest version with other certificates than the newest read brought
// (a retirement or a certificate kept since, which moves no version), is checked again, so no two events of a batch
// are judged by states or certificate sets a revocation or a retirement separates.
import { verifyEvent, type Certificates, type EventContext, type LogEventV2, type OrgState, type Verdict } from 'org-protocol';
import type { OrgStateView } from '../protocol/identity';

/** How old a cached head may be when an event needs it. */
export const STATE_MAX_AGE_MS = 60_000;
/** How often an unknown signer may send the cache back to the Registry. */
export const UNKNOWN_SIGNER_READ_MS = 1_000;
/** How long a read of the head may take before it counts as failed. */
export const STATE_READ_TIMEOUT_MS = 5_000;
/** How many times a batch is checked again for a head that moved under it before it is refused `state-unavailable`. */
const BATCH_ROUNDS = 3;

/** A v2 event's check: accepted, or refused with the reason and the message the uploader's refusal carries. */
export type SignatureCheck = { ok: true } | { ok: false; reason: 'bad-signature' | 'state-unavailable'; message: string };

/**
 * The head as read: its state (null before the org's first), its certificates (and `certs`, them as JSON, to tell two
 * reads of one version apart), and when the read was sent.
 */
type Held = { state: OrgState | null; certificates: Certificates; certs: string; version: number; read: number };

/** A check, with the head it was judged against (none for `state-unavailable`). */
type Judged = { check: SignatureCheck; against?: Held };

/** The refusal of a v2 event no usable org state could check. */
export const STATE_UNAVAILABLE: SignatureCheck = { ok: false, reason: 'state-unavailable', message: 'the org state could not be read to check the v2 signature; send it again' };

export class SignedEvents {
  private held: Held | undefined;
  /** The newest version announced: a held head older than it is known to be old. */
  private announced = 0;
  /** When the last read was sent, for the unknown signer's limit. */
  private lastRead = -Infinity;
  private reading: Promise<Held> | undefined;

  constructor(
    private readonly readHead: () => Promise<OrgStateView>,
    private readonly now: () => number = Date.now,
    private readonly readTimeoutMs: () => number = () => STATE_READ_TIMEOUT_MS,
  ) {}

  /** The Registry accepted `version`: a head older than it is read again now, and is never used until it is. */
  async advanced(version: number): Promise<void> {
    this.announced = Math.max(this.announced, version);
    if (this.held && this.held.version >= version) return;
    // A read that fails leaves the cache known to be old; the next event reads again, or is refused.
    await this.fresh().catch(() => {});
  }

  /** `event`, positioned as stored, checked for `ctx` against the cached head. */
  async check(ctx: EventContext, event: LogEventV2): Promise<SignatureCheck> {
    return (await this.checkAll(ctx, [event]))[0];
  }

  /** Each of `events` checked for `ctx`, all against one head: the newest held or announced when the checks end. */
  async checkAll(ctx: EventContext, events: LogEventV2[]): Promise<SignatureCheck[]> {
    const judged: Judged[] = [];
    let pending = events.map((_, i) => i);
    for (let round = 0; pending.length > 0; round++) {
      if (round === BATCH_ROUNDS) {
        for (const i of pending) judged[i] = { check: STATE_UNAVAILABLE };
        break;
      }
      for (const i of pending) judged[i] = await this.judge(ctx, events[i]);
      pending = judged.flatMap((j, i) => (j.against !== undefined && this.outrun(j.against) ? [i] : []));
    }
    return judged.map((j) => j.check);
  }

  /** Whether a check against `against` may not stand: its version is older than the newest held or announced, or the
   * newest read of that same version brought other certificates. */
  private outrun(against: Held): boolean {
    const held = this.held;
    if (against.version < Math.max(this.announced, held?.version ?? 0)) return true;
    return held !== undefined && held !== against && held.version === against.version && held.certs !== against.certs;
  }

  private async judge(ctx: EventContext, event: LogEventV2): Promise<Judged> {
    let held = await this.usable();
    if (!held) return { check: STATE_UNAVAILABLE };
    let verdict = await this.verify(ctx, held, event);
    if (!verdict.ok && verdict.code === 'unknown-signer' && this.now() - this.lastRead >= UNKNOWN_SIGNER_READ_MS) {
      // A re-read that cannot complete leaves the signer undecided, not refused: the sender retries.
      const fresher = await this.readAnnounced();
      if (!fresher) return { check: STATE_UNAVAILABLE };
      [held, verdict] = [fresher, await this.verify(ctx, fresher, event)];
    }
    if (verdict.ok) return { check: verdict, against: held };
    return { check: { ok: false, reason: 'bad-signature', message: `the v2 signature does not verify against the org state (${verdict.code})` }, against: held };
  }

  private verify(ctx: EventContext, held: Held, event: LogEventV2): Promise<Verdict> {
    if (held.state === null) return Promise.resolve({ ok: false, code: 'unknown-signer' });
    return verifyEvent(ctx, held.state, event, held.certificates, new Date(this.now()));
  }

  /** The held head when it is young enough and no announcement outran it; else a fresh read; else undefined. */
  private usable(): Promise<Held | undefined> {
    const held = this.held;
    if (held && this.now() - held.read <= STATE_MAX_AGE_MS && held.version >= this.announced) return Promise.resolve(held);
    return this.readAnnounced();
  }

  /** A fresh read no older than the newest announcement, or undefined when none can be had. */
  private async readAnnounced(): Promise<Held | undefined> {
    try {
      let read = await this.fresh();
      // A read sent before the announcement may answer the version before it: one more read is after it.
      if (read.version < this.announced) read = await this.fresh();
      return read.version >= this.announced ? read : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Reads the head, one read at a time: callers that need one while it is out share it. A read that outlasts the bound
   * fails, its late answer is dropped, and the next caller sends another.
   */
  private fresh(): Promise<Held> {
    if (this.reading) return this.reading;
    const read = (this.lastRead = this.now());
    const reading = (async () => {
      const view = await bounded(this.readHead(), this.readTimeoutMs());
      const state = view.head?.state ?? null;
      const held: Held = { state, certificates: view.certificates, certs: JSON.stringify(view.certificates), version: state?.version ?? 0, read };
      if (!this.held || held.version >= this.held.version) this.held = held;
      return held;
    })();
    this.reading = reading;
    const settled = () => {
      if (this.reading === reading) this.reading = undefined;
    };
    reading.then(settled, settled);
    return reading;
  }
}

/** `promise`, or a rejection once `ms` have passed. */
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`the org-state read took over ${ms} ms`)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
