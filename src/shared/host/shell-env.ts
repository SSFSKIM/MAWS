// carried by C9 until the rebase over C3 (wave-2 ledger d.12)
// X6's one-time login-shell capture, shared by the hosts (C3 lands the real one; this is C9's minimal stand-in with
// the ledger's name). Runs the user's login shell interactively once (`$SHELL -ilc`), so PATH and exports come from
// the owner's own dotfiles as in Terminal.app, and parses `env -0`'s NUL-separated pairs, which keeps multi-line
// values whole. Output a chatty rc file prints before the marker is ignored. Resolves null when the shell cannot run,
// times out or prints no pair; the caller falls back to its own environment.
import { execFile } from 'node:child_process';

export const SHELL_ENV_MARKER = '__MAWS_SHELL_ENV__';
const CAPTURE_TIMEOUT_MS = 5_000;

export interface CaptureOptions {
  shell?: string; // default $SHELL, else /bin/zsh
  timeoutMs?: number;
}

export function captureShellEnvironment({ shell, timeoutMs = CAPTURE_TIMEOUT_MS }: CaptureOptions = {}): Promise<Record<string, string> | null> {
  const program = shell ?? (process.env.SHELL || '/bin/zsh');
  return new Promise((resolve) => {
    execFile(
      program,
      ['-ilc', `printf '%s' ${SHELL_ENV_MARKER}; env -0`],
      { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : parseCapturedEnvironment(stdout)),
    );
  });
}

export function parseCapturedEnvironment(output: string): Record<string, string> | null {
  const at = output.indexOf(SHELL_ENV_MARKER);
  if (at === -1) return null;
  const env: Record<string, string> = {};
  for (const pair of output.slice(at + SHELL_ENV_MARKER.length).split('\0')) {
    const eq = pair.indexOf('=');
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return Object.keys(env).length > 0 ? env : null;
}
// carried by C9 until the rebase over C3 (wave-2 ledger d.12)
