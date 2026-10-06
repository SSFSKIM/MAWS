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
// - The idle-row release (the process table's): active while no client is connected or exit-when-idle is armed, with
//   the same idle time, so kept idle sessions end and with them the supervisor.
// - `host.stopAll`: engine.shutdown's body, answered, then the exit (a host that ran it can never launch again).
import type { HostClientHooks, HostOn } from '@shared/host/runtime';
import { HostCommandError } from '@shared/host/runtime';
import type { SupervisorStatus } from '@shared/ipc/schema/host';
import type { PluginsRunner } from './plugins/runner';
import type { ProcessTable } from './process-table';
import type { EngineSession } from './session';

export const DEFAULT_IDLE_EXIT_MS = 10 * 60_000; // until main's first host.configure

export type SupervisorExit = 'idle' | 'stopAll' | 'exitWhenIdle';

// What the status says of the process itself; a detached host learns its socket and start from the entry (`started`).
export type SupervisorIdentity = Pick<SupervisorStatus, 'pid' | 'startedAt' | 'buildId' | 'protocol' | 'wire' | 'socketPath' | 'logPath'>;

export interface SupervisionDeps {
  mode: 'utility' | 'detached';
  identity: SupervisorIdentity;
  table: Pick<ProcessTable, 'onChange' | 'onRowsChanged' | 'setIdleRelease'> & { list(): readonly Pick<EngineSession, 'lifecycle'>[] };
  plugins: Pick<PluginsRunner, 'busy' | 'onIdle'>;
  shutdown(graceMs: number): Promise<{ stopped: number; forced: number }>; // engine.shutdown's body
  emit(status: SupervisorStatus): boolean; // host.supervisorStatus
  log(line: string): void;
}

export class Supervision {
  private identity: SupervisorIdentity;
  private idleExitMs: number | null = DEFAULT_IDLE_EXIT_MS;
  private exitWhenIdle = false;
  private connected: boolean; // a client was welcomed and has not left; a utility host's client is main, for its life
  private exit: ((reason: SupervisorExit) => void) | null = null; // a detached host, once it serves
  private leaving: SupervisorExit | null = null;
  private idleSince: number | null = null; // when the idle exit's conditions last came true
  private idleDue: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private release: { idleMs: number | null; active: boolean } | null = null; // the idle-row release's policy as last set
  private published = '';

  constructor(private readonly deps: SupervisionDeps) {
    this.identity = deps.identity;
    this.connected = deps.mode === 'utility';
    deps.table.onChange(() => this.refresh());
    deps.table.onRowsChanged(() => this.refresh());
    deps.plugins.onIdle(() => this.refresh());
    this.refresh();
  }

  // The host.* commands, and the status at the end of every connect burst (main's pushes before its ready line, and
  // the answers to them, reach no client).
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
    on('host.stopAll', async ({ graceMs }) => {
      const exits = this.exit !== null && this.leaving === null;
      if (exits) this.leaving = 'stopAll'; // no other exit may close the client before the answer is written
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
    this.refresh();
  }

  clientChanged(connected: boolean): void {
    this.connected = connected;
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
      exitWhenIdle: this.exitWhenIdle, orphansKilled: 0,
    };
  }

  // Every change that could move a clock or the status: a row's status, the row set, the runner going idle, a client,
  // a configuration. Cheap: it reads the table's rows and compares.
  private refresh(): void {
    const live = this.deps.table.list().some((row) => row.lifecycle !== 'exited');
    const active = this.deps.mode === 'detached' && (!this.connected || this.exitWhenIdle);
    if (this.release === null || this.release.idleMs !== this.idleExitMs || this.release.active !== active) {
      this.release = { idleMs: this.idleExitMs, active };
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
