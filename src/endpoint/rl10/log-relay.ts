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
// Down. An arriving event goes to sminos only verified, wrapped `{event, signer, owners?}`:
//   - under one of this machine's own writers (its current name, or a former one `machineNames` binds to its ref), only
//     as an echo of what the endpoint signed at that `(project, writer, seq)`, the same upload form and signature: this
//     machine is the only source of its own writers, so anything else there (no ledger entry, another body, a signed
//     body reposted at a new position) is a hub's invention;
//   - a v2 event, by `verifyEvent` against the head and certificates, then once only: its signed content seen at another
//     position (the inbound index) is `replayed`. Its `signer` names the key id its signature names, and its attestation
//     goes down as verified owners;
//   - a v1-only event (a `mac`, no `sig`) from a machine not yet moved, when DX1's code verifies under the legacy key,
//     with `signer: {kind: 'legacy'}`.
// Anything else is refused up the log plane as DX2's `rejected` and never reaches sminos. The hub's Rejection takes
// four reasons, so the endpoint's verdict rides in its message: a forged or unverifiable event `bad-code`, a replay
// `seen-nonce`, an own-writer event that is no echo `conflict`, a shape `bad-shape`.
//
// Lost on the way. RL10 takes what is written, but RL1 can be down while sminos uploads (its first `have` came on an
// earlier RL1 connection), and what the hub never took would be lost: sminos's upload cursor only moves forward. So the
// first `have` of each project after an RL1 welcome is compared with what the ledger signed, and each own writer the
// hub holds less of is asked again from sminos with DX2's `resend`, which rebuilds the same bytes from the ledger.
import { createHash } from 'node:crypto';
import {
  eventSigningInput,
  isHubWriter,
  isIsoMillis,
  isLogSeq,
  isSig,
  keyId,
  machineNameKey,
  refOfName,
  signEvent,
  verifyEvent,
  writerMachine,
  type Certificates,
  type LogEventV2,
  type OrgState,
  type SigningKey,
} from 'org-protocol';
import type { LogProject } from '../hub-link';
import { attestFor, sessionOfWriter, verifiedOwners } from './attest';
import type { InboundIndex } from './inbound-index';
import type { LegacyKey } from './legacy';
import type { Members } from './members';
import { bodyHash, uploadForm, type Signature, type SignatureLedger } from './signature-ledger';

type Frame = { t: string } & Record<string, unknown>;

export type Signer = { kind: 'device'; member: string; device: string; keyId: string } | { kind: 'machine'; ref: string; name: string; keyId: string } | { kind: 'legacy' };
export type Wrapped = { event: Record<string, unknown>; signer: Signer; owners?: Array<{ id: string; email: string | null }> };
/** DX2's `rejected` up: the event named only by what it carried. */
export type Rejected = { t: 'rejected'; project: string; event: { writer: string; seq: number } | null; reason: 'bad-code' | 'seen-nonce' | 'bad-shape' | 'conflict'; message: string };

