// The engine binary a launch runs (charter D-1 as amended 2026-10-01, W13; X2 `engine.binaryInfo`; `session.launch`'s
// `binary_missing` refusal): the user's installed Claude Code, resolved again at every call. The order: the binary path
// the owner chose in Settings (launch.ts's BinaryConfig); under MAWS_E2E, MAWS_E2E_ENGINE_BIN and nothing else, so a
// test never reaches the user's install; else `~/.local/bin/claude` when it resolves; else the first executable `claude`
// on the captured login shell's PATH. The answer is the candidate's real path (`realpath`), so a launch spawns exactly
// the file that answered and an installer flipping its link mid-session changes nothing for that session. `--version`
// runs by that real path, cached by path, size and mtime (an update in place probes again); a failing answer is not
// cached, so installing the binary needs no restart. A missing binary or one that prints no version refuses the launch;
// a version other than the tested one never does (`testedVersion` is information).
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import { SHELL_CAPTURE_GRACE_MS, SHELL_CAPTURE_TIMEOUT_MS } from '@shared/host/shell-env';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { getBinaryConfig } from './launch';

export const VERSION_TIMEOUT_MS = 5_000;
// The probe's whole bound: a PATH lookup waits for the login-shell capture first, and `--version` then gets what is left
// (at least 2.5 s), so `session.launch`'s checks stay inside the bridge's deadline.
export const PROBE_BOUND_MS = SHELL_CAPTURE_TIMEOUT_MS + SHELL_CAPTURE_GRACE_MS + 2_500;
export const INSTALLED_LINK = '.local/bin/claude'; // under the home directory: the native installer's link

export type BinaryCheck = BinaryInfo;

export interface BinaryProbeDeps {
  run?: (path: string, timeoutMs: number) => Promise<string>; // the stdout of `<path> --version`
  captureEnv?: () => Promise<Record<string, string>>; // the login shell's environment, for the PATH lookup
  home?: string;
  env?: Record<string, string | undefined>; // the host's own: MAWS_E2E, MAWS_E2E_ENGINE_BIN
  now?: () => number;
}

const runVersion = (path: string, timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(path, ['--version'], { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );

const executable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

// The candidate before `realpath`, or why there is none.
async function candidateOf(deps: Required<Pick<BinaryProbeDeps, 'home' | 'env'>> & Pick<BinaryProbeDeps, 'captureEnv'>): Promise<{ path: string } | { path: string; error: string }> {
  const { binaryPath } = getBinaryConfig();
  if (binaryPath !== null) return { path: binaryPath };
  if (deps.env.MAWS_E2E === '1') {
    const pinned = deps.env.MAWS_E2E_ENGINE_BIN;
    return pinned && isAbsolute(pinned) ? { path: pinned } : { path: '', error: 'MAWS_E2E runs name their engine in MAWS_E2E_ENGINE_BIN (an absolute path); the installed Claude Code is never used' };
  }
  const installed = join(deps.home, INSTALLED_LINK);
  if (await executable(installed)) return { path: installed };
  const captured = deps.captureEnv ? await deps.captureEnv() : {};
  for (const dir of (captured.PATH ?? '').split(':')) {
    if (!isAbsolute(dir)) continue;
    const onPath = join(dir, 'claude');
    if (await executable(onPath)) return { path: onPath };
  }
  return { path: installed, error: `Claude Code is not installed: nothing at ${installed} and no claude on your login shell's PATH. Install it, or choose a binary in Settings › Engine.` };
}

export function createBinaryProbe(deps: BinaryProbeDeps = {}): () => Promise<BinaryCheck> {
  const run = deps.run ?? runVersion;
  const now = deps.now ?? Date.now;
  const where = { home: deps.home ?? homedir(), env: deps.env ?? process.env, captureEnv: deps.captureEnv };
  const versions = new Map<string, Promise<string>>(); // by real path, size and mtime; a failure is dropped
  return async () => {
    const started = now();
    const fail = (path: string, error: string): BinaryCheck => ({ path, testedVersion: TESTED_ENGINE_VERSION, version: null, ok: false, error });
    const candidate = await candidateOf(where);
    if ('error' in candidate) return fail(candidate.path, candidate.error);
    let path: string;
    let key: string;
    try {
      path = await realpath(candidate.path);
      const file = await stat(path);
      await access(path, constants.X_OK);
      if (!file.isFile()) throw new Error('not a file');
      key = `${path}\0${file.size}\0${file.mtimeMs}`;
    } catch (error) {
      return fail(candidate.path, `no executable engine binary at ${candidate.path}: ${messageOf(error)}`);
    }
    let pending = versions.get(key);
    if (!pending) {
      pending = run(path, Math.max(Math.min(VERSION_TIMEOUT_MS, PROBE_BOUND_MS - (now() - started)), 2_500)).then((stdout) => {
        const version = /\d+\.\d+\.\d+[^\s]*/.exec(stdout)?.[0];
        if (version === undefined) throw new Error('--version printed no version');
        return version;
      });
      versions.set(key, pending);
      pending.catch(() => versions.delete(key));
    }
    try {
      return { path, testedVersion: TESTED_ENGINE_VERSION, version: await pending, ok: true, error: null };
    } catch (error) {
      return fail(path, `${path} --version failed: ${messageOf(error)}`);
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
