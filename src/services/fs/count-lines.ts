// The added-line count of one new file, for `git.changesSince`'s `untracked` (UX wave U5b-2,
// docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, Interfaces §C and decision 15): read by the
// service through the boundary the files service reads by (../files/service.ts, its opening comment), open first and
// judge after, never check and then open:
//
// 1. the path is the repository's real root joined with the status's path, and nothing else names it;
// 2. it is opened read-only and non-blocking with no link on the way (./no-link.ts: `NO_LINK`; on Linux the ancestors
//    walked first and the opened descriptor confirmed). Where an open is not held to its path (`OPENS_CONFIRMED`
//    false) nothing is opened and the count is null;
// 3. an open refused for a link is not followed: the entry counts 1 only when an `lstat` says its last component is a
//    symbolic link (its diff is one line, the target's path), and its target is never opened; any other refusal is a
//    null count;
// 4. the type is judged on the descriptor: a regular file, else a null count;
// 5. the bytes are read from the descriptor, at most `cap + 1` of them whatever size the file had when it was opened:
//    a file that holds more has a null count. A NUL in the first 8,000 bytes read makes it binary with a null count;
//    otherwise the count is its lines as `git diff --numstat` counts an added file.
//
// No byte of the file leaves this function: it answers a count.
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { confirmOpened, LinkOnTheWay, NO_LINK, OPENS_CONFIRMED, walk, WALKED } from './no-link';

const { O_RDONLY, O_NONBLOCK } = constants;
const FLAGS = O_RDONLY | O_NONBLOCK | NO_LINK;
const BINARY_PROBE_BYTES = 8000; // git's FIRST_FEW_BYTES: a NUL among them makes a file binary
const CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

export interface AddedLines {
  insertions: number | null;
  binary: boolean;
  bytesRead: number; // what was read from the file, never more than the cap and one byte (the tests' witness)
}

// Test-only: awaited between the listing and the open, and between the open and the first read, so a test can replace
// the path or grow the file there. Not reachable from a command.
export interface CountHooks {
  beforeOpen?(path: string): Promise<void> | void;
  afterOpen?(path: string): Promise<void> | void;
}

const NOT_COUNTED: AddedLines = { insertions: null, binary: false, bytesRead: 0 };

// `realRoot` is the repository's top level as a realpath (an open with no link on the way refuses any other spelling);
// `path` is relative to it, as the status listed it.
export async function countAddedLines(realRoot: string, path: string, capBytes: number, hooks: CountHooks = {}): Promise<AddedLines> {
  if (!OPENS_CONFIRMED) return NOT_COUNTED;
  const full = join(realRoot, path);
  await hooks.beforeOpen?.(full);
  let handle: FileHandle;
  try {
    handle = await openNoLink(full);
  } catch (error) {
    if (!refusedForLink(error)) return NOT_COUNTED;
    const stat = await lstat(full).catch(() => null);
    return stat?.isSymbolicLink() ? { insertions: 1, binary: false, bytesRead: 0 } : NOT_COUNTED;
  }
  try {
    await hooks.afterOpen?.(full);
    if (!(await handle.stat()).isFile()) return NOT_COUNTED;
    return await countFrom(handle, capBytes);
  } finally {
    await handle.close();
  }
}

// The one open: on Linux the ancestors walked first and the descriptor's own path confirmed after, closed on a refusal.
async function openNoLink(full: string): Promise<FileHandle> {
  if (WALKED) await walk(dirname(full));
  const handle = await open(full, FLAGS);
  try {
    await confirmOpened(handle.fd, full);
  } catch (error) {
    await handle.close();
    throw error;
  }
  return handle;
}

// ELOOP is how the kernel refuses a link on the way (macOS's O_NOFOLLOW_ANY anywhere, Linux's O_NOFOLLOW last), and how
// the walk and the descriptor's confirmation code theirs.
function refusedForLink(error: unknown): boolean {
  return error instanceof LinkOnTheWay || (error as NodeJS.ErrnoException | null)?.code === 'ELOOP';
}

async function countFrom(handle: FileHandle, capBytes: number): Promise<AddedLines> {
  const limit = capBytes + 1;
  const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, limit));
  let total = 0;
  let newlines = 0;
  let last = -1;
  while (total < limit) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, limit - total), null);
    if (bytesRead === 0) break;
    const probe = Math.min(bytesRead, Math.max(0, BINARY_PROBE_BYTES - total));
    if (probe > 0 && chunk.subarray(0, probe).includes(0)) return { insertions: null, binary: true, bytesRead: total + bytesRead };
    for (let at = chunk.indexOf(NEWLINE, 0); at !== -1 && at < bytesRead; at = chunk.indexOf(NEWLINE, at + 1)) newlines++;
    last = chunk[bytesRead - 1];
    total += bytesRead;
  }
  if (total > capBytes) return { insertions: null, binary: false, bytesRead: total };
  return { insertions: total === 0 ? 0 : newlines + (last === NEWLINE ? 0 : 1), binary: false, bytesRead: total };
}
