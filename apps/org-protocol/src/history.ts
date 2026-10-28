// History re-attestation (O14 M4; docs/doperpowers/plans/2026-10-27-p5-o14-cutover.md, Interfaces §D). A stored log
// position is immutable at the hub, so a cut-over machine's phase-1 history can't gain a v2 `sig` in place: instead the
// machine signs, once per project and writer, a checkpoint over that writer's events from seq 1 to `upTo`, which keeps
// them verifiable after the shared org key retires.
//
//   digest: h_0 = the empty string, h_i = SHA-256(h_{i-1} ‖ UTF-8 canonicalize(event_i without `mac`)), as bytes;
//           the record carries base64url(h_upTo). The `sig` of a dual-coded event is inside it, its `mac` is not.
//
// Who may sign for which writer. The record is signed by a machine key, which `names[0]` (the signer's current name)
// must bind by RL8's rule (`machineSigners`: the entry `machineNames` gives the name, by its current key or a retired one,
// or a certificate bearing the name, live or retired), its `created` no later than the key's `notAfter`. The writer's
// name `<name>/…` then binds to the signer
//   - by RL8's rule as well (the signer's own name, under the new protocol), or
//   - as a phase-1 former name the record claims in `names`, which no state ever held: `machineNames` gives it no ref, and
//     no certificate the verifier holds, live or retired, bears it for another ref. A retired certificate ended its
//     name's contest, not its history's ownership, so nobody else may claim a retired VM's name.
// A `hub/` or `legacy/` writer binds to no machine. A false claim over a name no one owns mislabels a reader's history
// and confers no authority, which is the trust phase-1 history had.
//
// The consumer contract (O7's log views, O8's project channel): a DX1 event whose project and writer have a stored
// attestation that verifies as attesting that very project and writer (`at`), its seq at most `upTo`, is drawn
// "attested at migration by <by.name>"; any other DX1 event is drawn (unverified, legacy).
import { base64urlEncode, isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';
import { keyId, signingInput, utf8, verifyInput } from './keys.ts';
import { isIsoMillis, isLogSeq, isMachineName, machineNameKey, writerMachine } from './names.ts';
import { machineOfSigner, machineSigners, refOfName } from './records.ts';
import { isCertificates, isMachineCert, isSigned } from './shapes.ts';
import { SIGNING_DOMAINS, type Certificates, type HistoryAttestation, type OrgState, type Signed } from './types.ts';

/** A log event as the hub stores and serves it: its position, and every other field as written. */
export type StoredEvent = { writer: string; seq: number; [field: string]: unknown };

/** Who a verified attestation is by: the signer's ref and the current name its record gives. */
export type HistorySigner = { ref: string; name: string };
/**
 * The project and writer a reader asks a record to attest. The record names them inside its signature, but the events it
 * covers don't (the digest leaves out the `mac` that bound each to its project), so a hub could serve one project's record
 * and events as another's: every verification is asked about a position, and a record of another one is `binding`.
 */
export type HistoryPosition = { project: string; writer: string };
export type HistoryVerdict = { ok: true; by: HistorySigner } | { ok: false; reason: 'signature' | 'binding' | 'digest' | 'short' };

// ---- The hub's routes (Interfaces §D) --------------------------------------------------------------------------

/** `GET ?names=<current,former…>` → `HistoryInventory`: every project whose log holds a DX1 event under those names. */
export const HISTORY_INVENTORY_PATH = '/machine/history-inventory';
/** How many names one inventory request may carry. */
export const HISTORY_NAMES_MAX = 32;
/** About how many bytes of events one page of a writer's log carries (`HistoryLogPage`). */
export const HISTORY_PAGE_BYTES = 1024 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `GET ?writer=<w>&after=<seq>` → `HistoryLogPage`, as the machine. */
export const HISTORY_LOG_ROUTE = new RegExp(`^/machine/projects/(${UUID})/log$`);
/** `POST {record}` (201 kept, 200 held already) and `GET` → `HistoryAttestations`, as the machine. */
export const HISTORY_ATTESTATIONS_ROUTE = new RegExp(`^/machine/projects/(${UUID})/attestations$`);
/** `GET` → `HistoryAttestations`, as a member. */
export const MEMBER_ATTESTATIONS_ROUTE = new RegExp(`^/api/projects/(${UUID})/attestations$`);
export const historyLogPath = (project: string, writer: string, after: number) => `/machine/projects/${project}/log?writer=${encodeURIComponent(writer)}&after=${after}`;
export const historyAttestationsPath = (project: string) => `/machine/projects/${project}/attestations`;
export const historyInventoryPath = (names: string[]) => `${HISTORY_INVENTORY_PATH}?names=${names.map(encodeURIComponent).join(',')}`;

/** Each project's writers under the named machines with their highest DX1 (`sig`-less) seq. */
export type HistoryInventory = { projects: Array<{ id: string; writers: Array<{ writer: string; upTo: number }> }> };
export type HistoryLogPage = { events: StoredEvent[]; more: boolean };
export type HistoryAttestations = { records: Signed<HistoryAttestation>[] };

// ---- The record --------------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FIELDS = ['org', 'project', 'writer', 'names', 'upTo', 'digest', 'created'];
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v !== '' && v.length <= max && !v.includes('\n');

/** Exactly the record's fields: names distinct machine names (by their key), the current first; a 32-byte digest. */
export function isHistoryAttestation(value: unknown): value is HistoryAttestation {
  if (!isObject(value) || Object.keys(value).length !== FIELDS.length || !FIELDS.every((f) => f in value)) return false;
  const { org, project, writer, names, upTo, digest, created } = value;
  if (!isText(org, 200) || !isText(project, 200) || !isText(writer, 256) || !/^[^/]+\/.+$/.test(writer)) return false;
  if (!Array.isArray(names) || names.length === 0 || names.length > HISTORY_NAMES_MAX) return false;
  if (!names.every((n) => typeof n === 'string' && isMachineName(n)) || new Set(names.map((n: string) => machineNameKey(n))).size !== names.length) return false;
  return isLogSeq(upTo) && isBase64urlOf(digest, 32) && isIsoMillis(created);
}

// ---- The digest ----------------------------------------------------------------------------------------------------

/** One step of the digest: SHA-256 of the previous value's bytes and the event's canonical form without its `mac`. */
export async function historyDigestStep(previous: Uint8Array, event: object): Promise<Uint8Array<ArrayBuffer>> {
  const bare: Record<string, unknown> = { ...event };
  delete bare.mac;
  const body = utf8(canonicalize(bare));
  const input = new Uint8Array(previous.length + body.length);
  input.set(previous);
  input.set(body, previous.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

/** The digest of `events`, folded in the order given (a writer's from seq 1 on). Throws on a value RFC 8785 can't write. */
export async function historyDigest(events: readonly object[]): Promise<string> {
  let h: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  for (const event of events) h = await historyDigestStep(h, event);
  return base64urlEncode(h);
}

// ---- Verification ------------------------------------------------------------------------------------------------

/**
 * The record's signer and its binding to the writer (see the header), judged at `now`, without the events: what the
 * hub's courtesy check runs on arrival. `signature` for a record that is malformed, of another org, or not signed by a
 * key `names[0]` binds at its `created`; `binding` for a record of another project or writer than `at`, or a writer the
 * signer can't speak for.
 */
export async function verifyHistorySigner(
  record: Signed<HistoryAttestation>,
  head: OrgState,
  certificates: Certificates,
  at: HistoryPosition,
  now: Date = new Date(),
): Promise<{ ok: true; by: HistorySigner } | { ok: false; reason: 'signature' | 'binding' }> {
  if (!isSigned(record, isHistoryAttestation) || !isCertificates(certificates) || record.body.org !== head.org) return { ok: false, reason: 'signature' };
  if (record.body.project !== at.project || record.body.writer !== at.writer) return { ok: false, reason: 'binding' };
  const { names, writer, created } = record.body;
  const current = names[0];
  const kid = record.sig.kid;
  let signer: string | null = null;
  for (const s of await machineSigners(head, current, certificates, now)) {
    if ((await keyId(s.pub)) !== kid || (s.notAfter !== null && created > s.notAfter)) continue;
    if (await verifyInput(signingInput(SIGNING_DOMAINS.historyAttest, record.body), record.sig, s.pub)) signer = s.pub;
    break;
  }
  const ref = signer === null ? null : (await machineOfSigner(head, current, kid, certificates, now))?.ref;
  if (signer === null || ref === undefined || ref === null) return { ok: false, reason: 'signature' };
  const by = { ref, name: current };
  const name = writerMachine(writer);
  if (name === null) return { ok: false, reason: 'binding' };
  // The writer's name under the new protocol: the signer's key is one RL8 lets sign as it.
  for (const s of await machineSigners(head, name, certificates, now)) if (s.pub === signer) return { ok: true, by };
  // A phase-1 former name the record claims, which no state and no certificate gives another ref.
  const key = machineNameKey(name);
  if (!names.some((n) => machineNameKey(n) === key)) return { ok: false, reason: 'binding' };
  const given = refOfName(head, name);
  if (given !== undefined && given !== ref) return { ok: false, reason: 'binding' };
  const certified = certificates.certs.some((c) => isSigned(c, isMachineCert) && c.body.org === head.org && machineNameKey(c.body.name) === key && c.body.machine !== ref);
  return certified ? { ok: false, reason: 'binding' } : { ok: true, by };
}

/**
 * A stored attestation of the writer at `at`, against the events the verifier holds (a whole log will do: the record's
 * writer's events at or before `upTo` are taken, in the order given). They must be exactly one event per position, seq 1
 * to `upTo` in turn: `short` when a position is missing (the events don't reach `upTo`, or skip one), `digest` when one
 * repeats or comes out of turn, or when they don't fold to the record's digest (an event changed). A digest over two
 * events at one position is never accepted, so a hub can't slip a forged event in beside a genuine one. Else the
 * signer's verdict.
 */
export async function verifyHistoryAttestation(
  record: Signed<HistoryAttestation>,
  events: readonly StoredEvent[],
  head: OrgState,
  certificates: Certificates,
  at: HistoryPosition,
  now: Date = new Date(),
): Promise<HistoryVerdict> {
  const signer = await verifyHistorySigner(record, head, certificates, at, now);
  if (!signer.ok) return signer;
  const { writer, upTo, digest } = record.body;
  if (!Array.isArray(events)) return { ok: false, reason: 'short' };
  const prefix = events.filter((e) => isObject(e) && e.writer === writer && isLogSeq(e.seq) && e.seq <= upTo);
  const seqs = new Set(prefix.map((e) => e.seq));
  if (seqs.size < upTo) return { ok: false, reason: 'short' };
  if (prefix.length !== upTo || prefix.some((e, i) => e.seq !== i + 1)) return { ok: false, reason: 'digest' };
  try {
    if ((await historyDigest(prefix)) !== digest) return { ok: false, reason: 'digest' };
  } catch {
    return { ok: false, reason: 'digest' };
  }
  return signer;
}
