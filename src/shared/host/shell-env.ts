// The one-time login-shell environment capture (charter §4.1, X6): a Dock-launched app has none of the shell's exports,
// so each host captures `$SHELL -ilc 'env -0'` once at start and builds every child's environment from that (C3's
// engine host through `buildLaunch`; C9's PTY host runs the same capture so terminals match). NUL-separated so
// multi-line values survive; a chatty rc file that prints before the first pair is tolerated. On any failure (no shell,
// a hang past the timeout, a non-zero exit) the host's own `process.env` stands in, with a logged warning.
import { execFile } from 'node:child_process';

export const SHELL_CAPTURE_TIMEOUT_MS = 5_000;

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

// Runs the capture once, without caching or fallback; rejects on any failure.
export function runShellCapture(opts: { shell: string; timeoutMs: number }): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    execFile(
      opts.shell,
      ['-ilc', 'env -0'],
      { timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error.killed ? new Error(`timed out after ${opts.timeoutMs} ms`) : error);
          return;
        }
        const env = parseNulSeparatedEnv(stdout);
        if (!('PATH' in env)) {
          reject(new Error('capture printed no PATH'));
          return;
        }
        resolve(env);
      },
    );
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
