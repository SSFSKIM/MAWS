// The app as the org's signer (P5 O8 M3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M3's "Who signs,
// and with what" and "The pending slot"; Interfaces §K). A typed edit becomes a successor of the held head, passes the
// checks before Touch ID (checks.ts), is signed after Touch ID by the device module (`StateSigner`, which keeps the
// key), must pass the package's `verifySuccessor`, is kept in the durable pending slot with its delivery obligation,
// and is then posted and adopted. Nothing else is signed while a pending state is unsettled: under O13's rule, no two
// successors of one parent.
//
// - Who signs: this device, when the held head's `root.keys` holds its step-up key id and its key file carries the
//   backup mark (`excludedFromBackupAtCreation`, a local fact nothing signed can carry). Not a root: `not-root`;
//   unmarked: `unmarked`; signing.json damaged: `signing`. Each before anything is shown that would sign.
// - The slot (`deployment admin`'s anchor `pending`, admin.ts's `anchored`): written before the state goes anywhere,
//   its obligation in the same write; `exposed.hub` written before the POST. 201 adopts and clears it. A 409
//   `not-head` or `rollback` adopts the hub's chain: if that holds the state it is settled, else the slot stays and
//   reads `pending-fork`, since the hub may keep and serve what it refused. Anything else leaves it pending.
// - Settling (at start and at each feed open, which the session calls, and before any sign): the held chain holds the
//   state → cleared; the hub holds no successor of its parent → the same bytes posted again; another state holds its
//   version, or the line left its parent → `pending-fork`, until the owner's confirmed discard.
// - Discarding (`abandon-pending`'s rule, admin.ts): only on the owner's confirmation and only while the hub's chain
//   doesn't hold the state, read from the hub then and there. A fork waits for it; so does a slot the hub keeps
//   refusing for another reason (a courtesy check), which settling would otherwise post again forever.
// - The slot's state and its obligation settle apart: the slot at the hub's acceptance, the obligation (deliveries.ts,
//   Task 5) when its machines acknowledge. A discard moves the obligation to `abandoned` in the same write.
//
// Network calls and adoptions run outside the signing store's updates (whose queue adoption's anchor write waits on).
// Electron-free: the state signer is injected (step-up.ts's `createStateSigner`, imported here for its type only).
import { canonicalize, stateHash, verifySuccessor, type OrgState, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import type { StateSigner } from '../device/step-up';
import { checkSuccessor, type Finding, type SupersededOffer } from './checks';
import type { Obligation, Pending } from './files';
import type { HeldOrg } from './held';
import type { HubClient, HubResult } from './hub-client';
import type { OrgSession } from './session';
import { SigningDamaged, withExposure, type SigningStore } from './signing-store';

/** A change to the org state, in the words the person confirms: `apply` edits the successor's draft. */
export type Edit = { summary: string; lines: string[]; apply(draft: OrgState): void | Promise<void> };

export type SignOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: 'not-root' | 'unmarked' | 'signing' | 'cancelled' | 'pending' | 'invalid' | 'hub' | 'busy'; detail?: string }
  | { ok: false; reason: 'refused'; findings: Finding[] };

/** Why a discard did nothing: the hub holds it, the hub can't be read, nothing is pending, or signing.json is damaged. */
export type DiscardOutcome = { ok: true } | { ok: false; reason?: 'held' | 'hub' | 'none' | 'signing' };

export interface OrgSigner {
  /** The held head's `root.keys` holds this device's step-up key id. */
  isRoot(): boolean;
  /** A root, its keys marked, signing.json readable. */
  maySign(): boolean;
  /** `fork`: the app's line has left it (another state at its version, or its parent off the line). */
  pending(): { version: number; exposed: boolean; fork: boolean } | null;
  /** Composes, checks, prompts, slots, posts, adopts. */
  sign(edit: Edit): Promise<SignOutcome>;
  /** The slot's three rules. The session calls it at start and at each feed open; `sign` calls it first. */
  settle(): Promise<void>;
  /** Only after the owner's confirmation, and only while the hub's chain doesn't hold it. */
  discardPending(confirmed: true): Promise<DiscardOutcome>;
  /** Only in `problem: 'signing'`: a fresh signing.json. */
  resetSigning(confirmed: true): Promise<void>;
  /** `pending()` changed (a slot written or cleared, its fork judged), so the status can be emitted again. */
  onChanged(listener: () => void): () => void;
  close(): void;
}

