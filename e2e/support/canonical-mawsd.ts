// The account's canonical mawsd as the packaged daemon-shape check watches it (P5 O2; O14 residue 18;
// e2e/supervisor-packaged.spec.ts). The gate's Mac runs the owner's real `dev.maws.mawsd` once its account is cut over,
// so the check asserts that the job creates, removes or rewrites nothing of it that the job itself could cause: the
// plist; the default profile's sockets and lock, in `<profile>/mawsd/` and in its `$TMPDIR` fallback directory; and the
// default profile's `mawsd/` tree. Nothing under the profile is opened, read or connected to: directory listings and
// lstat only (the plist alone is read, as it was).
//
// A live canonical mawsd writes to its own tree while the job runs, so `canonicalDifferences` leaves out what only it
// can cause: the mtimes of logs and out files and their rotations (`mawsd.log`, `mawsd.out`, the pty host's `host.log`,
// each `.1` after a rotation; a rotation's first `.1` is not a difference either), everything below `endpoint/` (O10's
// state, which changes on its own; the snapshot records `endpoint` itself and nothing under it), and the directories'
// own mtimes, which a rotation's rename moves and which add nothing the entry names do not show. Every other entry
// keeps its name, kind and mtime (and a socket or the lock its inode).
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DAEMON_FILES, socketFallbackDir } from '../../src/shared/daemon/files';
import { defaultProfileDir } from '../../src/shared/daemon/profile';

export interface Entry {
  kind: 'socket' | 'dir' | 'link' | 'file';
  ino: number;
  mtimeMs: number;
}

export interface CanonicalSnapshot {
  plist: { text: string; mtimeMs: number } | null;
  sockets: Record<string, Entry | null>; // absolute path → the entry, or null when absent
  profile: Record<string, Entry> | null; // `<profile>/mawsd/`'s entries by relative path ('.' itself), or null when absent
}

export interface CanonicalPaths {
  plist: string;
  sockets: string[];
  profileMawsd: string;
}

// The default profile's paths in this account: the sockets and the lock in `mawsd/` and in the fallback directory of
// both this process's tmpdir and the account's own (`DARWIN_USER_TEMP_DIR`, which launchd gives the canonical job).
export function canonicalPaths(home: string = homedir()): CanonicalPaths {
  const profile = defaultProfileDir('darwin', process.env, home);
  const profileMawsd = join(profile, DAEMON_FILES.dir);
  const tmps = new Set([tmpdir(), execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim()]);
  const names = [DAEMON_FILES.machineSocket, DAEMON_FILES.engineHostSocket, DAEMON_FILES.ptyHostSocket, DAEMON_FILES.lock];
  const sockets = [profileMawsd, ...[...tmps].map((tmp) => socketFallbackDir(profile, tmp))].flatMap((dir) => names.map((name) => join(dir, name)));
  return { plist: join(home, 'Library', 'LaunchAgents', 'dev.maws.mawsd.plist'), sockets, profileMawsd };
}

export function snapshotCanonical(paths: CanonicalPaths): CanonicalSnapshot {
  return {
    plist: existsSync(paths.plist) ? { text: readFileSync(paths.plist, 'utf8'), mtimeMs: statSync(paths.plist).mtimeMs } : null,
    sockets: Object.fromEntries(paths.sockets.map((path) => [path, entryOf(path)])),
    profile: treeOf(paths.profileMawsd),
  };
}

const ENDPOINT = DAEMON_FILES.endpoint;
const LOG = /\.(log|out)(\.\d+)?$/; // DAEMON_FILES.log and .out, the hosts' SUPERVISOR_FILES.log, and their rotations
const ROTATION = /\.(log|out)\.\d+$/;
const belowEndpoint = (rel: string) => rel.startsWith(`${ENDPOINT}/`);
const mtimeIsTheirs = (rel: string, entry: Entry) => entry.kind === 'dir' || rel === ENDPOINT || belowEndpoint(rel) || LOG.test(basename(rel));

// What changed between two snapshots that the job could have caused, one line each; empty when nothing did.
export function canonicalDifferences(before: CanonicalSnapshot, after: CanonicalSnapshot): string[] {
  const out: string[] = [];
  if (JSON.stringify(before.plist) !== JSON.stringify(after.plist)) out.push(`the plist ${describe(before.plist === null, after.plist === null)}`);
  for (const path of new Set([...Object.keys(before.sockets), ...Object.keys(after.sockets)])) {
    const was = before.sockets[path] ?? null;
    const now = after.sockets[path] ?? null;
    if (JSON.stringify(was) !== JSON.stringify(now)) out.push(`${path} ${describe(was === null, now === null)}`);
  }
  if ((before.profile === null) !== (after.profile === null)) out.push(`the profile's ${DAEMON_FILES.dir}/ ${describe(before.profile === null, after.profile === null)}`);
  if (before.profile !== null && after.profile !== null) {
    for (const rel of new Set([...Object.keys(before.profile), ...Object.keys(after.profile)])) {
      if (belowEndpoint(rel)) continue;
      const was = before.profile[rel];
      const now = after.profile[rel];
      if (was === undefined || now === undefined) {
        if (!ROTATION.test(basename(rel))) out.push(`${DAEMON_FILES.dir}/${rel} ${describe(was === undefined, now === undefined)}`);
      } else if (was.kind !== now.kind) out.push(`${DAEMON_FILES.dir}/${rel} changed from a ${was.kind} to a ${now.kind}`);
      else if (was.mtimeMs !== now.mtimeMs && !mtimeIsTheirs(rel, now)) out.push(`${DAEMON_FILES.dir}/${rel} was rewritten`);
    }
  }
  return out;
}

function describe(wasAbsent: boolean, isAbsent: boolean): string {
  if (wasAbsent && !isAbsent) return 'appeared';
  if (!wasAbsent && isAbsent) return 'was removed';
  return 'changed';
}

function entryOf(path: string): Entry | null {
  try {
    const stat = lstatSync(path);
    return { kind: stat.isSocket() ? 'socket' : stat.isDirectory() ? 'dir' : stat.isSymbolicLink() ? 'link' : 'file', ino: stat.ino, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// Every entry under `dir` by relative path, symlinks not followed and `endpoint/` not entered; null when there is no dir.
function treeOf(dir: string): Record<string, Entry> | null {
  const root = entryOf(dir);
  if (root === null) return null;
  const tree: Record<string, Entry> = { '.': root };
  const walk = (at: string, prefix: string) => {
    for (const name of readdirSync(at).sort()) {
      const rel = `${prefix}${name}`;
      const entry = entryOf(join(at, name));
      if (entry === null) continue; // gone between the listing and its lstat
      tree[rel] = entry;
      if (entry.kind === 'dir' && rel !== ENDPOINT) walk(join(at, name), `${rel}/`);
    }
  };
  walk(dir, '');
  return tree;
}
