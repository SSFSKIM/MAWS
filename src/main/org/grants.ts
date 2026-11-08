// A machine's rights from this Mac (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's *Grants*;
// Interfaces §R): `org.grants.view`, `.set` and `.regrant`. A grant is a record signed beside the org state, not a state:
// a member's rights on one machine at a version, signed by an owner's device (an admin's, for an org-owned machine) and
// kept by the machine's own ledger (src/endpoint/grants.ts), which takes only a version above its high-water mark.
//
// - The version is above both this Mac's issued record (grants.json, grants-store.ts) and the ledger's `highWater` for
//   that member, read through `endpoint.grants` just before signing. A read that fails refuses the sign `ledger-unread`:
//   no version is guessed.
// - Before Touch ID, `grantProblems` judges the unsigned draft with this device's step-up key as its signer (a refusal
//   asks nothing). One confirmation names the machine, the member and each right (`RecordSigner`, step-up.ts); then the
//   full `verifyGrant` runs against the head held then, before the grant is kept or sent.
// - Delivery: the record notes `pending` before the send, and the outcome after it. This Mac's own machine (the
//   session's `local`) takes the grant through its endpoint's local door (an `endpoint.local.act` carrying an RL4
//   `endpoint.grant`, no step-up: the grant's signature is its authority, the act's device attribution only); every other
//   machine over its RL2 link (`act`, `stepUp: 'never'`). Outcomes:
//     - `done`: on the machine;
//     - the ledger's own refusals of the grant (`not-newer`, `not-held`, `other-machine`), whether the door or the link
//       carries them (`{state: 'failed', error: {code}}`, or a door's `{state: 'refused', reason}`): final;
//     - `not-newer` is read once more first: the ledger holding this very grant is `done` (an earlier send landed),
//       another's is "Another device changed this grant: sign again", never a silent retry;
//     - an orphaned op (`unknown expired`, its ledger reopened) is sent again at once as a new op;
//     - anything else (offline, not sent, unknown, the machine's head behind this Mac's) stays `pending`, sent again when
//       the machine's link comes up and every DELIVERY_RETRY_MS. The ledger is idempotent, and a resend of a grant it
//       kept answers `not-newer`, read as above.
// - Missing: at each `endpoint.grants` answer, a grant this Mac issued and delivered whose version is above the ledger's
//   mark for its member is missing (the machine was enrolled again with a new key and an empty ledger). Re-grant… shows
//   each, signs them under one confirmation for the machine's current key, at versions above both marks, and delivers
//   them. A withdrawal (no rights) is never offered.
// - Verify once: a grant this Mac keeps is never judged again against a later head (RL §6.3), and none lapses by its
//   signer's later standing; the machine decides at arrival.
// - Each operation belongs to the sign-in it started under: once that sign-in ends (a sign-out, a quit), during Touch ID,
//   while the ledger read or the act is out, nothing more is kept, sent or recorded for it.
//
// Electron-free: the session injects the context, the store, the door and the links.
import {
  base64urlEncode,
  canonicalize,
  grantProblems,
  isAction,
  keyId,
  machineKeys,
  NONCE_BYTES,
  SIGNING_DOMAINS,
  verifyGrant,
  type Action,
  type Certificates,
  type Grant,
  type OrgState,
  type Right,
  type Signed,
} from '../../../apps/org-protocol/src/index.ts';
import { GrantsAnswerSchema, type GrantsEntry } from '@shared/ipc/schema/endpoint';
import { GRANT_RIGHTS, type GrantDelivered, type GrantRegrantResult, type GrantSetResult, type GrantsView } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { shown as promptValue } from '../device/prompt-text';
import type { RecordSigner, StepUpPrompt } from '../device/step-up';
import type { RemoteLink } from '../machines/remote/link';
import type { IssuedGrant } from './files';
import { GrantsDamaged, issuedFor, type GrantsFile, type GrantsStore } from './grants-store';
import { orgTiming, type OrgTiming } from './timing';

