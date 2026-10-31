// An open that follows no link on its way (P5 O3-E M2 fix round 1;
// docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md): what lane A's upload walk (../lane-a/media.ts) and the files
// service (../files/service.ts) open through, now that both run in `mawsd` on Linux machines too. Node has no `openat`,
// so the guard is made per open:
//
// - macOS: the open carries `O_NOFOLLOW_ANY` (open(2), macOS 11), which fails it with ELOOP if any component of the
//   path is a link, atomically. Node does not name the bit; it replaces O_NOFOLLOW, since macOS answers EINVAL for the
//   two.
// - elsewhere (Linux), which ignores that bit: each directory from `/` down is `lstat`ed first (`walk`), the open
//   carries `O_NOFOLLOW` (the last component), and, where `/proc` is mounted, the opened descriptor's own path as the
//   kernel names it (`/proc/self/fd/<fd>`) must be the walked path (`confirmOpened`), so an ancestor turned into a link
//   between the walk and the open is refused at the open rather than followed. What remains: the open itself has
//   happened by then, so an open that creates (`O_CREAT`) through such an ancestor has made its empty file where the
//   link pointed before the refusal, and a path-based step after the open (a rename's, an unlink's own walk of its
//   ancestors) is not covered.
import { constants, existsSync, lstatSync, readlinkSync, type Stats } from 'node:fs';
import { lstat, readlink } from 'node:fs/promises';
import { join, sep } from 'node:path';

export const O_NOFOLLOW_ANY = 0x2000_0000;
const DARWIN = process.platform === 'darwin';
// The bits an open takes to follow no link: all of it on macOS, the last component elsewhere (with `walk` before it)
export const NO_LINK: number = DARWIN ? O_NOFOLLOW_ANY : constants.O_NOFOLLOW;
// The open alone does not refuse a link above the last component: `walk` the ancestors first
export const WALKED = !DARWIN;
const PROC_FD = WALKED && existsSync('/proc/self/fd');

// A component on the way that is a link or no directory (`part`, its name), or a descriptor opened somewhere other than
// the walked path; coded as the kernel codes a link the open refused.
export class LinkOnTheWay extends Error {
  readonly code = 'ELOOP';
  constructor(readonly part: string) {
    super(`${part} is a link or not a directory`);
  }
}

function* steps(dir: string): Generator<[at: string, part: string]> {
  let at: string = sep;
  for (const part of dir.split(sep).filter((p) => p !== '')) yield [(at = join(at, part)), part];
}
function check(stat: Stats | undefined, at: string, part: string): void {
  if (stat === undefined) throw Object.assign(new Error(`${at} is missing`), { code: 'ENOENT' });
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LinkOnTheWay(part);
}

// Every directory from `/` to `dir` (absolute, normal) a directory and none a link, as it stands now.
export function walkSync(dir: string): void {
  for (const [at, part] of steps(dir)) check(lstatSync(at, { throwIfNoEntry: false }), at, part);
}
export async function walk(dir: string): Promise<void> {
  for (const [at, part] of steps(dir)) check(await lstat(at).catch((error: unknown) => ((error as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : Promise.reject(error))), at, part);
}

// After a walked open: the descriptor names `path` itself (the caller closes it on a throw).
export function confirmOpenedSync(fd: number, path: string): void {
  if (PROC_FD && readlinkSync(`/proc/self/fd/${fd}`) !== path) throw new LinkOnTheWay(path);
}
export async function confirmOpened(fd: number, path: string): Promise<void> {
  if (PROC_FD && (await readlink(`/proc/self/fd/${fd}`)) !== path) throw new LinkOnTheWay(path);
}
