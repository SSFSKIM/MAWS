// Engine artifacts read on demand (C4 execution document, M3; charter §4.3 "spilled results are loaded by the path the
// engine reports, never by a derived name"): spilled tool results (`tool.result.spillPath`), task outputs
// (`task.notification.outputFile`) and workflow scripts, read lazily, on click, through `fs.readSpill`. Only a path whose
// realpath lies under `<configHome>/projects/`, `tasks/` or `jobs/`, or under the engine's task-output root
// (`<CLAUDE_CODE_TMPDIR or /tmp>/claude-<uid>`, SPEC 20; C8's ask), is read, so the renderer cannot turn the command
// into a general file reader; a symlink is judged by its target. Reads are bounded. Read-only: flag 'r' only.
import { open, realpath } from 'node:fs/promises';
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
    const want = Math.max(0, Math.min(length, info.size - offset));
    const buffer = Buffer.alloc(want);
    let filled = 0;
    while (filled < want) {
      const { bytesRead } = await file.read(buffer, filled, want - filled, offset + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { content: buffer.subarray(0, filled).toString('utf8'), bytes: info.size, offset, truncated: offset + filled < info.size };
  } finally {
    await file.close();
  }
}

function within(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path.startsWith(root + sep));
}