/** What a grant needs of a machine's link (main's `Machines.remote(ref)`). */
export type GrantLink = Pick<RemoteLink, 'state' | 'call' | 'act' | 'onState'>;
/** This Mac's own endpoint, through its local door (mawsd's main-only `endpoint.local.*`). */
export interface GrantDoor {
  /** `endpoint.local.act`: the act's outcome as `done` carries it, or its refusal (`{state: 'refused', reason}`). */
  act(action: Action): Promise<unknown>;
  /** `endpoint.local.grants`: the ledger as the machine's owners read it. */
  grants(): Promise<{ ok: true; output: unknown } | { ok: false; code: string }>;
}

/** The sign-in a grant is made under, as the session holds it now; null while signed out or unable to sign a record. */
export type GrantsContext = {
  org: string;
  member: string;
  device: string;
  head: OrgState;
  certificates: Certificates;
  signer: RecordSigner;
  /** Which sign-in this is: it changes only when one ends. */
  signIn: number;
};

export interface GrantsDeps {
  context(): GrantsContext | null;
  /** grants.json's store (loaded once, on first need). */
  store(): Promise<GrantsStore>;
  /** This Mac's own machine, reached through the door. */
  local: MachineRef | null;
  door: GrantDoor;
  /** A roster machine's link, null when there is none. */
  link(ref: MachineRef): GrantLink | null;
  roster(): readonly MachineRef[];
  onRoster(listener: () => void): () => void;
  /** `org.grants.changed`: a machine's grants moved (an issued grant kept or its outcome recorded, a ledger read). */
  changed(ref: string): void;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
}

export interface Grants {
  view(input: { ref: string }): Promise<GrantsView>;
  set(input: { ref: string; member: string; rights: readonly Right[] }): Promise<GrantSetResult>;
  regrant(input: { ref: string; digest: string }): Promise<GrantRegrantResult>;
  /** Sends every pending grant whose machine can be reached now; one pass at a time. */
  send(): Promise<void>;
  /** The sign-in ended: the ledger answers held for it are dropped (an operation in flight sees it through `context`). */
  fence(): void;
  /** Stops: nothing more is sent or written. Resolves once the operations in flight have ended. */
  close(): Promise<void>;
}

/** A key id no machine holds, for a draft judged while none speaks for its machine. */
const NO_KEY = base64urlEncode(new Uint8Array(16));
/** The codes a machine's ledger gives a grant by its own state (grants.ts's intake), which a resend can't change. */
const FINAL = new Set(['not-newer', 'not-held', 'other-machine']);

type Refusal = Extract<GrantSetResult, { ok: false }>;
const refuse = (reason: Refusal['reason'], detail?: string, problems?: string[]): Refusal => ({
  ok: false,
  reason,
  ...(detail === undefined ? {} : { detail }),
  ...(problems === undefined ? {} : { problems }),
});

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const random = (bytes: number) => base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
/** Rights in RL7's order, as a grant carries them. */
const ordered = (rights: readonly Right[]): Right[] => GRANT_RIGHTS.filter((r) => rights.includes(r));
const sameRights = (a: readonly Right[], b: readonly Right[]) => ordered(a).join() === ordered(b).join();
/** The same signed grant: its body and its signature. */
const sameGrant = (a: Signed<Grant>, b: Signed<Grant>) => canonicalize(a) === canonicalize(b);

/** The next version for a member on a machine: above both the issued record's and the ledger's mark. */
export function nextVersion(issued: IssuedGrant | undefined, highWater: number): number {
  return Math.max(issued?.signed.body.version ?? 0, highWater) + 1;
}

/**
 * The delivered grants this Mac issued on `ref` that the ledger answered by `members` no longer holds: a member it
 * answers for whose mark is below the issued version. Never one with no rights, nor one the ledger wasn't asked for.
 */
export function missingGrants(file: GrantsFile, ref: string, members: readonly GrantsEntry[]): IssuedGrant[] {
  return file.issued.filter((i) => {
    if (i.signed.body.machine !== ref || i.delivered !== 'done' || i.signed.body.rights.length === 0) return false;
    const entry = members.find((m) => m.member === i.signed.body.member);
    return entry !== undefined && entry.highWater < i.signed.body.version;
  });
}

