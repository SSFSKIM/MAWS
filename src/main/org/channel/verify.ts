// The project channel's verification (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Verification*): each event the hub's Project socket brings, judged against the held head and certificates. The hub
// is not trusted (RL §5.9); every byte rule is `org-protocol`'s.
//
// - A device's `human` (writer `hub/<member>`, or its audience stream `hub/<member>~<digest>`): `verifyEvent` alone,
//   which checks the signature against the channel keys of the member's devices, the hub's `writer`, `seq` and `ts`
//   outside what is signed. The writer's member must be the event's `member`. Its author is that member, named from the
//   held head. No machine attestation applies (`verifyAttestation` would answer `malformed`).
// - A machine's v2 event (writer `<machine>/…`, with `sig`): `verifyEvent`, then `verifyAttestation` when it attests
//   owners. Owners read only as RL9 verifies them, named by the held head, never by anything the event carries; an
//   attestation that doesn't verify leaves the event verified with no owners shown.
// - A DX1 event (a `mac`, no `sig`): the app holds no org key, so it never checks a `mac`. It reads `migrated` when a
//   checkpoint covers its writer and seq and its own canonical hash is the checkpoint's at that seq; other bytes at a
//   covered position fail; anything else reads `legacy`. A checkpoint is made once a history attestation verifies over
//   the writer's events from seq 1 (`verifyHistoryAttestation`), and keeps the hash of each event that passed, so the
//   verdict outlives the cache's bound (M7a's *The cache*) and extends to no event by writer and seq alone.
// - A withheld tombstone (`{writer, seq, withheld: true}`) is skipped. Anything else fails, and its caller keeps it,
//   counts it and judges it again at the next head.
//
// Electron-free.
import { createHash } from 'node:crypto';
import {
  canonicalize,
  HUB_WRITER_PREFIX,
  isHubWriter,
  isLogSeq,
  streamOf,
  verifyAttestation,
  verifyEvent,
  verifyHistoryAttestation,
  verifyHistorySigner,
  type Certificates,
  type EventContext,
  type HistoryAttestation,
  type LogEventV2,
  type OrgState,
  type Signed,
  type StoredEvent,
} from '../../../../apps/org-protocol/src/index.ts';
import { FORMER_MEMBER, type OrgMember } from '@shared/ipc/schema/org';
import { memberNames } from '@shared/org/member-name';

/** What an event drew from the held head: a label, or why it failed. */
export type Verdict =
  | { label: 'verified'; author?: OrgMember; owners?: OrgMember[] }
  | { label: 'migrated'; by: string }
  | { label: 'legacy' }
  | { failed: string };

/**
 * A writer's migrated history, once its attestation verified over its events from seq 1 to `upTo`: the record (its
 * signer re-checked at each load and head), who signed it, and the canonical hash of the event that passed at each seq.
 */
export type Checkpoint = { writer: string; upTo: number; by: { ref: string; name: string }; record: Signed<HistoryAttestation>; hashes: Record<string, string> };

/** What every judgment reads: the project, the held head and certificates, the time, and the writers' checkpoints. */
export type Judging = { ctx: EventContext; state: OrgState; certificates: Certificates; now: Date; checkpoints: ReadonlyMap<string, Checkpoint> };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The SHA-256 of the event's canonical form, exactly as stored (base64url). */
export const eventHash = (event: object): string => createHash('sha256').update(canonicalize(event)).digest('base64url');

/** A positioned event: a writer and a log seq; the rest is the judge's. */
export const isPositioned = (event: unknown): event is StoredEvent => isObject(event) && typeof event.writer === 'string' && isLogSeq(event.seq);

/** A withheld tombstone, which draws nothing. */
export const isTombstone = (event: unknown): boolean => isObject(event) && event.withheld === true;

/** A DX1 event: a `mac`, no v2 `sig`. */
export const isDx1 = (event: Record<string, unknown>): boolean => event.sig === undefined && event.mac !== undefined;

const namesByState = new WeakMap<OrgState, Map<string, string>>();

