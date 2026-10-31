// O16 M5: the reap, the release of an idle session as a state machine over the gate (docs/doperpowers/plans/
// 2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; holder design §3.2; D15, D17, D29). One per row, made by the process
// table at the reservation. The idle release (`idle`, the role's clock: idle-release.ts) and the memory budget's
// (`budget`: process-table.ts) both end a process through it, so neither signals into a turn.
//
//   idle --due, verified empty, observer healthy--> arming (`arm` sent)
//   arming --armed--> armed, and the step at once
//   arming/armed --turn, a veto at the step, the observer unhealthy, no armed within the lease--> idle (`proceed` for a
//                  turn, `disarm`, the row's clock restarts; a budget reap's `releasing` clears)
//   armed --step: verified empty, lease live--> signalled (the session's reap)
//   idle --due, verified empty, observer absent (never seen on the process: owner Q1)--> signalled
//   idle --due, observer unhealthy--> idle (the row's work reads `observer_unhealthy`: held until a fresh hello)
//   signalled --turn--> `stop`, state unchanged
//   signalled --exit--> the row is released (the table's released set, as today)
//   signalled --end_session and SIGTERM ignored (idle only)--> term_ignored --> idle (`disarm`, the clock restarts; the
//                  row's work reads `reap_term_ignored` until the next Stop)
//
// The linearization point is the step: the row's status, the interest, a fresh read of the process tree and the gate's
// state are read in one synchronous step with the signal, so an event that landed before it is reflected and one after
// it meets `signalled`. Arming is asynchronous (the observer answers over a socket); its `armed` runs the step again at
// once. The lease is the host's own clock from the `arm` it sent: the host signals only within `LEASE_MS` less
// `LEASE_MARGIN_MS` of it, renewing the arm (the same fence, a fresh `armed` awaited) when the step comes later, and it
// renews the lease while the signal runs, so a turn the engine starts before it exits still meets the fence.
import type { EngineSessionStatus } from '@shared/engine/status';
import { isIdleRow } from '../budget';
import type { GateChannel, ObserverState, TurnAnswer } from './gate';

export type { ObserverState } from './gate';
export type ReapState = 'idle' | 'arming' | 'armed' | 'signalled' | 'term_ignored';
export type ReapReason = 'idle' | 'budget';
export interface ReapView { state: ReapState; observer: ObserverState }

export const LEASE_MS = 10_000;
export const LEASE_MARGIN_MS = 1_000; // the host signals only within the lease less this, by its own clock
export const REAP_TERM_MS = 5_000; // an idle reap's wait for the exit after its one SIGTERM (session.ts `reap`)

export interface ReapDeps {
  gate: GateChannel; // the row's channel
  current(): EngineSessionStatus | null; // the row's status while it is its id's row
  stateful(): ReadonlySet<string>;
  interest(): boolean; // for `idle`: a client's interest holds the row, or the release is off
  descendants(): number | 'unreadable'; // a fresh read of the work under the engine
  reap(reason: ReapReason): Promise<'exited' | 'ignored'>; // the session's signal path
  now(): number;
  log(line: string): void;
  cancelled(reason: ReapReason): void; // the reap ended without a signal: the row's clock restarts, the budget's `releasing` clears
  ignored(): void; // the engine ignored an idle reap: the row's clock restarts
  changed(view: ReapView): void; // the session's status carries it
  leaseMs?: number;
  leaseMarginMs?: number;
}

// Verified empty (Interfaces §F): idle by E10's rule (no hard reason: no turn, no non-ambient task, no pending request,
// no queue, no held peer message, no stateful server; budget.ts `holdsWork`), the work known with no cron listed, and
// nothing under the engine but its registered infrastructure, read now.
export function isVerifiedEmpty(status: EngineSessionStatus, stateful: ReadonlySet<string>, descendants: number | 'unreadable'): boolean {
  return isIdleRow(status, stateful) && (status.work === undefined || (status.work.unknown === null && status.work.crons.length === 0)) && descendants === 0;
}

export class Reap {
  private current: ReapState = 'idle';
  private reason: ReapReason = 'idle';
  private fence = 0;
  private armSentAt = 0;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly leaseMs: number;
  private readonly marginMs: number;
  private lastView = '';

  constructor(private readonly label: string, private readonly deps: ReapDeps) {
    this.leaseMs = deps.leaseMs ?? LEASE_MS;
    this.marginMs = deps.leaseMarginMs ?? LEASE_MARGIN_MS;
    deps.gate.listen({
      armed: (fence) => this.armed(fence),
      turn: (fence) => this.turn(fence),
      health: (state) => this.health(state),
    });
  }

  get state(): ReapState {
    return this.current;
  }

  get observer(): ObserverState {
    return this.deps.gate.observer;
  }

  // The row's clock ran out (`idle`), or the budget picked it (`budget`).
  due(reason: ReapReason): void {
    if (this.current !== 'idle' || this.disposed) return; // a reap under way
    this.reason = reason;
    const veto = this.veto();
    if (veto !== null) return this.end(`${reason} reap of ${this.label} held: ${veto}`);
    if (this.observer === 'absent') return this.signal();
    this.arm();
  }