/** An act's outcome, the door's or the link's, as a delivery reads it. */
type Sent = { kind: 'done' } | { kind: 'final'; code: string } | { kind: 'expired' } | { kind: 'again'; why: string };
function sentOf(outcome: unknown): Sent {
  if (!isObject(outcome)) return { kind: 'again', why: 'no outcome' };
  const code = (value: unknown) => (typeof value === 'string' ? value : 'unknown');
  if (outcome.state === 'done') return { kind: 'done' };
  if (outcome.state === 'failed') {
    const c = code(isObject(outcome.error) ? outcome.error.code : undefined);
    return FINAL.has(c) ? { kind: 'final', code: c } : { kind: 'again', why: c };
  }
  if (outcome.state === 'refused') {
    const c = code(outcome.reason);
    return FINAL.has(c) ? { kind: 'final', code: c } : { kind: 'again', why: c };
  }
  if (outcome.state === 'unknown' && outcome.reason === 'expired') return { kind: 'expired' };
  return { kind: 'again', why: `${code(outcome.state)}${typeof outcome.reason === 'string' ? ` ${outcome.reason}` : ''}` };
}

/** The machine's name as the head (or a certificate) gives it. */
function machineName(head: OrgState, certificates: Certificates, ref: string): string {
  return head.machines.find((m) => m.ref === ref)?.name ?? certificates.certs.find((c) => c.body.machine === ref)?.body.name ?? ref;
}
const emailOf = (head: OrgState, member: string) => head.members.find((m) => m.id === member)?.email ?? member;
const rightsText = (rights: readonly Right[]) => (rights.length === 0 ? 'none (withdraws every right)' : rights.join(', '));

/** What the person confirms for one grant: the machine, the member, each right, the version. */
function grantLines(head: OrgState, certificates: Certificates, g: Grant): string[] {
  return [
    `Machine: ${promptValue(machineName(head, certificates, g.machine))} (${promptValue(g.machine)})`,
    `Member: ${promptValue(emailOf(head, g.member))}`,
    `Rights: ${rightsText(g.rights)}`,
    `Version: ${g.version}`,
  ];
}
function grantSummary(head: OrgState, certificates: Certificates, g: Grant, verb: 'Grant' | 'Re-grant'): string {
  const name = promptValue(machineName(head, certificates, g.machine));
  const email = promptValue(emailOf(head, g.member));
  return g.rights.length === 0 ? `Withdraw ${email}'s rights on ${name}` : `${verb} ${g.rights.join(', ')} on ${name} to ${email}`;
}
export function grantPrompt(head: OrgState, certificates: Certificates, g: Grant): StepUpPrompt {
  return { summary: grantSummary(head, certificates, g, 'Grant'), text: grantLines(head, certificates, g).join('\n') };
}
/** Several grants confirmed at once: one's own text, or each under its place ("1 of 3"). */
export function regrantPrompt(head: OrgState, certificates: Certificates, grants: readonly Grant[]): StepUpPrompt {
  if (grants.length === 1) return { summary: grantSummary(head, certificates, grants[0], 'Re-grant'), text: grantLines(head, certificates, grants[0]).join('\n') };
  const n = grants.length;
  return {
    summary: `Re-grant ${n} grants on ${promptValue(machineName(head, certificates, grants[0].machine))}`,
    text: grants.map((g, i) => `${i + 1} of ${n}\n${grantLines(head, certificates, g).join('\n')}`).join('\n\n'),
  };
}

async function digestOf(words: string): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(words))));
}
type Missing = Extract<GrantsView, { ok: true }>['missing'];
/** The digest naming the missing grants of `ref` as shown, which `org.grants.regrant` carries back. */
const missingDigest = (ref: string, missing: Missing) => digestOf(canonicalize({ ref, missing }));
const shownMissing = (missing: readonly IssuedGrant[]): Missing => missing.map((i) => ({ member: i.signed.body.member, rights: [...i.signed.body.rights], version: i.signed.body.version }));

