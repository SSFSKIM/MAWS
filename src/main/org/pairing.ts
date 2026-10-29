// The app's pairing (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4a's "Pairing"; Interfaces
// §M's `org.pair.*`): this Mac as the approving device, as `deployment admin pair` is (apps/desk-hub/deploy/admin.ts).
//
// - Start: only while this Mac may sign, and for yourself or a member with no devices; a later device of a member who
//   doesn't sign waits for the countersign flow (P5 Decision Log 34), and the page says so rather than offering it. The
//   code carries the hub, the org, the target member, the head's roots and recovery key, and 16 random bytes `k`
//   (base64url). It is in the start's answer alone: `k` lives in this module's memory, no status carries either, and a
//   relaunch ends the pairing.
// - Polling: every PAIR_POLL_MS, the target's pending entries (H1's `?member=`; the plain read for yourself), each judged
//   with `judgeEntry` against the code's secret, the class chosen and the held head's device ids. `503 hub-updating` and
//   no answer keep polling; `403 not-admin` and `404 no-member` end it.
// - The candidate is frozen once found: the first entry that answers, its canonical device and that device's digest.
//   The hub keeps an entry under its member and device id and replaces it on a repost, so a later poll can show the same
//   id with other keys: that ends the pairing as `entry-changed`, and a second entry answering ends it as
//   `two-entries`. The candidate is never swapped for a newer one.
// - Approval names `{generation, digest}`, the candidate the person compared. It reads the pending list again and needs
//   that same canonical device (`pair`'s rule, "the entry changed after it was shown"), then signs the frozen device,
//   never what the read returned (edits.ts's `deviceApproveEdit`): endorsed by this Mac inside the same Touch ID for your
//   own, unendorsed for another member's first. The edit's liveness guard (this generation, neither ended nor expired)
//   is read at `apply`, by the device module after the person's yes, and before the slot's write, so a cancel or an
//   expiry while Touch ID is open endorses, signs, slots and posts nothing. Once the slot holds the proposal it is
//   durable, and ending the pairing no longer withdraws it.
//
// One pairing at a time, and none while another of the session's attempts runs (a rekey). Electron-free.
import {
  base64urlEncode,
  canonicalize,
  encodePairingCode,
  entryDevice,
  judgeEntry,
  pairingFingerprint,
  PAIRING_SECRET_BYTES,
  type Device,
  type DeviceClass,
  type PendingEntry,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';
import type { OrgPairingStatus, PairStartResult, SignResult } from '@shared/ipc/schema/org';
import { deviceApproveEdit, type EditSelf } from './edits';
import type { HubClient, HubResult } from './hub-client';
import { StaleEdit, type Edit } from './signer';
import { orgTiming, type OrgTiming } from './timing';

/** What a pairing reads of the session, at each step: null once this Mac is not signed in to an org it holds. */
export type PairingContext = {
  /** The registration's hub origin, which the code names. */
  hub: string;
  self: EditSelf;
  head: SignedOrgState;
  /** This Mac may sign (M3's `maySign`, signed in). */
  maySign: boolean;
  /** The hub as the session reaches it now; null while no credential lives. */
  client: HubClient | null;
};

export interface Pairing {
  /** The status's `pairing` part: never the code or `k`. */
  status(): OrgPairingStatus;
  /** A pairing is under way (neither ended nor expired): the session's other attempts wait for it. */
  running(): boolean;
  start(input: { member: string; class: DeviceClass }): PairStartResult;
  approve(input: { generation: number; digest: string }): Promise<SignResult>;
  /** Ends it; a signing in flight sees it ended at its next check and reads `stale` (or `cancelled` after Touch ID). */
  cancel(): void;
}

export type PairingDeps = {
  context(): PairingContext | null;
  /** Another of the session's attempts runs (a sign-in, a re-anchor, a rekey). */
  busy(): boolean;
  /** The signer's `sign`, its outcome as `org.*` carries it. */
  sign(edit: Edit): Promise<SignResult>;
  /** The status changed. */
  changed(): void;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
};

type Problem = NonNullable<NonNullable<OrgPairingStatus>['problem']>;
type Candidate = { device: Omit<Device, 'endorsement'>; key: string; digest: string; fingerprint: string };
type Run = {
  generation: number;
  org: string;
  member: string;
  class: DeviceClass;
  k: Uint8Array;
  expires: number;
  candidate: Candidate | null;
  problem: Problem | null;
  timer: ReturnType<typeof setTimeout> | null;
  approving: boolean;
};

/** The rule the page states in place of Pair a device (M4a's "The rule the page states"). */
export const LATER_DEVICE = 'Their next device is paired from one of their own devices, a flow not built yet';
const CHANGED = 'the entry changed after it was shown: start over';

async function digestOf(text: string): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

export function createPairing(deps: PairingDeps): Pairing {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`pairing: ${line}`);
  let run: Run | null = null;
  let generations = 0;

  /** `r` still stands: the current pairing, nothing ended it, its code not expired. */
  const live = (r: Run): boolean => run === r && r.problem === null && now() < r.expires;

  function stop(r: Run): void {
    if (r.timer !== null) clearTimeout(r.timer);
    r.timer = null;
  }

  function end(r: Run, problem: Problem): void {
    if (run !== r || r.problem !== null) return;
    r.problem = problem;
    stop(r);
    log(`${r.generation} ended: ${problem}`);
    deps.changed();
  }

  function done(r: Run, why: string): void {
    if (run !== r) return;
    stop(r);
    run = null;
    log(`${r.generation} done: ${why}`);
    deps.changed();
  }

  function schedule(r: Run): void {
    r.timer = setTimeout(() => void tick(r), timing.PAIR_POLL_MS);
    (r.timer as { unref?: () => void }).unref?.();
  }

  async function tick(r: Run): Promise<void> {
    r.timer = null;
    if (!live(r)) {
      if (run === r && r.problem === null) end(r, 'expired');
      return;
    }
    try {
      await poll(r);
    } catch (error) {
      log(`${r.generation}: a poll failed: ${(error as Error).message}`);
    }
    if (live(r)) schedule(r);
    else if (run === r && r.problem === null) end(r, 'expired');
  }

  /** The candidate is on the held chain: approved (here, or by another root). */
  const listedIn = (head: SignedOrgState, r: Run): boolean =>
    r.candidate !== null && head.state.members.some((m) => m.id === r.member && m.devices.some((d) => d.id === r.candidate!.device.id));

  /**
   * One read of the target's entries judged: the matching devices, or `ended` (the hub refused the read for good, an
   * entry under the candidate's id changed, or two devices answered), or `unread` (polling goes on).
   */
  async function assess(r: Run, read: HubResult<PendingEntry[]>, head: SignedOrgState): Promise<Array<Omit<Device, 'endorsement'>> | 'ended' | 'unread'> {
    if (!read.ok) {
      if (read.kind === 'status' && read.status === 403 && read.error === 'not-admin') end(r, 'not-admin');
      else if (read.kind === 'status' && read.status === 404 && read.error === 'no-member') end(r, 'no-member');
      else return 'unread';
      return 'ended';
    }
    const listed = new Set(head.state.members.flatMap((m) => m.devices.map((d) => d.id)));
    const matches: Array<Omit<Device, 'endorsement'>> = [];
    for (const entry of read.value) {
      if (r.candidate !== null && entry.deviceId === r.candidate.device.id && canonicalize(entryDevice(entry)) !== r.candidate.key) {
        end(r, 'entry-changed');
        return 'ended';
      }
      const judged = await judgeEntry(entry, { org: r.org, member: r.member, k: r.k, class: r.class, listed });
      if (judged.ok) matches.push(judged.device);
    }
    const answering = new Set(matches.map((d) => canonicalize(d)));
    if (r.candidate !== null) answering.add(r.candidate.key);
    if (answering.size > 1) {
      end(r, 'two-entries');
      return 'ended';
    }
    return matches;
  }

  async function poll(r: Run): Promise<void> {
    const ctx = deps.context();
    if (ctx === null) {
      // Signed out, or the session closed: nothing more is read for it.
      if (run === r) {
        stop(r);
        run = null;
        deps.changed();
      }
      return;
    }
    if (listedIn(ctx.head, r)) return done(r, 'the held org state lists the device');
    if (ctx.client === null) return;
    const read = await ctx.client.pendingOf(r.member === ctx.self.member ? null : r.member);
    if (!live(r)) return;
    const found = await assess(r, read, deps.context()?.head ?? ctx.head);
    if (!live(r) || typeof found === 'string' || r.candidate !== null || found.length === 0) return;
    const device = structuredClone(found[0]);
    const key = canonicalize(device);
    const candidate: Candidate = { device, key, digest: await digestOf(key), fingerprint: await pairingFingerprint(r.org, r.member, device) };
    if (!live(r) || r.candidate !== null) return;
    r.candidate = candidate;
    log(`${r.generation}: device ${device.id.slice(0, 8)} (${device.class}) answered; its fingerprint is shown to compare`);
    deps.changed();
  }

  function start(input: { member: string; class: DeviceClass }): PairStartResult {
    if (run !== null && live(run)) return { ok: false, reason: 'busy', detail: 'a pairing is under way: cancel it first' };
    if (deps.busy()) return { ok: false, reason: 'busy', detail: 'another org attempt is under way' };
    const ctx = deps.context();
    if (ctx === null) return { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
    if (!ctx.maySign) return { ok: false, reason: 'not-root', detail: 'Only a root signs org changes' };
    const target = ctx.head.state.members.find((m) => m.id === input.member);
    if (target === undefined) return { ok: false, reason: 'no-member', detail: 'the org state lists no member by that id' };
    if (target.id !== ctx.self.member && target.devices.length > 0) return { ok: false, reason: 'later-device', detail: LATER_DEVICE };
    if (ctx.client === null) return { ok: false, reason: 'hub', detail: 'the hub sign-in has ended: sign in again to pair' };
    const k = crypto.getRandomValues(new Uint8Array(PAIRING_SECRET_BYTES));
    const { org, root } = ctx.head.state;
    const code = encodePairingCode({ hub: ctx.hub, org, member: target.id, roots: [...root.keys], recoveryPub: root.recoveryPub, k: base64urlEncode(k) });
    if (run !== null) stop(run);
    const r: Run = { generation: ++generations, org, member: target.id, class: input.class, k, expires: now() + timing.PAIR_TTL_MS, candidate: null, problem: null, timer: null, approving: false };
    run = r;
    schedule(r);
    const expires = new Date(r.expires).toISOString();
    log(`${r.generation}: a ${r.class} device of ${target.email}, until ${expires}`);
    deps.changed();
    return { ok: true, code, expires };
  }

  async function approve(input: { generation: number; digest: string }): Promise<SignResult> {
    const r = run;
    if (r === null || r.generation !== input.generation || r.candidate === null || r.candidate.digest !== input.digest) {
      return { ok: false, reason: 'stale', detail: 'this is not the pairing or the device that was shown: nothing was signed' };
    }
    if (!live(r)) return { ok: false, reason: 'stale', detail: 'the pairing ended (cancelled, expired or refused): nothing was signed' };
    if (r.approving) return { ok: false, reason: 'busy', detail: 'this pairing is being approved' };
    const ctx = deps.context();
    if (ctx === null) return { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
    if (ctx.client === null) return { ok: false, reason: 'hub', detail: 'the hub sign-in has ended: sign in again to approve' };
    r.approving = true;
    try {
      // What is signed is what was shown: the list read again, the same canonical device answering, and no other.
      const read = await ctx.client.pendingOf(r.member === ctx.self.member ? null : r.member);
      if (!live(r)) return { ok: false, reason: 'stale', detail: 'the pairing ended (cancelled or expired): nothing was signed' };
      const at = deps.context() ?? ctx;
      const found = await assess(r, read, at.head);
      if (found === 'unread') return { ok: false, reason: 'hub', detail: 'the pending entries did not read: try again' };
      if (found === 'ended') return { ok: false, reason: 'stale', detail: r.problem === 'two-entries' ? 'two devices answered this code: start over' : CHANGED };
      if (!found.some((d) => canonicalize(d) === r.candidate!.key)) {
        end(r, 'entry-changed');
        return { ok: false, reason: 'stale', detail: CHANGED };
      }
      let edit: Edit;
      try {
        edit = await deviceApproveEdit(at.head.state, { member: r.member, device: r.candidate.device, self: at.self, live: () => live(r) });
      } catch (error) {
        if (error instanceof StaleEdit) return { ok: false, reason: 'stale', detail: error.message };
        throw error;
      }
      const result = await deps.sign(edit);
      if (result.ok) done(r, `approved at version ${result.version}`);
      return result;
    } finally {
      r.approving = false;
    }
  }

  function cancel(): void {
    const r = run;
    if (r === null) return;
    stop(r);
    run = null;
    log(`${r.generation} cancelled`);
    deps.changed();
  }

  function status(): OrgPairingStatus {
    const r = run;
    if (r === null) return null;
    const c = r.candidate;
    return {
      generation: r.generation,
      member: r.member,
      class: r.class,
      expires: new Date(r.expires).toISOString(),
      entry: c === null ? null : { id: c.device.id, class: c.device.class, keyStorage: c.device.keyStorage, fingerprint: c.fingerprint, digest: c.digest },
      problem: r.problem ?? (now() >= r.expires ? 'expired' : null),
    };
  }

  return { status, running: () => run !== null && live(run), start, approve, cancel };
}