  // From outside (an explicit stop, say): a reap not yet signalled ends, disarmed.
  cancel(why: string): void {
    if (this.current === 'arming' || this.current === 'armed') this.end(`${this.reason} reap of ${this.label} cancelled: ${why}`);
  }

  // The row exited or left the table.
  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  private arm(): void {
    this.fence += 1;
    this.sendArm();
    this.deps.log(`${this.reason} reap of ${this.label}: arming fence ${this.fence}`);
  }

  private sendArm(): void {
    this.clearTimers();
    this.armSentAt = this.deps.now();
    this.deps.gate.arm(this.fence, this.leaseMs);
    this.set('arming');
    this.armTimer = setTimeout(() => {
      if (this.current === 'arming') this.end(`${this.reason} reap of ${this.label}: no armed for fence ${this.fence} within the lease`);
    }, this.leaseMs);
    (this.armTimer as { unref?: () => void }).unref?.();
  }

  private armed(fence: number): void {
    if (this.current !== 'arming' || fence !== this.fence) return;
    if (this.armTimer !== null) clearTimeout(this.armTimer);
    this.armTimer = null;
    this.set('armed');
    this.step();
  }

  // The linearization point: everything read again, the signal in the same synchronous step.
  private step(): void {
    const veto = this.veto() ?? (this.observer === 'healthy' ? null : `the observer is ${this.observer}`);
    if (veto !== null) return this.end(`${this.reason} reap of ${this.label} cancelled at the step: ${veto}`);
    if (this.deps.now() > this.armSentAt + this.leaseMs - this.marginMs) return this.sendArm(); // renewed before any signal
    this.signal();
  }

  private signal(): void {
    this.clearTimers();
    this.set('signalled');
    if (this.observer !== 'absent') {
      this.renewTimer = setInterval(() => this.deps.gate.arm(this.fence, this.leaseMs), this.leaseMs - this.marginMs);
      (this.renewTimer as { unref?: () => void }).unref?.();
    }
    this.deps.log(`${this.reason} reap of ${this.label}: signalled${this.observer === 'absent' ? ' (no observer was ever seen on the process)' : ` (fence ${this.fence})`}`);
    this.deps.reap(this.reason).then(
      (outcome) => this.settled(outcome),
      (error: unknown) => {
        this.deps.log(`${this.reason} reap of ${this.label} failed: ${error instanceof Error ? error.message : String(error)}`);
        this.settled('ignored');
      },
    );
  }

  private settled(outcome: 'exited' | 'ignored'): void {
    this.clearTimers();
    if (this.disposed || outcome === 'exited') return;
    this.set('term_ignored');
    if (this.observer !== 'absent') this.deps.gate.disarm(this.fence);
    this.deps.log(`${this.reason} reap of ${this.label}: the engine ignored it; the session goes on`);
    this.set('idle');
    this.deps.ignored();
  }

  private turn(fence: number): TurnAnswer {
    if (fence !== this.fence) return 'proceed';
    if (this.current === 'signalled') return 'stop';
    if (this.current === 'arming' || this.current === 'armed') this.end(`${this.reason} reap of ${this.label} cancelled: a turn started under fence ${fence}`, true);
    return 'proceed';
  }

  private health(state: ObserverState): void {
    if (state === 'unhealthy' && (this.current === 'arming' || this.current === 'armed')) this.end(`${this.reason} reap of ${this.label} cancelled: the observer went silent or away`);
    else this.publish();
  }

  // A reap that ends without a signal: disarmed (when anything was armed), idle, the row's clock restarted. A turn's
  // cancel writes its `disarm` after the turn's `proceed`, which the gate writes once this returns.
  private end(line: string, afterAnswer = false): void {
    const armed = this.current === 'arming' || this.current === 'armed';
    this.clearTimers();
    if (armed) {
      const fence = this.fence;
      if (afterAnswer) queueMicrotask(() => this.deps.gate.disarm(fence));
      else this.deps.gate.disarm(fence);
    }
    this.deps.log(line);
    this.set('idle');
    this.deps.cancelled(this.reason);
  }

  private veto(): string | null {
    const status = this.deps.current();
    if (status === null) return 'the row is gone';
    if (this.observer === 'unhealthy') return 'the observer seen on the process is silent or away';
    if (this.reason === 'idle' && status.kept === true) return 'kept running';
    if (this.reason === 'idle' && this.deps.interest()) return 'interest held';
    const descendants = status.pid === null ? 0 : this.deps.descendants();
    if (!isVerifiedEmpty(status, this.deps.stateful(), descendants)) {
      if (descendants === 'unreadable') return 'the process tree under the engine cannot be read';
      return descendants === 0 ? 'its work is not verified empty' : `${descendants} process${descendants === 1 ? '' : 'es'} of its work under the engine`;
    }
    return null;
  }

  private set(state: ReapState): void {
    this.current = state;
    this.publish();
  }

  private publish(): void {
    const view = { state: this.current, observer: this.observer };
    const key = `${view.state}:${view.observer}`;
    if (key === this.lastView) return;
    this.lastView = key;
    this.deps.changed(view);
  }

  private clearTimers(): void {
    if (this.armTimer !== null) clearTimeout(this.armTimer);
    if (this.renewTimer !== null) clearInterval(this.renewTimer);
    this.armTimer = null;
    this.renewTimer = null;
  }
}