/** What the signer needs of deliveries.ts (Task 5's `Deliveries`). */
export type SignerDeliveries = {
  /** The obligation `signed` makes (null: it ends no key), written with the slot in one update. */
  obligation(signed: SignedOrgState, parent: OrgState): Obligation | null | Promise<Obligation | null>;
  /** Sends what is owed and on the app's line; started after each post. */
  send(): Promise<void>;
};

export type OrgSignerDeps = {
  session: OrgSession;
  held: () => HeldOrg | null;
  /** The device module's state signer over this device's step-up key; null while no keys are loaded. */
  signer: () => StateSigner | null;
  /** This device's key file carries `excludedFromBackupAtCreation`. */
  marked(): boolean;
  hub: () => HubClient | null;
  store: SigningStore;
  deliveries: SignerDeliveries;
  now?(): number;
  log(line: string): void;
};

/** M3's own edit: the weekly no-change successor (Q6). */
export function noChangeEdit(): Edit {
  return { summary: 're-sign the org state (no change)', lines: ['No change: the org state signed again, so machines keep accepting it'], apply: () => {} };
}

/** M3's other edit: the superseded states' revocations (P5 Decision Log 30), or null when the offer signs nothing. */
export function supersededEdit(offer: SupersededOffer): Edit | null {
  if (offer === null || offer.lines.length === 0) return null;
  return { summary: 'revoke the keys a recovery left current', lines: offer.lines, apply: (draft) => offer.edit(draft) };
}

/** The held state at `version`, if the chain holds one. */
function stateAt(view: HeldOrg, version: number): SignedOrgState | undefined {
  return view.since(version - 1).states.find((s) => s.state.version === version);
}

/**
 * Where a pending state stands against the held chain: `held` (the chain holds it), `candidate` (the head is its
 * parent) or `fork` (another state holds its version, or the head is not its parent: it can never join this line).
 * Deliveries judge by it too: a `fork` slot's obligation is not sent.
 */
export async function judgePending(pending: Pending, view: HeldOrg): Promise<'held' | 'candidate' | 'fork'> {
  const version = pending.signed.state.version;
  const at = stateAt(view, version);
  if (at !== undefined) return (await stateHash(at.state)) === (await stateHash(pending.signed.state)) ? 'held' : 'fork';
  const head = view.head();
  return head.state.version === version - 1 && (await stateHash(head.state)) === pending.parent ? 'candidate' : 'fork';
}

const describe = (answer: Exclude<HubResult<unknown>, { ok: true }>): string =>
  answer.kind === 'status' ? `${answer.status}${answer.error === null ? '' : ` ${answer.error}`}` : answer.kind === 'unreachable' ? `unreachable (${answer.detail})` : `${answer.kind} (${answer.status})`;

