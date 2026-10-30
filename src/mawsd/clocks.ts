// `mawsd`'s clocks (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The clocks"). Facts come in as they
// change; the clocks decide, and call their actions. Every due time compares `Date.now()`, so a machine that slept past
// one acts when it wakes.
//
// - The engine host's park clock: with no app on engine-host.sock and an empty interest union (no remote viewer either)
//   for `idleExitMs`, the served engine host is asked to exit when idle (it exits once no row is live and its plugin
//   runner is idle, and the exit parks it). An app's attach, or any session entering the union, takes it back first and
//   restarts the clock. It never arms while anything holds interest: under an armed exit-when-idle M2's release ignores
//   interest, so arming then would release a session a remote viewer holds. P5 O3-D M6 (fix round 1): `parkNow()` arms
//   it at once, under the same two conditions, for the host the discovery wake woke, once its pass is heard; the clock's
//   own start (`parkSince`) and `idleExitMs` are untouched, and an attach or interest takes it back the same way.
// - A private daemon exits once no client has been on any of its sockets for `idleExitMs`, both hosts are parked and no
//   hold is out; a unit daemon never exits by itself.
// - `idleExitMs` is the last `host.configure` an app sent, 10 minutes until then; `null` arms nothing.
// - Quiet (P5 Decision Log 124's lever, @shared/host/idle-collect.ts): once the daemon serves, no client on any socket
//   and none between its socket and the count (a hello waiting on its admission, a departure's drain), an empty interest
//   union and no hold out. It is told at every evaluation, so `mawsd` collects at every entry, and `quiet()` answers it
//   again at the moment of collecting.
// (The pty host's park is a check, not a clock: the daemon asks `pty.list` at the app's departure and at each `pty.exit`.)

export const DEFAULT_IDLE_EXIT_MS = 10 * 60_000;

export interface ClockActions {
  armEnginePark(why: 'idle' | 'discovery'): void; // `exit {when: 'idle'}` to the served engine host: the clock's, or parkNow's
  disarmEnginePark(): void; // `host.exitWhenIdle {armed: false}`, and the transport told
  exitDaemon(): void; // a private daemon's idle exit
  quiet(quiet: boolean): void; // the daemon's quiet as it stands, told at each evaluation from `served()` on
}

export class DaemonClocks {
  private idleExitMs: number | null = DEFAULT_IDLE_EXIT_MS;
  private attached = false;
  private interestEmpty = true;
  private enginePid: number | null = null; // the served engine host, null while none is served
  private armedPid: number | null = null; // the engine host asked to exit when idle
  private parkSince: number;
  private parked = { engine: true, pty: true };
  private clientCount = 0;
  private between = false; // an app between a relay's socket and the count (the quiet's alone: the exit clock counts welcomed clients)
  private holdCount = 0;
  private clientsGoneSince: number;
  private exited = false;
  private serving = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly kind: 'unit' | 'private',
    private readonly actions: ClockActions,
  ) {
    this.parkSince = Date.now();
    this.clientsGoneSince = Date.now();
  }

  idleMs(): number | null {
    return this.idleExitMs;
  }

  configure(idleExitMs: number | null): void {
    this.idleExitMs = idleExitMs;
    this.evaluate();
  }

  engineAttached(attached: boolean): void {
    if (attached === this.attached) return;
    this.attached = attached;
    this.parkConditionChanged();
  }

  interest(empty: boolean): void {
    if (empty === this.interestEmpty) return;
    this.interestEmpty = empty;
    this.parkConditionChanged();
  }

  engineHost(pid: number | null): void {
    if (pid !== null && pid !== this.armedPid) this.armedPid = null; // another process: nothing asked of it yet
    this.enginePid = pid;
    this.evaluate();
  }

  hosts(parked: { engine: boolean; pty: boolean }): void {
    if (parked.engine) [this.armedPid, this.enginePid] = [null, null]; // it exited: the next one is asked afresh
    this.parked = { ...parked };
    this.evaluate();
  }

  clients(count: number): void {
    if (count > 0) this.clientsGoneSince = Number.NaN;
    else if (this.clientCount > 0 || Number.isNaN(this.clientsGoneSince)) this.clientsGoneSince = Date.now();
    this.clientCount = count;
    this.evaluate();
  }

  holds(count: number): void {
    this.holdCount = count;
    this.evaluate();
  }

  // P5 O3-D M6 (fix round 1): the discovery wake's park, at once, of the served engine host, only with no app attached
  // and an empty interest union, once per host as the clock's is; nothing of the clock's own time changes.
  parkNow(): void {
    if (this.stopped || this.attached || !this.interestEmpty || this.enginePid === null || this.armedPid === this.enginePid) return;
    this.armedPid = this.enginePid;
    this.actions.armEnginePark('discovery');
  }

  relaysBetween(between: boolean): void {
    this.between = between;
    this.evaluate();
  }

  quiet(): boolean {
    return this.serving && !this.stopped && this.clientCount === 0 && !this.between && this.interestEmpty && this.holdCount === 0;
  }

  // Start step (8) is done: the daemon serves, and its quiet is told from now on.
  served(): void {
    this.serving = true;
    this.evaluate();
  }

  // A private daemon's exit clock while no client is on any socket; null otherwise.
  idleExitAt(): string | null {
    const due = this.exitDue();
    return due === null ? null : new Date(due).toISOString();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
  }

  private parkConditionChanged(): void {
    const idle = !this.attached && this.interestEmpty;
    if (idle) this.parkSince = Date.now(); // the clock starts when the last of the two came true
    else if (this.armedPid !== null) {
      // taken back first: an app attached, or a session entered the union
      this.armedPid = null;
      this.actions.disarmEnginePark();
    }
    this.evaluate();
  }

  private parkDue(): number | null {
    if (this.attached || !this.interestEmpty || this.idleExitMs === null) return null;
    return this.parkSince + this.idleExitMs;
  }

  private exitDue(): number | null {
    if (this.kind !== 'private' || this.clientCount > 0 || this.idleExitMs === null || Number.isNaN(this.clientsGoneSince)) return null;
    return this.clientsGoneSince + this.idleExitMs;
  }

  private evaluate(): void {
    if (this.stopped) return;
    if (this.serving) this.actions.quiet(this.quiet());
    this.clearTimer();
    const now = Date.now();
    const waits: number[] = [];
    const park = this.parkDue();
    if (park !== null && this.enginePid !== null && this.armedPid !== this.enginePid) {
      if (now >= park) {
        this.armedPid = this.enginePid;
        this.actions.armEnginePark('idle');
      } else waits.push(park);
    }
    const exit = this.exitDue();
    if (exit !== null && !this.exited) {
      if (now < exit) waits.push(exit);
      else if (this.parked.engine && this.parked.pty && this.holdCount === 0) {
        this.exited = true;
        this.actions.exitDaemon();
      }
    }
    if (waits.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.evaluate();
    }, Math.max(0, Math.min(...waits) - now));
    this.timer.unref?.(); // the sockets keep a serving daemon alive, not this clock
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
