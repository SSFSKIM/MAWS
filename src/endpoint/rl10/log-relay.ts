// The log plane between sminos and the hub (O10 M6; RL §5.7, RL8, RL9; Interfaces §D). RL1 carries DX2's log-plane
// vocabulary unchanged (P5 Decision Log 17), so the relay forwards sminos's `hello`, `events` and `rejected` to RL1 and
// the hub's `have`, `events`, `resend` and `refused` back, adding the signatures up and verifying down. A project the
// endpoint relays is one sminos opened with a log-plane `hello`; it stays open on RL1 until sminos's connection ends.
//
// Up. Each own event is signed once, as its `events` frame arrives and before the next frame is read, in its upload
// form (signature-ledger.ts): `attest` added for a session writer (attest.ts), the v2 `sig` over it, then DX1's `mac`
// while the legacy key is held (legacy.ts), all kept in the signature ledger before the event leaves. A position the
// ledger holds is resent byte for byte from what it kept; another body there is refused to sminos (`conflict`) and
// logged, never signed again. An event with no upload form is refused `malformed`; one under a writer not this
// machine's current name, `writer-not-yours`.
//
// The uplink. Signed uploads go up through the uplink (uplink.ts): a capped queue for the hub link's room, which lets
// an upload past its cap go and asks sminos for it again (`resend`), one hole at a time. The relay hands it each signed
// upload, every refusal sminos hears (the endpoint's own and the hub's), the hub's `resend`s, and each RL1 welcome's
// comparison of the hub's `have` with the ledger (below).
//
// Down. An arriving event goes to sminos only verified, wrapped `{event, signer, owners?}`:
//   - under one of this machine's own writers (its current name, or a former one `machineNames` binds to its ref), only
//     as an echo of what the endpoint signed at that `(project, writer, seq)`, the same upload form and signature: this
//     machine is the only source of its own writers, so anything else there (no ledger entry, another body, a signed
//     body reposted at a new position) is a hub's invention;
//   - a v2 event, by `verifyEvent` against the head and certificates, then once only: its signed content seen at another
//     position (the inbound index) is `replayed`. Its `signer` names the key id its signature names, and its attestation
//     goes down as verified owners;
//   - a v1-only event (a `mac`, no `sig`) from a machine not yet moved, when DX1's code verifies under the legacy key,
//     with `signer: {kind: 'legacy'}`; once the org state retires the key (legacy.ts's tombstone, O14 M5a), at once and
//     unchecked, as an inert record: `signer: {kind: 'legacy', checked: false}`, never held nor spent, so a machine
//     enrolled after the retirement reads the org's phase-1 history (sminos shows a legacy signer `(unverified,
//     legacy)` and never delivers it as words).
// What can't go down is judged by whether a later head could change the verdict.
//   - Final (no later head can change it): a bad shape, an own-writer event that is no echo, a replay, a v2 signature
//     that fails under a key the head knows (or whose key the head has revoked, or the state retired before its
//     `created`), a v1 code that fails under the held legacy key. It is refused up the log plane as DX2's `rejected`, and its
//     position goes down to sminos as `spent {project, writer, seq, reason}`, in stream order where the event would
//     have gone (the `events` frame split around it), with no content: sminos records the position as one it refused
//     itself, so the writer's later events aren't held behind it. The hub's Rejection takes four reasons, so the
//     endpoint's verdict rides in its message: a forged or unverifiable event `bad-code`, a replay `seen-nonce`, an
//     own-writer event that is no echo `conflict`, a shape `bad-shape`.
//   - Not yet decidable (a signer or key the endpoint's head doesn't know, as when it is behind the hub's; a machine
//     certificate lapsed at its `created`, which a renewal not yet received may accept; no head yet; a v1 event while
//     no legacy key is held): held, neither rejected nor spent, and verified again each time the head
//     or the certificates move or the legacy key arrives (`retry`). The hold is bounded (`HOLD_MAX` events, each
//     `HOLD_MS`); one let go is only forgotten, and comes again from the hub at sminos's next log-plane hello, since
//     sminos's `have` stops below it.
//     A hold a newer head or certificate set could settle (its signer or key unknown, its certificate lapsed) asks the
//     endpoint for a read of the hub's org state (`behind`): storing or retiring a certificate moves no org-state
//     version, so no `state` notice tells the endpoint of it, and a machine's first events after it enrolls, cuts over
//     or renews would otherwise wait for the next periodic read. A key asks at most once per `HELD_READ_MS`: a burst of
//     its events asks once, and a key the read left unknown asks no more until then, however many of its events come.

// Message reach (P5 O18, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md D4–D7, D9).
//   - Up: every own event is signed with the audience the endpoint computes for it from its own records and policy
//     cache (audiences.ts): the meet of its writing session's and each addressed session's. A writer's digest that
//     isn't that audience's, recipients that give differing ones, or an audience no member is in, is refused to sminos
//     as `audience`; a snapshot (`joined`, `state`) and an `unlisted` notice gain the record's `policyRev`; a notice's
//     audience is checked to be the members its change withdraws, from the cache's history of the session's policy; a
//     `void` (a content-free filler at a position refused `audience`) carries the audience sminos claims for its writer,
//     signed when it hashes to the writer's digest. Provenance references whose session's audience doesn't contain the
//     event's are written null before signing (the attestation's spawner left out), and the ledger keeps what was
//     signed, so a resend is byte for byte and the audience frozen. An upload naming a session the cache hasn't
//     confirmed while its rebuild is incomplete, or a stream event while the hub's welcome lacks `audience`, is held:
//     neither signed nor refused, its position a parked hole released when the cache or the hub can decide it.
//   - Down: the hub's tombstone of a withheld position goes to sminos as `spent {reason: 'withheld'}` in stream order,
//     and every verified snapshot of a remote session feeds the policy cache, passed down or not. To an sminos whose
//     hello lacks `audience`, nothing that names a stream writer goes down: no event, `have` entry, `spent`,
//     `refused` or `resend` (its archive would copy them to the project's shared remote, D9).

