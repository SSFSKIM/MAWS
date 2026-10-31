// The supervisor's own life (E10 execution document, §Design 1 "Lifecycle in the supervisor", "Idle exit, and idle
// rows", "Stop all"; Interfaces "X2 additions"): the `host.*` commands the engine host serves, its status, and the
// clocks that end it. One object in both modes; only a detached host (the supervisor) ever exits by itself.
//
// - The idle exit: with no client connected, no live row and nothing in the plugin runner, the supervisor exits after
//   `idleExitMs` (main's `host.configure`, 10 minutes until then; null is never). The clock starts when the last of
//   those conditions came true (the client's disconnect, the last live row's exit, the runner's last operation) and
//   resets whenever one stops holding; it is checked again when it fires.
// - Exit-when-idle (the socket layer's `exit {when: 'idle'}` or `host.exitWhenIdle`): once armed the supervisor exits
//   as soon as no row is live and the runner holds nothing, client or not.
// - The idle release (the process table's, idle-release.ts; P5 O2 M2): keyed on interest, which each client reports
//   (`host.interest`), with a keep mark, and strict; in every mode, client connected or not (RELEASE_WHILE_CONNECTED).
//   Its idle time is the machine role's (role.ts): a laptop's is the idle exit's, a server's 24 hours. Under an armed
//   exit-when-idle interest is ignored, so an old supervisor still serving empties unless the owner kept a session.
// - `host.stopAll`: engine.shutdown's body, answered, then the exit (a host that ran it can never launch again).
// - Quiet (P5 Decision Log 124's idle collection, @shared/host/idle-collect.ts): once the host serves and its startup
//   gate has settled, no client holds interest in any session, no launch is preparing its row, every live row is idle by
//   E10's rule (budget.ts `isIdleRow`, no stateful server counted: ready, no turn, nothing working, waiting or queued)
//   and the plugin runner holds nothing. It is told at every refresh, so the engine host collects at every entry: a
//   kept session's turn ending after the app left is one. The collector asks `quiet()` again at the moment of
//   collecting, over the rows' live status, so work a row has begun and not yet told (a send whose queue tells only once
//   its save settles) holds it off. A live row that ends with the host quiet (an idle release, an engine's exit) is told
//   as a dropped holding, whose transcript is garbage the collection's guard cannot see. From a stop-all or an exit on it
//   is never quiet again.
import type { HostClientHooks, HostOn } from '@shared/host/runtime';
import { HostCommandError } from '@shared/host/runtime';
import type { AppSessionId } from '@shared/graph/ids';
import type { SupervisorStatus } from '@shared/ipc/schema/host';
import type { IdleCollector } from '@shared/host/idle-collect';
import { isIdleRow } from './budget';
import type { PluginsRunner } from './plugins/runner';
import type { ProcessTable } from './process-table';
import type { MachineRole } from './role';
import type { EngineSession } from './session';

export const DEFAULT_IDLE_EXIT_MS = 10 * 60_000; // until main's first host.configure
export const SERVER_RELEASE_MS = 24 * 60 * 60_000; // P5 O2 M2: a server's idle release, by wall clock

// P5 O2 M2 (P5 §2, Decision Logs 29 and 44): the idle release runs while a client is connected too, so a session with
// no tab is released after the idle time while MAWS is open. The owner's answer on keeping E10's rule (released only
// once no client is connected, or under an armed exit-when-idle) is open; that reversal is this one constant, `false`.
export const RELEASE_WHILE_CONNECTED = true;

export type SupervisorExit = 'idle' | 'stopAll' | 'exitWhenIdle';

// What the status says of the process itself; a detached host learns its socket and start from the entry (`started`).
export type SupervisorIdentity = Pick<SupervisorStatus, 'pid' | 'startedAt' | 'buildId' | 'protocol' | 'wire' | 'socketPath' | 'logPath'>;

export interface SupervisionDeps {
  mode: 'utility' | 'detached';
  identity: SupervisorIdentity;
  table: Pick<ProcessTable, 'onChange' | 'onRowsChanged' | 'setIdleRelease' | 'setInterest' | 'interested' | 'launching' | 'onHoldChanged'> & { list(): readonly Pick<EngineSession, 'lifecycle' | 'status'>[] };
  role: MachineRole; // P5 O2 M2: read once at the engine host's start (role.ts)
  plugins: Pick<PluginsRunner, 'busy' | 'onIdle' | 'onBusy'>;
  shutdown(graceMs: number): Promise<{ stopped: number; forced: number }>; // engine.shutdown's body
  emit(status: SupervisorStatus): boolean; // host.supervisorStatus
  log(line: string): void;
  // The idle collection (index.ts), told the quiet; a harness that does not read it leaves it out
  collector?: Pick<IdleCollector, 'set' | 'dropped'>;
  startup?: Promise<unknown>; // the register's startup gate (index.ts's designSystems.ready): quiet waits for it to settle
  // O16 M5: the gate (holder/gate.ts): its socket's path while it serves (null when it could not listen) and the live
  // rows' counts by reap and observer (the table's); absent in a harness, which reports neither
  gate?: { path(): string | null; counts(): { armed: number; observed: number; unhealthy: number; absent: number } };
}

