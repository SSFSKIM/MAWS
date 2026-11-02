// The idle release (P5 O2 M2: docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M2 "The release rule"; P5 §2 "Idle
// release"; E10's idle-row release re-keyed from "no client" to "no interest"). The process table holds one and feeds it
// every row's status; Supervision sets its policy and the clients' interest arrives through `host.interest`.
//
// A row is eligible when it is ready, the engine is not running or waiting, it holds no hard reason (budget.ts
// `isIdleRow`: background work of every kind, a session cron and unreadable work included), it is not kept, and no
// client holds interest in it. Its clock starts at the latest of: the moment it last became eligible by state, its
// interest's end, its keep mark's clearing, and the release's activation (the engine host's start, or, as E10 had it,
// the moment a client left). It is released (`stop('idle')`, a release like the budget's: kept in the released set and
// resumed from disk at its next use) when the clock reaches the idle time, read again in the same synchronous step as
// the stop, so no event can land between the verdict and the stop. Under an armed exit-when-idle interest is ignored,
// its clock starting at the arming, and the keep mark is honoured, so an old supervisor still serving can empty unless
// the owner kept a session. Interest is per holder (a client connection's ClientRef), each holder's last full set,
// ended for every session at once when the holder is gone. Due times compare Date.now(), and no timer waits longer than
// RECHECK_MS, so a due time a laptop slept past is met within a minute of its waking.
//
// O16 M5 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F): a due row is handed to its reap
// (`release`, holder/reap.ts), which signals only once the row is verified empty and its observer's fence is armed (or
// none was ever seen on the process), re-reading this rule (`held`) in the step that signals. A reap that ends without
// a signal, or whose signal the engine ignored, restarts the row's clock (`restart`). The verdict is the reap's; the
// idle times are unchanged.
//
// P5 O17 M7 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §E; D20): the idle exception for a headless
// tab's hold. The hold is work to every other reader (budget.ts `holdsWork`), so the due check and the reap still refuse
// a held row; the clock alone reads `isIdleRowIgnoringBrowser`, so a session idle in every way but its hold starts its
// clock. At its due time such a row is neither dropped (which would restart its clock at the next `track`) nor handed to
// its reap: it waits, keeping its `since`, and the release asks once (`browserIdleDue`, which `mawsd` answers by closing
// the session's headless tabs). A waiting row that has asked is out of `dueOf`, so no timer runs for it. The status change
// that clears the hold ends the wait at once and the next `fire` hands the row to its reap as any due row; a turn, interest
// or a Keep mark ends it as well and restarts or stops the clock as before. A fresh `mawsd` link's first snapshot
// (`browserSnapshotApplied`) has every waiting row ask again. Closed (a handover's freeze, the exit order), it asks nothing.
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { ClientRef } from '@shared/ipc/client';
import { isIdleRow, isIdleRowIgnoringBrowser } from './budget'; // P5 O17 M7: isIdleRowIgnoringBrowser
import type { EngineSession } from './session';

export const RECHECK_MS = 60_000;

// `idleMs` null is never; `active` false holds every row (E10's connected client, kept only as the one condition
// Supervision may still set: RELEASE_WHILE_CONNECTED); `ignoreInterest` while exit-when-idle is armed.
export interface IdleReleasePolicy { idleMs: number | null; active: boolean; ignoreInterest?: boolean }

export interface IdleReleaseDeps {
  current(session: EngineSession): EngineSessionStatus | null; // the session's status while it is its id's row, else null
  stateful(): ReadonlySet<string>;
  log(line: string): void;
  interestChanged?(): void; // a holder's set replaced or ended (the supervisor's quiet reads `interested`)
  release(session: EngineSession): void; // O16 M5: the row's reap, due as `idle`
  browserIdleDue?(appSessionId: AppSessionId): void; // P5 O17 M7: a due row held by its headless tab alone, once per wait
}

// P5 O17 M7: `waiting`, due and held by its headless tab alone; `asked`, its `browserIdleDue` told for this wait
interface RowClock { appSessionId: AppSessionId; since: number | null; kept: boolean; keptClearedAt: number | null; waiting: boolean; asked: boolean }