export type RelayContext = {
  /** The head and certificates, the machine's ref and its current name; null while none is held. */
  org(): { head: OrgState; certificates: Certificates; ref: string; name: string } | null;
  key(): { key: SigningKey; keyId: string } | null;
  members: Members;
  ledger: SignatureLedger;
  index: InboundIndex;
  legacy: LegacyKey;
  hub: { openProject(project: string, handler: LogProject): () => void; send(frame: Frame): boolean };
  /** A frame down RL10 to sminos (dropped when it isn't connected). */
  toSminos(frame: Frame): void;
  /** A project sminos opened (listings re-judge what they relay). */
  opened(project: string): void;
  now(): number;
  log(line: string): void;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const position = (e: unknown): { writer: string; seq: number } | null => (isObject(e) && typeof e.writer === 'string' && typeof e.seq === 'number' ? { writer: e.writer, seq: e.seq } : null);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64url');

export class LogRelay {
  readonly #ctx: RelayContext;
  /** The projects sminos opened on this connection: their latest hello, and their close on RL1. */
  readonly #projects = new Map<string, { hello: { name: string; have: Record<string, number>; follow?: boolean }; close: () => void }>();
  /** Projects whose first `have` since the RL1 welcome is still to come. */
  readonly #fresh = new Set<string>();
  /** Each machine name's newest relayed event time (the org directory's `seen`). */
  readonly #seen = new Map<string, string>();

  constructor(ctx: RelayContext) {
    this.#ctx = ctx;
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

  /** sminos's own events up: each signed (or rebuilt from the ledger) and sent on, or refused to sminos. */
  async events(frame: Frame): Promise<void> {
    const { project, events } = frame;
    if (typeof project !== 'string' || !Array.isArray(events)) return this.#ctx.log('endpoint: an RL10 events frame that is not one was ignored');
    const out: Record<string, unknown>[] = [];
    for (const e of events) {
      const signed = await this.#up(project, e);
      if ('event' in signed) out.push(signed.event);
      else {
        const at = position(e);
        this.#ctx.toSminos({ t: 'refused', project, refusal: { reason: signed.reason, ...(at ?? {}), message: signed.message } });
      }
    }
    if (out.length > 0) this.#ctx.hub.send({ t: 'events', project, events: out });
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
  }

  /** An RL1 connection was welcomed: each project's first `have` on it is checked against the ledger. */
  hubWelcomed(): void {
    for (const project of this.#projects.keys()) this.#fresh.add(project);
  }

  async #up(project: string, e: unknown): Promise<{ event: Record<string, unknown> } | { reason: string; message: string }> {
    const org = this.#ctx.org();
    const key = this.#ctx.key();
    if (!isObject(e) || typeof e.writer !== 'string' || !isLogSeq(e.seq)) return { reason: 'bad-shape', message: 'not a log event (writer, seq)' };
    const { writer, seq } = e as { writer: string; seq: number };
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
      if (held.hash === hash) return { event: rebuilt(form, held) };
      this.#ctx.log(`endpoint: sminos uploaded another body at ${writer}:${seq} in project ${project}, where the endpoint signed one already: refused (conflict), not signed again`);
      return { reason: 'conflict', message: `${writer}:${seq} was signed with another body` };
    }
    const session = sessionOfWriter(writer);
    const member = session === null ? null : this.#ctx.members.get(session);
    const now = new Date(this.#ctx.now());
    const attest = member === null ? undefined : await attestFor(member, org.head, org.ref, org.certificates, now);
    const body = attest === undefined ? form : { ...form, attest };
    const signed = await signEvent({ org: org.head.org, project }, body, key.key.privateKey, key.key.pub);
    const mac = await this.#ctx.legacy.mac(project, signed);
    const signature: Signature = { hash, sig: signed.sig, ...(attest === undefined ? {} : { attest }), ...(mac === null ? {} : { mac }) };
    this.#ctx.ledger.put(project, writer, seq, signature);
    return { event: rebuilt(form, signature) };
  }

  // ---- hub → sminos -----------------------------------------------------------------------------------------------

  /** A log-plane frame from the hub for an open project (`have`, `events`, `resend`, `refused`), in the project's order. */
  async fromHub(frame: { t: string; project: string } & Record<string, unknown>): Promise<void> {
    if (!this.#projects.has(frame.project)) return;
    if (frame.t === 'events') return this.#arrived(frame.project, frame.events);
    this.#ctx.toSminos(frame);
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
      if (signed > at) this.#ctx.toSminos({ t: 'resend', project, writer, from: at + 1 });
    }
  }

  async #arrived(project: string, events: unknown): Promise<void> {
    if (!Array.isArray(events)) return;
    const down: Wrapped[] = [];
    for (const e of events) {
      const verdict = await this.#verify(project, e);
      if ('event' in verdict) down.push(verdict);
      else {
        const at = position(e);
        this.#ctx.log(`endpoint: refused an event the hub sent in project ${project}${at === null ? '' : ` at ${at.writer}:${at.seq}`}: ${verdict.message}`);
        this.#ctx.hub.send({ t: 'rejected', project, event: at, reason: verdict.reason, message: verdict.message } satisfies Rejected);
      }
    }
    if (down.length > 0) this.#ctx.toSminos({ t: 'events', project, events: down });
  }

  async #verify(project: string, e: unknown): Promise<Wrapped | { reason: Rejected['reason']; message: string }> {
    if (!isObject(e) || typeof e.writer !== 'string' || !isLogSeq(e.seq) || typeof e.ts !== 'string' || typeof e.kind !== 'string') {
      return { reason: 'bad-shape', message: 'not a log event (writer, seq, ts, kind)' };
    }
    const org = this.#ctx.org();
    if (org === null) return { reason: 'bad-code', message: 'unverifiable: the endpoint holds no org state' };
    const event = e as LogEventV2 & { seq: number; ts: string };
    const name = writerMachine(event.writer);
    if (name !== null && this.#own(org.head, org.ref, name)) return this.#echo(project, event, name, org);
    if (isSig(event.sig)) {
      const now = new Date(this.#ctx.now());
      const verdict = await verifyEvent({ org: org.head.org, project }, org.head, event, org.certificates, now);
      if (!verdict.ok) return { reason: 'bad-code', message: `its v2 signature does not verify (${verdict.code})` };
      const content = sha256(eventSigningInput({ org: org.head.org, project }, event));
      const seen = this.#ctx.index.seen(project, content, event.writer, event.seq);
      if (seen.kind === 'replayed') return { reason: 'seen-nonce', message: `replayed: its signed content arrived at ${seen.writer}:${seen.seq} before` };
      if (seen.kind === 'new') this.#ctx.index.record(project, content, event.writer, event.seq);
      const signer = await signerOf(org.head, org.certificates, event);
      if (signer === null) return { reason: 'bad-code', message: 'its signer could not be named' };
      if (name !== null && isIsoMillis(event.created)) this.#saw(name, event.created);
      const owners = await verifiedOwners(event, org.head, org.certificates, this.#ctx.log);
      return { event, signer, ...(owners === undefined ? {} : { owners }) };
    }
    if (isObject(event.mac)) {
      if (await this.#ctx.legacy.verifies(project, event)) {
        if (name !== null) this.#saw(name, event.ts);
        return { event, signer: { kind: 'legacy' } };
      }
      return { reason: 'bad-code', message: this.#ctx.legacy.held ? 'its DX1 code does not verify under the legacy key' : 'a v1 event, and the endpoint holds no legacy key to check it' };
    }
    return { reason: 'bad-shape', message: 'it carries neither a sig nor a mac' };
  }

  /** An event under one of this machine's own writers: only the echo of what the endpoint signed at its position. */
  async #echo(project: string, event: LogEventV2 & { seq: number }, name: string, org: { head: OrgState; certificates: Certificates; ref: string }): Promise<Wrapped | { reason: Rejected['reason']; message: string }> {
    const held = this.#ctx.ledger.get(project, event.writer, event.seq);
    const form = uploadForm(event);
    let same = false;
    if (held !== null && form !== null && isSig(event.sig)) {
      try {
        same = bodyHash(form) === held.hash && event.sig.kid === held.sig.kid && event.sig.value === held.sig.value && JSON.stringify(event.attest ?? null) === JSON.stringify(held.attest ?? null);
      } catch {
        same = false;
      }
    }
    if (!same) return { reason: 'conflict', message: `not what this machine signed at ${event.writer}:${event.seq}: only this machine writes its own writers` };
    const owners = await verifiedOwners(event, org.head, org.certificates, this.#ctx.log);
    return { event, signer: { kind: 'machine', ref: org.ref, name, keyId: event.sig.kid }, ...(owners === undefined ? {} : { owners }) };
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

/** An own event as it goes up: the upload form with what the endpoint added, in the order it first went. */
function rebuilt(form: Record<string, unknown>, signature: Signature): Record<string, unknown> {
  return { ...form, ...(signature.attest === undefined ? {} : { attest: signature.attest }), sig: signature.sig, ...(signature.mac === undefined ? {} : { mac: signature.mac }) };
}

/** Who signed a verified v2 event: a member's device for a `hub/` writer, else the machine its name binds (by the head's
 * `machineNames`, or a certificate bearing the name). */
async function signerOf(head: OrgState, certificates: Certificates, event: LogEventV2): Promise<Signer | null> {
  const kid = event.sig.kid;
  if (isHubWriter(event.writer)) {
    const member = event.writer.slice('hub/'.length);
    for (const m of head.members) {
      if (m.id !== member) continue;
      for (const d of m.devices) if ((await keyId(d.channelPub)) === kid) return { kind: 'device', member, device: d.id, keyId: kid };
    }
    const retired = head.retired.find((r) => r.keyId === kid && 'member' in r.holder && r.holder.member === member);
    return retired !== undefined && 'device' in retired.holder ? { kind: 'device', member, device: retired.holder.device, keyId: kid } : null;
  }
  const name = writerMachine(event.writer);
  if (name === null) return null;
  const ref = refOfName(head, name) ?? certificates.certs.find((c) => machineNameKey(c.body.name) === machineNameKey(name))?.body.machine;
  return ref === undefined ? null : { kind: 'machine', ref, name, keyId: kid };
}