const NO_STATEFUL: ReadonlySet<string> = new Set(); // a stateful server holds a row's release, not its quiet

export class Supervision {
  private identity: SupervisorIdentity;
  private idleExitMs: number | null = DEFAULT_IDLE_EXIT_MS;
  private exitWhenIdle = false;
  private connected: boolean; // a client was welcomed and has not left; a utility host's client is main, for its life
  private exit: ((reason: SupervisorExit) => void) | null = null; // a detached host, once it serves
  private leaving: SupervisorExit | null = null;
  private stopping = false; // host.stopAll ran: in either mode the host never launches again
  private idleSince: number | null = null; // when the idle exit's conditions last came true
  private idleDue: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private release: { idleMs: number | null; active: boolean; ignoreInterest: boolean } | null = null; // the idle release's policy as last set
  private published = '';
  private orphansKilled = 0; // the engines of a dead predecessor the start-up sweep stopped (Task 2.5)
  private serving: boolean; // a utility host serves from its register, a detached one from `started`
  private settled: boolean; // the startup gate resolved or rejected
  private live = 0; // the live rows as last counted

  constructor(private readonly deps: SupervisionDeps) {
    this.identity = deps.identity;
    this.connected = deps.mode === 'utility';
    this.serving = deps.mode === 'utility';
    this.settled = deps.startup === undefined;
    deps.table.onChange(() => this.refresh());
    if (deps.collector) deps.table.onHoldChanged(() => this.refresh());
    deps.table.onRowsChanged(() => this.refresh());
    deps.plugins.onIdle(() => this.refresh());
    deps.plugins.onBusy(() => this.refresh());
    const settle = () => {
      this.settled = true;
      this.refresh();
    };
    void deps.startup?.then(settle, settle);
    this.refresh();
  }

  // The host.* commands (their deadline shapes: ipc.ts HOST_DEADLINE_SHAPES), and the status at the end of every connect
  // burst (main's pushes before its ready line, and the answers to them, reach no client).
  register(on: HostOn, client: Pick<HostClientHooks, 'onConnect'>): void {
    on('host.supervisorStatus', async () => this.status());
    on('host.configure', async ({ idleExitMs }) => {
      this.idleExitMs = idleExitMs;
      this.refresh();
    });
    on('host.exitWhenIdle', async ({ armed }) => {
      if (this.deps.mode !== 'detached') throw new HostCommandError({ code: 'internal', message: 'exit-when-idle is the detached supervisor’s; a utility host ends with the app' });
      this.armExitWhenIdle(armed);
    });
    // P5 O2 M2: the asking connection's full set (main-only; `mawsd` will send the union of its clients'); it ends with
    // the connection, ready or not (the connection's own ClientRef, which the runtime ends at a detach or a new serve)
    on('host.interest', async ({ sessions }, { client: holder }) => {
      this.deps.table.setInterest(holder, sessions as AppSessionId[]);
    });
    on('host.stopAll', async ({ graceMs }) => {
      const exits = this.exit !== null && this.leaving === null;
      if (exits) this.leaving = 'stopAll'; // no other exit may close the client before the answer is written
      this.stopping = true;
      this.tellQuiet();
      this.deps.log(`stop all asked (grace ${graceMs} ms)${exits ? '; the supervisor exits after answering' : ''}`);
      try {
        return await this.deps.shutdown(graceMs);
      } catch (error) {
        this.deps.log(`stop all failed: ${error instanceof Error ? error.message : String(error)}${exits ? '; the supervisor exits anyway' : ''}`);
        throw error;
      } finally {
        // every stop-all ends a detached supervisor, whose admission it closed for good; after the runtime has posted the
        // answer (or the error), which it does in the microtasks that follow this return
        if (exits) setImmediate(() => this.exit?.('stopAll'));
      }
    });
    client.onConnect(() => this.publish(true));
  }

  // A detached host serves: its identity as the entry knows it, and how it exits (the exit order).
  started(identity: SupervisorIdentity, exit: (reason: SupervisorExit) => void): void {
    this.identity = identity;
    this.exit = exit;
    this.serving = true;
    this.refresh();
  }

  clientChanged(connected: boolean): void {
    this.connected = connected;
    this.refresh();
  }

  // The start-up sweep ended (a detached host's, after it serves; detached.ts): how many orphans it stopped.
  orphansSwept(killed: number): void {
    this.orphansKilled = killed;
    this.refresh();
  }