// Lost on the way. RL10 takes what is written, but RL1 can be down while sminos uploads (its first `have` came on an
// earlier RL1 connection), and what the hub never took would be lost: sminos's upload cursor only moves forward. So the
// first `have` of each project after an RL1 welcome is compared with what the ledger signed, and each own writer the
// hub holds less of is asked again from sminos with DX2's `resend`, which rebuilds the same bytes from the ledger.
import { createHash } from 'node:crypto';
import {
  audienceDigest,
  eventSigningInput,
  HUB_WRITER_PREFIX,
  isAudience,
  isHubWriter,
  isIsoMillis,
  isLogSeq,
  isSig,
  isWithheldTombstone,
  keyId,
  machineNameKey,
  refOfName,
  sessionRefs,
  signEvent,
  streamOf,
  verifyEvent,
  writerMachine,
  writerSession,
  type Certificates,
  type LogEventV2,
  type OrgState,
  type SigningKey,
} from 'org-protocol';
import type { LogProject } from '../hub-link';
import { attestFor, sessionOfWriter, verifiedOwners } from './attest';
import { contains, digestOf, knownAudience, localPolicy, meet, sameAudience, type AudienceContext } from './audiences';
import { PolicyCache, type Audience } from './policy-cache';
import type { InboundIndex } from './inbound-index';
import type { LegacyKey } from './legacy';
import type { Members } from './members';
import { bodyHash, uploadForm, type Signature, type SignatureLedger } from './signature-ledger';
import { Uplink, type UplinkContext } from './uplink';

type Frame = { t: string } & Record<string, unknown>;

export type Signer = { kind: 'device'; member: string; device: string; keyId: string } | { kind: 'machine'; ref: string; name: string; keyId: string } | { kind: 'legacy'; checked?: false };
export type Wrapped = { event: Record<string, unknown>; signer: Signer; owners?: Array<{ id: string; email: string | null }> };
/** DX2's `rejected` up: the event named only by what it carried. */
export type Rejected = { t: 'rejected'; project: string; event: { writer: string; seq: number } | null; reason: 'bad-code' | 'seen-nonce' | 'bad-shape' | 'conflict'; message: string };
type Uploaded = { event: Record<string, unknown> } | { reason: string; message: string } | { hold: string };
/** Why a position was spent (`spent`'s `reason`): the endpoint's own words for a final verdict, or the hub's tombstone. */
export type SpentReason = 'bad-shape' | 'conflict' | 'replayed' | 'bad-signature' | 'revoked' | 'expired' | 'withheld';
/** What the signer makes of an own event's audience (see the header). */
type Judgment = { audience: Audience; policyRev?: number; redact: string[]; spawner: boolean } | { refuse: string; reason?: string } | { hold: string };
/** What the endpoint makes of an arriving event (see the header). `read`: the key a read of the hub's state may bring. */
type Judged =
  | { deliver: Wrapped }
  | { spent: SpentReason; reason: Rejected['reason']; message: string }
  | { hold: string; read?: string };

const HUB_LACKS_STREAMS = "the hub's welcome advertises no audience streams";

/** How many arriving events the relay holds at most, and how long each, while their verdict waits on the head. */
export const HOLD_MAX = 1000;
export const HOLD_MS = 3_600_000;
/** How often one key a held event names may ask for a read of the hub's org state (`RelayContext.behind`). */
export const HELD_READ_MS = 60_000;

