// The plugin CLI runner (E8 execution document, Interfaces "The runner"; D-1 to D-5, D-15): the engine host runs the
// engine's own `claude plugin …` (the binary the launcher resolves, so the owner's choice in Settings › Engine applies)
// in a process it owns, never writing the config home itself. The child gets the whole captured login-shell environment
// (a private marketplace's clone needs SSH_AUTH_SOCK and the shell's PATH; CLAUDE_CONFIG_DIR travels in it as it does to
// the engine) less the nesting variables (inside a Claude Code session the CLI ignores `--accept-command`), plus the
// updater off and a dumb terminal; its cwd is the operation's directory, where project and local scope write.
// Reads run freely and answer the whole output; mutations are serialised in one queue and run as operations: a receipt
// `{ opId }` at once, then `started`, the CLI's `output` lines, `reloading` and `done`, with `plugins.changed` as soon as
// the CLI has ended. A child runs in its own process group, which the runner owns until the group is empty: at
// CLI_TIMEOUT_MS, on `cancel` and on `stop` (the host stopping) the group gets SIGTERM and, at the grace, SIGKILL, and the
// run ends only once no member remains, so a clone or helper the CLI started dies with it even after the CLI itself
// exited. A cancel or stop that arrives while an operation is still resolving the binary or capturing the environment
// completes it `cancelled` without spawning; after `stop` nothing new runs.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { PluginsOperationEvent, PluginsOutcome } from '@shared/ipc/schema/plugins';
import { commandLine, type PluginsAction, type PluginsActionInputs } from '@shared/plugins/cli';
import type { BinaryCheck } from '../binary-info';
import { mutationOutcome, resultOf, type CliRun } from './cli-result';
import { RELOADING_ACTIONS, reloadAfter, SETTLE_MS, type ReloadTarget } from './reload-after';

export { SETTLE_MS };
export const CLI_TIMEOUT_MS = 600_000;
export const KILL_GRACE_MS = 5_000;
// The host stopping (the app's quit through `engine.shutdown`): SIGKILL sooner, so the whole stop fits main's 5 s quit
// bound (src/main/lifecycle/quit-guard.ts SHUTDOWN_BOUND_MS) with REAP_GIVE_UP_MS and a poll to spare.
export const SHUTDOWN_KILL_GRACE_MS = 2_000;
const REAP_POLL_MS = 50; // how often a stopping group is probed for remaining members
const REAP_GIVE_UP_MS = 1_000; // after SIGKILL, how long a member that still answers the probe is waited for

// MAWS's and the engine's nesting variables: the CLI must not think it runs inside a Claude Code session or Electron.
const DROPPED = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS'];

export function pluginsEnvironment(captured: Record<string, string>): Record<string, string> {
  const env = { ...captured };
  for (const key of DROPPED) delete env[key];
  env.DISABLE_AUTOUPDATER = '1';
  env.TERM = 'dumb';
  return env;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) };

export interface PluginsRunnerDeps {
  binary(): Promise<BinaryCheck>; // the launcher's probe: the real path of the engine a launch would run
  captureEnv(): Promise<Record<string, string>>; // the host's captured login-shell environment
  reloadTargets(): ReloadTarget[]; // the sessions whose process is ready now
  emit(event: PluginsOperationEvent): void;
  changed(): void;
  spawn?: typeof nodeSpawn;
  timers?: Timers;
}

type Failure = Extract<PluginsOutcome, { ok: false }>['error']['code'];
type Ended = { run: CliRun } | { failed: Failure; message: string };
type StopReason = 'timeout' | 'cancelled' | 'stopped';

interface Operation {
  opId: string;
  action: PluginsAction;
  input: PluginsActionInputs[PluginsAction];
  argv: string[];
  cwd: string;
  target: string;
  state: 'queued' | 'running' | 'ended';
  abort: 'cancelled' | 'stopped' | null; // asked while running, whether or not its CLI was spawned yet
  group: OwnedGroup | null; // while its CLI's process group is owned
}

const FAILED_WORDS = { timeout: `the CLI was still running after ${CLI_TIMEOUT_MS / 60_000} minutes and was stopped`, cancelled: 'cancelled before the CLI finished', stopped: 'stopped with the engine host' } as const;

// One spawned CLI and its process group. `stop` sends SIGTERM to the group, SIGKILL at the grace, and resolves once the
// leader has been reaped and no member of the group remains (or REAP_GIVE_UP_MS after SIGKILL); it is idempotent.
class OwnedGroup {
  reason: StopReason | null = null;
  private leaderExited = false;
  private gone: Promise<void> | null = null;

  constructor(
    private readonly child: ChildProcess,
    private readonly timers: Timers,
  ) {
    child.once('exit', () => (this.leaderExited = true));
  }

