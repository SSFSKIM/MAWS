// MAWS's custody of the pinned engine (C12 execution document, Interfaces "Engine custody"; charter D6, D-1). The
// installer keeps only its five newest versions, so the pinned binary can vanish under MAWS: at pin time MAWS copies
// `<source>/<version>` to `<userData>/engine/<version>/claude` (byte for byte, its embedded signature intact, never
// patched) beside a manifest with its SHA-256, and launches from the copy. Every start re-hashes the copy against the
// manifest; a copy that is missing or altered is made again from a source that answers `--version` with the pin (which
// is what makes "reinstall that version" a fix), and otherwise custody answers the refusal main gives a launch.
//
// The installer's directory is only read. Tests and replay (MAWS_E2E, MAWS_ENGINE_REPLAY) run without custody, so the
// host keeps C3's ENGINE_BIN; MAWS_ENGINE_SOURCE_DIR opts an unpackaged run in against a scratch source.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { LaunchResult } from '@shared/ipc/schema/session';
import { CustodyManifestSchema, type Custody, type CustodyManifest } from '@shared/ipc/schema/settings';
import { ENGINE_BIN } from '../../engine-host/launch';

export type { Custody, CustodyManifest };

export const VERSION_TIMEOUT_MS = 5_000; // C3's binary probe's

export interface CustodyDeps {
  copyFile?: (from: string, to: string, mode: number) => Promise<void>;
  runVersion?: (path: string) => Promise<string>; // the stdout of `<path> --version`, run by absolute path
  now?: () => string;
  log?: (message: string) => void;
}

export function custodyPath(userData: string, version: string): string {
  return join(userData, 'engine', version, 'claude');
}

// Where custody copies from, or null when it does not run. The installer's directory is ENGINE_BIN's; an unpackaged run
// may name a scratch one by absolute path (the custody spec); MAWS_E2E and replay otherwise leave the host on
// ENGINE_BIN. An override that is not an absolute path is ignored, never read as a bypass.
export function custodySourceDir(env: Record<string, string | undefined>, packaged: boolean): string | null {
  const override = packaged ? undefined : env.MAWS_ENGINE_SOURCE_DIR;
  if (override !== undefined && isAbsolute(override)) return override;
  if (env.MAWS_E2E === '1' || env.MAWS_ENGINE_REPLAY === '1') return null;
  return dirname(ENGINE_BIN);
}

export async function ensureCustody(o: { userData: string; version: string; sourceDir: string }, deps: CustodyDeps = {}): Promise<Custody> {
  const path = custodyPath(o.userData, o.version);
  const source = join(o.sourceDir, o.version);
  const log = deps.log ?? ((message: string) => console.warn(`[custody] ${message}`));
  const problem = await verify(path, o.version);
  if (problem === null) return { state: 'ok', path, manifest: (await readManifest(path))! };
  if (!(await exists(source))) return refused(problem, o, path);
  const made = await makeCopy(source, path, o.version, deps);
  if (made.state !== 'ok') return made.state === 'version' ? refused('version', o, path, made.answered) : refused(problem, o, path);
  log(problem === 'missing' ? `copied ${source} to ${path}` : `the copy at ${path} did not match its manifest; made again from ${source}`);
  return { state: 'ok', path, manifest: made.manifest };
}

export function custodyRefusal(c: Custody): Extract<LaunchResult, { status: 'refused' }> | null {
  if (c.state === 'ok') return null;
  return { status: 'refused', reason: c.state === 'missing' ? 'binary_missing' : 'binary_version', message: c.message };
}

// ---- the check ------------------------------------------------------------------------------------------------------

const manifestPath = (path: string) => join(dirname(path), 'manifest.json');

async function readManifest(path: string): Promise<CustodyManifest | null> {
  try {
    const parsed = CustodyManifestSchema.safeParse(JSON.parse(await readFile(manifestPath(path), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// null when the copy is the pin's as its manifest recorded it; a copy with no readable manifest cannot be told from an
// altered one. The full hash runs at every start: measured 2026-09-29 (C12 M4 task 3) on the owner's Mac, 2.1.283's
// 225,036,032 bytes hash in 207 to 259 ms, well under the one second past which the document would compare size and
// mtime at start and hash in the background instead.
async function verify(path: string, version: string): Promise<'missing' | 'mismatch' | null> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return 'missing';
  }
  const manifest = await readManifest(path);
  if (manifest === null || manifest.version !== version || manifest.size !== size) return 'mismatch';
  return (await sha256Of(path)) === manifest.sha256 ? null : 'mismatch';
}

export function sha256Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

// ---- the copy -------------------------------------------------------------------------------------------------------

type Made = { state: 'ok'; manifest: CustodyManifest } | { state: 'version'; answered: string | null } | { state: 'failed' };

// A temporary name beside the target, a clone where the volume allows (a full copy otherwise), mode 0755, `--version`
// on the copy by absolute path, the hash, then the rename into place and the manifest after it.
async function makeCopy(source: string, path: string, version: string, deps: CustodyDeps): Promise<Made> {
  const dir = dirname(path);
  const temporary = join(dir, `.claude-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  const copy = deps.copyFile ?? ((from: string, to: string, mode: number) => copyFile(from, to, mode));
  try {
    await mkdir(dir, { recursive: true });
    await copy(source, temporary, constants.COPYFILE_FICLONE);
    await chmod(temporary, 0o755);
    const answered = await versionOf(temporary, deps.runVersion ?? runVersion);
    if (answered !== version) {
      await rm(temporary, { force: true });
      return { state: 'version', answered };
    }
    const manifest: CustodyManifest = { version, sha256: await sha256Of(temporary), size: (await stat(temporary)).size, source, copiedAt: (deps.now ?? (() => new Date().toISOString()))() };
    await rename(temporary, path);
    const manifestTemporary = `${manifestPath(path)}.${process.pid}.tmp`;
    await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(manifestTemporary, manifestPath(path));
    return { state: 'ok', manifest };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    (deps.log ?? console.warn)(`[custody] copying ${source} to ${path} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { state: 'failed' };
  }
}

const runVersion = (path: string): Promise<string> =>
  new Promise((resolve, reject) => execFile(path, ['--version'], { timeout: VERSION_TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout))));

async function versionOf(path: string, run: (path: string) => Promise<string>): Promise<string | null> {
  try {
    return /\d+\.\d+\.\d+[^\s]*/.exec(await run(path))?.[0] ?? null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ---- the words ------------------------------------------------------------------------------------------------------

function refused(state: 'missing' | 'mismatch' | 'version', o: { version: string; sourceDir: string }, path: string, answered: string | null = null): Custody {
  const what = {
    missing: `is missing from MAWS's copy at ${path}`,
    mismatch: `has been altered in MAWS's copy at ${path}`,
    version: `answers a different version (${answered ?? 'none'}), so MAWS's copy at ${path} was not made`,
  }[state];
  const installed = homeAbbreviated(join(o.sourceDir, o.version));
  return { state, path, message: `Claude Code ${o.version} ${what}. Reinstall Claude Code ${o.version} (it belongs at ${installed}) and restart MAWS, or choose a binary path in Settings › Engine.` };
}

function homeAbbreviated(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