export type RelayContext = {
  /** The head and certificates, the machine's ref and its current name; null while none is held. */
  org(): { head: OrgState; certificates: Certificates; ref: string; name: string } | null;
  key(): { key: SigningKey; keyId: string } | null;
  members: Members;
  ledger: SignatureLedger;
  index: InboundIndex;
  legacy: LegacyKey;
  /** `writable`: resolves once the hub link's socket has room (hub-link.ts), which the uplink waits for. */
  hub: { openProject(project: string, handler: LogProject): () => void; send(frame: Frame): boolean; writable?(): Promise<void> };
  /** A frame down RL10 to sminos (dropped when it isn't connected). */
  toSminos(frame: Frame): void;
  /** A project sminos opened (listings re-judge what they relay). */
  opened(project: string): void;
  /**
   * An event is held for a key a newer head or certificate set may bring: a read of the hub's org state, begun after
   * this call, whose adoption judges the held events again (`retry`).
   */
  behind?(): void;
  now(): number;
  log(line: string): void;
  /** The uplink's cap, reserve and ask wait (uplink.ts's defaults unless given). */
  uplink?: UplinkContext['limits'];
  /** P5 O18: the policy cache, which the signer reads and the hub's snapshots feed (one held in memory unless given). */
  cache?: PolicyCache;
  /** Whether sminos's RL10 hello advertised `audience`: only then do stream writers go down (D9). Absent: no. */
  streamsDown?(): boolean;
  /** Whether the hub's RL1 welcome advertised `audience`: only then do stream events go up (D9). Absent: no. */
  hubStreams?(): boolean;
  /** Whether the policy cache's rebuild is incomplete (link.ts): an unconfirmed session's upload is held meanwhile. */
  rebuilding?(): boolean;
  /** A remote session's policy moved in the cache. */
  policyChanged?(session: string): void;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const position = (e: unknown): { writer: string; seq: number } | null => (isObject(e) && typeof e.writer === 'string' && typeof e.seq === 'number' ? { writer: e.writer, seq: e.seq } : null);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64url');
/** A writer the hub stores (desk-hub's `eventShapeError`): `<machine>/<feed>`, at most 256 characters, none a control. */
const isWriterName = (writer: string) => /^[^/]+\/.+$/.test(writer) && writer.length <= 256 && ![...writer].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export class LogRelay {
  readonly #ctx: RelayContext & Required<Pick<RelayContext, 'cache' | 'streamsDown' | 'hubStreams' | 'rebuilding'>>;
  /** The projects sminos opened on this connection: their latest hello, and their close on RL1. */
  readonly #projects = new Map<string, { hello: { name: string; have: Record<string, number>; follow?: boolean }; close: () => void }>();
  /** Projects whose first `have` since the RL1 welcome is still to come. */
  readonly #fresh = new Set<string>();
  /** Each machine name's newest relayed event time (the org directory's `seen`). */
  readonly #seen = new Map<string, string>();
  /**
   * The uploads being signed, by `project\nwriter\nseq`: a position is checked, signed and kept in the ledger by one
   * upload at a time, across connections (a replaced connection's upload may still be signing when the new one resends).
   */
  readonly #signing = new Map<string, Promise<unknown>>();
  readonly #uplink: Uplink;
  /** The arriving events held for a head that can judge them, by project, then `writer\nseq`, in arrival order. */
  readonly #held = new Map<string, Map<string, { event: unknown; since: number }>>();
  /** The keys that asked for a read, and when, in that order: each asks again only `HELD_READ_MS` later. */
  readonly #asked = new Map<string, number>();
  /** The `retry`s begun (`#arrived` reads it). */
  #retries = 0;

  constructor(ctx: RelayContext) {
    this.#ctx = { cache: new PolicyCache(null, ctx.log), streamsDown: () => false, hubStreams: () => false, rebuilding: () => false, ...ctx };
    this.#uplink = new Uplink({
      send: (frame) => ctx.hub.send(frame),
      writable: () => ctx.hub.writable?.() ?? Promise.resolve(),
      toSminos: (frame) => this.#toSminos(frame),
      signed: (project, writer, seq) => ctx.ledger.get(project, writer, seq) !== null,
      waits: (writer) => this.#streamHeld(writer),
      now: () => ctx.now(),
      log: (line) => ctx.log(line),
      limits: ctx.uplink,
    });
  }

  /** The newest event time relayed from `name`'s writers, or null. */
  seen(name: string): string | null {
    return this.#seen.get(machineNameKey(name)) ?? null;
  }

  // ---- sminos → hub -----------------------------------------------------------------------------------------------

  /** sminos's log-plane `hello {project, name, have, follow?}`: the project opened on RL1 (its hello sent there now). */
  hello(frame: Frame): void {
    const { project, name, have, follow } = frame;
    if (typeof project !== 'string' || typeof name !== 'string' || !isObject(have)) return this.#ctx.log('endpoint: an RL10 log-plane hello that is not one was ignored');
    const hello = { name, have: have as Record<string, number>, ...(follow === true ? { follow: true } : {}) };
    const held = this.#projects.get(project);
    held?.close();
    const close = this.#ctx.hub.openProject(project, { hello: () => this.#projects.get(project)?.hello ?? hello, down: (down) => this.fromHub(down) });
    this.#projects.set(project, { hello, close });
    this.#fresh.add(project);
    if (held === undefined) this.#ctx.opened(project);
  }

  /** Whether sminos opened `project` on this connection. */
  relays(project: string): boolean {
    return this.#projects.has(project);
  }

  /** The projects sminos opened on this connection, in the order it opened them. */
  projects(): string[] {
    return [...this.#projects.keys()];
  }

  /** sminos's own events up: each signed (or rebuilt from the ledger) and sent on, or refused to sminos. */
  async events(frame: Frame): Promise<void> {
    const { project, events } = frame;
    if (typeof project !== 'string' || !Array.isArray(events)) return this.#ctx.log('endpoint: an RL10 events frame that is not one was ignored');
    const out: Record<string, unknown>[] = [];
    for (const e of events) {
      const signed = await this.#up(project, e);
      if ('event' in signed) out.push(signed.event);
      else if ('hold' in signed) {
        const at = position(e)!;
        if (this.#uplink.holding(project, at.writer) === null) this.#ctx.log(`endpoint: holding ${at.writer}:${at.seq} in project ${project} unsigned until it can be decided (${signed.hold})`);
        this.#uplink.hold(project, at.writer, at.seq);
      } else {
        const at = position(e);
        this.#toSminos({ t: 'refused', project, refusal: { reason: signed.reason, ...(at ?? {}), message: signed.message } });
        if (at !== null) this.#uplink.refused(project, at.writer, isLogSeq(at.seq) ? at.seq : 0, signed.reason);
      }
    }
    if (out.length > 0) this.#uplink.upload(project, out);
  }

  /** The positions held for the policy cache or the hub asked for again now (link.ts, when either can decide more). */
  release(): void {
    this.#uplink.release();
  }

  /** The first position of `writer` held unsigned, or null (a suite's view). */
  heldAt(project: string, writer: string): number | null {
    return this.#uplink.holding(project, writer);
  }

  /** Whether a frame names only what sminos may be sent: every stream writer is left out of one to an old sminos. */
  #toSminos(frame: Frame): void {
    if (this.#ctx.streamsDown()) return this.#ctx.toSminos(frame);
    const stream = (writer: unknown) => typeof writer === 'string' && streamOf(writer).digest !== null;
    if (stream(frame.writer) || (isObject(frame.refusal) && stream(frame.refusal.writer))) return;
    if (frame.t === 'have') {
      const plain = (map: unknown) => (isObject(map) ? Object.fromEntries(Object.entries(map).filter(([writer]) => !stream(writer))) : map);
      const out: Frame = { ...frame, have: plain(frame.have) };
      if (frame.withheld !== undefined) out.withheld = plain(frame.withheld);
      return this.#ctx.toSminos(out);
    }
    if (frame.t === 'events' && Array.isArray(frame.events)) {
      const events = frame.events.filter((w) => !stream((isObject(w) && isObject(w.event) ? w.event : w)?.writer as unknown));
      if (events.length === 0) return;
      return this.#ctx.toSminos({ ...frame, events });
    }
    this.#ctx.toSminos(frame);
  }

  /** The signed uploads' bytes waiting for the hub link's room. */
  get uplinkQueued(): number {
    return this.#uplink.queued;
  }

  /** sminos's `rejected` (an event it refused on import) on to the hub. */
  rejected(frame: Frame): void {
    if (typeof frame.project !== 'string') return;
    this.#ctx.hub.send(frame);
  }

  /** sminos's connection ended: its projects close on RL1 until it opens them again. */
  closeAll(): void {
    for (const { close } of this.#projects.values()) close();
    this.#projects.clear();
    this.#fresh.clear();
    this.#held.clear();
    this.#uplink.ended();
  }

  /** The head, the certificates or the legacy key moved: every held event judged again, in the order it arrived. */
  async retry(): Promise<void> {
    this.#retries++;
    for (const [project, held] of [...this.#held]) {
      const prior = new Map(held);
      held.clear();
      await this.#arrived(project, [...prior.values()].map((h) => h.event), (key) => prior.get(key)?.since);
      if (this.#held.get(project)?.size === 0) this.#held.delete(project);
    }
  }

  /** How many arriving events are held now. */
  get holding(): number {
    let n = 0;
    for (const held of this.#held.values()) n += held.size;
    return n;
  }

  /** An RL1 connection was welcomed: each project's first `have` on it is checked against the ledger. */
  hubWelcomed(): void {
    for (const project of this.#projects.keys()) this.#fresh.add(project);
  }

  async #up(project: string, e: unknown): Promise<Uploaded> {
    if (!isObject(e) || typeof e.writer !== 'string' || !isLogSeq(e.seq)) return { reason: 'bad-shape', message: 'not a log event (writer, seq)' };
    if (!isWriterName(e.writer)) return { reason: 'bad-shape', message: 'writer is <machine>/<feed>, without control characters' };
    const at = `${project}\n${e.writer}\n${e.seq}`;
    const before = this.#signing.get(at) ?? Promise.resolve();
    const run = before.then(() => this.#upAt(project, e as Record<string, unknown> & { writer: string; seq: number }));
    const settled = run.then(
      () => {},
      () => {},
    );
    this.#signing.set(at, settled);
    void settled.then(() => {
      if (this.#signing.get(at) === settled) this.#signing.delete(at);
    });
    return run;
  }

  async #upAt(project: string, e: Record<string, unknown> & { writer: string; seq: number }): Promise<Uploaded> {
    const org = this.#ctx.org();
    const key = this.#ctx.key();
    const { writer, seq } = e;
    if (org === null || key === null) return { reason: 'state-unavailable', message: 'the endpoint holds no org state or machine key now' };
    if (writerMachine(writer) === null || machineNameKey(writerMachine(writer) as string) !== machineNameKey(org.name)) {
      return { reason: 'writer-not-yours', message: `${writer} is not one of ${org.name}'s writers` };
    }
    const form = uploadForm(e);
    if (form === null) return { reason: 'malformed', message: 'its ts is no ISO 8601 UTC time, or it carries a created other than its ts' };
    let hash: string;
    try {
      hash = bodyHash(form);
    } catch (error) {
      return { reason: 'bad-shape', message: `not canonical JSON: ${(error as Error).message}` };
    }
    const held = this.#ctx.ledger.get(project, writer, seq);
    if (held !== null) {
      if (held.hash === hash) return this.#streamHeld(writer) ? { hold: HUB_LACKS_STREAMS } : { event: rebuilt(form, held) };
      this.#ctx.log(`endpoint: sminos uploaded another body at ${writer}:${seq} in project ${project}, where the endpoint signed one already: refused (conflict), not signed again`);
      return { reason: 'conflict', message: `${writer}:${seq} was signed with another body` };
    }
    const judged = await this.#judge(project, e, form, org);
    if ('refuse' in judged) return { reason: judged.reason ?? 'audience', message: judged.refuse };
    if ('hold' in judged) return judged;
    if (this.#streamHeld(writer)) return { hold: HUB_LACKS_STREAMS };
    const session = sessionOfWriter(writer);
    const member = session === null ? null : this.#ctx.members.get(session);
    const now = new Date(this.#ctx.now());
    const attest = member === null ? undefined : await attestFor(member, org.head, org.ref, org.certificates, now, { spawner: judged.spawner });
    const redacted = judged.redact.length === 0 ? undefined : { paths: judged.redact, hash: bodyHash(redact(form, judged.redact)) };
    const signature: Omit<Signature, 'sig'> = {
      hash,
      ...(attest === undefined ? {} : { attest }),
      ...(judged.audience === null ? {} : { audience: judged.audience }),
      ...(judged.policyRev === undefined ? {} : { policyRev: judged.policyRev }),
      ...(redacted === undefined ? {} : { redacted }),
    };
    const body = unsigned(form, signature);
    const signed = await signEvent({ org: org.head.org, project }, body, key.key.privateKey, key.key.pub);
    const mac = await this.#ctx.legacy.mac(project, signed);
    const kept: Signature = { ...signature, sig: signed.sig, ...(mac === null ? {} : { mac }) };
    this.#ctx.ledger.put(project, writer, seq, kept);
    return { event: rebuilt(form, kept) };
  }

  /**
   * Whether `writer`'s events wait for the hub (D9): a stream's while the hub's welcome lacks `audience`. Checked at
   * signing, at a resend of what the ledger signed, and again by the uplink as each upload leaves.
   */
  #streamHeld(writer: string): boolean {
    return streamOf(writer).digest !== null && !this.#ctx.hubStreams();
  }

  #audiences(org: { head: OrgState; certificates: Certificates; ref: string }): AudienceContext {
    return { org: () => org, members: this.#ctx.members, cache: this.#ctx.cache, now: this.#ctx.now };
  }

  /**
   * The audience an own event is signed with, or why it is refused or held (see the header). `e` is the event as sminos
   * sent it (a `void`'s claimed audience is read from it), `form` its upload form.
   */
  async #judge(project: string, e: Record<string, unknown> & { writer: string; seq: number }, form: Record<string, unknown>, org: { head: OrgState; certificates: Certificates; ref: string }): Promise<Judgment> {
    const { writer, seq } = e;
    const { digest } = streamOf(writer);
    const ctx = this.#audiences(org);
    const own = writerSession(writer);
    if (form.kind === 'void') {
      const extra = Object.keys(form).filter((k) => !['ts', 'writer', 'seq', 'kind', 'of', 'created'].includes(k));
      if (extra.length > 0 || form.of !== seq) return { refuse: 'a void is {ts, writer, seq, kind, of: seq, audience?}, and nothing else', reason: 'malformed' };
      if (digest === null) return e.audience === undefined ? { audience: null, redact: [], spawner: false } : { refuse: 'a void under a plain writer carries no audience' };
      if (!isAudience(e.audience) || audienceDigest(e.audience) !== digest) return { refuse: "a void's audience is its writer's: the one its digest names" };
      return { audience: [...e.audience], redact: [], spawner: false };
    }
    const member = own === null ? null : this.#ctx.members.get(own);
    if (form.kind === 'unlisted') return this.#notice(form, own, digest, org, ctx);
    const writing: Audience = own === null ? null : await audienceOrNull(ctx, own);
    const refs = sessionRefs(form);
    const known = new Map<string, Audience>();
    for (const session of new Set([...refs.map((r) => r.session), ...(typeof member?.origin.spawnerSession === 'string' ? [member.origin.spawnerSession] : [])])) {
      const k = await knownAudience(ctx, session);
      if (k.kind === 'unknown' && this.#ctx.rebuilding()) return { hold: `session ${session.slice(0, 64)} is not yet in the policy cache, whose rebuild is incomplete` };
      known.set(session, k.kind === 'unknown' ? null : k.audience);
    }
    const addressed = refs.filter((r) => r.role === 'addressing').map((r) => meet(writing, known.get(r.session) ?? null));
    const audience = addressed[0] ?? writing;
    if (addressed.some((a) => !sameAudience(a, audience))) return { refuse: 'its recipients give differing audiences: one event per audience' };
    if (audience !== null && audience.length === 0) return { refuse: 'no member may read it: the audiences it names do not meet' };
    if (digestOf(audience) !== digest) return { refuse: digest === null ? 'it names a private session: it is written under its audience stream' : "the writer's digest is not the audience the endpoint computes for it" };
    const redacted = refs.filter((r) => r.role === 'provenance' && !contains(known.get(r.session) ?? null, audience)).map((r) => r.path);
    const spawner = typeof member?.origin.spawnerSession !== 'string' || contains(known.get(member.origin.spawnerSession) ?? null, audience);
    const snapshot = own !== null && (form.kind === 'joined' || form.kind === 'state') && form.session === own;
    return { audience, ...(snapshot && member?.policyRev !== undefined ? { policyRev: member.policyRev } : {}), redact: redacted, spawner };
  }

  /** An `unlisted` notice (D6): a local session's, under its own namespace, its audience the members its change withdraws. */
  async #notice(form: Record<string, unknown>, own: string | null, digest: string | null, org: { head: OrgState }, ctx: AudienceContext): Promise<Judgment> {
    if (own === null || form.session !== own || 'text' in form || 'to' in form || digest === null) return { refuse: "an unlisted notice is its session's own, content-free, under a stream" };
    const member = this.#ctx.members.get(own);
    const now = await localPolicy(ctx, own);
    if (member === null || member.policyRev === undefined || now === null) return { refuse: 'an unlisted notice is signed only for a session this machine holds, at its policyRev' };
    const before = this.#ctx.cache.before(own, member.policyRev);
    if (before === undefined) return { refuse: `no audience of ${own.slice(0, 64)} before policyRev ${member.policyRev} is held to withdraw from` };
    const everyone = org.head.members.map((m) => m.id);
    const previous = before.audience ?? everyone;
    const next = now.members ?? everyone;
    const withdrawn = [...new Set(previous.filter((m) => !next.includes(m)))].sort();
    if (withdrawn.length === 0) return { refuse: 'the change withdraws no member: no unlisted notice' };
    if (audienceDigest(withdrawn) !== digest) return { refuse: "the notice's digest is not the members its change withdraws" };
    return { audience: withdrawn, policyRev: member.policyRev, redact: [], spawner: false };
  }

  // ---- hub → sminos -----------------------------------------------------------------------------------------------

  /** A log-plane frame from the hub for an open project (`have`, `events`, `resend`, `refused`), in the project's order. */
  async fromHub(frame: { t: string; project: string } & Record<string, unknown>): Promise<void> {
    if (!this.#projects.has(frame.project)) return;
    if (frame.t === 'events') return this.#arrived(frame.project, frame.events);
    // A gap the hub names in what the endpoint signed: a hole, asked for once there is room (uplink.ts).
    if (frame.t === 'resend' && typeof frame.writer === 'string' && isLogSeq(frame.from) && this.#uplink.resend(frame.project, frame.writer, frame.from)) return;
    this.#toSminos(frame);
    const refusal = frame.t === 'refused' && isObject(frame.refusal) ? frame.refusal : null;
    if (refusal !== null && typeof refusal.writer === 'string' && typeof refusal.reason === 'string') this.#uplink.refused(frame.project, refusal.writer, isLogSeq(refusal.seq) ? refusal.seq : 0, refusal.reason);
    if (frame.t === 'have' && this.#fresh.delete(frame.project)) this.#behind(frame.project, frame.have);
  }

  /** Each own writer the hub holds less of than the ledger signed, asked again from sminos (see the header). */
  #behind(project: string, have: unknown): void {
    const org = this.#ctx.org();
    if (org === null || !isObject(have)) return;
    for (const [writer, signed] of this.#ctx.ledger.reach(project)) {
      const name = writerMachine(writer);
      if (name === null || machineNameKey(name) !== machineNameKey(org.name)) continue;
      const at = typeof have[writer] === 'number' ? (have[writer] as number) : 0;
      this.#uplink.behind(project, writer, signed > at ? at + 1 : null);
    }
  }

  /** `since` gives a held event's first hold time, when it is judged again. */
  async #arrived(project: string, events: unknown, since?: (key: string) => number | undefined): Promise<void> {
    if (!Array.isArray(events)) return;
    let down: Wrapped[] = [];
    let read = false;
    const flush = () => {
      if (down.length > 0) this.#toSminos({ t: 'events', project, events: down });
      down = [];
    };
    for (const e of events) {
      // The hub's tombstone of a position it withheld (D5): spent, in stream order, so the writer goes on past it.
      if (isWithheldTombstone(e)) {
        flush();
        this.#toSminos({ t: 'spent', project, writer: e.writer, seq: e.seq, reason: 'withheld' satisfies SpentReason });
        continue;
      }
      // A hold judged while a `retry` began is judged again: that retry may have passed this project before the event
      // was held, and no later one comes unless the state moves. The check and the hold run with no await between.
      let judged: Judged;
      for (;;) {
        const retries = this.#retries;
        judged = await this.#verify(project, e);
        if (!('hold' in judged) || retries === this.#retries) break;
      }
      const at = position(e);
      if ('deliver' in judged) {
        this.#feed(judged.deliver, false);
        down.push(judged.deliver);
      } else if ('hold' in judged) {
        const kept = at !== null && this.#hold(project, at, e, judged.hold, since?.(`${at.writer}\n${at.seq}`));
        if (kept && judged.read !== undefined && this.#ask(judged.read)) read = true;
      } else {
        this.#ctx.log(`endpoint: refused an event the hub sent in project ${project}${at === null ? '' : ` at ${at.writer}:${at.seq}`}: ${judged.message}`);
        this.#ctx.hub.send({ t: 'rejected', project, event: at, reason: judged.reason, message: judged.message } satisfies Rejected);
        if (at !== null && isLogSeq(at.seq)) {
          flush();
          this.#toSminos({ t: 'spent', project, writer: at.writer, seq: at.seq, reason: judged.spent });
        }
      }
    }
    flush();
    if (read) this.#ctx.behind?.();
  }

  /**
   * A verified remote snapshot into the policy cache (D7): a `joined` or `state` of a session on another machine, under
   * its own writer or a stream of it, signed by that machine. Its audience is the stream's (none for a plain writer), its
   * owners the attestation's as verified. `rebuild`: read back from the log, where two machines leave it unbound.
   */
  #feed(wrapped: Wrapped, rebuild: boolean): void {
    const e = wrapped.event;
    if (wrapped.signer.kind !== 'machine' || typeof e.writer !== 'string' || (e.kind !== 'joined' && e.kind !== 'state')) return;
    const session = writerSession(e.writer);
    if (session === null || e.session !== session) return;
    const org = this.#ctx.org();
    const name = writerMachine(e.writer);
    if (org === null || name === null || this.#own(org.head, org.ref, name)) return;
    const { digest } = streamOf(e.writer);
    const audience = digest === null ? null : isAudience(e.audience) && audienceDigest(e.audience) === digest ? [...e.audience] : undefined;
    if (audience === undefined || typeof e.created !== 'string') return;
    const policyRev = Number.isSafeInteger(e.policyRev) && (e.policyRev as number) >= 0 ? (e.policyRev as number) : 0;
    const owners = (wrapped.owners ?? []).map((o) => o.id);
    if (this.#ctx.cache.take({ session, machine: wrapped.signer.ref, audience, policyRev, created: e.created, owners }, rebuild)) this.#ctx.policyChanged?.(session);
  }

  /**
   * A page of `snapshots?` (D7's rebuild): each stored snapshot verified again here, as an arriving one is, and taken
   * into the cache; sminos carries them and is never their source. What doesn't verify now is left out.
   */
  async snapshots(project: string, events: unknown): Promise<void> {
    if (!Array.isArray(events)) return;
    const org = this.#ctx.org();
    if (org === null) return;
    for (const raw of events) {
      if (!isObject(raw) || typeof raw.writer !== 'string' || !isSig(raw.sig)) continue;
      const event: Record<string, unknown> = { ...raw };
      delete event.verified;
      const signed = event as unknown as LogEventV2;
      const name = writerMachine(signed.writer);
      if (name === null || this.#own(org.head, org.ref, name)) continue;
      const verdict = await verifyEvent({ org: org.head.org, project }, org.head, signed, org.certificates, new Date(this.#ctx.now()));
      if (!verdict.ok) continue;
      const signer = await signerOf(org.head, org.certificates, signed);
      if (signer === null) continue;
      const owners = await verifiedOwners(signed, org.head, org.certificates, this.#ctx.log);
      this.#feed({ event, signer, ...(owners === undefined ? {} : { owners }) }, true);
    }
  }

  /** An arriving event kept for a head that can judge it (see the header), within the hold's bounds; false once let go. */
  #hold(project: string, at: { writer: string; seq: number }, event: unknown, why: string, first?: number): boolean {
    const now = this.#ctx.now();
    let held = this.#held.get(project);
    if (held === undefined) this.#held.set(project, (held = new Map()));
    const key = `${at.writer}\n${at.seq}`;
    const since = first ?? held.get(key)?.since ?? now;
    held.delete(key);
    if (now - since > HOLD_MS) {
      this.#ctx.log(`endpoint: let go of ${at.writer}:${at.seq} in project ${project}, held ${Math.round((now - since) / 60_000)} min (${why}); the hub sends it again at sminos's next hello`);
      return false;
    }
    held.set(key, { event, since });
    if (since === now) this.#ctx.log(`endpoint: holding ${at.writer}:${at.seq} in project ${project} until the head can judge it (${why})`);
    while (this.holding > HOLD_MAX) {
      const [oldestProject, oldest] = [...this.#held].find(([, h]) => h.size > 0) ?? [];
      const first = oldest?.keys().next().value;
      if (oldestProject === undefined || oldest === undefined || first === undefined) break;
      oldest.delete(first);
      this.#ctx.log(`endpoint: let go of ${first.replace('\n', ':')} in project ${oldestProject}: more than ${HOLD_MAX} events held`);
    }
    return true;
  }

  /** Whether the key `kid` asks for a read now: not within `HELD_READ_MS` of its last ask (see the header). */
  #ask(kid: string): boolean {
    const now = this.#ctx.now();
    for (const [k, at] of this.#asked) {
      if (now - at < HELD_READ_MS && this.#asked.size <= HOLD_MAX) break;
      this.#asked.delete(k);
    }
    if (this.#asked.has(kid)) return false;
    this.#asked.set(kid, now);
    return true;
  }

  async #verify(project: string, e: unknown): Promise<Judged> {
    if (!isObject(e) || typeof e.writer !== 'string' || !isLogSeq(e.seq) || typeof e.ts !== 'string' || typeof e.kind !== 'string') {
      return { spent: 'bad-shape', reason: 'bad-shape', message: 'not a log event (writer, seq, ts, kind)' };
    }
    const org = this.#ctx.org();
    if (org === null) return { hold: 'the endpoint holds no org state yet' };
    const event = e as LogEventV2 & { seq: number; ts: string };
    const name = writerMachine(event.writer);
    if (name !== null && this.#own(org.head, org.ref, name)) return this.#echo(project, event, name, org);
    if (isSig(event.sig)) {
      const now = new Date(this.#ctx.now());
      const verdict = await verifyEvent({ org: org.head.org, project }, org.head, event, org.certificates, now);
      if (!verdict.ok) {
        switch (verdict.code) {
          case 'unknown-signer':
            return { hold: 'its signer is not in the head this endpoint holds', read: event.sig.kid };
          case 'revoked':
            return { spent: 'revoked', reason: 'bad-code', message: 'revoked: the head revokes its signing key' };
          case 'expired':
            // A key the state retired keeps its notAfter for good; a machine certificate's runs to its delegation's
            // expiry or retirement, and a renewal this endpoint hasn't received yet may still accept it. verifyEvent
            // names no signer, so a certificate bearing the signing key is held.
            if (await certifies(org.certificates, event.sig.kid)) return { hold: 'its machine certificate had lapsed at its created, and a renewal may be on its way', read: event.sig.kid };
            return { spent: 'expired', reason: 'bad-code', message: 'expired: its key was retired before its created' };
          case 'bad-signature':
            return { spent: 'bad-signature', reason: 'bad-code', message: 'forged: its v2 signature does not verify under the key it names' };
          default:
            return { spent: 'bad-shape', reason: 'bad-shape', message: `its v2 signature can't be checked (${verdict.code})` };
        }
      }
      const signer = await signerOf(org.head, org.certificates, event);
      if (signer === null) return { hold: 'its signer could not be named under the head this endpoint holds', read: event.sig.kid };
      const content = sha256(eventSigningInput({ org: org.head.org, project }, event));
      const seen = this.#ctx.index.seen(project, content, event.writer, event.seq);
      if (seen.kind === 'replayed') return { spent: 'replayed', reason: 'seen-nonce', message: `replayed: its signed content arrived at ${seen.writer}:${seen.seq} before` };
      if (seen.kind === 'new') this.#ctx.index.record(project, content, event.writer, event.seq);
      if (name !== null && isIsoMillis(event.created)) this.#saw(name, event.created);
      const owners = await verifiedOwners(event, org.head, org.certificates, this.#ctx.log);
      return { deliver: { event, signer, ...(owners === undefined ? {} : { owners }) } };
    }
    if (isObject(event.mac)) {
      if (this.#ctx.legacy.retired) return { deliver: { event, signer: { kind: 'legacy', checked: false } } };
      if (!this.#ctx.legacy.held) return { hold: 'a v1 event, and the endpoint holds no legacy key to check it yet' };
      if (await this.#ctx.legacy.verifies(project, event)) {
        if (name !== null) this.#saw(name, event.ts);
        return { deliver: { event, signer: { kind: 'legacy' } } };
      }
      return { spent: 'bad-signature', reason: 'bad-code', message: 'forged: its DX1 code does not verify under the legacy key' };
    }
    return { spent: 'bad-shape', reason: 'bad-shape', message: 'it carries neither a sig nor a mac' };
  }

  /** An event under one of this machine's own writers: only the echo of what the endpoint signed at its position. */
  async #echo(project: string, event: LogEventV2 & { seq: number }, name: string, org: { head: OrgState; certificates: Certificates; ref: string }): Promise<Judged> {
    const held = this.#ctx.ledger.get(project, event.writer, event.seq);
    const form = uploadForm(event);
    let same = false;
    if (held !== null && form !== null && isSig(event.sig)) {
      try {
        same =
          bodyHash(form) === (held.redacted?.hash ?? held.hash) &&
          event.sig.kid === held.sig.kid &&
          event.sig.value === held.sig.value &&
          JSON.stringify(event.attest ?? null) === JSON.stringify(held.attest ?? null) &&
          JSON.stringify((event as { audience?: unknown }).audience ?? null) === JSON.stringify(held.audience ?? null) &&
          JSON.stringify((event as { policyRev?: unknown }).policyRev ?? null) === JSON.stringify(held.policyRev ?? null);
      } catch {
        same = false;
      }
    }
    if (!same) return { spent: 'conflict', reason: 'conflict', message: `not what this machine signed at ${event.writer}:${event.seq}: only this machine writes its own writers` };
    const owners = await verifiedOwners(event, org.head, org.certificates, this.#ctx.log);
    return { deliver: { event, signer: { kind: 'machine', ref: org.ref, name, keyId: event.sig.kid }, ...(owners === undefined ? {} : { owners }) } };
  }

  /** Whether `name` is one of the names `machineNames` binds to this machine's ref. */
  #own(head: OrgState, ref: string, name: string): boolean {
    return head.machineNames.some((p) => p.ref === ref && machineNameKey(p.name) === machineNameKey(name));
  }

  #saw(name: string, at: string): void {
    const k = machineNameKey(name);
    const held = this.#seen.get(k);
    if (held === undefined || at > held) this.#seen.set(k, at);
  }
}

/** Whether a machine certificate bears the key `kid` names. */
async function certifies(certificates: Certificates, kid: string): Promise<boolean> {
  for (const c of certificates.certs) if ((await keyId(c.body.pub)) === kid) return true;
  return false;
}

/** A local session's audience as the endpoint knows it, the whole org when it knows none. */
async function audienceOrNull(ctx: AudienceContext, session: string): Promise<Audience> {
  const known = await knownAudience(ctx, session);
  return known.kind === 'unknown' ? null : known.audience;
}

/** `form` with each dot path written null (a provenance reference redacted, D4); the rest untouched. */
function redact(form: Record<string, unknown>, paths: readonly string[]): Record<string, unknown> {
  const out = structuredClone(form);
  for (const path of paths) {
    const parts = path.split('.');
    let at: unknown = out;
    for (const part of parts.slice(0, -1)) at = isObject(at) || Array.isArray(at) ? (at as Record<string, unknown>)[part] : undefined;
    if (isObject(at) || Array.isArray(at)) (at as Record<string, unknown>)[parts[parts.length - 1]] = null;
  }
  return out;
}

/** What is signed: the upload form, redacted, with the endpoint's additions but the signature. */
function unsigned(form: Record<string, unknown>, signature: Omit<Signature, 'sig'>): Record<string, unknown> {
  return {
    ...(signature.redacted === undefined ? form : redact(form, signature.redacted.paths)),
    ...(signature.attest === undefined ? {} : { attest: signature.attest }),
    ...(signature.audience === undefined ? {} : { audience: signature.audience }),
    ...(signature.policyRev === undefined ? {} : { policyRev: signature.policyRev }),
  };
}

/** An own event as it goes up: the upload form with what the endpoint added, in the order it first went. */
function rebuilt(form: Record<string, unknown>, signature: Signature): Record<string, unknown> {
  return { ...unsigned(form, signature), sig: signature.sig, ...(signature.mac === undefined ? {} : { mac: signature.mac }) };
}

/** Who signed a verified v2 event: a member's device for a `hub/` writer or its stream, else the machine its name binds
 * (by the head's `machineNames`, or a certificate bearing the name). */
export async function signerOf(head: OrgState, certificates: Certificates, event: LogEventV2): Promise<Signer | null> {
  const kid = event.sig.kid;
  if (isHubWriter(event.writer)) {
    const member = streamOf(event.writer).base.slice(HUB_WRITER_PREFIX.length);
    for (const m of head.members) {
      if (m.id !== member) continue;
      for (const d of m.devices) if ((await keyId(d.channelPub)) === kid) return { kind: 'device', member, device: d.id, keyId: kid };
    }
    const retired = head.retired.find((r) => r.keyId === kid && 'member' in r.holder && r.holder.member === member);
    return retired !== undefined && 'device' in retired.holder ? { kind: 'device', member, device: retired.holder.device, keyId: kid } : null;
  }
  const name = writerMachine(event.writer);
  if (name === null) return null;
  const bound = refOfName(head, name);
  if (bound !== undefined) return { kind: 'machine', ref: bound, name, keyId: kid };
  // A certificate's name can be borne again by another delegated machine once the first is retired: the one whose key
  // signed is the signer.
  for (const c of certificates.certs) {
    if (machineNameKey(c.body.name) === machineNameKey(name) && (await keyId(c.body.pub)) === kid) return { kind: 'machine', ref: c.body.machine, name, keyId: kid };
  }
  return null;
}
