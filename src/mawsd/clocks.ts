// `mawsd`'s clocks (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The clocks"). Facts come in as they
// change; the clocks decide, and call their actions. Every due time compares `Date.now()`, so a machine that slept past
// one acts when it wakes.
//
// - The engine host's park clock: with no app on engine-host.sock and an empty interest union (no remote viewer either)
//   for `idleExitMs`, the served engine host is asked to exit when idle (it exits once no row is live and its plugin
//   runner is idle, and the exit parks it). An app's attach, or any session entering the union, takes it back first and
//   restarts the clock. It never arms while anything holds interest: under an armed exit-when-idle M2's release ignores
//   interest, so arming then would release a session a remote viewer holds. Armed means sent: an ask the transport did
//   not take (`armEnginePark` false) is asked again at the next evaluation, the same host's reconnect included.
//   P5 O3-D M6 (fix rounds 1, 2): `parkNow()` asks the same of the host the discovery wake woke, at once, under the same
//   two conditions and with no app between its socket and the count (a hello on its admission acquires this host); one
//   asked meanwhile waits for that to end, and goes if an app attaches or a session enters the union first, or the host
//   parks. The clock's own start (`parkSince`) and `idleExitMs` are untouched, and an attach or interest takes it back.
//   P5 O3-D M6 (fix round 3): no ask, the clock's or parkNow's, is sent while an app is between its socket and the count,
//   nor while a discovery wake is out (`discoveryWaking()` to its `parkNow()`): on a daemon idle past `idleExitMs` the
//   clock's ask is overdue the moment the woken host is ready, and would end it before its pass. Either one's end
//   evaluates again, the clock's ask still due from `parkSince`.
//   P5 (a parked host's need): `engineNeeded()`, a command waits on the engine host (the spine's session service waits
//   for its first streaming), starts the clock again from that moment, so the host woken for it is not asked to park the
//   moment it is ready, and a discovery wake's park asked after the need is left to the clock.
//   P5 O5 (landing 1, the park race): a client's request to the engine host (engine-requests.ts) is a need too, and while
//   any is in flight no park is asked (`engineRequests`), so the host is never asked to exit under a request it holds;
//   one that arrives after the ask was sent (`parkAsked`) waits for that host's exit, or takes the park back
//   (`takeBackPark`) when the host stays.
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
  armEnginePark(why: 'idle' | 'discovery'): boolean; // `exit {when: 'idle'}` to the served engine host: the clock's, or parkNow's; false when not sent
  disarmEnginePark(): void; // `host.exitWhenIdle {armed: false}`, and the transport told
  exitDaemon(): void; // a private daemon's idle exit
  quiet(quiet: boolean): void; // the daemon's quiet as it stands, told at each evaluation from `served()` on
}

export class DaemonClocks {
  private idleExitMs: number | null = DEFAULT_IDLE_EXIT_MS;
  private attached = false;
  private interestEmpty = true;
  private enginePid: number | null = null; // the served engine host, null while none is served
  private armedPid: number | null = null; // the engine host asked to exit when idle, the ask sent
  private discoveryPark = false; // parkNow's ask, until it is sent or no longer wanted
  private discoveryWake = false; // a discovery wake is out: no ask until its parkNow
  private neededInWake = false; // engineNeeded() came while a discovery wake was out: its parkNow leaves the park to the clock
  private requestsInFlight = 0; // P5 O5: clients' requests to the engine host not answered yet: no park asked under them
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
    if (parked.engine) [this.armedPid, this.enginePid, this.discoveryPark] = [null, null, false]; // it exited: the next one is asked afresh
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

  // P5 O3-D M6 (fix round 3): a discovery wake starts; its parkNow() ends it, heard or given up
  discoveryWaking(): void {
    this.discoveryWake = true;
    this.neededInWake = false;
  }

  // P5: a command waits on the engine host (the header's terms)
  engineNeeded(): void {
    this.parkSince = Date.now();
    this.discoveryPark = false;
    if (this.discoveryWake) this.neededInWake = true;
    this.evaluate();
  }

  // P5 O5 (landing 1): the clients' requests to the engine host in flight (the header's terms)
  engineRequests(count: number): void {
    this.requestsInFlight = count;
    this.evaluate();
  }

  // P5 O5 (landing 1): the served engine host was asked to exit when idle and has not exited yet
  parkAsked(): boolean {
    return this.armedPid !== null && this.armedPid === this.enginePid;
  }

  // P5 O5 (landing 1): a request found the host asked to park and still serving after the exit's bound (it holds live
  // rows, so it is not leaving): the ask is taken back, as an app's attach takes it back, and the clock starts again
  takeBackPark(): void {
    if (!this.parkAsked()) return;
    this.armedPid = null;
    this.parkSince = Date.now();
    this.actions.disarmEnginePark();
    this.evaluate();
  }

  // P5 O3-D M6 (fix rounds 1, 2, 3): the discovery wake's park of the engine host it woke (the header's terms)
  parkNow(): void {
    this.discoveryWake = false;
    if (!this.stopped && !this.neededInWake && !this.parked.engine && !this.attached && this.interestEmpty) this.discoveryPark = true;
    this.neededInWake = false;
    this.evaluate();
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
    else this.discoveryPark = false; // the host is someone's now: its own clock decides once it is free again
    if (!idle && this.armedPid !== null) {
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
    if (this.enginePid !== null && this.armedPid !== this.enginePid && !this.between && !this.discoveryWake && this.requestsInFlight === 0) {
      const discovery = this.discoveryPark && !this.attached && this.interestEmpty;
      if (discovery || (park !== null && now >= park)) {
        if (this.actions.armEnginePark(discovery ? 'discovery' : 'idle')) [this.armedPid, this.discoveryPark] = [this.enginePid, false];
      } else if (park !== null) waits.push(park);
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
