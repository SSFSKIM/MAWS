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
//   its obligation in the same write; `exposed.hub` written before the POST. A 201 is done only once the held chain
//   holds the state (adopted from the hub's chain, or directly); until then the slot stays for settling. A 409
//   `not-head` or `rollback` adopts the hub's chain: if that holds the state it is settled, else the slot stays and
//   reads `pending-fork`, since the hub may keep and serve what it refused. Anything else leaves it pending.
// - Settling (at start and at each feed open, which the session calls, and before any sign): the held chain holds the
//   state → cleared; the hub holds no successor of its parent → the same bytes posted again; another state holds its
//   version, or the line left its parent → `pending-fork`, until the owner's confirmed discard.
// - Discarding (`abandon-pending`'s rule, admin.ts): only on the owner's confirmation and only while the hub's chain
//   doesn't hold the state, read from the hub then and there. A fork waits for it; so does a slot the hub keeps
//   refusing for another reason (a courtesy check), which settling would otherwise post again forever.
// - A sign-out or close fences what is in flight (`fence`, `close`): a sign asked for before it stops before Touch ID,
//   before its slot is written and before any post; a settle or discard stops before its post or its write; and none
//   adopts a hub read it made before the fence. A slot written before the sign-out stays, and settles at the next
//   sign-in. Each post is made on the held line it was planned on, checked again synchronously after its exposure write,
//   with the hub client of that moment. `close` resolves once the operation in flight has ended (M4a's *Close*).
// - The slot's state and its obligation settle apart: the slot at the hub's acceptance, the obligation (deliveries.ts,
//   Task 5) when its machines acknowledge. A discard moves the obligation to `abandoned` in the same write.
// - M4a: an edit may name devices this device endorses inside the same Touch ID (`Edit.endorse`; the checks count them
//   endorsed, `verifySuccessor` checks the real endorsement after), and may carry a liveness guard (`Edit.live`, a
//   pairing's) read before Touch ID, by the device module after the person's yes, and inside the slot's write, so a
//   pairing that ends while Touch ID is open endorses, signs, slots and posts nothing.
// - M4b: an edit may carry a drop's hub row (`Edit.hubRow`), kept with its slot; `settled` hears each slot cleared
//   because the held chain holds its state, with that row, so the row goes only with that very state, however late.
// - M4c: an edit may be held (`Edit.hold`): signed into the slot as any edit, with its `unsent` marker in the slot's
//   write, and then not posted. While the marker stands nothing sends the slot: the post path refuses it in the very
//   update that would write its exposure (so settlement's repost never sends it), deliveries suspend its obligation, the
//   weekly asking is not due and every other sign answers `pending`. Only its caller's `publishHeld(hash)` sends it: one
//   update clears the marker of the slot that hash names, and only then the normal post path runs. A crash or a
//   sign-out between the two leaves an ordinary pending slot, which settles by the rules above. Publishing is this
//   run's alone: the held sign leaves an in-memory record of its slot with the lifecycle it was signed under, which a
//   sign-out, a close, the slot's Discard or its replacement drops, and which no relaunch has. Without it the slot is
//   Discard-only, since the delegation's key pair lived only in the run that ended.
//
// Network calls and adoptions run outside the signing store's updates (whose queue adoption's anchor write waits on).
// Electron-free: the state signer is injected (step-up.ts's `createStateSigner`, imported here for its type only).
import { canonicalize, isSignedOrgState, stateHash, verifySuccessor, type OrgState, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import type { StateSigner } from '../device/step-up';
import { checkSuccessor, type Finding, type SupersededOffer } from './checks';
import type { HubRow, Obligation, Pending, Unsent } from './files';
import { rereadFrom, type HeldOrg } from './held';
import type { HubClient, HubResult, Served } from './hub-client';
import type { OrgSession } from './session';
import { SigningDamaged, withExposure, type SigningStore } from './signing-store';

/**
 * A change to the org state, in the words the person confirms: `apply` edits the successor's draft (M4a's composers are
 * edits.ts). `endorse`: devices the draft lists that this device endorses with its step-up key inside the same Touch ID
 * (a later device of this Mac's own member, paired from here); the checks count each as endorsed. `live`: whether the
 * change still stands (a pairing neither cancelled nor expired), checked before Touch ID, by the device module after the
 * person's yes, and just before the slot's write; once the slot holds the proposal it is durable, and `live` no longer
 * withdraws it. `hold` (M4c): the slot keeps the proposal unsent, marked by what holds it, until `publishHeld`; the sign
 * answers `HeldSigned`.
 */
export type Edit = {
  summary: string;
  lines: string[];
  endorse?: ReadonlyArray<{ member: string; device: string }>;
  live?(): boolean;
  hubRow?: HubRow;
  hold?: Unsent;
  apply(draft: OrgState): void | Promise<void>;
};

/**
 * `beforePrompt`: the caller's last word, awaited once everything before Touch ID has passed; Touch ID is asked
 * synchronously after it says yes, and not at all after it says no (the outcome then reads `cancelled`, `not asked`).
 * The weekly asking checks focus there, so no fingerprint is asked for with no window in front.
 */
export type SignOptions = { beforePrompt?(): Promise<boolean> };

/**
 * A held sign's success (`Edit.hold`), and only a held sign's: the proposal is in the slot, unsent, and `hash` is the
 * slot's stored hash, the name `publishHeld` and a confirmed discard bind to. (TypeScript narrows a success to it with
 * `'hash' in outcome`.)
 */
export type HeldSigned = { ok: true; version: number; hash: string };

/**
 * M4c: `publishHeld`'s outcome. `published` is set only once this call's own update cleared the slot's marker, whatever
 * the post then answered: positive provenance that it published, which a slot merely gone afterwards (a Discard queued
 * ahead, a replacement) never gives.
 */
export type PublishOutcome = SignOutcome & { published?: true };

export type SignOutcome =
  | { ok: true; version: number }
  | HeldSigned
  | { ok: false; reason: 'not-root' | 'unmarked' | 'signing' | 'cancelled' | 'pending' | 'invalid' | 'hub' | 'busy' | 'stale'; detail?: string }
  | { ok: false; reason: 'refused'; findings: Finding[] };

/**
 * A discard, in `abandon-pending`'s distinctions (admin.ts:1168-1196), for the Org section to word: `unsent`, never
 * exposed (no POST, no machine's act), so nothing can show it as a fork; else where the hub stood when it was read,
 * `hubVersion` its head and `forkAt` the version where it holds another state. `marker` (M4c): the slot's own `unsent`
 * marker, read in the write that cleared the slot, naming what held it back for its caller's publish. The discard's
 * `unsent` and the slot's marker are related but different facts: a held slot is never exposed, but a slot never exposed
 * need not have been held (a crash or an unreachable hub can leave any slot unposted). Refused: the hub holds it, the
 * hub can't be read (or its head couldn't be adopted, so the floor below isn't reached), nothing is pending, or
 * signing.json is damaged. After a discard the held head is at least max(the slot's parent version, `hubVersion`): the
 * floor no lower version passes. `stale`: the owner confirmed another proposal than the slot holds now (`hash` names the
 * confirmed one), so nothing was discarded.
 */
export type DiscardOutcome = { ok: true; unsent: boolean; hubVersion: number; forkAt?: number; marker: Unsent | null } | { ok: false; reason?: 'held' | 'hub' | 'none' | 'signing' | 'stale' };

export interface OrgSigner {
  /** The held head's `root.keys` holds this device's step-up key id. */
  isRoot(): boolean;
  /** A root, its keys marked, signing.json readable. */
  maySign(): boolean;
  /** `fork`: the app's line has left it (another state at its version, or its parent off the line). `hash`: its state's
   * `stateHash`, which the owner's confirmed discard names. `refused`: the hub's last answer to a post of it this run
   * that didn't take it (a sign's or a settle's), null while it only waits (no answer, or no hub). `unsent`: the slot's
   * marker while it is held for its caller's publish (M4c), else null. */
  pending(): { version: number; exposed: boolean; fork: boolean; hash: string; refused: string | null; unsent: Unsent | null } | null;
  /** Composes, checks, prompts, slots, posts, adopts. A held edit (`Edit.hold`) stops at the slot: `HeldSigned`. */
  sign(edit: Edit, options?: SignOptions): Promise<SignOutcome>;
  /**
   * M4c: sends the held slot `hash` names. One update clears its marker (refused `stale`, changing nothing, when the slot
   * is gone, is another, is no longer held, or was held by a run that has ended: a sign-out, a close or a relaunch since
   * its held sign leaves it Discard-only); then the normal post path, whose outcome it answers. Once the marker is
   * cleared the slot is an ordinary pending one: a post that fails or is cut off leaves it to settlement, and the outcome
   * says `published` (PublishOutcome).
   */
  publishHeld(hash: string): Promise<PublishOutcome>;
  /** The slot's three rules. The session calls it at start and at each feed open; `sign` calls it first. */
  settle(): Promise<void>;
  /** Only after the owner's confirmation of the proposal `hash` names, and only while the hub's chain doesn't hold it. */
  discardPending(confirmed: true, hash: string): Promise<DiscardOutcome>;
  /** Only in `problem: 'signing'`: a fresh signing.json. */
  resetSigning(confirmed: true): Promise<void>;
  /**
   * The session's sign-out: every sign, settle and discard asked for before it stops at its next step (Touch ID, the
   * slot's write, a post, a discard's write). A slot already written stays, and settles at the next sign-in.
   */
  fence(): void;
  /** `pending()` changed (a slot written or cleared, its fork judged), so the status can be emitted again. */
  onChanged(listener: () => void): () => void;
  /**
   * Fences as `fence` does, for good: nothing in flight goes further. Resolves once the operation in flight (a sign,
   * settle, discard or reset, and a judging of the slot) has ended, so the session's close can join it.
   */
  close(): Promise<void>;
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
  /**
   * M4b: a slot cleared because the held chain holds its state (settled now, by a later settle, or at a start after a
   * relaunch), with what it was kept with: a drop's `hubRow` is the session's to delete. A discard is no settlement.
   */
  settled?(slot: Pending): void;
  now?(): number;
  log(line: string): void;
};

/**
 * An edit's refusal of itself: what it would sign is no longer what the person was shown (the superseded offer composed
 * again on the head the signer drafts from). The sign ends `stale` before Touch ID.
 */
export class StaleEdit extends Error {}

/**
 * An edit's refusal of what it was asked to do, whatever the head says (edits.ts's composers: changing yourself,
 * removing this Mac's device, …). The sign ends `refused` with these findings before Touch ID, as the checks' refusals do.
 */
export class RefusedEdit extends Error {
  constructor(readonly findings: Finding[]) {
    super(findings.map((f) => f.detail).join('; '));
  }
}

/** The edit no longer stands: what `live()` saying no reads as before Touch ID and before the slot's write. */
const ENDED = 'the change ended (a pairing cancelled or expired): nothing was signed';

/**
 * The successor of `head` an edit applies to, as `deploy/org-admin.ts`'s `successor()` composes it: a copy of its state,
 * `version + 1`, `prev` its hash, `issued` now but never before the head's.
 */
export async function successorDraft(head: SignedOrgState, at: number): Promise<OrgState> {
  const draft = structuredClone(head.state);
  draft.version += 1;
  draft.prev = await stateHash(head.state);
  const iso = new Date(at).toISOString();
  draft.issued = iso > head.state.issued ? iso : head.state.issued;
  return draft;
}

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
  /**
   * The lifecycle fence. Each sign, settle and discard takes the epoch it was asked in and goes no further once a
   * sign-out (`fence`) or `close` advances it: past Touch ID, into the slot, to the hub. The session's own generation
   * fences its attempts (registration, rekey), not signing.
   */
  let epoch = 0;
  let closed = false;
  const live = (asked: number): boolean => !closed && epoch === asked;
  /**
   * M4c: the held slot this run may publish (its stored hash) and the lifecycle it was signed under. Only memory holds
   * it, as only memory holds the held delegation's key pair: a fence, a close, the slot's Discard or a new slot drops it.
   */
  let heldHere: { hash: string; epoch: number } | null = null;
  const stopped = (what: string): SignOutcome => ({ ok: false, reason: 'not-root', detail: `this Mac signed out while signing: ${what}` });

  /** The fork judgment of the slot `key` names (its state's canonical form), refreshed after each change. */
  let judged: { key: string; fork: boolean } | null = null;
  /** The hub's last refusal of the state `key` names, from a sign's post or a settle's, so the owner can discard it. */
  let refusal: { key: string; detail: string } | null = null;
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
    return {
      version: signed.state.version,
      exposed: exposed.hub || exposed.machines.length > 0,
      fork: judged !== null && judged.key === key && judged.fork,
      hash: file.pending.hash,
      refused: refusal !== null && refusal.key === key ? refusal.detail : null,
      unsent: file.pending.unsent === null ? null : { ...file.pending.unsent },
    };
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
  /** The judgings in flight, which `close` joins: one may be clearing the slot. */
  const judgings = new Set<Promise<void>>();
  const refreshNow = (): Promise<void> => {
    const judging = refresh().catch((error: unknown) => log(`judging the pending state failed: ${(error as Error).message}`));
    judgings.add(judging);
    void judging.finally(() => judgings.delete(judging));
    return judging;
  };
  const refreshed = () => void refreshNow();
  const unwatch = deps.session.onChanged(refreshed);
  refreshed();

  /** Clears the slot if it still holds `slot`'s state (never once closed: the next start settles it). */
  async function clear(slot: Pending): Promise<void> {
    if (closed) return;
    const key = canonicalize(slot.signed.state);
    const cleared = await store.update<Pending | null>((file) => {
      if (file.pending === null || canonicalize(file.pending.signed.state) !== key) return { next: file, value: null };
      const was = file.pending;
      file.pending = null;
      return { next: file, value: was };
    });
    if (cleared === null) return;
    log(`pending version ${slot.signed.state.version} is on the held chain: settled`);
    try {
      deps.settled?.(cleared);
    } catch (error) {
      log(`a settlement listener failed: ${(error as Error).message}`);
    }
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

  /**
   * The hub's chain read and adopted, by M1's rule (held.ts's `rereadFrom`): after the held head (or `from`), and again
   * from a recovery's base when the page carries a recovery from below the head, so a rewind is authenticated and taken
   * rather than refused as a rollback. `agreed`: the held head is now the hub's head; `why`: what kept it from being.
   * Null with no held view, or once the lifecycle `asked` names has ended (a sign-out or close since a read): nothing
   * read after it is adopted.
   */
  async function follow(hub: HubClient, asked: number, from?: number): Promise<{ read: HubResult<Served>; agreed: boolean; why?: string } | null> {
    const view = deps.held();
    if (view === null) return null;
    let read = await hub.chain(from ?? view.head().state.version);
    if (!live(asked)) return null;
    if (read.ok) {
      const again = rereadFrom(view, read.value);
      if (again !== null && (from === undefined || again < from)) {
        read = await hub.chain(again);
        if (!live(asked)) return null;
      }
    }
    if (!read.ok) {
      log(`the hub's chain did not read: ${describe(read)}`);
      return { read, agreed: false, why: describe(read) };
    }
    let why: string | undefined;
    try {
      why = (await view.adoptServed(read.value)).refused;
    } catch (error) {
      why = (error as Error).message;
    }
    if (why !== undefined) log(`the hub's chain was not adopted: ${why}`);
    const now = deps.held();
    const served = read.value.head;
    const agreed = now !== null && isSignedOrgState(served) && (await stateHash(now.head().state)) === (await stateHash(served.state));
    return { read, agreed, ...(agreed ? {} : { why: why ?? `the hub's head is not the held one` }) };
  }

  /** The held chain holds `signed`'s state at its version. */
  async function onChain(signed: SignedOrgState): Promise<boolean> {
    const view = deps.held();
    const at = view === null ? undefined : stateAt(view, signed.state.version);
    return at !== undefined && (await stateHash(at.state)) === (await stateHash(signed.state));
  }

  /**
   * Posts the slot's state, `exposed.hub` written first, and settles what the answer says; then starts the deliveries,
   * which send only what is on the app's line (so nothing of a slot the answer made a fork).
   */
  async function post(signed: SignedOrgState, asked: number): Promise<SignOutcome> {
    const outcome = await postOnce(signed, asked);
    if (live(asked)) void deliveries.send().catch((error: unknown) => log(`delivering failed: ${(error as Error).message}`));
    return outcome;
  }

  async function postOnce(signed: SignedOrgState, asked: number): Promise<SignOutcome> {
    const version = signed.state.version;
    const unsent = `version ${version} was not posted, and stays pending until this Mac signs in again`;
    if (!live(asked)) return stopped(unsent);
    if (deps.hub() === null) return { ok: false, reason: 'hub', detail: 'no hub: the state stays pending until it can be posted' };
    // The held line the post is made on, and the proposal must still be its successor: an adoption between the slot's
    // write and here (a sibling whose in-memory head moved before its anchor's turn in the commit queue, a recovery)
    // leaves a proposal that can only fork. It is not posted, and `judgePending` reads it as the fork it is. An
    // adoption while the exposure is written is caught by the identity check after it.
    const view = deps.held();
    const head = view?.head() ?? null;
    const parent = head === null ? null : await stateHash(head.state);
    const onLine = view !== null && deps.held() === view && view.head() === head && head !== null && head.state.version === version - 1 && parent === signed.state.prev;
    if (!onLine) {
      if (await clearIfHeld()) return { ok: true, version };
      log(`version ${version}: the held head is not its parent; nothing was posted`);
      return { ok: false, reason: 'hub', detail: `the held org state is no longer version ${version}'s parent: nothing was posted, and it stays pending` };
    }
    // The parent's hash was an await: a sign-out or close since stops it before the exposure's enqueue.
    if (!live(asked)) return stopped(unsent);
    let exposed: boolean;
    try {
      exposed = await store.update((file) => {
        // M4c: a slot held unsent is never sent from here while its marker stands (settlement's repost included); only
        // `publishHeld` sends it, after an update of its own cleared the marker. Judged in the update that would expose it.
        const slot = file.pending;
        if (slot !== null && slot.unsent !== null && canonicalize(slot.signed.state) === canonicalize(signed.state)) return { next: file, value: false };
        return { next: withExposure(file, signed, { hub: true }), value: true };
      });
    } catch (error) {
      return { ok: false, reason: 'signing', detail: (error as Error).message };
    }
    if (!exposed) {
      log(`version ${version} is held unsent for its caller's publish: nothing was posted`);
      return { ok: false, reason: 'pending', detail: `version ${version} is held unsent until its caller publishes it` };
    }
    refreshed();
    // Synchronously from here to the post, as deliveries.ts does before its act: a proposal whose parent is no longer
    // the held head (or whose state the held chain now holds) is not posted; it settles by the slot's rules. Nor is
    // one a sign-out overtook, and the hub is the one this lifecycle reaches now, never a client taken before the write.
    if (!live(asked)) return stopped(unsent);
    const hub = deps.hub();
    if (hub === null) return { ok: false, reason: 'hub', detail: 'no hub: the state stays pending until it can be posted' };
    if (deps.held() !== view || (view?.head() ?? null) !== head) {
      if (await clearIfHeld()) return { ok: true, version };
      log(`version ${version}: the held org state moved while its exposure was written; nothing was posted`);
      return { ok: false, reason: 'hub', detail: `the held org state moved before version ${version} was posted: nothing was posted, and it stays pending` };
    }
    const answer = await hub.postState(signed);
    // The refusal the status names is the outcome's detail; no answer is no refusal (the slot only waits).
    const lost = !answer.ok && answer.kind === 'status' && answer.status === 409 && (answer.error === 'not-head' || answer.error === 'rollback');
    heard(signed, answer.ok || answer.kind === 'unreachable' ? null : lost ? answer.error : describe(answer));
    if (answer.ok) {
      log(`version ${version} accepted by the hub`);
      let why = (await follow(hub, asked))?.why;
      // A sign-out or close since the post: nothing is adopted for it here; the slot settles at the next sign-in.
      if (!live(asked)) return stopped(`version ${version} was posted, and stays pending until this Mac signs in again`);
      const view = deps.held();
      // Adopted directly when the chain's read didn't bring it: the held view verifies it as any state.
      if (view !== null && stateAt(view, version) === undefined) {
        try {
          why = (await view.adoptServed({ chain: [signed], head: null, transitions: [], certificates: null })).refused ?? why;
        } catch (error) {
          why = (error as Error).message;
        }
      }
      // Done only once the state is on the held chain (a concurrent re-judge may have cleared the slot already). A 201
      // is the hub's word, which proves nothing (RL §5.9): until then the slot stays, and settling finishes it.
      if (!(await onChain(signed))) {
        const detail = `the hub took version ${version}, but it was not adopted here (${why ?? 'another state holds its version'}): it stays pending`;
        log(detail);
        return { ok: false, reason: 'hub', detail };
      }
      await clearIfHeld().catch((error: unknown) => log(`clearing settled version ${version} failed: ${(error as Error).message}; the next settle clears it`));
      return { ok: true, version };
    }
    log(`version ${version}: the hub answered ${describe(answer)}; it stays pending`);
    if (answer.kind === 'status' && answer.status === 409 && (answer.error === 'not-head' || answer.error === 'rollback')) {
      await follow(hub, asked);
      // The hub's chain holds it after all (an earlier post of the same bytes): settled.
      if (await clearIfHeld()) return { ok: true, version };
      return { ok: false, reason: 'hub', detail: answer.error };
    }
    return { ok: false, reason: 'hub', detail: describe(answer) };
  }

  /** What the hub said of a post of `signed`: `detail` a refusal the status names, null an acceptance or no answer. */
  function heard(signed: SignedOrgState, detail: string | null): void {
    const key = canonicalize(signed.state);
    if (detail !== null) refusal = { key, detail };
    else if (refusal?.key === key) refusal = null;
    announce();
  }

  async function settleLocked(asked: number): Promise<void> {
    const file = store.get();
    const view = deps.held();
    if (file === 'damaged' || file.pending === null || view === null) return;
    const slot = file.pending;
    const version = slot.signed.state.version;
    let verdict = await judgePending(slot, view);
    if (verdict === 'candidate') {
      const hub = deps.hub();
      if (hub === null) return;
      const followed = await follow(hub, asked);
      if (followed === null || !followed.read.ok) return;
      const now = deps.held();
      if (now === null) return;
      verdict = await judgePending(slot, now);
      const served = followed.read.value;
      if (verdict === 'candidate') {
        // The hub's head is still the parent, so it holds no successor of it: the same bytes go again.
        if (isSignedOrgState(served.head) && (await stateHash(served.head.state)) === slot.parent) {
          log(`pending version ${version} is not at the hub: sent again`);
          await post(slot.signed, asked);
        } else {
          log(`pending version ${version}: the hub serves a chain the held view did not take; it stays pending`);
        }
        return;
      }
    }
    if (verdict === 'held') await clear(slot);
    else log(`pending version ${version} is a fork: another state holds its version; it waits for the owner's discard`);
  }

  /**
   * M4c's publish, in two steps. First one update, pure and synchronous, clears the marker of the slot whose stored hash
   * is `named`, still held, and held by this lifecycle (`heldHere`); nothing else is changed (no slot: it was discarded;
   * another: it was replaced; no marker: it was published already, and settlement owns it; no record of this run holding
   * it: the run that held it ended, and only Discard is left). Only once that write resolves, the normal post path, which
   * writes exposure first. So a caller whose slot is gone publishes nothing, and an end between the two steps (a crash, a
   * sign-out, a close) leaves an ordinary unexposed pending slot that the next settlement posts.
   */
  async function publishLocked(named: string, asked: number): Promise<PublishOutcome> {
    const unpublished = 'nothing was published';
    if (!live(asked)) return stopped(unpublished);
    if (deps.session.current() === null) return { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
    if (store.get() === 'damaged') return { ok: false, reason: 'signing' };
    const cleared = await store.update<'stopped' | 'none' | 'other' | 'sent' | 'ended' | SignedOrgState>((f) => {
      if (!live(asked)) return { next: f, value: 'stopped' };
      if (f.pending === null) return { next: f, value: 'none' };
      if (f.pending.hash !== named) return { next: f, value: 'other' };
      if (f.pending.unsent === null) return { next: f, value: 'sent' };
      // The run that held it, and no other: checked in the clearing update, so nothing awaits between the two.
      if (heldHere === null || heldHere.hash !== named || heldHere.epoch !== epoch) return { next: f, value: 'ended' };
      f.pending.unsent = null;
      return { next: f, value: f.pending.signed };
    });
    if (cleared === 'stopped') return stopped(unpublished);
    if (cleared === 'none') return { ok: false, reason: 'stale', detail: `no proposal is pending (discarded): ${unpublished}` };
    if (cleared === 'other') return { ok: false, reason: 'stale', detail: `another proposal holds the slot now: ${unpublished}` };
    if (cleared === 'sent') return { ok: false, reason: 'stale', detail: 'the proposal is no longer held: it was published already, and settles as any pending proposal' };
    if (cleared === 'ended') return { ok: false, reason: 'stale', detail: 'this slot was held by a run that has ended: only Discard' };
    heldHere = null;
    log(`version ${cleared.state.version} published by its caller: its marker is cleared, and it is posted`);
    refreshed();
    // From here on it is published, whatever the post answers: a store that fails now leaves an ordinary pending slot.
    try {
      return { ...(await post(cleared, asked)), published: true };
    } catch (error) {
      log(`posting version ${cleared.state.version} failed: ${(error as Error).message}`);
      return { ok: false, reason: 'signing', detail: (error as Error).message, published: true };
    }
  }

  /** The refusal before anything is composed, or null. */
  function standing(): SignOutcome | null {
    if (deps.session.current() === null) return { ok: false, reason: 'not-root', detail: 'this Mac is not signed in to the org' };
    if (!isRoot()) return { ok: false, reason: 'not-root' };
    if (!deps.marked()) return { ok: false, reason: 'unmarked' };
    if (store.get() === 'damaged') return { ok: false, reason: 'signing' };
    return null;
  }

  async function signLocked(edit: Edit, asked: number, options: SignOptions): Promise<SignOutcome> {
    if (!live(asked)) return stopped('nothing was signed');
    const before = standing();
    if (before !== null) return before;
    await settleLocked(asked);
    const file = store.get();
    if (file === 'damaged') return { ok: false, reason: 'signing' };
    if (file.pending !== null) return { ok: false, reason: 'pending' };
    // On the hub's head where the hub is reachable, so a successor of a stale head isn't proposed (and left a fork).
    // A hub that can't be read is passed over (direct delivery needs no hub); one whose head the held view won't take
    // is not: the held head may be one a recovery superseded, signed for with a root the recovery removed.
    const hub = deps.hub();
    const followed = hub === null ? null : await follow(hub, asked);
    if (!live(asked)) return stopped('nothing was signed');
    if (followed !== null && followed.read.ok && !followed.agreed) {
      return { ok: false, reason: 'hub', detail: `the hub's head was not taken here (${followed.why}): nothing is signed until the two agree` };
    }
    const again = standing();
    if (again !== null) return again;

    const view = deps.held()!;
    const signer = deps.signer()!;
    const head = view.head();
    const draft = await successorDraft(head, now());
    try {
      await edit.apply(draft);
    } catch (error) {
      if (error instanceof StaleEdit) return { ok: false, reason: 'stale', detail: error.message };
      if (error instanceof RefusedEdit) return { ok: false, reason: 'refused', findings: error.findings };
      return { ok: false, reason: 'invalid', detail: `the edit failed: ${(error as Error).message}` };
    }
    // Each device to endorse is one the draft lists under that member: the device module endorses only what it signs.
    const endorse = edit.endorse ?? [];
    const unlisted = endorse.find(({ member, device }) => !draft.members.some((m) => m.id === member && m.devices.some((d) => d.id === device)));
    if (unlisted !== undefined) return { ok: false, reason: 'invalid', detail: `the edit names device ${unlisted.device} to endorse, which the successor doesn't list under that member` };

    const endorsing = endorse.length === 0 ? undefined : { kid: signer.kid, devices: endorse.map((e) => e.device) };
    const findings = await checkSuccessor(head.state, draft, view.superseded(), new Date(now()), { certificates: view.certificates(), ...(endorsing === undefined ? {} : { endorsing }) });
    if (findings.some((f) => f.level === 'refuse')) return { ok: false, reason: 'refused', findings };
    const text = [
      `Org ${draft.org}: version ${head.state.version} → ${draft.version}`,
      ...edit.lines,
      ...findings.map((f) => `Warning: ${f.detail}`),
    ].join('\n');
    // Touch ID shows only its one line (step-up.ts's `promptTouchIDConfirmation`), never `text`: a change's own lines
    // are shown before it is asked for (the Org section's sheet), and a warning is at least counted here, where it is
    // read, with where to find it (the superseded-keys warnings are the Org section's Revocations row).
    const warned = findings.length;
    const summary = warned === 0 ? edit.summary : `${edit.summary}, with ${warned === 1 ? '1 warning' : `${warned} warnings`} shown in Settings › Org`;
    // The edit and the checks above are awaits a sign-out may land in: the person is not asked for it.
    if (!live(asked)) return stopped('nothing was signed');
    if (options.beforePrompt !== undefined && !(await options.beforePrompt())) return { ok: false, reason: 'cancelled', detail: 'not asked' };
    // Synchronously from here to Touch ID.
    if (!live(asked)) return stopped('nothing was signed');
    if (edit.live !== undefined && !edit.live()) return { ok: false, reason: 'stale', detail: ENDED };
    // The device module reads `live` again once the person said yes, before it endorses or signs anything.
    const answer = await signer.sign(draft, { summary, text }, { endorse, ...(edit.live === undefined ? {} : { live: () => edit.live!() }) });
    if (!answer.ok) return edit.live !== undefined && !edit.live() ? { ok: false, reason: 'cancelled', detail: ENDED } : { ok: false, reason: 'cancelled' };
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
    const slot: Pending = {
      signed,
      parent: await stateHash(parent.state),
      hash: await stateHash(signed.state),
      exposed: { hub: false, machines: [] },
      ...(edit.hubRow === undefined ? {} : { hubRow: { ...edit.hubRow } }),
      unsent: edit.hold === undefined ? null : { kind: edit.hold.kind, id: edit.hold.id },
    };
    let kept: 'kept' | 'pending' | 'moved' | 'stopped' | 'ended';
    // Right before the enqueue (the verdict and the obligation were awaits): a close since refuses the store's queue, and
    // a sign-out since keeps nothing, so either reads as the stopped sign it is.
    if (!live(asked)) return stopped('what was signed was not kept or sent');
    try {
      kept = await store.update((f) => {
        // A sign-out since the person was asked: what was signed is never kept, so nothing can post it later.
        if (!live(asked)) return { next: f, value: 'stopped' as const };
        // The change ended since the person said yes (the verdict and the obligation were awaited, and a first write's
        // registration mark, after which the store runs this again): never kept. From this write on the proposal is
        // durable, and ending the change no longer withdraws it.
        if (edit.live !== undefined && !edit.live()) return { next: f, value: 'ended' as const };
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
    if (kept === 'stopped') return stopped('what was signed was not kept or sent');
    if (kept === 'ended') return { ok: false, reason: 'stale', detail: 'the change ended (a pairing cancelled or expired) after Touch ID: what was signed was not kept or sent' };
    // The slot is this run's now: a held one is publishable by this lifecycle alone, any other replaces the record.
    heldHere = slot.unsent === null ? null : { hash: slot.hash, epoch: asked };
    log(`version ${signed.state.version} signed and kept pending${slot.unsent === null ? '' : `, held unsent for ${slot.unsent.kind} ${slot.unsent.id}`}${obligation === null ? '' : `, owed to ${obligation.owed.length} machine(s)`}`);
    refreshed();
    // M4c: a held proposal stops here, unsent; its caller publishes it by the slot's hash.
    if (slot.unsent !== null) return { ok: true, version: signed.state.version, hash: slot.hash };

    return post(signed, asked);
  }

  return {
    isRoot,
    maySign: () => isRoot() && deps.marked() && store.get() !== 'damaged',
    pending,
    async sign(edit, options = {}) {
      if (signing) return { ok: false, reason: 'busy' };
      signing = true;
      const asked = epoch;
      try {
        return await exclusive(() => signLocked(edit, asked, options));
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
      const asked = epoch;
      await exclusive(() => settleLocked(asked));
      await refreshNow();
    },
    async publishHeld(named) {
      const asked = epoch;
      try {
        return await exclusive(() => publishLocked(named, asked));
      } catch (error) {
        // Only the signing store throws here (a damaged file, a failed write): the slot's state is what it reads back.
        if (error instanceof SigningDamaged) return { ok: false, reason: 'signing' };
        log(`publishing failed: ${(error as Error).message}`);
        return { ok: false, reason: 'signing', detail: (error as Error).message };
      } finally {
        await refreshNow();
      }
    },
    async discardPending(confirmed, named) {
      if (confirmed !== true) return { ok: false };
      const asked = epoch;
      const outcome = await exclusive(async (): Promise<DiscardOutcome> => {
        if (!live(asked)) return { ok: false };
        const file = store.get();
        if (file === 'damaged') return { ok: false, reason: 'signing' };
        if (file.pending === null) return { ok: false, reason: 'none' };
        const slot = file.pending;
        // The owner's consent is to the proposal they were shown: a slot replaced since is not theirs to discard.
        if (slot.hash !== named) return { ok: false, reason: 'stale' };
        const version = slot.signed.state.version;
        if (await clearIfHeld()) return { ok: false, reason: 'held' };
        const hub = deps.hub();
        if (hub === null) return { ok: false, reason: 'hub' };
        // The hub's chain from the slot's version, adopted first: the floor after the discard is its head.
        const followed = await follow(hub, asked, version - 1);
        if (!live(asked)) return { ok: false };
        if (followed === null || !followed.read.ok) return { ok: false, reason: 'hub' };
        const served = followed.read.value;
        const there = served.chain.find((s) => s.state.version === version);
        if (there !== undefined && canonicalize(there.state) === canonicalize(slot.signed.state)) {
          // The hub holds it: adopted with the read, it settles as the hub's.
          await clearIfHeld().catch(() => false);
          return { ok: false, reason: 'held' };
        }
        const hubVersion = isSignedOrgState(served.head) ? served.head.state.version : 0;
        const view = deps.held();
        if (view === null || view.head().state.version < hubVersion) return { ok: false, reason: 'hub' };
        // The slot's own hash (the store computed it), so no await falls between the lifecycle check and the enqueue.
        const hash = slot.hash;
        const key = canonicalize(slot.signed.state);
        if (!live(asked)) return { ok: false };
        const done = await store.update<'stopped' | { unsent: boolean; marker: Unsent | null } | null>((f) => {
          // A sign-out since the owner confirmed: the hub was read for the lifecycle that ended, so nothing is discarded on it.
          if (!live(asked)) return { next: f, value: 'stopped' as const };
          if (f.pending === null || canonicalize(f.pending.signed.state) !== key) return { next: f, value: null };
          const { hub: atHub, machines } = f.pending.exposed;
          const marker = f.pending.unsent;
          f.pending = null;
          f.deliveries = f.deliveries.filter((o) => o.hash !== hash);
          f.abandoned.push({ hash, version, hub: atHub, machines: [...machines] });
          return { next: f, value: { unsent: !atHub && machines.length === 0, marker } };
        });
        if (done === 'stopped') return { ok: false };
        if (done === null) return { ok: false, reason: 'none' };
        if (heldHere?.hash === hash) heldHere = null;
        log(`pending version ${version} ${hash} abandoned on the owner's word${done.unsent ? ' (never sent)' : ''}${done.marker === null ? '' : ` (held for ${done.marker.kind} ${done.marker.id})`}; the hub's head is version ${hubVersion}`);
        return { ok: true, unsent: done.unsent, hubVersion, ...(there === undefined ? {} : { forkAt: version }), marker: done.marker };
      });
      await refreshNow();
      return outcome;
    },
    async resetSigning(confirmed) {
      if (confirmed !== true) return;
      await exclusive(async () => {
        // Asked for before a close whose fence ran first: nothing is written once closed (the next start asks again).
        if (closed) return;
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
    fence() {
      epoch++;
      heldHere = null;
    },
    close() {
      closed = true;
      epoch++;
      heldHere = null;
      unwatch();
      listeners.clear();
      return Promise.all([turns, ...judgings]).then(() => undefined);
    },
  };
}
