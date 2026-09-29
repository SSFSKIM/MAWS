// The engine binary check (C3 execution document, X2 `engine.binaryInfo`; `session.launch`'s `binary_missing` and
// `binary_version` refusals): the configured binary (launch.ts's BinaryConfig) must exist at its absolute path and
// answer `--version` with the expected version. `--version` runs by absolute path, never through PATH (D-1, X6), at
// most once per configuration while it matches; a failing answer is not cached, so installing the binary needs no restart.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import { engineBinaryPath, getBinaryConfig } from './launch';

export const VERSION_TIMEOUT_MS = 5_000;

export interface BinaryCheck {
  path: string;
  expectedVersion: string;
  version: string | null;
  ok: boolean;
  error: string | null;
  problem: 'missing' | 'version' | null; // which refusal `session.launch` answers; not part of the X2 output
}

export interface BinaryProbeDeps {
  run?: (path: string) => Promise<string>; // the stdout of `<path> --version`
  access?: (path: string) => Promise<void>; // rejects when the path is not an executable file
}

const runVersion = (path: string): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(path, ['--version'], { timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );

const executable = (path: string) => fsAccess(path, constants.X_OK);

export function createBinaryProbe(deps: BinaryProbeDeps = {}): () => Promise<BinaryCheck> {
  const run = deps.run ?? runVersion;
  const access = deps.access ?? executable;
  const cache = new Map<string, BinaryCheck>();
  return async () => {
    const { expectedVersion } = getBinaryConfig();
    const path = engineBinaryPath();
    const key = `${path}\0${expectedVersion}`;
    const cached = cache.get(key);
    if (cached) return { ...cached };
    const fail = (problem: 'missing' | 'version', error: string, version: string | null = null): BinaryCheck => ({ path, expectedVersion, version, ok: false, error, problem });
    try {
      await access(path);
    } catch (error) {
      return fail('missing', `no executable engine binary at ${path}: ${messageOf(error)}`);
    }
    let stdout: string;
    try {
      stdout = await run(path);
    } catch (error) {
      return fail('version', `${path} --version failed: ${messageOf(error)}`);
    }
    const version = /\d+\.\d+\.\d+[^\s]*/.exec(stdout)?.[0] ?? null;
    if (version === null) return fail('version', `${path} --version printed no version`);
    if (version !== expectedVersion) return fail('version', `${path} is ${version}; MAWS expects ${expectedVersion}`, version);
    const check: BinaryCheck = { path, expectedVersion, version, ok: true, error: null, problem: null };
    cache.set(key, check);
    return { ...check };
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
