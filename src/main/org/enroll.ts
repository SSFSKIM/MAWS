// The app's enrollment of a machine (P5 O8 M4b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4b's "The
// enrollment"; Interfaces §R's `org.enroll.*`): this Mac as the enrolling admin's device, as `deployment admin enroll
// [--replace]` is (apps/desk-hub/deploy/admin.ts), built as the pairing is (pairing.ts).
//
// - Start: only an admin's, since the mint is an admin's and the poll answers only the member who minted it, and only
//   while this Mac may sign. Before the mint, a name out of the grammar, one the state lists (but a re-enrollment's own)
//   and one under a delegation's prefix are refused, as `enroll` refuses them. The mint asks the hub's longest token
//   (ENROLL_TTL_S), naming the replaced machine for a re-enrollment, which the hub admits only for an active row. The code
//   carries the hub, the token, the head's roots and recovery key, the name and 32 random bytes `k` (base64url). It is
//   in the start's answer alone: `k` and the token live in this module's memory, no status carries either, and a
//   relaunch ends the enrollment.
// - Polling: every ENROLL_POLL_MS, the key posted under the enrollment. `404 no-key` (and no answer, and anything else
//   the hub may later take back) keeps polling; `403 not-yours` and `404 unknown-enrollment` end it. A key posted under
//   another name, or whose MAC isn't under `k` (`verifyEnrollmentMac`, which also holds every field to its grammar), is
//   not this enrollment's and is passed over.
// - The candidate is frozen at the first good answer: its name, ref, key and MAC. The hub keeps one key per enrollment,
//   which a later post replaces: another key read after that ends the enrollment `key-changed`. The name's binding to
//   its ref for the life of the org (`machineNames`) can only be judged once the ref is known, so it is checked at the
//   candidate and again at approval (`machine-names`), as `enroll` checks it; a re-enrollment's key must be under the
//   replaced machine's own ref.
// - Approval names `{generation, digest}`, the candidate the person compared. It reads the key again and needs that same
//   key, then signs `machine.add` (owned by the enrolling member, its name bound to its ref) or `machine.replace` (the
//   old key retired), composed by edits.ts on the head the signer drafts from. The edit's liveness guard (this
//   generation, neither ended nor expired, and the sign-in standing) is read at `apply`, by the device module after the
//   person's yes, and before the slot's write, so a cancel, an expiry or a sign-out while Touch ID is open signs, slots
//   and posts nothing.
//
// One enrollment at a time, none while another of the session's attempts runs (a pairing, a rekey), and none after
// `close`, which cancels it and joins the poll in flight. Electron-free.
import {
  base64urlEncode,
  canonicalize,
  encodeEnrollmentCodeV2,
  isMachineName,
  keyId,
  machineNameKey,
  verifyEnrollmentMac,
  type Certificates,
  type OrgState,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';
import type { ClientId } from '@shared/ipc/client';
import type { EnrollCancelResult, EnrollStartResult, OrgChange, OrgEnrollingStatus, SignResult } from '@shared/ipc/schema/org';
import { composeChange, type EditSelf } from './edits';
import type { EnrollmentKey, HubClient, HubResult } from './hub-client';
import { RefusedEdit, StaleEdit, type Edit } from './signer';
import { orgTiming, type OrgTiming } from './timing';

/** The token's life, the most the hub mints (`MAX_ENROLLMENT_TTL_S`): the CLI's default is 900, a sheet waits longer. */
export const ENROLL_TTL_S = 3600;
/** The bytes of `k`, as `enroll` makes it. */
export const ENROLL_SECRET_BYTES = 32;
/** What an admin whose app can't sign is told in place of the action. */
export const CANT_SIGN = "This Mac can't sign: enroll from an admin's Mac that does";

/** What an enrollment reads of the session, at each step: null once this Mac is not signed in to an org it holds. */
export type EnrollmentContext = {
  /** The registration's hub origin, which the code names. */
  hub: string;
  self: EditSelf;
  head: SignedOrgState;
  /** The certificates held with the head, which say which refs are certified machines. */
  certificates: Certificates;
  /** This Mac may sign (M3's `maySign`, signed in). */
  maySign: boolean;
  /** The hub as the session reaches it now; null while no credential lives. */
  client: HubClient | null;
};

export interface Enrollment {
  /** The status's `enrolling` part: never the code, its token or `k`. */
  status(): OrgEnrollingStatus;
  /** An enrollment is under way (being minted, or neither ended nor expired): the session's other attempts wait for it. */
  running(): boolean;
  /** `asker`: the window that sent it, whose null cancel reaches this start and the run it makes (`cancelRun`). */
  start(input: { name: string; replace?: string }, asker: ClientId): Promise<EnrollStartResult>;
  approve(input: { generation: number; digest: string }): Promise<SignResult>;
  /** Ends it; a signing in flight sees it ended at its next check and reads `stale` (or `cancelled` after Touch ID). */
  cancel(): void;
  /**
   * A window's cancel (`org.enroll.cancel`): ends the run of that `generation` only; with null, only the start `asker`
   * sent, while its token is minted, or the run that start made while it is still the current one. A window never
   * cancels a start or a run it doesn't own.
   */
  cancelRun(input: { generation: number | null }, asker: ClientId): EnrollCancelResult;
  /** Cancels it, refuses any start from now on, and resolves once the poll in flight has ended. */
  close(): Promise<void>;
}

export type EnrollmentDeps = {
  context(): EnrollmentContext | null;
  /** Another of the session's attempts runs (a sign-in, a re-anchor, a rekey, a pairing). */
  busy(): boolean;
  /** The signer's `sign`, its outcome as `org.*` carries it. */
  sign(edit: Edit): Promise<SignResult>;
  /** The status changed. */
  changed(): void;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
};

type Problem = NonNullable<NonNullable<OrgEnrollingStatus>['problem']>;
type Candidate = EnrollmentKey & { keyId: string; digest: string };
type Run = {
  generation: number;
  name: string;
  /** The ref a re-enrollment replaces. */
  replace: string | null;
  id: string;
  k: Uint8Array;
  expires: number;
  candidate: Candidate | null;
  problem: Problem | null;
  timer: ReturnType<typeof setTimeout> | null;
  polling: Promise<void> | null;
  approving: boolean;
  /** The window whose start made it. */
  asker: ClientId;
};

const CHANGED = 'another key was posted after the one shown: start over';
const ENDED = 'the enrollment ended (cancelled, expired or refused): nothing was signed';

async function digestOf(text: string): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

const sameName = (a: string, b: string) => machineNameKey(a) === machineNameKey(b);
const sameKey = (a: EnrollmentKey, b: EnrollmentKey) => a.machine === b.machine && a.ref === b.ref && a.pub === b.pub && a.mac === b.mac;

/** The delegation prefix, live or dropped, `name` falls under (RL DL 26), as the package compares them; null for none. */
function prefixOver(state: OrgState, name: string): string | null {
  const prefixes = [...state.delegations.map((d) => d.prefix), ...state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.prefix] : []))];
  return prefixes.find((p) => machineNameKey(name).startsWith(machineNameKey(p))) ?? null;
}

