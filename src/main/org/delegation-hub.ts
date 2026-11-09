// The delegations' hub reconciliation (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's
// "Renew", "Drop"; the refresh's item 7; Interfaces §S): the hub halves of renew and drop, Retry and a stray key's
// Revoke, the revokes a create or a Discard asks for, and the hub's key list the view reads. One of the two state owners
// behind delegations.ts (the other, delegation-create.ts, owns a create's run and its custody).
//
// - The hub halves follow from the head, with no record of their own: a settled state that extends a delegation's
//   `expires` against its parent renews its hub key; one that drops a delegation revokes it. Each runs once at its
//   settlement (the signer's `settled`), and Retry (`renewHub`, `revokeHub`) calls the route alone; a later sign-in or a
//   relaunch reads what is left from the comparison (view.ts's `hubBehind`), and nothing carries a half across.
// - Everything here belongs to the sign-in that asked for it: a half is queued with its sign-in, and runs only while
//   that sign-in stands; every await's answer, and every read it would start, is judged against it (`over`). The fence
//   (a sign-out) drops the queue, the key list, its clock and the problems; a half or a read still out answers nothing
//   to the next sign-in.
// - `409 not-renewed` is followed by the key list, and a key no longer behind (equal included) is done.
// - The key list is read when the Org page is shown (`readKeys({ifStale})`), after each hub half, and at each
//   settlement; the last good read is kept with its time, and a failed one says so.
// - A Revoke of a key this Mac's create under way holds (`reserves`) is refused: that key is about to be named.
//
// Electron-free: the session injects its context through delegations.ts.
import type { OrgState } from '../../../apps/org-protocol/src/index.ts';
import type { HubHalfResult } from '@shared/ipc/schema/org';
import type { DelegationsContext, HubProblem } from './delegations';
import type { Pending } from './files';
import type { HubResult, ProvisioningKey } from './hub-client';
import { orgTiming, type OrgTiming } from './timing';

export type DelegationHubDeps = {
  context(): DelegationsContext | null;
  /** The pending slot's signed state (held unsent or not), whose delegations no Revoke may take: null with no slot. */
  slotState(): OrgState | null;
  /** The held chain's state at `version` (a settled state's parent), or null. */
  stateAt(version: number): OrgState | null;
  /** Whether a create of this Mac's under way holds key `id` (`key`, its entry in the last read, when there is one). */
  reserves(id: string, key: ProvisioningKey | null): boolean;
  changed(): void;
  timing?: Partial<OrgTiming>;
  now(): number;
  log(line: string): void;
};

export interface DelegationHub {
  renewHub(id: string): Promise<HubHalfResult>;
  revokeHub(id: string): Promise<HubHalfResult>;
  settled(slot: Pending): void;
  /**
   * Key `id` revoked for the sign-in `asked` (a create's minted key no state names): the hub's answer, or null when that
   * sign-in has ended (nothing is asked of the hub for it). The key list is read after, while it stands.
   */
  revokeKey(id: string, asked: number): Promise<HubResult<'revoked' | 'absent'> | null>;
  /** A Discard's marker: the unsent delegation's hub key revoked under the current sign-in (a failure leaves a stray). */
  revokeDiscarded(id: string): Promise<void>;
  readKeys(options?: { ifStale?: boolean }): Promise<void>;
  viewInputs(): { keys: { list: readonly ProvisioningKey[]; at: string } | null; keysFailed: boolean; hubProblems: ReadonlyMap<string, HubProblem> };
  idle(): Promise<void>;
  fence(): void;
  close(): void;
}

export const hubWords = (answer: Exclude<HubResult<unknown>, { ok: true }>): string =>
  answer.kind === 'status' ? `${answer.status} ${answer.error ?? 'with no code'}` : answer.kind === 'unreachable' ? `no answer (${answer.detail})` : `Access answered ${answer.status}`;

const SIGN_IN_ENDED: HubHalfResult = { ok: false, reason: 'hub', detail: 'the sign-in that asked for it ended' };