  armExitWhenIdle(armed: boolean): void {
    if (armed !== this.exitWhenIdle) this.deps.log(`exit when idle ${armed ? 'armed' : 'disarmed'}`);
    this.exitWhenIdle = armed;
    this.refresh();
  }

  status(): SupervisorStatus {
    const rows = this.deps.table.list();
    return {
      mode: this.deps.mode, ...this.identity,
      liveSessions: rows.filter((row) => row.lifecycle !== 'exited').length, rows: rows.length,
      idleExitMs: this.idleExitMs, idleExitAt: this.idleDue === null ? null : new Date(this.idleDue).toISOString(),
      exitWhenIdle: this.exitWhenIdle, orphansKilled: this.orphansKilled,
      release: { role: this.deps.role, idleMs: this.releaseIdleMs(), ...(this.deps.gate && { gate: this.deps.gate.counts() }) }, // P5 O2 M2; O16 M5: the gate
      ...(this.deps.gate && { holder: { hosts: 0, adopted: 0, failed: 0, gate: this.deps.gate.path(), handover: 'none' as const } }), // O16 M5: the gate's path; M2 and M3 fill the rest
    };
  }

  // Every change that could move a clock or the status: a row's status, the row set, the runner going busy or idle, a
  // client, a configuration, the startup gate settling, the table's holds (interest, a launch preparing). Cheap: it reads
  // the table's rows and compares.
  private refresh(): void {
    const live = this.deps.table.list().some((row) => row.lifecycle !== 'exited');
    this.tellQuiet();
    const active = RELEASE_WHILE_CONNECTED || (this.deps.mode === 'detached' && (!this.connected || this.exitWhenIdle));
    const idleMs = this.releaseIdleMs();
    if (this.release === null || this.release.idleMs !== idleMs || this.release.active !== active || this.release.ignoreInterest !== this.exitWhenIdle) {
      this.release = { idleMs, active, ignoreInterest: this.exitWhenIdle };
      this.deps.table.setIdleRelease(this.release);
    }
    if (this.exit !== null && this.leaving === null) {
      const busy = this.deps.plugins.busy();
      if (this.exitWhenIdle && !live && !busy) return this.leave('exitWhenIdle');
      if (!this.connected && !live && !busy && this.idleExitMs !== null) this.armIdle(this.idleExitMs);
      else this.clearIdle();
    }
    this.publish(false);
  }

  // The host's quiet (the header's) as its live state reads now: told at each refresh, and asked again by the collector at
  // the moment of collecting.
  quiet(): boolean {
    return this.serving && this.settled && this.leaving === null && !this.stopping && !this.deps.plugins.busy()
      && !this.deps.table.interested() && !this.deps.table.launching()
      && this.deps.table.list().every((row) => row.lifecycle === 'exited' || isIdleRow(row.status(), NO_STATEFUL));
  }

  private tellQuiet(): void {
    const collector = this.deps.collector;
    if (!collector) return;
    const live = this.deps.table.list().filter((row) => row.lifecycle !== 'exited').length;
    const ended = live < this.live;
    this.live = live;
    if (!this.serving || !this.settled) return;
    const quiet = this.quiet();
    collector.set(quiet);
    if (quiet && ended) collector.dropped();
  }

  // P5 O2 M2: a laptop releases after the idle exit's time (the app's setting, null for never), a server after 24 hours
  private releaseIdleMs(): number | null {
    return this.deps.role === 'server' ? SERVER_RELEASE_MS : this.idleExitMs;
  }

  private armIdle(idleExitMs: number): void {
    this.idleSince ??= Date.now();
    const due = this.idleSince + idleExitMs;
    if (due === this.idleDue) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleDue = due;
    this.idleTimer = setTimeout(() => this.idleFired(), Math.max(0, due - Date.now()));
    (this.idleTimer as { unref?: () => void }).unref?.(); // the server keeps a serving supervisor alive, not this clock
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idleSince = null;
    this.idleDue = null;
  }

  // Checked when it fires, not trusted: anything that changed unannounced (the runner taking work) re-arms or clears it.
  private idleFired(): void {
    this.idleTimer = null;
    const due = this.idleDue;
    this.idleDue = null; // so refresh re-arms if the conditions still hold but the time has not come
    const live = this.deps.table.list().some((row) => row.lifecycle !== 'exited');
    if (due !== null && Date.now() >= due && !this.connected && !live && !this.deps.plugins.busy() && this.idleExitMs !== null && this.leaving === null) {
      return this.leave('idle');
    }
    this.refresh();
  }

  private leave(reason: SupervisorExit): void {
    this.clearIdle();
    this.leaving = reason;
    this.tellQuiet();
    this.publish(false);
    this.exit?.(reason);
  }

  private publish(force: boolean): void {
    const status = this.status();
    const signature = JSON.stringify(status);
    if (!force && signature === this.published) return;
    this.published = signature;
    this.deps.emit(status);
  }
}
