// Engine artifacts read on demand (C4 execution document, M3; charter §4.3 "spilled results are loaded by the path the
// engine reports, never by a derived name"): spilled tool results (`tool.result.spillPath`), task outputs
// (`task.notification.outputFile`) and workflow scripts, read lazily, on click, through `fs.readSpill`. Only a path whose
// realpath lies under `<configHome>/projects/`, `tasks/` or `jobs/`, or under the engine's task-output root
// (`<CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>`, SPEC 20; C8's ask), is read, so the renderer cannot turn the command
// into a general file reader; a symlink is judged by its target. Reads are bounded. Read-only: flag 'r' only.
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import type { FsReadSpillInput, FsReadSpillOutput } from '@shared/ipc/schema/fs';
import type { StorePaths } from './paths';
import { isMissing } from './sidecars';

export const SPILL_DEFAULT_LENGTH = 1024 * 1024;
const OUTSIDE = 'path outside the engine store';

export async function readSpill(paths: StorePaths, { path, offset = 0, length = SPILL_DEFAULT_LENGTH }: FsReadSpillInput): Promise<FsReadSpillOutput> {
  if (!isAbsolute(path)) throw new Error(OUTSIDE);
  const lexicalRoots = [paths.projects, paths.tasks, paths.jobs, paths.taskOutput].map((root) => resolve(root));
  const roots = [...lexicalRoots, ...(await Promise.all(lexicalRoots.map((root) => realpath(root).catch(() => null)))).filter((root) => root !== null)];
  let real: string;
  try {
    real = await realpath(path);
  } catch (error) {
    // A path that does not exist is refused as outside unless it would lie inside, so the command says nothing about
    // what exists elsewhere on disk.
    if (isMissing(error)) throw new Error(within(resolve(path), roots) ? `spill not found: ${path}` : OUTSIDE, { cause: error });
    throw error;
  }
  if (!within(real, roots)) throw new Error(OUTSIDE);

  const file = await open(real, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error(`not a file: ${path}`);
    let page = await readFully(file, Math.max(0, Math.min(length, info.size - offset)), offset);
    // A page ends on a UTF-8 character boundary unless it reaches the file's end, so a character cut by the requested
    // length is decoded whole on the next page instead of as U+FFFD on both. A page too short to hold the character it
    // cuts reads forward (at most three bytes) to finish it instead: an empty page would never advance a pager.
    if (offset + page.length < info.size) {
      const cut = utf8Cut(page);
      if (cut.end > 0 || cut.missing === 0) page = page.subarray(0, cut.end);
      else page = Buffer.concat([page, await readFully(file, Math.min(cut.missing, info.size - offset - page.length), offset + page.length)]);
    }
    return { content: page.toString('utf8'), bytes: info.size, offset, length: page.length, truncated: offset + page.length < info.size };
  } finally {
    await file.close();
  }
}

async function readFully(file: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await file.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

// Where `page` must end so it does not end inside a UTF-8 sequence, and how many bytes that last sequence lacks (0 when
// the page ends on a boundary). Bytes that are not valid UTF-8 are left as they are.
function utf8Cut(page: Buffer): { end: number; missing: number } {
  const whole = { end: page.length, missing: 0 };
  let start = page.length - 1;
  while (start >= 0 && page.length - start <= 4 && (page[start] & 0xc0) === 0x80) start--; // back over continuation bytes
  if (start < 0 || page.length - start > 4) return whole;
  const lead = page[start];
  const size = lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 0;
  if (size === 0 || start + size <= page.length) return whole; // complete, or not a sequence at all
  return { end: start, missing: start + size - page.length };
}

function within(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path.startsWith(root + sep));
}
