// The Linux release directory (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The unit's program path
// from a checkout", residue 21): the canonical unit never runs code from a working checkout, so `mawsd install` copies
// the pack it runs from (`pnpm mawsd:pack`'s `dist/mawsd/<version>-<commit>-<content>/`) into
// `~/.local/share/maws/mawsd/releases/<release>/`, points `current` at it, and the unit runs `current`'s runtime and
// entry. The two releases installed before the current one are kept (a rollback is `mawsd install` run from one of
// them); older ones are pruned once the new one is active (install.ts).
//
// A release is immutable. Its name carries its content's hash (the pack's), so the same content is the same release
// and installing it again copies nothing, and different content, a rebuild of one commit included, is another release
// that flips `current` like any other; nothing ever rewrites an installed release.
//
// A running daemon is unaffected by a flip: Node runs the real path of its entry and `process.execPath` is the real
// runtime, so it and the hosts it spawned keep their release's files until the unit restarts it. A host can outlive
// several releases (an engine host of an unchanged build is adopted by every later `mawsd`, never replaced) and reads
// its release's files while it runs (its design systems' `?asset` files), so a release a running process runs from is
// never pruned, however old: the release its executable lies under (`/proc/<pid>/exe`, resolved through `current` when
// it was exec'd), or one its command line names as `releases/<release>/`. A command line naming `current/` is never
// read against the link as it is now, which may have flipped since that process started.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { UnitError, type UnitProgram } from './units/unit';

const RELEASE_NAME = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/; // `<version>-<commit>-<content>`: one path segment
const KEEP_PREVIOUS = 2;

export const releasesRoot = (home: string): string => join(home, '.local', 'share', 'maws', 'mawsd');

// The program the canonical Linux unit runs: current's runtime and entry.
export function releaseProgram(home: string): UnitProgram {
  const current = join(releasesRoot(home), 'current');
  return { runtime: join(current, 'runtime', 'bin', 'node'), entry: join(current, 'out', 'main', 'mawsd.js') };
}

export interface Pack {
  root: string; // the directory holding out/, node_modules/, package.json and, on Linux, runtime/
  release: string; // `<version>-<commit>-<content>`, the name it installs under
  runtime: boolean; // it carries runtime/bin/node
}

// The pack `entry` (`<pack>/out/main/mawsd.js`) belongs to, known by its package.json's `mawsd.release`; null for a
// checkout's out/main or anything else.
export function packOf(entry: string): Pack | null {
  if (basename(entry) !== 'mawsd.js' || basename(dirname(entry)) !== 'main' || basename(dirname(dirname(entry))) !== 'out') return null;
  const root = dirname(dirname(dirname(entry)));
  let manifest: { mawsd?: { release?: unknown } };
  try {
    manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as typeof manifest;
  } catch {
    return null;
  }
  const release = manifest.mawsd?.release;
  if (typeof release !== 'string' || !RELEASE_NAME.test(release)) return null;
  return { root, release, runtime: existsSync(join(root, 'runtime', 'bin', 'node')) };
}

export interface ReleaseFlip {
  release: string;
  previous: string | null; // the release current named before, if any
  flipped: boolean; // current now names another release than before
}

export interface InstalledRelease extends ReleaseFlip {
  pruned: string[]; // the releases removed once this one was active
}

// Copies `pack` into releases/<release> unless that release is installed already (a release is immutable, its name its
// content's), marks it the most recently installed, and flips current to it. A copy is staged beside its target and
// renamed into place, so a release directory is either whole or absent.
export function installRelease(pack: Pack, home: string, { now = Date.now }: { now?: () => number } = {}): ReleaseFlip {
  if (!pack.runtime) throw new UnitError(`the release ${pack.release} at ${pack.root} has no runtime/bin/node (pnpm mawsd:pack adds it on Linux)`);
  const dir = join(releasesRoot(home), 'releases');
  const target = join(dir, pack.release);
  mkdirSync(dir, { recursive: true });
  sweepStaging(dir);
  if (!existsSync(target)) {
    const staged = join(dir, `.${pack.release}.${process.pid}.staged`);
    cpSync(pack.root, staged, { recursive: true, verbatimSymlinks: true });
    renameSync(staged, target);
  }
  const stamp = new Date(now());
  utimesSync(target, stamp, stamp);
  const previous = currentRelease(home);
  const flipped = previous !== pack.release;
  if (flipped) pointCurrent(home, pack.release);
  return { release: pack.release, previous, flipped };
}

