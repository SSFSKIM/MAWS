// The Linux release directory (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The unit's program path
// from a checkout", residue 21): the canonical unit never runs code from a working checkout, so `mawsd install` copies
// the pack it runs from (`pnpm mawsd:pack`'s `dist/mawsd/<version>-<commit>/`) into
// `~/.local/share/maws/mawsd/releases/<version>-<commit>/`, points `current` at it, and the unit runs `current`'s runtime
// and entry. The two releases installed before the current one are kept (a rollback is `mawsd install` run from one of
// them); older ones are pruned.
//
// A running daemon is unaffected by a flip: Node runs the real path of its entry and `process.execPath` is the real
// runtime, so it and the hosts it spawned keep their release's files until the unit restarts it (install.ts).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { UnitError, type UnitProgram } from './units/unit';

const RELEASE_NAME = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/; // `<version>-<commit>`: one path segment
const KEEP_PREVIOUS = 2;

export const releasesRoot = (home: string): string => join(home, '.local', 'share', 'maws', 'mawsd');

// The program the canonical Linux unit runs: current's runtime and entry.
export function releaseProgram(home: string): UnitProgram {
  const current = join(releasesRoot(home), 'current');
  return { runtime: join(current, 'runtime', 'bin', 'node'), entry: join(current, 'out', 'main', 'mawsd.js') };
}

export interface Pack {
  root: string; // the directory holding out/, node_modules/, package.json and, on Linux, runtime/
  release: string; // `<version>-<commit>`, the name it installs under
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

export interface InstalledRelease {
  release: string;
  previous: string | null; // the release current named before, if any
  flipped: boolean; // current now names another release than before
  pruned: string[];
}

// Copies `pack` into releases/<release> (unless it is that directory), flips current to it, marks it the most recently
// installed, and prunes all but the two previous releases. A copy is staged beside its target and renamed into place.
export function installRelease(pack: Pack, home: string, now: () => number = Date.now): InstalledRelease {
  if (!pack.runtime) throw new UnitError(`the release ${pack.release} at ${pack.root} has no runtime/bin/node (pnpm mawsd:pack adds it on Linux)`);
  const base = releasesRoot(home);
  const dir = join(base, 'releases');
  const target = join(dir, pack.release);
  mkdirSync(dir, { recursive: true });
  sweepStaging(dir);

  if (!sameDirectory(pack.root, target)) {
    const staged = join(dir, `.${pack.release}.${process.pid}.staged`);
    cpSync(pack.root, staged, { recursive: true, verbatimSymlinks: true });
    if (existsSync(target)) {
      const old = join(dir, `.${pack.release}.${process.pid}.old`);
      renameSync(target, old);
      renameSync(staged, target);
      rmSync(old, { recursive: true, force: true });
    } else {
      renameSync(staged, target);
    }
  }
  const stamp = new Date(now());
  utimesSync(target, stamp, stamp);

  const link = join(base, 'current');
  const previous = releaseOf(link);
  const flipped = previous !== pack.release;
  if (flipped) {
    const temporary = join(base, `.current.${process.pid}`);
    rmSync(temporary, { force: true });
    symlinkSync(join('releases', pack.release), temporary);
    renameSync(temporary, link); // atomic: current names the old release or the new one, never nothing
  }

  const others = readdirSync(dir)
    .filter((name) => !name.startsWith('.') && name !== pack.release)
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  const pruned = others.slice(KEEP_PREVIOUS).map(({ name }) => name);
  for (const name of pruned) rmSync(join(dir, name), { recursive: true, force: true });
  return { release: pack.release, previous, flipped, pruned };
}

// The release `link` names (`releases/<release>`), or null when there is no link.
function releaseOf(link: string): string | null {
  try {
    return basename(readlinkSync(link));
  } catch {
    return null;
  }
}

function sameDirectory(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

// A staged copy or a replaced release an interrupted install left behind.
function sweepStaging(dir: string): void {
  for (const name of readdirSync(dir)) if (/^\..+\.\d+\.(staged|old)$/.test(name)) rmSync(join(dir, name), { recursive: true, force: true });
}