/** `id` as the held head names them (M5's `memberName`), or a former member. */
function memberOf(state: OrgState, id: string): OrgMember {
  let names = namesByState.get(state);
  if (names === undefined) namesByState.set(state, (names = memberNames(state.members)));
  const email = state.members.find((m) => m.id === id)?.email ?? null;
  return { id, email, name: names.get(id) ?? FORMER_MEMBER };
}

async function judgeSigned(event: StoredEvent, judging: Judging): Promise<Verdict> {
  const { ctx, state, certificates, now } = judging;
  const verdict = await verifyEvent(ctx, state, event as unknown as LogEventV2, certificates, now);
  if (!verdict.ok) return { failed: verdict.code };
  if (isHubWriter(event.writer)) {
    const member = streamOf(event.writer).base.slice(HUB_WRITER_PREFIX.length);
    if (event.member !== member) return { failed: 'not-the-writer' };
    return { label: 'verified', author: memberOf(state, member) };
  }
  if (event.attest === undefined) return { label: 'verified' };
  const attested = await verifyAttestation(state, certificates, event as unknown as LogEventV2);
  return attested.ok && attested.owners !== undefined ? { label: 'verified', owners: attested.owners.map((id) => memberOf(state, id)) } : { label: 'verified' };
}

function judgeDx1(event: StoredEvent, checkpoint: Checkpoint | undefined): Verdict {
  if (checkpoint === undefined || event.seq > checkpoint.upTo) return { label: 'legacy' };
  return checkpoint.hashes[String(event.seq)] === eventHash(event) ? { label: 'migrated', by: checkpoint.by.name } : { failed: 'not-attested' };
}

/** One event's verdict; null for a withheld tombstone, which is skipped. */
export async function judgeEvent(event: unknown, judging: Judging): Promise<Verdict | null> {
  if (isTombstone(event)) return null;
  if (!isPositioned(event)) return { failed: 'malformed' };
  if (event.sig !== undefined) return judgeSigned(event, judging);
  if (isDx1(event)) return judgeDx1(event, judging.checkpoints.get(event.writer));
  return { failed: 'malformed' };
}

/**
 * The checkpoint `record` makes over `events` (the writer's held events, any order; others are ignored), or null when it
 * doesn't verify for this project and writer: its signer and binding, and exactly one event per seq from 1 to `upTo`
 * folding to its digest.
 */
export async function checkpointOf(record: Signed<HistoryAttestation>, events: readonly StoredEvent[], judging: Judging): Promise<Checkpoint | null> {
  const writer = record.body?.writer;
  if (typeof writer !== 'string') return null;
  const prefix = events.filter((e) => e.writer === writer && e.seq <= record.body.upTo).sort((a, b) => a.seq - b.seq);
  const verdict = await verifyHistoryAttestation(record, prefix, judging.state, judging.certificates, { project: judging.ctx.project, writer }, judging.now);
  if (!verdict.ok) return null;
  return { writer, upTo: record.body.upTo, by: verdict.by, record, hashes: Object.fromEntries(prefix.map((e) => [String(e.seq), eventHash(e)])) };
}

/** Whether `record`'s signer and binding (this project, its writer) verify against the held head: before its writer is trusted with anything. */
export async function attestationSigned(record: Signed<HistoryAttestation>, judging: Judging): Promise<boolean> {
  const writer = record.body?.writer;
  if (typeof writer !== 'string') return false;
  return (await verifyHistorySigner(record, judging.state, judging.certificates, { project: judging.ctx.project, writer }, judging.now)).ok;
}

/** Whether a kept checkpoint's record still verifies its signer and binding against the held head (at each load). */
export async function recheckCheckpoint(checkpoint: Checkpoint, judging: Judging): Promise<boolean> {
  const verdict = await verifyHistorySigner(checkpoint.record, judging.state, judging.certificates, { project: judging.ctx.project, writer: checkpoint.writer }, judging.now);
  return verdict.ok && verdict.by.ref === checkpoint.by.ref && checkpoint.record.body.upTo === checkpoint.upTo;
}
