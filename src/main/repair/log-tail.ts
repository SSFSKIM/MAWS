// The daemon's last log lines for the repair window (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md,
// Interfaces §B): the last LOG_LINES lines of `<profile>/mawsd/mawsd.log`, each cut at LOG_LINE_CHARS characters; of
// `mawsd.out` (the unit's standard output and error, what `mawsd` prints before its log opens) when the log has none;
// null when neither has any. Only the file's end is read: the log runs to 8 MiB before it rotates.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON_FILES, type DaemonPaths } from '@shared/daemon/files';
import type { RepairState } from '@shared/repair';

export const LOG_LINES = 20;
export const LOG_LINE_CHARS = 300;
const TAIL_BYTES = 256 * 1024; // far more than 20 lines of a daemon's log; a longer line is cut anyway

export function readLogTail(paths: DaemonPaths): RepairState['log'] {
  for (const name of [DAEMON_FILES.log, DAEMON_FILES.out]) {
    const path = join(paths.dir, name);
    const lines = lastLines(path);
    if (lines.length > 0) return { path, lines };
  }
  return null;
}

function lastLines(path: string): string[] {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return []; // absent or unreadable: none
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift(); // the first is a line's end, cut by the read
    return lines
      .filter((line) => line.trim() !== '')
      .slice(-LOG_LINES)
      .map((line) => line.slice(0, LOG_LINE_CHARS));
  } finally {
    closeSync(fd);
  }
}
