// The folder a stored statement was made on (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §D; its
// design §2, Decision Log 3): its device, inode and birth time, read with a 64-bit `stat` (a float loses the last
// digits), and the comparison both runtimes make. A reader compares the device and the inode exactly, and the birth
// time only where both sides have one, equal within a microsecond: Python reads it as a float of seconds, which differs
// from Node's nanoseconds in the last digits for one folder, and Python on Linux has none at all.
import { statSync } from 'node:fs';
import type { Anchor } from '@shared/machine/registry';

/** A folder as one runtime reads it: Node gives `birthNs`, Python `birthSeconds`, a platform with no birth time neither. */
export type FolderReading = { dev: string; ino: string; birthNs?: string; birthSeconds?: number };

const BIRTH_SLACK_NS = 1_000n;

type BigStat = { dev: bigint; ino: bigint; birthtimeNs: bigint; ctimeNs: bigint };

/**
 * The anchor of a folder's 64-bit stat. `birth` is "0" where the filesystem reports none: on Linux libuv gives 0 where
 * `statx` has no birth time and, where it falls back to `stat`, the change time in its place, so a birth time equal to the
 * change time reads as none there (the weaker check, by device and inode, never the stronger one on a wrong value).
 */
export function anchorOf(stat: BigStat, platform: NodeJS.Platform = process.platform): Anchor {
  const none = stat.birthtimeNs <= 0n || (platform === 'linux' && stat.birthtimeNs === stat.ctimeNs);
  return { dev: String(stat.dev), ino: String(stat.ino), birth: none ? '0' : String(stat.birthtimeNs) };
}

function statOf(path: string): BigStat | null {
  try {
    const stat = statSync(path, { bigint: true, throwIfNoEntry: false });
    return stat?.isDirectory() ? stat : null;
  } catch {
    return null; // a path that cannot be read: no folder to anchor
  }
}

/** The anchor of the folder at `path` (a link followed); null when there is no folder there. */
export function readAnchor(path: string): Anchor | null {
  const stat = statOf(path);
  return stat === null ? null : anchorOf(stat);
}

/** The folder at `path` as this runtime reads it; null when there is none. */
export function readFolder(path: string): FolderReading | null {
  const anchor = readAnchor(path);
  return anchor === null ? null : { dev: anchor.dev, ino: anchor.ino, birthNs: anchor.birth };
}

// Python's float of seconds as nanoseconds: the whole seconds exactly, the fraction rounded to the nanosecond.
function secondsNs(seconds: number): bigint {
  const whole = Math.floor(seconds);
  return BigInt(whole) * 1_000_000_000n + BigInt(Math.round((seconds - whole) * 1e9));
}

/** Whether the folder read is the one anchored (§D). */
export function sameFolder(anchor: Anchor, reading: FolderReading): boolean {
  if (anchor.dev !== reading.dev || anchor.ino !== reading.ino) return false;
  const anchored = BigInt(anchor.birth);
  const read = reading.birthNs !== undefined ? BigInt(reading.birthNs) : reading.birthSeconds !== undefined ? secondsNs(reading.birthSeconds) : 0n;
  if (anchored === 0n || read === 0n) return true;
  const apart = anchored > read ? anchored - read : read - anchored;
  return apart <= BIRTH_SLACK_NS;
}