export function createEnrollment(deps: EnrollmentDeps): Enrollment {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`enrollment: ${line}`);
  let run: Run | null = null;
  /** A start awaiting its mint, with the window that sent it; a cancel clears it, and the start then begins nothing. */
  let starting: { asker: ClientId } | null = null;
  let generations = 0;
  let closed = false;

  /** `r` still stands: the current enrollment, nothing ended it, its token not expired, the sign-in standing. */
  const live = (r: Run): boolean => run === r && r.problem === null && !closed && now() < r.expires && deps.context() !== null;

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
    r.timer = setTimeout(() => void tick(r), timing.ENROLL_POLL_MS);
    (r.timer as { unref?: () => void }).unref?.();
  }

  /** Whether `r` polls on: a sign-in that ended drops it, an elapsed token ends it `expired`. */
  function standing(r: Run): boolean {
    if (run !== r || r.problem !== null || closed) return false;
    if (deps.context() === null) {
      // Signed out, or the session closed: nothing more is read for it.
      stop(r);
      run = null;
      log(`${r.generation} stopped: the sign-in ended`);
      deps.changed();
      return false;
    }
    if (now() >= r.expires) {
      end(r, 'expired');
      return false;
    }
    return true;
  }

  async function tick(r: Run): Promise<void> {
    r.timer = null;
    if (!standing(r)) return;
    r.polling = poll(r).catch((error: unknown) => log(`${r.generation}: a poll failed: ${(error as Error).message}`));
    await r.polling;
    r.polling = null;
    if (standing(r)) schedule(r);
  }

  /** The key's ref is the one its name is bound to for the life of the org, and a re-enrollment's is the machine's. */
  function bindingHolds(state: OrgState, r: Run, key: EnrollmentKey): boolean {
    const bound = state.machineNames.find((n) => sameName(n.name, key.machine));
    return (bound === undefined || bound.ref === key.ref) && (r.replace === null || key.ref === r.replace);
  }

  /**
   * One read of the posted key judged: the key, when it is this enrollment's (the candidate's own, once one is frozen),
   * or `ended` (the hub refused the read for good, or another key was posted after the candidate), or null (none yet,
   * not this enrollment's, or no answer: polling goes on).
   */
  async function judged(r: Run, read: HubResult<EnrollmentKey>): Promise<EnrollmentKey | 'ended' | null> {
    if (!read.ok) {
      if (read.kind === 'status' && read.status === 403 && read.error === 'not-yours') end(r, 'not-yours');
      else if (read.kind === 'status' && read.status === 404 && read.error === 'unknown-enrollment') end(r, 'unknown-enrollment');
      else return null;
      return 'ended';
    }
    const key = read.value;
    if (r.candidate !== null) {
      if (sameKey(key, r.candidate)) return key;
      end(r, 'key-changed');
      return 'ended';
    }
    if (!sameName(key.machine, r.name)) {
      log(`${r.generation}: a key posted under another name is not this enrollment's`);
      return null;
    }
    if (!(await verifyEnrollmentMac(r.k, { name: key.machine, machinePub: key.pub, ref: key.ref, tokenId: r.id }, key.mac))) {
      log(`${r.generation}: a key whose MAC is not under this code's secret is not this enrollment's`);
      return null;
    }
    return key;
  }

  async function poll(r: Run): Promise<void> {
    const ctx = deps.context();
    if (ctx === null) return;
    const c = r.candidate;
    if (c !== null && ctx.head.state.machines.some((m) => m.ref === c.ref && m.pub === c.pub)) return done(r, 'the held org state lists the key');
    if (ctx.client === null) return;
    const read = await ctx.client.enrollmentKey(r.id);
    if (!live(r)) return;
    const found = await judged(r, read);
    if (!live(r) || found === null || found === 'ended' || r.candidate !== null) return;
    if (!bindingHolds((deps.context() ?? ctx).head.state, r, found)) return end(r, 'machine-names');
    const candidate: Candidate = { ...found, keyId: await keyId(found.pub), digest: await digestOf(canonicalize({ name: found.machine, ref: found.ref, pub: found.pub })) };
    if (!live(r) || r.candidate !== null) return;
    r.candidate = candidate;
    log(`${r.generation}: ${found.machine} posted its key ${candidate.keyId}; it is shown to compare`);
    deps.changed();
  }

  async function start(input: { name: string; replace?: string }, asker: ClientId): Promise<EnrollStartResult> {
    const no = (reason: Extract<EnrollStartResult, { ok: false }>['reason'], detail: string): EnrollStartResult => ({ ok: false, reason, detail });
    if (closed) return no('busy', 'the org session is closed');
    if (starting !== null || (run !== null && live(run))) return no('busy', 'an enrollment is under way: cancel it first');
    if (deps.busy()) return no('busy', 'another org attempt is under way');
    const ctx = deps.context();
    if (ctx === null) return no('not-root', 'this Mac is not signed in to the org');
    const state = ctx.head.state;
    if (state.members.find((m) => m.id === ctx.self.member)?.role !== 'admin') return no('not-admin', 'Only an admin enrolls a machine');
    if (!ctx.maySign) return no('not-root', CANT_SIGN);
    if (!isMachineName(input.name)) return no('shape', `${JSON.stringify(input.name)} is not an admitted machine name`);
    let name = input.name;
    let replace: string | null = null;
    if (input.replace !== undefined) {
      const entry = state.machines.find((m) => m.ref === input.replace);
      if (entry === undefined) {
        return ctx.certificates.certs.some((c) => c.body.machine === input.replace)
          ? no('certified-machine', "a certified machine is enrolled again through its delegation, never from here")
          : no('no-machine', 'the org state lists no machine by that ref');
      }
      if (!sameName(entry.name, input.name)) return no('shape', `a re-enrollment names the machine it replaces, ${entry.name}`);
      name = entry.name;
      replace = entry.ref;
    } else {
      const listed = state.machines.find((m) => sameName(m.name, input.name));
      if (listed !== undefined) return no('machine-name-taken', `${listed.name} is listed: re-enroll it from its row`);
      const prefix = prefixOver(state, input.name);
      if (prefix !== null) return no('prefix-names-machine', `${input.name} falls under the delegation prefix ${prefix}`);
    }
    if (ctx.client === null) return no('hub', 'the hub sign-in has ended');

    const mark = { asker };
    starting = mark;
    let minted: Awaited<ReturnType<HubClient['mintEnrollment']>>;
    try {
      minted = await ctx.client.mintEnrollment({ ttl_s: ENROLL_TTL_S, ...(replace === null ? {} : { machine: name }) });
    } catch (error) {
      if (starting === mark) starting = null;
      throw error;
    }
    if (starting !== mark) return no('cancelled', 'the enrollment was cancelled while its token was minted: nothing was shown');
    starting = null;
    const at = deps.context();
    if (closed || at === null) return no('cancelled', 'the sign-in ended while the token was minted: nothing was shown');
    if (!minted.ok) {
      return minted.kind === 'status'
        ? no('refused', `${minted.status} ${minted.error ?? 'with no code'}`)
        : no('hub', minted.kind === 'unreachable' ? `the hub was not reached: ${minted.detail}` : 'the hub sign-in has ended');
    }
    const k = crypto.getRandomValues(new Uint8Array(ENROLL_SECRET_BYTES));
    const { root } = at.head.state;
    const code = encodeEnrollmentCodeV2({ hub: at.hub, token: minted.value.token, roots: [...root.keys], recoveryPub: root.recoveryPub, k: base64urlEncode(k), machine: name });
    if (run !== null) stop(run);
    const expires = Math.min(Date.parse(minted.value.expires), now() + ENROLL_TTL_S * 1000);
    const r: Run = { generation: ++generations, name, replace, id: minted.value.id, k, expires, candidate: null, problem: null, timer: null, polling: null, approving: false, asker };
    run = r;
    schedule(r);
    log(`${r.generation}: ${replace === null ? '' : 're-'}enrolling ${name}, until ${new Date(expires).toISOString()}`);
    deps.changed();
    return { ok: true, code, expires: new Date(expires).toISOString(), generation: r.generation };
  }

  async function approve(input: { generation: number; digest: string }): Promise<SignResult> {
    const r = run;
    if (r === null || r.generation !== input.generation || r.candidate === null || r.candidate.digest !== input.digest) {
      return { ok: false, reason: 'stale', detail: 'this is not the enrollment or the key that was shown: nothing was signed' };
    }
    if (!live(r)) return { ok: false, reason: 'stale', detail: ENDED };
    if (r.approving) return { ok: false, reason: 'busy', detail: 'this enrollment is being approved' };
    const ctx = deps.context();
    if (ctx === null) return { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
    if (ctx.client === null) return { ok: false, reason: 'hub', detail: 'the hub sign-in has ended: sign in again to approve' };
    r.approving = true;
    try {
      // What is signed is what was shown: the key read again, the same key answering.
      const read = await ctx.client.enrollmentKey(r.id);
      if (!live(r)) return { ok: false, reason: 'stale', detail: ENDED };
      const found = await judged(r, read);
      if (found === 'ended') return { ok: false, reason: 'stale', detail: r.problem === 'key-changed' ? CHANGED : ENDED };
      if (found === null) return { ok: false, reason: 'hub', detail: "the machine's key did not read: try again" };
      const c = r.candidate;
      const at = deps.context() ?? ctx;
      if (!bindingHolds(at.head.state, r, c)) {
        end(r, 'machine-names');
        return { ok: false, reason: 'refused', detail: `${c.machine} is bound to another ref for the life of the org: nothing was signed` };
      }
      const change: OrgChange = r.replace === null ? { kind: 'machine.add', name: c.machine, ref: c.ref, pub: c.pub, owners: [at.self.member] } : { kind: 'machine.replace', ref: r.replace, pub: c.pub };
      let composed: Edit;
      try {
        composed = await composeChange(at.head.state, change, at.self, at.certificates);
      } catch (error) {
        if (error instanceof StaleEdit) return { ok: false, reason: 'stale', detail: error.message };
        if (error instanceof RefusedEdit) return { ok: false, reason: 'refused', detail: error.message };
        throw error;
      }
      const result = await deps.sign({
        summary: composed.summary,
        lines: composed.lines,
        live: () => live(r),
        async apply(draft) {
          if (!live(r)) throw new StaleEdit(ENDED);
          await composed.apply(draft);
        },
      });
      if (result.ok) done(r, `listed at version ${result.version}`);
      return result;
    } finally {
      r.approving = false;
    }
  }

  function cancel(): void {
    starting = null;
    if (run !== null) clear(run);
  }

  /** Clears `r`, the current run, and says so. */
  function clear(r: Run): void {
    stop(r);
    run = null;
    log(`${r.generation} cancelled`);
    deps.changed();
  }

  function cancelRun({ generation }: { generation: number | null }, asker: ClientId): EnrollCancelResult {
    const no = (detail: string): EnrollCancelResult => ({ ok: false, reason: 'not-current', detail: `${detail}: nothing was cancelled` });
    if (generation === null) {
      // The sender's own start: its mint, or the run it made that the window hasn't been shown yet. A start refused
      // (busy) recorded nothing, so its window's null reaches nothing.
      if (starting !== null && starting.asker === asker) {
        starting = null;
        log('a start cancelled while its token was minted');
        return { ok: true };
      }
      if (run === null || run.asker !== asker) return no('no start of this window’s is under way');
      clear(run);
      return { ok: true };
    }
    if (run === null || run.generation !== generation) return no(`enrollment ${generation} is not the one running (${run === null ? 'none' : run.generation} is)`);
    clear(run); // its run alone: a start being minted after it is another window's to cancel
    return { ok: true };
  }

  async function close(): Promise<void> {
    const polling = run?.polling ?? null;
    closed = true;
    cancel();
    await polling;
  }

  function status(): OrgEnrollingStatus {
    const r = run;
    if (r === null) return null;
    const c = r.candidate;
    return {
      generation: r.generation,
      name: r.name,
      replace: r.replace,
      expires: new Date(r.expires).toISOString(),
      candidate: c === null ? null : { name: c.machine, ref: c.ref, keyId: c.keyId, digest: c.digest },
      problem: r.problem ?? (now() >= r.expires ? 'expired' : null),
    };
  }

  return { status, running: () => starting !== null || (run !== null && live(run)), start, approve, cancel, cancelRun, close };
}