  stop(reason: StopReason, graceMs: number): Promise<void> {
    if (this.gone) return this.gone;
    this.reason = reason;
    this.signal('SIGTERM');
    this.gone = new Promise<void>((resolve) => {
      const handles = new Set<unknown>();
      const later = (fn: () => void, ms: number) => void handles.add(this.timers.setTimeout(fn, ms));
      const finish = () => {
        for (const handle of handles) this.timers.clearTimeout(handle);
        handles.clear();
        resolve();
      };
      later(() => {
        this.signal('SIGKILL');
        later(finish, REAP_GIVE_UP_MS);
      }, graceMs);
      const poll = () => (this.alive() ? later(poll, REAP_POLL_MS) : finish());
      poll();
    });
    return this.gone;
  }

  private signal(sig: NodeJS.Signals): void {
    try {
      if (this.child.pid !== undefined) process.kill(-this.child.pid, sig); // the group: the CLI and whatever it started
    } catch {
      try {
        this.child.kill(sig);
      } catch {
        // the leader is gone too
      }
    }
  }

  private alive(): boolean {
    if (this.child.pid === undefined) return false; // never spawned
    if (!this.leaderExited) return true; // an unreaped leader still holds the group
    try {
      process.kill(-this.child.pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
}

export class PluginsRunner {
  private readonly spawn: typeof nodeSpawn;
  private readonly timers: Timers;
  private readonly operations = new Map<string, Operation>(); // queued or running
  private readonly groups = new Set<OwnedGroup>(); // every process group a read or a mutation still owns
  private closed = false; // `stop` ran: nothing new runs
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PluginsRunnerDeps) {
    this.spawn = deps.spawn ?? nodeSpawn;
    this.timers = deps.timers ?? realTimers;
  }

  // A read: the CLI's whole output, whatever its exit code; rejects when the CLI could not run.
  async read(args: readonly string[], cwd: string): Promise<CliRun> {
    const ended = await this.exec(args, cwd, null, null);
    if ('failed' in ended) throw new Error(ended.message);
    return ended.run;
  }

  // Queued behind the running mutation; the receipt answers before any of its events.
  async start<A extends PluginsAction>(action: A, input: PluginsActionInputs[A], cwd: string): Promise<{ opId: string }> {
    if (this.closed) throw new Error('the engine host is stopping: no plugin operation starts');
    const argv = commandLine(action, input);
    const i = input as { plugin?: string; source?: string; name?: string };
    const op: Operation = { opId: randomUUID(), action, input, argv, cwd, target: i.plugin ?? i.source ?? i.name ?? '', state: 'queued', abort: null, group: null };
    this.operations.set(op.opId, op);
    this.queue = this.queue
      .then(() => new Promise<void>((resolve) => this.timers.setTimeout(resolve, 0))) // after the receipt's answer is posted
      .then(() => this.run(op))
      .catch((error: unknown) => console.warn(`[engine-host] plugins ${op.action} failed: ${error instanceof Error ? error.message : String(error)}`));
    return { opId: op.opId };
  }

  // Stops the CLI of a running operation (or keeps one still preparing from spawning), or drops a queued one; false once
  // its CLI has ended (or for an unknown id).
  cancel(opId: string): boolean {
    const op = this.operations.get(opId);
    if (!op || op.state === 'ended') return false;
    this.abort(op, 'cancelled', KILL_GRACE_MS);
    return true;
  }

  // The host stops: nothing new runs, every queued operation is dropped, every operation still preparing completes
  // without spawning, and every owned process group is stopped; resolves once all of those groups are gone.
  stop(graceMs = KILL_GRACE_MS): Promise<void> {
    this.closed = true;
    for (const op of [...this.operations.values()]) this.abort(op, 'stopped', graceMs);
    return Promise.all([...this.groups].map((group) => group.stop('stopped', graceMs))).then(() => undefined);
  }

  private abort(op: Operation, reason: 'cancelled' | 'stopped', graceMs: number): void {
    if (op.state === 'queued') {
      this.finish(op, { ok: false, error: { code: 'cancelled', message: FAILED_WORDS[reason], failureCode: null, shownCommand: null } });
      return;
    }
    op.abort ??= reason;
    void op.group?.stop(op.abort, graceMs);
  }

  private async run(op: Operation): Promise<void> {
    if (op.state !== 'queued') return; // cancelled while it waited
    op.state = 'running';
    const emit = (event: Omit<PluginsOperationEvent, 'opId' | 'action' | 'target'>) => this.deps.emit({ opId: op.opId, action: op.action, target: op.target, ...event });
    emit({ phase: 'started' });
    const ended = await this.exec(op.argv, op.cwd, (line) => emit({ phase: 'output', line }), op);
    op.state = 'ended';
    const outcome: PluginsOutcome = 'failed' in ended ? { ok: false, error: { code: ended.failed, message: ended.message, failureCode: null, shownCommand: null } } : mutationOutcome(ended.run);
    this.deps.changed(); // the CLI has ended: the lists may have moved, even after a failure (a refreshed catalogue)
    if (!outcome.ok || !RELOADING_ACTIONS.has(op.action)) return this.finish(op, outcome);
    emit({ phase: 'reloading' });
    const i = op.input as { plugin?: string; scope?: 'user' | 'project' | 'local' };
    const id = typeof outcome.result.pluginId === 'string' ? outcome.result.pluginId : (i.plugin ?? null);
    const plugin = id === null ? null : id.lastIndexOf('@') > 0 ? id.slice(0, id.lastIndexOf('@')) : id;
    const sessions = await reloadAfter({ action: op.action, scope: i.scope ?? 'user', cwd: op.cwd, plugin }, () => this.deps.reloadTargets(), {
      sleep: (ms) => new Promise((resolve) => this.timers.setTimeout(resolve, ms)),
    });
    this.finish(op, outcome, { sessions });
  }

  private finish(op: Operation, outcome: PluginsOutcome, reload?: PluginsOperationEvent['reload']): void {
    op.state = 'ended';
    this.operations.delete(op.opId);
    this.deps.emit({ opId: op.opId, action: op.action, target: op.target, phase: 'done', outcome, ...(reload && { reload }) });
  }

  // One CLI run. `onLine` hears every non-empty line the CLI prints but a result line; `op` is told of the group it owns.
  private async exec(args: readonly string[], cwd: string, onLine: ((line: string) => void) | null, op: Operation | null): Promise<Ended> {
    // a stop or cancel asked while preparing ends the run without a spawn: checked after every await, the last one
    // immediately before the synchronous spawn
    const aborted = (): Ended | null => {
      const reason = this.closed ? 'stopped' : (op?.abort ?? null);
      return reason === null ? null : { failed: 'cancelled', message: FAILED_WORDS[reason] };
    };
    const check = await this.deps.binary();
    const afterBinary = aborted();
    if (afterBinary) return afterBinary;
    if (!check.ok) return { failed: 'spawn_failed', message: check.error ?? `no engine binary at ${check.path}` };
    const isDirectory = await stat(cwd).then((s) => s.isDirectory(), () => false);
    const afterStat = aborted();
    if (afterStat) return afterStat;
    if (!isDirectory) return { failed: 'spawn_failed', message: `no directory at ${cwd}` };
    const env = pluginsEnvironment(await this.deps.captureEnv());
    const afterEnv = aborted();
    if (afterEnv) return afterEnv;
    return new Promise<Ended>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawn(check.path, [...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      } catch (error) {
        resolve({ failed: 'spawn_failed', message: error instanceof Error ? error.message : String(error) });
        return;
      }
      const group = new OwnedGroup(child, this.timers);
      this.groups.add(group);
      if (op) op.group = group;
      const ceiling = this.timers.setTimeout(() => void group.stop('timeout', KILL_GRACE_MS), CLI_TIMEOUT_MS);
      const out: string[] = [];
      const err: string[] = [];
      const lineReader = (sink: string[]) => {
        let partial = '';
        const hear = (line: string) => {
          const trimmed = line.trim();
          if (trimmed.length > 0 && resultOf(trimmed) === null) onLine?.(trimmed);
        };
        return {
          data: (text: string) => {
            sink.push(text);
            if (!onLine) return;
            const parts = (partial + text).split('\n');
            partial = parts.pop()!;
            parts.forEach(hear);
          },
          end: () => hear(partial),
        };
      };
      const stdout = lineReader(out);
      const stderr = lineReader(err);
      // decoded per stream, so a character split across two chunks arrives whole
      child.stdout?.setEncoding('utf8').on('data', stdout.data);
      child.stderr?.setEncoding('utf8').on('data', stderr.data);
      let settled = false;
      const settle = (ended: Ended) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(ceiling);
        this.groups.delete(group);
        if (op) op.group = null;
        resolve(ended);
      };
      child.on('error', (error) => {
        if (child.pid === undefined) settle({ failed: 'spawn_failed', message: error.message }); // the spawn itself failed
      });
      child.on('close', (code) => {
        stdout.end();
        stderr.end();
        const reason = group.reason;
        if (reason === null) return settle({ run: { stdout: out.join(''), stderr: err.join(''), code } }); // its own end: ownership ends
        // stopped: the group stays owned, and its SIGKILL due, until no member remains
        void group.stop(reason, KILL_GRACE_MS).then(() => settle({ failed: reason === 'timeout' ? 'timeout' : 'cancelled', message: FAILED_WORDS[reason] }));
      });
    });
  }
}
