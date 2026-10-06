// The plugin CLI runner (E8 execution document, Interfaces "The runner"; D-1 to D-5): the engine host runs the engine's
// own `claude plugin …` (the binary the launcher resolves, so the owner's choice in Settings › Engine applies) in a
// process it owns, never writing the config home itself. The child gets the whole captured login-shell environment (a
// private marketplace's clone needs SSH_AUTH_SOCK and the shell's PATH; CLAUDE_CONFIG_DIR travels in it as it does to
// the engine) less the nesting variables (inside a Claude Code session the CLI ignores `--accept-command`), plus the
// updater off and a dumb terminal; its cwd is the operation's directory, where project and local scope write.
// Reads run freely and answer the whole output; mutations are serialised in one queue and run as operations: a receipt
// `{ opId }` at once, then `started`, the CLI's `output` lines, `reloading` and `done`, with `plugins.changed` as soon as
// the CLI has ended. A child is killed at CLI_TIMEOUT_MS (SIGTERM, SIGKILL after KILL_GRACE_MS), on `cancel`, and on
// `stop` (the host stopping); each runs in its own process group so a clone it started dies with it.
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
type Stop = (why: 'timeout' | 'cancelled' | 'stopped') => void;

interface Operation {
  opId: string;
  action: PluginsAction;
  input: PluginsActionInputs[PluginsAction];
  argv: string[];
  cwd: string;
  target: string;
  state: 'queued' | 'running' | 'ended';
  stop: Stop | null; // while the CLI runs
}

const FAILED_WORDS = { timeout: `the CLI was still running after ${CLI_TIMEOUT_MS / 60_000} minutes and was stopped`, cancelled: 'cancelled before the CLI finished', stopped: 'stopped with the engine host' } as const;

export class PluginsRunner {
  private readonly spawn: typeof nodeSpawn;
  private readonly timers: Timers;
  private readonly operations = new Map<string, Operation>(); // queued or running
  private readonly children = new Set<Stop>();
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
    const argv = commandLine(action, input);
    const i = input as { plugin?: string; source?: string; name?: string };
    const op: Operation = { opId: randomUUID(), action, input, argv, cwd, target: i.plugin ?? i.source ?? i.name ?? '', state: 'queued', stop: null };
    this.operations.set(op.opId, op);
    this.queue = this.queue
      .then(() => new Promise<void>((resolve) => this.timers.setTimeout(resolve, 0))) // after the receipt's answer is posted
      .then(() => this.run(op))
      .catch((error: unknown) => console.warn(`[engine-host] plugins ${op.action} failed: ${error instanceof Error ? error.message : String(error)}`));
    return { opId: op.opId };
  }

  // Kills the CLI of a running operation, or drops a queued one; false once its CLI has ended (or for an unknown id).
  cancel(opId: string): boolean {
    const op = this.operations.get(opId);
    if (!op || op.state === 'ended') return false;
    if (op.state === 'running') op.stop?.('cancelled');
    else this.finish(op, { ok: false, error: { code: 'cancelled', message: FAILED_WORDS.cancelled, failureCode: null, shownCommand: null } });
    return true;
  }

  // The host stops: every child is killed and every queued operation dropped.
  stop(): void {
    for (const op of [...this.operations.values()]) if (op.state === 'queued') this.cancel(op.opId);
    for (const stop of [...this.children]) stop('stopped');
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

  // One CLI run. `onLine` hears every non-empty line the CLI prints but a result line; `op` receives the stop handle.
  private async exec(args: readonly string[], cwd: string, onLine: ((line: string) => void) | null, op: Operation | null): Promise<Ended> {
    const check = await this.deps.binary();
    if (!check.ok) return { failed: 'spawn_failed', message: check.error ?? `no engine binary at ${check.path}` };
    const isDirectory = await stat(cwd).then((s) => s.isDirectory(), () => false);
    if (!isDirectory) return { failed: 'spawn_failed', message: `no directory at ${cwd}` };
    const env = pluginsEnvironment(await this.deps.captureEnv());
    return new Promise<Ended>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawn(check.path, [...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      } catch (error) {
        resolve({ failed: 'spawn_failed', message: error instanceof Error ? error.message : String(error) });
        return;
      }
      const out: string[] = [];
      const err: string[] = [];
      let why: 'timeout' | 'cancelled' | 'stopped' | null = null;
      let killTimer: unknown = null;
      let settled = false;
      const signal = (sig: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, sig); // the group: the CLI and whatever it started
        } catch {
          child.kill(sig);
        }
      };
      const stop: Stop = (reason) => {
        if (why !== null || settled) return;
        why = reason;
        signal('SIGTERM');
        killTimer = this.timers.setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS);
      };
      this.children.add(stop);
      if (op) op.stop = stop;
      const ceiling = this.timers.setTimeout(() => stop('timeout'), CLI_TIMEOUT_MS);
      const lineReader = (sink: string[]) => {
        let partial = '';
        const hear = (line: string) => {
          const trimmed = line.trim();
          if (trimmed.length > 0 && resultOf(trimmed) === null) onLine?.(trimmed);
        };
        return {
          data: (chunk: Buffer) => {
            const text = chunk.toString('utf8');
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
      child.stdout?.on('data', stdout.data);
      child.stderr?.on('data', stderr.data);
      const settle = (ended: Ended) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(ceiling);
        if (killTimer !== null) this.timers.clearTimeout(killTimer);
        this.children.delete(stop);
        if (op) op.stop = null;
        resolve(ended);
      };
      child.on('error', (error) => settle({ failed: 'spawn_failed', message: error.message }));
      child.on('close', (code) => {
        stdout.end();
        stderr.end();
        settle(why !== null ? { failed: why === 'timeout' ? 'timeout' : 'cancelled', message: FAILED_WORDS[why] } : { run: { stdout: out.join(''), stderr: err.join(''), code } });
      });
    });
  }
}