export function createOrgSigner(deps: OrgSignerDeps): OrgSigner {
  const { store, deliveries } = deps;
  const now = deps.now ?? Date.now;
  const log = (line: string) => deps.log(`signer: ${line}`);
  const listeners = new Set<() => void>();

  /** One sign, settle, discard or reset at a time. */
  let turns: Promise<unknown> = Promise.resolve();
  function exclusive<T>(body: () => Promise<T>): Promise<T> {
    const turn = turns.then(body);
    turns = turn.catch(() => {});
    return turn;
  }
  let signing = false;

  /** The fork judgment of the slot `key` names (its state's canonical form), refreshed after each change. */
  let judged: { key: string; fork: boolean } | null = null;
  let judging = 0;
  let shown = 'null';

  function isRoot(): boolean {
    const view = deps.held();
    const signer = deps.signer();
    return view !== null && signer !== null && view.head().state.root.keys.includes(signer.kid);
  }

  function pending(): ReturnType<OrgSigner['pending']> {
    const file = store.get();
    if (file === 'damaged' || file.pending === null) return null;
    const { signed, exposed } = file.pending;
    const key = canonicalize(signed.state);
    return { version: signed.state.version, exposed: exposed.hub || exposed.machines.length > 0, fork: judged !== null && judged.key === key && judged.fork };
  }

  function announce(): void {
    const next = JSON.stringify(pending());
    if (next === shown) return;
    shown = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log(`a listener failed: ${(error as Error).message}`);
      }
    }
  }

  /** Judges the slot again against the held chain, clearing it if the chain holds it, and tells listeners of a change. */
  async function refresh(): Promise<void> {
    const mine = ++judging;
    let next: typeof judged = null;
    const file = store.get();
    const view = deps.held();
    if (file !== 'damaged' && file.pending !== null && view !== null) {
      const verdict = await judgePending(file.pending, view);
      if (verdict === 'held') await clear(file.pending);
      else next = { key: canonicalize(file.pending.signed.state), fork: verdict === 'fork' };
    }
    if (mine !== judging) return;
    judged = next;
    announce();
  }
  const refreshNow = () => refresh().catch((error: unknown) => log(`judging the pending state failed: ${(error as Error).message}`));
  const refreshed = () => void refreshNow();
  const unwatch = deps.session.onChanged(refreshed);
  refreshed();

  /** Clears the slot if it still holds `slot`'s state. */
  async function clear(slot: Pending): Promise<void> {
    const key = canonicalize(slot.signed.state);
    const cleared = await store.update((file) => {
      if (file.pending === null || canonicalize(file.pending.signed.state) !== key) return { next: file, value: false };
      file.pending = null;
      return { next: file, value: true };
    });
    if (cleared) log(`pending version ${slot.signed.state.version} is on the held chain: settled`);
  }

  /** The slot, if the held chain holds its state: cleared. Whether it was. */
  async function clearIfHeld(): Promise<boolean> {
    const file = store.get();
    const view = deps.held();
    if (file === 'damaged' || file.pending === null || view === null) return false;
    if ((await judgePending(file.pending, view)) !== 'held') return false;
    await clear(file.pending);
    return true;
  }

  /** The hub's chain after the held head, adopted; the read's answer (null with no hub or no view). */
  async function follow(hub: HubClient): Promise<Awaited<ReturnType<HubClient['chain']>> | null> {
    const view = deps.held();
    if (view === null) return null;
    const read = await hub.chain(view.head().state.version);
    if (!read.ok) {
      log(`the hub's chain did not read: ${describe(read)}`);
      return read;
    }
    try {
      const adopted = await view.adoptServed(read.value);
      if (adopted.refused !== undefined) log(`the hub's chain was not adopted: ${adopted.refused}`);
    } catch (error) {
      log(`adopting the hub's chain failed: ${(error as Error).message}`);
    }
    return read;
  }

  /**
   * Posts the slot's state, `exposed.hub` written first, and settles what the answer says; then starts the deliveries,
   * which send only what is on the app's line (so nothing of a slot the answer made a fork).
   */
  async function post(signed: SignedOrgState): Promise<SignOutcome> {
    const outcome = await postOnce(signed);
    void deliveries.send().catch((error: unknown) => log(`delivering failed: ${(error as Error).message}`));
    return outcome;
  }

  async function postOnce(signed: SignedOrgState): Promise<SignOutcome> {
    const version = signed.state.version;
    const hub = deps.hub();
    if (hub === null) return { ok: false, reason: 'hub', detail: 'no hub: the state stays pending until it can be posted' };
    try {
      await store.update((file) => ({ next: withExposure(file, signed, { hub: true }), value: undefined }));
    } catch (error) {
      return { ok: false, reason: 'signing', detail: (error as Error).message };
    }
    refreshed();
    const answer = await hub.postState(signed);
    if (answer.ok) {
      log(`version ${version} accepted by the hub`);
      await follow(hub);
      const view = deps.held();
      // The hub took it, so it verifies: adopted directly when the chain's read didn't bring it.
      if (view !== null && stateAt(view, version) === undefined) await view.adoptServed({ chain: [signed], head: null, transitions: [], certificates: null }).catch(() => {});
      await clearIfHeld();
      return { ok: true, version };
    }
    log(`version ${version}: the hub answered ${describe(answer)}; it stays pending`);
    if (answer.kind === 'status' && answer.status === 409 && (answer.error === 'not-head' || answer.error === 'rollback')) {
      await follow(hub);
      // The hub's chain holds it after all (an earlier post of the same bytes): settled.
      if (await clearIfHeld()) return { ok: true, version };
      return { ok: false, reason: 'hub', detail: answer.error };
    }
    return { ok: false, reason: 'hub', detail: describe(answer) };
  }

  async function settleLocked(): Promise<void> {
    const file = store.get();
    const view = deps.held();
    if (file === 'damaged' || file.pending === null || view === null) return;
    const slot = file.pending;
    const version = slot.signed.state.version;
    let verdict = await judgePending(slot, view);
    if (verdict === 'candidate') {
      const hub = deps.hub();
      if (hub === null) return;
      const read = await follow(hub);
      if (read === null || !read.ok) return;
      const now = deps.held();
      if (now === null) return;
      verdict = await judgePending(slot, now);
      const served = read.value;
      if (verdict === 'candidate') {
        // The hub's head is still the parent, with no successor of it: the same bytes go again.
        if (served.chain.length === 0 && served.head !== null && (await stateHash(served.head.state)) === slot.parent) {
          log(`pending version ${version} is not at the hub: sent again`);
          await post(slot.signed);
        } else {
          log(`pending version ${version}: the hub serves a chain the held view did not take; it stays pending`);
        }
        return;
      }
    }
    if (verdict === 'held') await clear(slot);
    else log(`pending version ${version} is a fork: another state holds its version; it waits for the owner's discard`);
  }

  /** The refusal before anything is composed, or null. */
  function standing(): SignOutcome | null {
    if (deps.session.current() === null) return { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
    if (!isRoot()) return { ok: false, reason: 'not-root' };
    if (!deps.marked()) return { ok: false, reason: 'unmarked' };
    if (store.get() === 'damaged') return { ok: false, reason: 'signing' };
    return null;
  }

  async function signLocked(edit: Edit): Promise<SignOutcome> {
    const before = standing();
    if (before !== null) return before;
    await settleLocked();
    const file = store.get();
    if (file === 'damaged') return { ok: false, reason: 'signing' };
    if (file.pending !== null) return { ok: false, reason: 'pending' };
    // On the hub's head where the hub is reachable, so a successor of a stale head isn't proposed (and left a fork).
    const hub = deps.hub();
    if (hub !== null) await follow(hub);
    const again = standing();
    if (again !== null) return again;

    const view = deps.held()!;
    const signer = deps.signer()!;
    const head = view.head();
    const draft = structuredClone(head.state);
    draft.version += 1;
    draft.prev = await stateHash(head.state);
    const at = new Date(now()).toISOString();
    draft.issued = at > head.state.issued ? at : head.state.issued;
    try {
      await edit.apply(draft);
    } catch (error) {
      return { ok: false, reason: 'invalid', detail: `the edit failed: ${(error as Error).message}` };
    }

    const findings = await checkSuccessor(head.state, draft, view.superseded(), new Date(now()));
    if (findings.some((f) => f.level === 'refuse')) return { ok: false, reason: 'refused', findings };
    const text = [
      `Org ${draft.org}: version ${head.state.version} → ${draft.version}`,
      ...edit.lines,
      ...findings.map((f) => `Warning: ${f.detail}`),
    ].join('\n');
    const answer = await signer.sign(draft, { summary: edit.summary, text });
    if (!answer.ok) return { ok: false, reason: 'cancelled' };
    const signed = answer.signed;

    // Judged against the head as it is now: one adopted while the person was asked makes it `not-head`.
    const current = deps.held();
    if (current === null) return { ok: false, reason: 'invalid', detail: 'no held org state' };
    const parent = current.head();
    const verdict = await verifySuccessor(parent, signed, current.since(parent.state.version).transitions);
    if (!verdict.ok) {
      log(`the signed version ${signed.state.version} fails verifySuccessor (${verdict.code}): nothing kept or sent`);
      return { ok: false, reason: 'invalid', detail: verdict.code };
    }
    const obligation = await deliveries.obligation(signed, parent.state);
    const slot: Pending = { signed, parent: await stateHash(parent.state), exposed: { hub: false, machines: [] } };
    let kept: 'kept' | 'pending' | 'moved';
    try {
      kept = await store.update((f) => {
        if (f.pending !== null) return { next: f, value: 'pending' as const };
        // An adoption between the verdict and this turn: the slot would name a parent that is no longer the head.
        if (deps.held() !== current || current.head() !== parent) return { next: f, value: 'moved' as const };
        f.pending = slot;
        if (obligation !== null) f.deliveries.push(obligation);
        return { next: f, value: 'kept' as const };
      });
    } catch (error) {
      return { ok: false, reason: 'signing', detail: (error as Error).message };
    }
    if (kept === 'pending') return { ok: false, reason: 'pending' };
    if (kept === 'moved') return { ok: false, reason: 'invalid', detail: 'not-head' };
    log(`version ${signed.state.version} signed and kept pending${obligation === null ? '' : `, owed to ${obligation.owed.length} machine(s)`}`);
    refreshed();

    return post(signed);
  }

  return {
    isRoot,
    maySign: () => isRoot() && deps.marked() && store.get() !== 'damaged',
    pending,
    async sign(edit) {
      if (signing) return { ok: false, reason: 'busy' };
      signing = true;
      try {
        return await exclusive(() => signLocked(edit));
      } catch (error) {
        // Only the signing store throws here (a damaged file, a failed write): the slot's state is what it reads back.
        if (error instanceof SigningDamaged) return { ok: false, reason: 'signing' };
        log(`signing failed: ${(error as Error).message}`);
        return { ok: false, reason: 'signing', detail: (error as Error).message };
      } finally {
        signing = false;
        await refreshNow();
      }
    },
    async settle() {
      await exclusive(settleLocked);
      await refreshNow();
    },
    async discardPending(confirmed) {
      if (confirmed !== true) return { ok: false };
      const outcome = await exclusive(async (): Promise<DiscardOutcome> => {
        const file = store.get();
        if (file === 'damaged') return { ok: false, reason: 'signing' };
        if (file.pending === null) return { ok: false, reason: 'none' };
        const slot = file.pending;
        const version = slot.signed.state.version;
        if (await clearIfHeld()) return { ok: false, reason: 'held' };
        const hub = deps.hub();
        if (hub === null) return { ok: false, reason: 'hub' };
        const read = await hub.chain(version - 1);
        if (!read.ok) return { ok: false, reason: 'hub' };
        const there = read.value.chain.find((s) => s.state.version === version);
        if (there !== undefined && canonicalize(there.state) === canonicalize(slot.signed.state)) {
          // The hub holds it: the next settle (or this adoption) makes it the app's too.
          await deps.held()?.adoptServed(read.value).catch(() => {});
          await clearIfHeld();
          return { ok: false, reason: 'held' };
        }
        const hash = await stateHash(slot.signed.state);
        const key = canonicalize(slot.signed.state);
        const done = await store.update((f) => {
          if (f.pending === null || canonicalize(f.pending.signed.state) !== key) return { next: f, value: false };
          const { hub: atHub, machines } = f.pending.exposed;
          f.pending = null;
          f.deliveries = f.deliveries.filter((o) => o.hash !== hash);
          f.abandoned.push({ hash, version, hub: atHub, machines: [...machines] });
          return { next: f, value: true };
        });
        if (done) log(`pending version ${version} ${hash} abandoned on the owner's word`);
        return done ? { ok: true } : { ok: false, reason: 'none' };
      });
      await refreshNow();
      return outcome;
    },
    async resetSigning(confirmed) {
      if (confirmed !== true) return;
      await exclusive(async () => {
        if (store.get() !== 'damaged') {
          log('signing.json reads: nothing to reset');
          return;
        }
        await store.reset();
        log('signing.json reset on the owner\'s word');
      });
      await refreshNow();
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      unwatch();
      listeners.clear();
    },
  };
}
