// The engine binary a launch runs (charter D-1 as amended 2026-10-01, W13; X2 `engine.binaryInfo`; `session.launch`'s
// `binary_missing` refusal): the user's installed Claude Code, resolved again at every call. The order: the binary path
// the owner chose in Settings (launch.ts's BinaryConfig); under MAWS_E2E, MAWS_E2E_ENGINE_BIN and nothing else, so a
// test never reaches the user's install; else `~/.local/bin/claude` when it resolves; else the first executable `claude`
// on the captured login shell's PATH. The answer is the candidate's real path (`realpath`), so a launch spawns exactly
// the file that answered and an installer flipping its link mid-session changes nothing for that session. `--version`
// runs by that real path in the captured login shell's environment, the base every launch's is built from (W13 review:
// an npm-installed `claude` is `#!/usr/bin/env node`, and a Dock-launched host's own PATH has no `node`); it is cached
// by path, size and mtime (an update in place probes again), and a failing answer is not cached, so installing the
// binary needs no restart. A missing binary or one that prints no version refuses the launch; a version other than the
// tested one never does (`testedVersion` is information).
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import { SHELL_CAPTURE_GRACE_MS, SHELL_CAPTURE_TIMEOUT_MS } from '@shared/host/shell-env';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { getBinaryConfig } from './launch';

export const VERSION_TIMEOUT_MS = 5_000;
// The probe's whole bound: the login-shell capture comes first (cached per host start), and `--version` then gets what
// is left (at least 2.5 s), so `session.launch`'s checks stay inside the bridge's deadline.
export const PROBE_BOUND_MS = SHELL_CAPTURE_TIMEOUT_MS + SHELL_CAPTURE_GRACE_MS + 2_500;
export const INSTALLED_LINK = '.local/bin/claude'; // under the home directory: the native installer's link

export type BinaryCheck = BinaryInfo;

export interface BinaryProbeDeps {
  run?: (path: string, timeoutMs: number, env: Record<string, string> | undefined) => Promise<string>; // the stdout of `<path> --version` in env (undefined: the host's own)
  captureEnv?: () => Promise<Record<string, string>>; // the login shell's environment: the PATH lookup's and `--version`'s; without it, the host's own
  home?: string;
  env?: Record<string, string | undefined>; // the host's own: MAWS_E2E, MAWS_E2E_ENGINE_BIN
  now?: () => number;
}

const runVersion = (path: string, timeoutMs: number, env: Record<string, string> | undefined): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(path, ['--version'], { timeout: timeoutMs, encoding: 'utf8', env }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
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
async function candidateOf(deps: {
  home: string;
  env: Record<string, string | undefined>;
  shellEnv: () => Promise<Record<string, string> | undefined>;
}): Promise<{ path: string } | { path: string; error: string }> {
  const { binaryPath } = getBinaryConfig();
  if (binaryPath !== null) return { path: binaryPath };
  if (deps.env.MAWS_E2E === '1') {
    const pinned = deps.env.MAWS_E2E_ENGINE_BIN;
    return pinned && isAbsolute(pinned) ? { path: pinned } : { path: '', error: 'MAWS_E2E runs name their engine in MAWS_E2E_ENGINE_BIN (an absolute path); the installed Claude Code is never used' };
  }
  const installed = join(deps.home, INSTALLED_LINK);
  if (await executable(installed)) return { path: installed };
  for (const dir of ((await deps.shellEnv())?.PATH ?? '').split(':')) {
    if (!isAbsolute(dir)) continue;
    const onPath = join(dir, 'claude');
    if (await executable(onPath)) return { path: onPath };
  }
  return { path: installed, error: `Claude Code is not installed: nothing at ${installed} and no claude on your login shell's PATH. Install it, or choose a binary in Settings › Engine.` };
}

export function createBinaryProbe(deps: BinaryProbeDeps = {}): () => Promise<BinaryCheck> {
  const run = deps.run ?? runVersion;
  const now = deps.now ?? Date.now;
  const home = deps.home ?? homedir();
  const env = deps.env ?? process.env;
  const versions = new Map<string, Promise<string>>(); // by real path, size and mtime; a failure is dropped
  const declarations = new Map<string, Promise<boolean>>(); // P2-C: by the same key; the scan never fails
  return async () => {
    const started = now();
    const fail = (path: string, error: string): BinaryCheck => ({ path, testedVersion: TESTED_ENGINE_VERSION, version: null, ok: false, error, declaresSystemPromptSnapshot: false /* P2-C */ });
    let captured: Promise<Record<string, string> | undefined> | undefined; // read at most once a call, only when needed
    const shellEnv = () => (captured ??= deps.captureEnv ? deps.captureEnv() : Promise.resolve(undefined));
    const candidate = await candidateOf({ home, env, shellEnv });
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
    // P2-C start (2026-10-09): the flag's declaration, scanned once per file beside --version; never a refusal
    let declares = declarations.get(key);
    if (!declares) {
      declares = binaryDeclares(path, SYSTEM_PROMPT_SNAPSHOT_FLAG);
      declarations.set(key, declares);
    }
    // P2-C end
    let pending = versions.get(key);
    if (!pending) {
      pending = shellEnv()
        .then((runEnv) => run(path, Math.max(Math.min(VERSION_TIMEOUT_MS, PROBE_BOUND_MS - (now() - started)), 2_500), runEnv))
        .then((stdout) => {
          const version = /\d+\.\d+\.\d+[^\s]*/.exec(stdout)?.[0];
          if (version === undefined) throw new Error('--version printed no version');
          return version;
        });
      versions.set(key, pending);
      pending.catch(() => versions.delete(key));
    }
    try {
      return { path, testedVersion: TESTED_ENGINE_VERSION, version: await pending, ok: true, error: null, declaresSystemPromptSnapshot: await declares /* P2-C */ };
    } catch (error) {
      return fail(path, `${path} --version failed: ${messageOf(error)}`);
    }
  };
}

// P2-C start (2026-10-09): the flag `--system-prompt-snapshot` (the P2-C document, Design §2, "The flag's
// availability"). The CLI's help does not list it, so its declaration is read from the binary's own bytes, where its
// option table carries this literal (2.1.295). The scan reads in chunks, never the whole file at once, keeping the
// literal's length less one byte between chunks so a match across a boundary is found. Unreadable reads as undeclared.
export const SYSTEM_PROMPT_SNAPSHOT_FLAG = '--system-prompt-snapshot <on|off>';
const SCAN_CHUNK_BYTES = 1024 * 1024;

export async function binaryDeclares(path: string, literal: string, chunkBytes = SCAN_CHUNK_BYTES): Promise<boolean> {
  const needle = Buffer.from(literal);
  let file;
  try {
    file = await open(path, 'r');
  } catch {
    return false;
  }
  try {
    const buffer = Buffer.alloc(chunkBytes + needle.length - 1);
    let kept = 0; // bytes carried over from the previous chunk, at the buffer's start
    let position = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, kept, chunkBytes, position);
      if (bytesRead === 0) return false;
      const filled = kept + bytesRead;
      if (buffer.subarray(0, filled).includes(needle)) return true;
      position += bytesRead;
      kept = Math.min(needle.length - 1, filled);
      buffer.copy(buffer, 0, filled - kept, filled);
    }
  } catch {
    return false;
  } finally {
    await file.close();
  }
}
// P2-C end

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