export function createGrants(deps: GrantsDeps): Grants {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`[org-grants] ${line}`);
  let closed = false;
  /** One sign or re-grant at a time: the version each reads would be the other's. */
  let busy = false;
  /** The operations in flight, which `close` joins. */
  const work = new Set<Promise<unknown>>();
  const tracked = <T>(p: Promise<T>): Promise<T> => {
    work.add(p);
    void p.finally(() => work.delete(p)).catch(() => {});
    return p;
  };

  /** Each machine's last ledger answer, held for the sign-in that read it. */
  const answers = new Map<string, { members: GrantsEntry[]; at: number; signIn: number }>();

  /** Whether the sign-in `at` was taken under still stands: the same member's, the same device's, never ended since. */
  const stands = (at: GrantsContext): boolean => {
    if (closed) return false;
    const c = deps.context();
    return c !== null && c.signIn === at.signIn && c.org === at.org && c.member === at.member && c.device === at.device;
  };

  /** The machine's ledger, read through its door or its link. */
  async function readLedger(ref: string): Promise<{ ok: true; members: GrantsEntry[] } | { ok: false; reason: string }> {
    let answer: { ok: true; output: unknown } | { ok: false; code: string };
    if (ref === deps.local) answer = await deps.door.grants().catch((error: unknown) => ({ ok: false as const, code: (error as Error).message }));
    else {
      const link = deps.link(ref as MachineRef);
      if (link === null || link.state() !== 'up') return { ok: false, reason: 'offline' };
      const result = await link.call('endpoint.grants', null);
      answer = result.ok ? { ok: true, output: result.output } : { ok: false, code: result.error.code };
    }
    if (!answer.ok) return { ok: false, reason: answer.code };
    const parsed = GrantsAnswerSchema.safeParse(answer.output);
    if (!parsed.success) {
      log(`${ref}'s endpoint.grants answer is not a grants read`);
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, members: parsed.data.members };
  }

  /** A ledger read for the sign-in `at`, held as the machine's last answer; told when it moved, unless the view asked. */
  async function read(at: GrantsContext, ref: string, tell: boolean): Promise<{ ok: true; members: GrantsEntry[] } | { ok: false; reason: string } | null> {
    const result = await readLedger(ref);
    if (!stands(at)) return null;
    if (result.ok) {
      const before = answers.get(ref);
      answers.set(ref, { members: result.members, at: now(), signIn: at.signIn });
      if (tell && (before?.signIn !== at.signIn || canonicalize(before.members) !== canonicalize(result.members))) deps.changed(ref);
    }
    return result;
  }
  const heldAnswer = (at: GrantsContext, ref: string) => {
    const held = answers.get(ref);
    return held !== undefined && held.signIn === at.signIn ? held : null;
  };

  /** The one key that speaks for the machine now, by id, or null (none, contested, several). */
  async function currentKey(at: GrantsContext, ref: string): Promise<string | null> {
    const { keys, contested } = await machineKeys(at.head, ref, at.certificates, new Date(now()));
    return contested || keys.length !== 1 ? null : keyId(keys[0]);
  }

  /** `grantProblems`' codes for `body`, signed by this device's step-up key. */
  const problemsOf = async (at: GrantsContext, body: Grant) => (await grantProblems(at.head, at.certificates, body, at.signer.kid, new Date(now()))).map((p) => p.code);

  /** The grant kept in the issued record as `pending`, while the sign-in stands; false when nothing was kept. */
  async function keep(store: GrantsStore, at: GrantsContext, signed: readonly Signed<Grant>[]): Promise<boolean> {
    try {
      return await store.update((file) => {
        if (!stands(at)) return { next: file, value: false };
        for (const s of signed) {
          file.issued = file.issued.filter((i) => i.signed.body.machine !== s.body.machine || i.signed.body.member !== s.body.member);
          file.issued.push({ signed: s, delivered: 'pending' });
        }
        return { next: file, value: true };
      });
    } catch (error) {
      if (!(error instanceof GrantsDamaged)) log(`the grant was not kept: ${(error as Error).message}`);
      return false;
    }
  }

  /** The outcome recorded on the issued grant, while it is still the latest for its pair and the sign-in stands. */
  async function record(store: GrantsStore, at: GrantsContext, signed: Signed<Grant>, delivered: GrantDelivered, op: string | null): Promise<void> {
    if (closed) return;
    const changed = await store
      .update((file) => {
        const held = issuedFor(file, signed.body.machine, signed.body.member);
        if (!stands(at) || held === undefined || !sameGrant(held.signed, signed)) return { next: file, value: false };
        held.delivered = delivered;
        if (delivered === 'pending' && op !== null) held.op = op;
        else delete held.op;
        return { next: file, value: true };
      })
      .catch((error: unknown) => (log(`the outcome was not recorded: ${(error as Error).message}`), false));
    if (changed) deps.changed(signed.body.machine);
  }

  /** The RL4 act the door takes: no step-up, its device this Mac's (attribution), stamped now. */
  function doorAction(at: GrantsContext, signed: Signed<Grant>): Action | null {
    const stamp = new Date(now()).toISOString();
    const action = { v: 1, org: at.org, machine: signed.body.machine, device: at.device, opId: random(16), opCreated: stamp, action: 'endpoint.grant', args: { grant: signed }, nonce: random(NONCE_BYTES), created: stamp };
    return isAction(action) ? action : null;
  }

  /** One send of `signed` through its machine's door or link, and the op it went as (null: none went). */
  async function sendOnce(at: GrantsContext, signed: Signed<Grant>): Promise<{ sent: Sent; op: string | null }> {
    const ref = signed.body.machine;
    if (ref === deps.local) {
      const action = doorAction(at, signed);
      if (action === null) return { sent: { kind: 'again', why: 'the door act does not build' }, op: null };
      const outcome = await deps.door.act(action).catch((error: unknown) => ({ state: 'unknown', reason: (error as Error).message }));
      return { sent: sentOf(outcome), op: action.opId };
    }
    const link = deps.link(ref as MachineRef);
    if (link === null || link.state() !== 'up') return { sent: { kind: 'again', why: 'offline' }, op: null };
    const handle = link.act({ action: 'endpoint.grant', args: { grant: signed }, stepUp: 'never' });
    return { sent: sentOf(await handle.outcome), op: handle.opId };
  }

  /** In flight per grant: a pass and a sign that reach the same grant share one delivery. */
  const delivering = new Map<string, Promise<GrantDelivered>>();
  function deliver(store: GrantsStore, at: GrantsContext, signed: Signed<Grant>): Promise<GrantDelivered> {
    const key = canonicalize(signed);
    const held = delivering.get(key);
    if (held !== undefined) return held;
    const run = tracked(deliverNow(store, at, signed)).finally(() => delivering.delete(key));
    delivering.set(key, run);
    return run;
  }

  async function deliverNow(store: GrantsStore, at: GrantsContext, signed: Signed<Grant>): Promise<GrantDelivered> {
    const ref = signed.body.machine;
    for (let attempt = 0; ; attempt++) {
      if (!stands(at)) return 'pending';
      const { sent, op } = await sendOnce(at, signed);
      // the sign-in it was sent under ended while the act was out: nothing is recorded for it
      if (!stands(at)) return 'pending';
      // its ledger reopened and orphaned the op: sent again at once, as a new op (once; later passes go on)
      if (sent.kind === 'expired' && attempt === 0) continue;
      let delivered: GrantDelivered;
      if (sent.kind === 'done') delivered = 'done';
      else if (sent.kind === 'final' && sent.code === 'not-newer') {
        // Read once more: this very grant in the ledger is an earlier send that landed; another's is another device's.
        const again = await read(at, ref, true);
        if (again === null) return 'pending';
        const entry = again.ok ? again.members.find((m) => m.member === signed.body.member) : undefined;
        if (!again.ok) delivered = 'pending';
        else delivered = entry?.grant !== null && entry?.grant !== undefined && sameGrant(entry.grant, signed) ? 'done' : { refused: 'not-newer' };
      } else if (sent.kind === 'final') delivered = { refused: sent.code };
      else {
        log(`version ${signed.body.version} for ${signed.body.member.slice(0, 8)} on ${ref}: not delivered (${sent.kind === 'again' ? sent.why : 'expired'}); sent again later`);
        delivered = 'pending';
      }
      await record(store, at, signed, delivered, op);
      return delivered;
    }
  }

  /** The store, or why nothing can be signed. */
  async function storeFor(): Promise<GrantsStore | Refusal> {
    const store = await deps.store();
    return store.get() === 'damaged' ? refuse('damaged') : store;
  }

  async function view({ ref }: { ref: string }): Promise<GrantsView> {
    const at = deps.context();
    if (at === null) return { ok: false, ref, reason: 'signed-out' };
    const store = await deps.store();
    const file = store.get();
    if (file === 'damaged') return { ok: false, ref, reason: 'damaged' };
    const fresh = await read(at, ref, false);
    if (fresh === null) return { ok: false, ref, reason: 'signed-out' };
    const held = heldAnswer(at, ref);
    const latest = store.get();
    if (latest === 'damaged') return { ok: false, ref, reason: 'damaged' };
    const members = held?.members ?? null;
    const issued = latest.issued.filter((i) => i.signed.body.machine === ref && i.signed.body.org === at.org);
    const rows = new Map<string, Extract<GrantsView, { ok: true }>['grants'][number]>();
    for (const e of members ?? []) if (e.grant !== null && e.grant.body.rights.length > 0) rows.set(e.member, { member: e.member, rights: [...e.grant.body.rights], version: e.grant.body.version, state: 'on-machine' });
    for (const i of issued) {
      const { member, rights, version } = i.signed.body;
      if (i.delivered === 'done') {
        // the machine's word stands where it answered; with no answer yet, the issued record's view
        if (members === null && rights.length > 0) rows.set(member, { member, rights: [...rights], version, state: 'on-machine' });
        continue;
      }
      const mark = members?.find((e) => e.member === member)?.highWater ?? 0;
      if (mark >= version) continue; // the ledger is past it: its own word is shown
      rows.set(member, i.delivered === 'pending' ? { member, rights: [...rights], version, state: 'pending' } : { member, rights: [...rights], version, state: 'refused', reason: i.delivered.refused });
    }
    const order = new Map(at.head.members.map((m, n) => [m.id, n]));
    const grants = [...rows.values()].sort((a, b) => (order.get(a.member) ?? Infinity) - (order.get(b.member) ?? Infinity));
    const missing =
      members === null || (await currentKey(at, ref)) === null
        ? []
        : shownMissing(missingGrants(latest, ref, members).filter((i) => i.signed.body.org === at.org));
    return {
      ok: true,
      ref,
      live: fresh.ok,
      asOf: held === null ? null : new Date(held.at).toISOString(),
      grants,
      missing,
      digest: missing.length === 0 ? null : await missingDigest(ref, missing),
    };
  }

  /** Runs `body` as the one sign: refused `busy` beside another, joined by `close`. */
  async function exclusive<T extends GrantSetResult | GrantRegrantResult>(body: () => Promise<T>): Promise<T | Refusal> {
    if (busy) return refuse('busy', 'another grant is being signed');
    busy = true;
    try {
      return await tracked(body());
    } finally {
      busy = false;
    }
  }

  async function set({ ref, member, rights }: { ref: string; member: string; rights: readonly Right[] }): Promise<GrantSetResult> {
    const at = deps.context();
    if (at === null || closed) return refuse('signed-out');
    if (new Set(rights).size !== rights.length) return refuse('invalid', 'a right is named twice');
    return exclusive(async () => {
      const store = await storeFor();
      if ('ok' in store) return store;
      // With no one key speaking for the machine, the draft names none that could (16 zero bytes), and the judge says why.
      const draft = async (version: number, under: GrantsContext): Promise<Grant> => ({
        org: under.org,
        machine: ref,
        machineKey: (await currentKey(under, ref)) ?? NO_KEY,
        member,
        rights: ordered(rights),
        version,
        issued: new Date(now()).toISOString(),
      });
      const issuedNow = () => {
        const file = store.get();
        return file === 'damaged' ? undefined : issuedFor(file, ref, member);
      };
      // Judged before anything is read or asked, on the version the issued record alone would give.
      const before = await problemsOf(at, await draft(nextVersion(issuedNow(), 0), at));
      if (before.length > 0) return refuse('ineligible', `this grant can't be signed here: ${before.join(', ')}`, before);
      const ledger = await read(at, ref, true);
      if (ledger === null) return refuse('signed-out');
      if (!ledger.ok) return refuse('ledger-unread', `${ref}'s grant ledger can't be read (${ledger.reason}): no version is guessed`);
      const entry = ledger.members.find((m) => m.member === member);
      if (entry === undefined) return refuse('ledger-unread', `${ref}'s grant ledger answered nothing for this member: no version is guessed`);
      const issued = issuedNow();
      // The rights the member holds or is being given: a pending grant above the ledger's mark is the latest word.
      const standing = issued !== undefined && issued.delivered === 'pending' && issued.signed.body.version > entry.highWater ? issued.signed.body.rights : (entry.grant?.body.rights ?? []);
      if (sameRights(standing, rights)) return refuse('no-change', 'the member holds these rights already');
      // Judged again on the head held now (the read was an await), with the version above both marks.
      const current = deps.context();
      if (current === null || !stands(at)) return refuse('signed-out');
      const body = await draft(nextVersion(issued, entry.highWater), current);
      const problems = await problemsOf(current, body);
      if (problems.length > 0) return refuse('ineligible', `this grant can't be signed here: ${problems.join(', ')}`, problems);
      const signed = await current.signer.sign(SIGNING_DOMAINS.grant, body, grantPrompt(current.head, current.certificates, body), { live: () => stands(at) });
      if (!signed.ok) return refuse('cancelled');
      const kept = await verifiedKept(store, at, [signed.signed]);
      if (!kept.ok) return kept;
      deps.changed(ref);
      return { ok: true, version: body.version, delivered: await deliver(store, at, signed.signed) };
    });
  }

  /** Each signed grant verified against the head held now, then kept; nothing kept unless all are. */
  async function verifiedKept(store: GrantsStore, at: GrantsContext, signed: readonly Signed<Grant>[]): Promise<{ ok: true } | Refusal> {
    const held = deps.context();
    if (held === null || !stands(at)) return refuse('signed-out');
    for (const s of signed) {
      const verdict = await verifyGrant(held.head, s, held.certificates, new Date(now()));
      if (!verdict.ok) return refuse('refused', `the signed grant does not verify against the org state held now (${verdict.code}): nothing was kept or sent`);
    }
    if (!(await keep(store, at, signed))) return store.get() === 'damaged' ? refuse('damaged') : refuse('signed-out');
    return { ok: true };
  }

  async function regrant({ ref, digest }: { ref: string; digest: string }): Promise<GrantRegrantResult> {
    const at = deps.context();
    if (at === null || closed) return refuse('signed-out');
    return exclusive(async () => {
      const store = await storeFor();
      if ('ok' in store) return store;
      const ledger = await read(at, ref, true);
      if (ledger === null) return refuse('signed-out');
      if (!ledger.ok) return refuse('ledger-unread', `${ref}'s grant ledger can't be read (${ledger.reason}): no version is guessed`);
      const file = store.get();
      if (file === 'damaged') return refuse('damaged');
      // The head held now (the read was an await): the key the grants are signed for, and their judge.
      const held = deps.context();
      if (held === null || !stands(at)) return refuse('signed-out');
      const key = await currentKey(held, ref);
      const missing = key === null ? [] : missingGrants(file, ref, ledger.members).filter((i) => i.signed.body.org === at.org);
      if (key === null || missing.length === 0) return refuse('none', 'no grant this Mac issued is missing there');
      if ((await missingDigest(ref, shownMissing(missing))) !== digest) return refuse('stale', 'the missing grants changed since they were shown: nothing was signed');
      const stamp = new Date(now()).toISOString();
      const bodies: Grant[] = missing.map((i) => {
        const mark = ledger.members.find((m) => m.member === i.signed.body.member)!.highWater;
        return { org: held.org, machine: ref, machineKey: key, member: i.signed.body.member, rights: [...i.signed.body.rights], version: nextVersion(i, mark), issued: stamp };
      });
      const problems = [...new Set((await Promise.all(bodies.map((b) => problemsOf(held, b)))).flat())];
      if (problems.length > 0) return refuse('ineligible', `these grants can't be signed here: ${problems.join(', ')}`, problems);
      const signed = await held.signer.signMany(SIGNING_DOMAINS.grant, bodies, regrantPrompt(held.head, held.certificates, bodies), { live: () => stands(at) });
      if (!signed.ok) return refuse('cancelled');
      const kept = await verifiedKept(store, at, signed.signed);
      if (!kept.ok) return kept;
      deps.changed(ref);
      const results: Extract<GrantRegrantResult, { ok: true }>['results'] = [];
      for (const s of signed.signed) results.push({ member: s.body.member, version: s.body.version, delivered: await deliver(store, at, s) });
      return { ok: true, results };
    });
  }

  /** One pass over the pending grants whose machine can be reached now, for the sign-in standing at its start. */
  async function pass(): Promise<void> {
    const at = deps.context();
    if (at === null || closed) return;
    const store = await deps.store();
    const file = store.get();
    if (file === 'damaged') return;
    for (const i of file.issued) {
      if (!stands(at)) return;
      if (i.delivered !== 'pending' || i.signed.body.org !== at.org) continue;
      const ref = i.signed.body.machine;
      if (ref !== deps.local && deps.link(ref as MachineRef)?.state() !== 'up') continue;
      await deliver(store, at, i.signed);
    }
  }
  let running: Promise<void> | null = null;
  let again = false;
  function send(): Promise<void> {
    if (closed) return Promise.resolve();
    if (running !== null) {
      again = true;
      return running;
    }
    running = tracked(
      (async () => {
        do {
          again = false;
          await pass();
        } while (again && !closed);
      })(),
    ).finally(() => (running = null));
    return running;
  }
  const sendLogged = () => void send().catch((error: unknown) => log(`a pass failed: ${(error as Error).message}`));

  /** One `onState` per roster machine's link: its pending grants are sent when it comes up. */
  const watched = new Map<MachineRef, { link: GrantLink; off: () => void }>();
  function watch(): void {
    const roster = new Set(deps.roster());
    for (const [ref, w] of watched) {
      if (roster.has(ref) && deps.link(ref) === w.link) continue;
      w.off();
      watched.delete(ref);
    }
    for (const ref of roster) {
      if (watched.has(ref)) continue;
      const link = deps.link(ref);
      if (link !== null) watched.set(ref, { link, off: link.onState((state) => state === 'up' && sendLogged()) });
    }
  }
  watch();
  const offRoster = deps.onRoster(watch);
  const timer = setInterval(sendLogged, timing.DELIVERY_RETRY_MS);
  timer.unref?.();

  return {
    view: (input) => (closed ? Promise.resolve({ ok: false, ref: input.ref, reason: 'signed-out' }) : tracked(view(input))),
    set,
    regrant,
    send,
    fence: () => answers.clear(),
    close() {
      closed = true;
      clearInterval(timer);
      offRoster();
      for (const w of watched.values()) w.off();
      watched.clear();
      answers.clear();
      return Promise.all([...work].map((p) => p.catch(() => {}))).then(() => undefined);
    },
  };
}
