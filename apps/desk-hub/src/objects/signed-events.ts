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
// A cache an announcement has outrun is never used, nor one past its age that cannot be read again: the event is then
// refused `state-unavailable`, and its sender retries. A v2 event is never stored unchecked.
import { verifyEvent, type Certificates, type EventContext, type LogEventV2, type OrgState, type Verdict } from 'org-protocol';
import type { OrgStateView } from '../protocol/identity';

/** How old a cached head may be when an event needs it. */
export const STATE_MAX_AGE_MS = 60_000;
/** How often an unknown signer may send the cache back to the Registry. */
export const UNKNOWN_SIGNER_READ_MS = 1_000;

/** A v2 event's check: accepted, or refused with the reason and the message the uploader's refusal carries. */
export type SignatureCheck = { ok: true } | { ok: false; reason: 'bad-signature' | 'state-unavailable'; message: string };

/** The head as read: its state (null before the org's first), its certificates, and when the read was sent. */
type Held = { state: OrgState | null; certificates: Certificates; version: number; read: number };

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
    let held = await this.usable();
    if (!held) return STATE_UNAVAILABLE;
    let verdict = await this.verify(ctx, held, event);
    if (!verdict.ok && verdict.code === 'unknown-signer' && this.now() - this.lastRead >= UNKNOWN_SIGNER_READ_MS) {
      held = await this.fresh().catch(() => undefined);
      if (held) verdict = await this.verify(ctx, held, event);
    }
    if (verdict.ok) return verdict;
    return { ok: false, reason: 'bad-signature', message: `the v2 signature does not verify against the org state (${verdict.code})` };
  }

  private verify(ctx: EventContext, held: Held, event: LogEventV2): Promise<Verdict> {
    if (held.state === null) return Promise.resolve({ ok: false, code: 'unknown-signer' });
    return verifyEvent(ctx, held.state, event, held.certificates, new Date(this.now()));
  }

  /** The held head when it is young enough and no announcement outran it; else a fresh read; else undefined. */
  private async usable(): Promise<Held | undefined> {
    const held = this.held;
    if (held && this.now() - held.read <= STATE_MAX_AGE_MS && held.version >= this.announced) return held;
    try {
      let read = await this.fresh();
      // A read sent before the announcement may answer the version before it: one more read is after it.
      if (read.version < this.announced) read = await this.fresh();
      return read.version >= this.announced ? read : undefined;
    } catch {
      return undefined;
    }
  }

  /** Reads the head, one read at a time: callers that need one while it is out share it. */
  private fresh(): Promise<Held> {
    this.reading ??= (async () => {
      const read = (this.lastRead = this.now());
      try {
        const view = await this.readHead();
        const state = view.head?.state ?? null;
        const held: Held = { state, certificates: view.certificates, version: state?.version ?? 0, read };
        if (!this.held || held.version >= this.held.version) this.held = held;
        return held;
      } finally {
        this.reading = undefined;
      }
    })();
    return this.reading;
  }
}
