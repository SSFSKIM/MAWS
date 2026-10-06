// The one-time login-shell environment capture (charter §4.1, X6): a Dock-launched app has none of the shell's exports,
// so each host captures `$SHELL -ilc 'env -0'` once at start and builds every child's environment from that (C3's
// engine host through `buildLaunch`; C9's PTY host runs the same capture so terminals match). NUL-separated so
// multi-line values survive; a chatty rc file that prints before the first pair is tolerated. On any failure (no shell,
// a hang past the timeout, a non-zero exit) the host's own `process.env` stands in, with a logged warning.
import { spawn, type ChildProcess } from 'node:child_process';

export const SHELL_CAPTURE_TIMEOUT_MS = 5_000;
export const SHELL_CAPTURE_GRACE_MS = 250; // after the SIGKILL, before the capture gives up on the child
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface ShellCaptureOptions {
  shell?: string; // default $SHELL, then /bin/zsh
  timeoutMs?: number;
  fallback?: NodeJS.ProcessEnv; // default process.env
  cache?: boolean; // default true: one capture per host start
}

const ENV_PAIR = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Parses `env -0` output. Everything before the first `\0`-terminated `KEY=` pair is rc-file noise and is skipped by
// scanning that first chunk for the last line that starts a pair.
export function parseNulSeparatedEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  const chunks = text.split('\0');
  let first = true;
  for (let chunk of chunks) {
    if (first) {
      first = false;
      if (!ENV_PAIR.test(chunk)) {
        const lines = chunk.split('\n');
        const start = lines.findIndex((line) => ENV_PAIR.test(line));
        if (start < 0) continue;
        chunk = lines.slice(start).join('\n');
      }
    }
    if (chunk.length === 0 || !ENV_PAIR.test(chunk)) continue;
    const eq = chunk.indexOf('=');
    env[chunk.slice(0, eq)] = chunk.slice(eq + 1);
  }
  return env;
}

function stringsOnly(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') out[key] = value;
  return out;
}

// Runs the capture once, without caching or fallback; rejects on any failure. It settles by `timeoutMs` plus a short
// grace whatever the shell does (whole-branch review): stdin is closed, so an rc file that reads it sees end of input;
// the timeout kills with SIGKILL, since an interactive zsh ignores SIGTERM; and the capture gives up on its own timer,
// since a child the rc file started can hold the output pipe open after the shell is gone.
export function runShellCapture(opts: { shell: string; timeoutMs: number }): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(opts.shell, ['-ilc', 'env -0'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timedOut = () => new Error(`timed out after ${opts.timeoutMs} ms`);
    const finish = (error: Error | null, env?: Record<string, string>) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      clearTimeout(giveUp);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      child.stdout?.destroy(); // a grandchild may still hold the pipes; the host lets go of them
      child.stderr?.destroy();
      if (error) reject(error);
      else resolve(env!);
    };
    const kill = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    const giveUp = setTimeout(() => finish(timedOut()), opts.timeoutMs + SHELL_CAPTURE_GRACE_MS);
    child.stdout!.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_CAPTURE_BYTES) finish(new Error(`capture printed more than ${MAX_CAPTURE_BYTES} bytes`));
      else chunks.push(chunk);
    });
    child.stderr!.resume(); // an rc file's chatter is drained, never read
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (signal !== null) return finish(signal === 'SIGKILL' ? timedOut() : new Error(`the shell ended on ${signal}`));
      if (code !== 0) return finish(new Error(`the shell exited ${code}`));
      const env = parseNulSeparatedEnv(Buffer.concat(chunks).toString('utf8'));
      if (!('PATH' in env)) return finish(new Error('capture printed no PATH'));
      finish(null, env);
    });
  });
}

let cached: Promise<Record<string, string>> | null = null;

export function captureShellEnvironment(opts: ShellCaptureOptions = {}): Promise<Record<string, string>> {
  const useCache = opts.cache ?? true;
  if (useCache && cached) return cached;
  const shell = opts.shell ?? process.env.SHELL ?? '/bin/zsh';
  const timeoutMs = opts.timeoutMs ?? SHELL_CAPTURE_TIMEOUT_MS;
  const fallback = opts.fallback ?? process.env;
  const capture = runShellCapture({ shell, timeoutMs }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[host] shell environment capture failed (${shell} -ilc 'env -0'): ${message}; using the host's own environment`);
    return stringsOnly(fallback);
  });
  if (useCache) cached = capture;
  return capture;
}

// E10 (E10 execution document, §Design 1 "Long-lived host hygiene"): the detached supervisor outlives the app, so the
// cached capture is dropped when a client connects (the owner is back, perhaps with a changed shell) and the next
// launch captures again, once. A capture already handed out stays with its callers.
export function invalidateShellEnvironment(): void {
  cached = null;
}