export class IdleRelease {
  private policy: { idleMs: number | null; activeSince: number | null; ignoreInterest: boolean } = { idleMs: null, activeSince: null, ignoreInterest: false };
  private readonly rows = new Map<EngineSession, RowClock>(); // live rows, with when each became eligible by state
  private readonly holders = new Map<string, ReadonlySet<AppSessionId>>(); // each holder's last full set
  private readonly interestEnded = new Map<AppSessionId, number>(); // when each session last left the union
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly deps: IdleReleaseDeps) {}

  // An activation keeps its start across a new idle time; arming exit-when-idle ends every held interest at once.
  setPolicy(policy: IdleReleasePolicy): void {
    const now = Date.now();
    const ignoreInterest = policy.ignoreInterest ?? false;
    if (ignoreInterest && !this.policy.ignoreInterest) for (const id of this.union()) this.interestEnded.set(id, now);
    this.policy = { idleMs: policy.idleMs, activeSince: policy.active ? (this.policy.activeSince ?? now) : null, ignoreInterest };
    this.schedule();
  }

  // `host.interest`: the holder's full set, replacing its previous one. A holder seen for the first time is followed to
  // its end (at once for one already gone), which ends its whole set.
  setInterest(holder: ClientRef, sessions: readonly AppSessionId[]): void {
    const fresh = !this.holders.has(holder.id);
    this.replaceInterest(holder.id, new Set(sessions));
    if (fresh) holder.onGone(() => this.replaceInterest(holder.id, null));
  }

  // Every status of a row's own process: its eligibility by state and its keep mark, each change stamped.
  track(session: EngineSession, status: EngineSessionStatus | null): void {
    if (status === null || status.process === 'exited') {
      if (status !== null) this.interestEnded.delete(status.appSessionId); // a later launch's eligibility comes after it
      if (this.rows.delete(session)) this.schedule();
      return;
    }
    const prev = this.rows.get(session);
    const now = Date.now();
    const eligible = isIdleRowIgnoringBrowser(status, this.deps.stateful()); // P5 O17 M7: the clock sets the hold aside
    const kept = status.kept === true;
    // P5 O17 M7: a wait lasts while the row is held by its hold alone; checked before the equality return, since the
    // hold's clearing changes none of the clock's other fields
    const waiting = prev?.waiting === true && eligible && !kept && !isIdleRow(status, this.deps.stateful());
    const next: RowClock = {
      appSessionId: status.appSessionId,
      since: eligible ? (prev?.since ?? now) : null,
      kept,
      keptClearedAt: prev?.kept === true && !kept ? now : (prev?.keptClearedAt ?? null),
      waiting,
      asked: waiting && prev?.asked === true,
    };
    if (prev && prev.since === next.since && prev.kept === next.kept && prev.keptClearedAt === next.keptClearedAt && prev.waiting === next.waiting && prev.asked === next.asked) return;
    this.rows.set(session, next);
    this.schedule();
  }

  close(): void {
    this.closed = true;
    this.schedule();
  }

  // Every session some holder holds interest in now.
  interestUnion(): ReadonlySet<AppSessionId> {
    return this.union();
  }

  // O16 M5: whether the rule holds the session now, the reap's step reading it again: the release off, or interest held
  // (unless exit-when-idle ignores it). The keep mark and the row's state are the reap's own reads.
  held(appSessionId: AppSessionId): boolean {
    if (this.closed) return true; // P5 O16 M3b fix wave 1: closed (a handover, the exit order): nothing is released
    const { idleMs, activeSince, ignoreInterest } = this.policy;
    return idleMs === null || activeSince === null || (!ignoreInterest && this.union().has(appSessionId));
  }

  // O16 M5: the row's reap ended without a release: its clock starts again now, if its state still makes it eligible.
  restart(session: EngineSession): void {
    const status = this.deps.current(session);
    if (status === null || status.process === 'exited' || this.closed) return;
    const eligible = isIdleRowIgnoringBrowser(status, this.deps.stateful()); // P5 O17 M7: the clock's own read
    this.rows.set(session, { appSessionId: status.appSessionId, since: eligible ? Date.now() : null, kept: status.kept === true, keptClearedAt: null, waiting: false, asked: false });
    this.schedule();
  }

  // P5 O17 M7: a fresh `mawsd` link applied its first snapshot: every row still waiting asks again, at the next check
  browserSnapshotApplied(): void {
    for (const [session, clock] of this.rows) if (clock.waiting && clock.asked) this.rows.set(session, { ...clock, asked: false });
    this.schedule();
  }

  // Whether any holder holds interest in any session.
  interested(): boolean {
    for (const set of this.holders.values()) if (set.size > 0) return true;
    return false;
  }

  private replaceInterest(holderId: string, next: ReadonlySet<AppSessionId> | null): void {
    const before = this.union();
    if (next === null) this.holders.delete(holderId);
    else this.holders.set(holderId, next);
    const after = this.union();
    const now = Date.now();
    for (const id of before) if (!after.has(id)) this.interestEnded.set(id, now);
    // P5 O17 M7: interest ends a row's wait (unless exit-when-idle ignores it); its end restarts the clock as before
    if (!this.policy.ignoreInterest) for (const [session, clock] of this.rows) if (clock.waiting && after.has(clock.appSessionId)) this.rows.set(session, { ...clock, waiting: false, asked: false });
    this.schedule();
    this.deps.interestChanged?.();
  }

  private union(): Set<AppSessionId> {
    const all = new Set<AppSessionId>();
    for (const set of this.holders.values()) for (const id of set) all.add(id);
    return all;
  }

  // When a row's clock runs out, or null while it is held (not eligible by state, kept, interest held) or the release
  // is off.
  private dueOf(clock: RowClock, union: ReadonlySet<AppSessionId>): number | null {
    const { idleMs, activeSince, ignoreInterest } = this.policy;
    if (idleMs === null || activeSince === null || clock.since === null || clock.kept) return null;
    if (clock.waiting && clock.asked) return null; // P5 O17 M7: it waits for its hold to clear, with no timer
    if (!ignoreInterest && union.has(clock.appSessionId)) return null;
    return Math.max(clock.since, this.interestEnded.get(clock.appSessionId) ?? -Infinity, clock.keptClearedAt ?? -Infinity, activeSince) + idleMs;
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed) return;
    const union = this.union();
    const dues = [...this.rows.values()].map((clock) => this.dueOf(clock, union)).filter((due): due is number => due !== null);
    if (dues.length === 0) return;
    const wait = Math.min(Math.max(0, Math.min(...dues) - Date.now()), RECHECK_MS);
    this.timer = setTimeout(() => this.fire(), wait);
    (this.timer as { unref?: () => void }).unref?.();
  }

  // The timer fired: every row whose clock has run out is read again and, still eligible, handed to its reap as `idle`
  // in the same synchronous step as the read (O16 M5: the reap's own step is the release's linearization point).
  private fire(): void {
    this.timer = null;
    const now = Date.now();
    const union = this.union();
    for (const [session, clock] of [...this.rows]) {
      const due = this.dueOf(clock, union);
      if (due === null || now < due) continue;
      const status = this.deps.current(session);
      // P5 O17 M7: held by its headless tab alone: it waits, its clock kept, and asks once for this wait
      if (status !== null && status.kept !== true && !isIdleRow(status, this.deps.stateful()) && isIdleRowIgnoringBrowser(status, this.deps.stateful())) {
        this.rows.set(session, { ...clock, waiting: true, asked: true });
        if (!clock.asked) {
          this.deps.log(`idle release of ${status.appSessionId}: due, held by its headless browser work alone; its tabs are asked to close`);
          this.deps.browserIdleDue?.(status.appSessionId);
        }
        continue;
      }
      if (status === null || !isIdleRow(status, this.deps.stateful()) || status.kept === true) {
        this.rows.delete(session);
        continue;
      }
      this.rows.delete(session);
      const { idleMs, ignoreInterest } = this.policy;
      this.deps.log(`idle release of ${status.appSessionId}: idle for ${idleMs} ms with no interest held${ignoreInterest ? ' (exit-when-idle armed: interest ignored)' : ''}`);
      this.deps.release(session); // O16 M5
    }
    this.schedule();
  }
}