// Puts current back where it was before a flip whose activation failed (null: there was no current), so the next
// install sees the flip again and completes it.
export function restoreCurrent(home: string, previous: string | null): void {
  if (previous === null) rmSync(join(releasesRoot(home), 'current'), { force: true });
  else pointCurrent(home, previous);
}

// The release current names, or null.
export function currentRelease(home: string): string | null {
  try {
    return basename(readlinkSync(join(releasesRoot(home), 'current')));
  } catch {
    return null;
  }
}

export interface RunningProcess {
  exe: string | null; // the executable's real path (Linux's /proc/<pid>/exe), null when unreadable
  cmdline: string; // its arguments, joined by spaces
}

// Removes every release but current and the two installed most recently before it, keeping any a running process runs
// from. Returns the removed names, sorted.
export function pruneReleases(home: string, { processes = procProcesses }: { processes?: () => RunningProcess[] } = {}): string[] {
  const dir = join(releasesRoot(home), 'releases');
  if (!existsSync(dir)) return [];
  const current = currentRelease(home);
  const others = readdirSync(dir)
    .filter((name) => !name.startsWith('.') && name !== current)
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  const inUse = releasesInUse(dir, processes());
  const pruned = others.slice(KEEP_PREVIOUS).map(({ name }) => name).filter((name) => !inUse.has(name)).sort();
  for (const name of pruned) rmSync(join(dir, name), { recursive: true, force: true });
  return pruned;
}

// The releases under `dir` the processes run from: the one each executable lies under, and each named in a command line.
function releasesInUse(dir: string, running: RunningProcess[]): Set<string> {
  const roots = [...new Set([dir, realOr(dir)])].map((root) => `${root}${sep}`);
  const used = new Set<string>();
  const under = (path: string) => {
    for (const root of roots) if (path.startsWith(root)) used.add(path.slice(root.length).split(sep)[0]!);
  };
  for (const { exe, cmdline } of running) {
    if (exe !== null) under(exe);
    for (const root of roots) for (const [, name] of cmdline.matchAll(new RegExp(`${escape(root)}([^${escape(sep)}\\s]+)${escape(sep)}`, 'g'))) used.add(name!);
  }
  return used;
}

function procProcesses(): RunningProcess[] {
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return []; // no /proc: not Linux
  }
  const running: RunningProcess[] = [];
  for (const pid of pids) {
    let cmdline: string;
    try {
      cmdline = readFileSync(join('/proc', pid, 'cmdline'), 'utf8').replace(/\0/g, ' ');
    } catch {
      continue; // gone
    }
    let exe: string | null = null;
    try {
      exe = readlinkSync(join('/proc', pid, 'exe')).replace(/ \(deleted\)$/, '');
    } catch {
      // another user's, or a kernel thread
    }
    running.push({ exe, cmdline });
  }
  return running;
}

function pointCurrent(home: string, release: string): void {
  const base = releasesRoot(home);
  const temporary = join(base, `.current.${process.pid}`);
  rmSync(temporary, { force: true });
  symlinkSync(join('releases', release), temporary);
  renameSync(temporary, join(base, 'current')); // atomic: current names one release or the other, never nothing
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// A staged copy an interrupted install left behind.
function sweepStaging(dir: string): void {
  for (const name of readdirSync(dir)) if (/^\..+\.\d+\.staged$/.test(name)) rmSync(join(dir, name), { recursive: true, force: true });
}
