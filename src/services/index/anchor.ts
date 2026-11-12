// The folder a stored statement was made on (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §D; its
// design §2, Decision Log 3): its device, inode and birth time, read with a 64-bit `stat` (a float loses the last
// digits), and the comparison both runtimes make. A reader compares the device and the inode exactly, and the birth
// time only where both sides have one, equal within a microsecond: Python reads it as a float of seconds, which differs
// from Node's nanoseconds in the last digits for one folder, and Python on Linux has none at all.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Anchor } from '@shared/machine/registry';

/** A folder as one runtime reads it: Node gives `birthNs`, Python `birthSeconds`, a platform with no birth time neither. */
export type FolderReading = { dev: string; ino: string; birthNs?: string; birthSeconds?: number };

const BIRTH_SLACK_NS = 1_000n;

type BigStat = { dev: bigint; ino: bigint; birthtimeNs: bigint; ctimeNs: bigint };
type Times = Pick<BigStat, 'birthtimeNs' | 'ctimeNs'>;

const tick = new Int32Array(new SharedArrayBuffer(4));

/**
 * Whether this process's birth times are libuv's change-time fallback: on Linux, where `statx` is not there, libuv falls
 * back to `stat` and reports each change time as the birth time (with `statx` and no birth time it reports 0). One folder
 * read twice around a change of its change time tells: a birth time that moved with it is the change time. A change time
 * that never moves (a clock too coarse for the probe's bound) leaves it untold, read as the fallback: the weaker check,
 * never a wrong value.
 */
export function birthFollowsChange(read: (path: string) => Times = (path) => statSync(path, { bigint: true })): boolean {
  const folder = mkdtempSync(join(tmpdir(), 'maws-birth-'));
  try {
    const before = read(folder);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const entry = join(folder, 'entry');
      writeFileSync(entry, '');
      rmSync(entry);
      const after = read(folder);
      if (after.ctimeNs !== before.ctimeNs) return after.birthtimeNs !== before.birthtimeNs;
      Atomics.wait(tick, 0, 0, 5); // past the filesystem clock's tick
    }
    return true;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

let probed: boolean | undefined;
const birthIsChange = (): boolean => (probed ??= birthFollowsChange());

/** The anchor of a folder's 64-bit stat. `birth` is "0" where there is no birth time: none reported, or this process's are change times. */
export function anchorOf(stat: BigStat, birthFromChange: boolean = birthIsChange()): Anchor {
  const none = birthFromChange || stat.birthtimeNs <= 0n;
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