export function createDelegationHub(deps: DelegationHubDeps): DelegationHub {
  const timing = orgTiming(deps.timing);
  const { now, log, changed } = deps;
  let closed = false;
  let keys: { list: ProvisioningKey[]; at: number } | null = null;
  let keysFailed = false;
  let keysAsked = Number.NEGATIVE_INFINITY;
  let keysReading: { asked: number; read: Promise<void> } | null = null;
  const hubProblems = new Map<string, HubProblem>();
  let halves: Promise<unknown> = Promise.resolve();

  /** The sign-in `asked` names has ended (a sign-out or close since): its answers are recorded nowhere. */
  const over = (asked: number) => closed || deps.context()?.signIn !== asked;

  /** `half` after every half queued before it, one at a time, for the sign-in queuing it; dropped once that ends. */
  function queued(half: (asked: number) => Promise<HubHalfResult>): Promise<HubHalfResult> {
    const asked = deps.context()?.signIn ?? null;
    const turn = halves.then(() => (asked === null || over(asked) ? SIGN_IN_ENDED : half(asked)));
    halves = turn.catch((error: unknown) => log(`a hub half failed: ${(error as Error).message}`));
    return turn;
  }

  function failed(id: string, asked: number, reason: HubProblem['reason'], detail: string): HubHalfResult {
    if (!over(asked)) {
      hubProblems.set(id, { reason, detail });
      changed();
    }
    log(`the hub half for ${id} did not finish (${reason}: ${detail})`);
    return { ok: false, reason, detail };
  }
  function done(id: string, asked: number, said: string): HubHalfResult {
    log(`the hub half for ${id}: ${said}`);
    if (!over(asked) && hubProblems.delete(id)) changed();
    return { ok: true };
  }

  /** The context of sign-in `asked`, or null once it has ended. */
  function contextOf(asked: number): DelegationsContext | null {
    const ctx = deps.context();
    return closed || ctx === null || ctx.signIn !== asked ? null : ctx;
  }

  /** Renew's hub half: `POST …/renew`, no body, by §S's answers. */
  async function renewHalf(id: string, asked: number): Promise<HubHalfResult> {
    const ctx = contextOf(asked);
    if (ctx === null) return SIGN_IN_ENDED;
    const delegation = ctx.head.state.delegations.find((d) => d.id === id);
    if (delegation === undefined) return { ok: false, reason: 'none', detail: `the org state holds no delegation ${id}` };
    if (ctx.client === null) return failed(id, asked, 'hub', 'the hub sign-in has ended: sign in again, then Retry');
    const answer = await ctx.client.renewProvisioningKey(id);
    if (over(asked)) return SIGN_IN_ENDED;
    if (answer.ok) {
      noteKey(answer.value);
      await refreshKeys(asked);
      return done(id, asked, `the hub's key now expires ${answer.value.expires}`);
    }
    const code = answer.kind === 'status' ? `${answer.status} ${answer.error}` : null;
    let result: HubHalfResult;
    if (code === '409 not-renewed') {
      // Also a renewal already applied (a lost 200): the key list says whether the hub's key is still behind.
      await refreshKeys(asked);
      if (over(asked)) return SIGN_IN_ENDED;
      const key = keys?.list.find((k) => k.id === id);
      if (key !== undefined && key.revoked === null && !(Date.parse(delegation.expires) > Date.parse(key.expires))) return done(id, asked, `the hub's key already expires ${key.expires}`);
      return failed(id, asked, 'not-renewed', `the hub's org state doesn't hold the renewal yet${key === undefined ? '' : `; its key still expires ${key.expires}`}`);
    }
    if (code === '503 hub-updating') result = failed(id, asked, 'updating', 'the hub is updating: Retry in a moment');
    else if (code === '404 not-found') result = failed(id, asked, 'no-route', `Renewed in the org state; this hub can't renew its key yet`);
    else if (code === '410 key-revoked') result = failed(id, asked, 'ended', "the hub's key was revoked, and a revoked key is never renewed");
    else if (code === '410 key-expired') result = failed(id, asked, 'ended', "the hub's key expired before it was renewed, and an elapsed key is never revived");
    else if (code === '409 too-long') result = failed(id, asked, 'too-long', 'the hub refuses that expiry yet (past its longest key life from now): Retry later');
    else if (answer.kind === 'status') result = failed(id, asked, 'refused', `the hub answered ${hubWords(answer)}`);
    else result = failed(id, asked, 'hub', `the hub was not reached (${hubWords(answer)}): Retry`);
    await refreshKeys(asked);
    return result;
  }

  /** Drop's hub half, or a stray key's Revoke: `DELETE`, a soft revoke; `404 unknown-key` counts as gone. */
  async function revokeHalf(id: string, asked: number): Promise<HubHalfResult> {
    const ctx = contextOf(asked);
    if (ctx === null) return SIGN_IN_ENDED;
    if (ctx.head.state.delegations.some((d) => d.id === id)) return { ok: false, reason: 'none', detail: `delegation ${id} is in effect: drop it to revoke its key` };
    // A delegation the pending slot carries (held unsent, or published and not yet settled) is about to be in effect.
    if (deps.slotState()?.delegations.some((d) => d.id === id) === true) return { ok: false, reason: 'none', detail: `delegation ${id} is in the pending proposal: its Discard revokes its key` };
    // A key this Mac's create under way minted, before its slot exists: about to be named.
    if (deps.reserves(id, keys?.list.find((k) => k.id === id) ?? null)) return { ok: false, reason: 'none', detail: `key ${id} is the one a create under way on this Mac holds: wait for it to finish` };
    if (ctx.client === null) return failed(id, asked, 'hub', 'the hub sign-in has ended: sign in again, then Retry');
    const answer = await ctx.client.revokeProvisioningKey(id);
    if (over(asked)) return SIGN_IN_ENDED;
    await refreshKeys(asked);
    if (answer.ok) return done(id, asked, answer.value === 'revoked' ? 'the hub\'s key is revoked' : 'the hub holds no such key');
    return answer.kind === 'status' ? failed(id, asked, answer.status === 503 && answer.error === 'hub-updating' ? 'updating' : 'refused', `the hub answered ${hubWords(answer)}`) : failed(id, asked, 'hub', `the hub was not reached (${hubWords(answer)}): Retry`);
  }

  function settled(slot: Pending): void {
    const state = slot.signed.state;
    const parent = deps.stateAt(state.version - 1);
    if (parent !== null) {
      for (const d of state.delegations) {
        const before = parent.delegations.find((p) => p.id === d.id);
        if (before !== undefined && Date.parse(d.expires) > Date.parse(before.expires)) void queued((asked) => renewHalf(d.id, asked));
      }
      const wasDropped = new Set(parent.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.delegation] : [])));
      for (const r of state.revoked) {
        if ('delegation' in r.holder && !wasDropped.has(r.holder.delegation)) {
          const id = r.holder.delegation;
          void queued((asked) => revokeHalf(id, asked));
        }
      }
    }
    void queued(async (asked) => {
      await refreshKeys(asked);
      return { ok: true };
    });
  }

  async function revokeKey(id: string, asked: number): Promise<HubResult<'revoked' | 'absent'> | null> {
    const ctx = contextOf(asked);
    if (ctx === null) return null;
    if (ctx.client === null) return { ok: false, kind: 'unreachable', detail: 'no hub sign-in' };
    const answer = await ctx.client.revokeProvisioningKey(id);
    if (!over(asked)) void refreshKeys(asked);
    return answer;
  }

  async function revokeDiscarded(id: string): Promise<void> {
    const asked = deps.context()?.signIn ?? null;
    const answer = asked === null ? null : await revokeKey(id, asked);
    if (answer === null) log(`the discarded delegation ${id}'s hub key was not revoked (the sign-in ended): it shows as a stray key`);
    else if (answer.ok) log(`the discarded delegation ${id}'s hub key is ${answer.value === 'revoked' ? 'revoked' : 'gone'}`);
    else log(`the discarded delegation ${id}'s hub key was not revoked (${hubWords(answer)}): it shows as a stray key`);
    if (asked !== null) await refreshKeys(asked);
  }

  // ---- the hub's key list ----

  function readKeys(options: { ifStale?: boolean } = {}): Promise<void> {
    const ctx = deps.context();
    if (closed || ctx === null) return Promise.resolve();
    return refreshKeys(ctx.signIn, options.ifStale === true);
  }

  /** The key list read for sign-in `asked`, while it stands. */
  function refreshKeys(asked: number, ifStale = false): Promise<void> {
    if (over(asked)) return Promise.resolve();
    // A read already out serves the page; anyone else (a hub half just answered) needs one that starts after it.
    if (keysReading !== null && keysReading.asked === asked) return ifStale ? keysReading.read : keysReading.read.then(() => refreshKeys(asked));
    if (ifStale && now() - keysAsked < timing.KEYS_FRESH_MS) return Promise.resolve();
    keysAsked = now();
    const client = deps.context()!.client;
    if (client === null) {
      if (!keysFailed) {
        keysFailed = true;
        changed();
      }
      return Promise.resolve();
    }
    const reading = {
      asked,
      read: (async () => {
        const read = await client.provisioningKeys();
        if (over(asked)) return;
        const before = JSON.stringify([keys?.list ?? null, keysFailed]);
        if (read.ok) {
          keys = { list: read.value.keys, at: now() };
          keysFailed = false;
        } else {
          keysFailed = true;
          log(`the hub's provisioning keys did not read (${hubWords(read)})`);
        }
        if (JSON.stringify([keys?.list ?? null, keysFailed]) !== before) changed();
      })().finally(() => {
        if (keysReading === reading) keysReading = null;
      }),
    };
    keysReading = reading;
    return reading.read;
  }

  /** A key one answer gave (renew's), taken into the last read. */
  function noteKey(key: ProvisioningKey): void {
    if (keys === null) return;
    keys = { list: keys.list.map((k) => (k.id === key.id ? key : k)), at: keys.at };
    changed();
  }

  function fence(): void {
    // The queue is this sign-in's: what is queued answers nothing to the next (each half is judged by its own sign-in),
    // and the next sign-in's halves wait for none of it.
    halves = Promise.resolve();
    keysReading = null;
    hubProblems.clear();
    keys = null;
    keysFailed = false;
    keysAsked = Number.NEGATIVE_INFINITY;
    changed();
  }

  return {
    renewHub: (id) => queued((asked) => renewHalf(id, asked)),
    revokeHub: (id) => queued((asked) => revokeHalf(id, asked)),
    settled,
    revokeKey,
    revokeDiscarded,
    readKeys,
    viewInputs: () => ({ keys: keys === null ? null : { list: keys.list, at: new Date(keys.at).toISOString() }, keysFailed, hubProblems }),
    idle: () => halves.then(() => undefined),
    fence,
    close() {
      fence();
      closed = true;
    },
  };
}
