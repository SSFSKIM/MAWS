// The daemon's last log lines for the repair window (P5 O15 M2, docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md,
// Interfaces §B): the last LOG_LINES lines of `<profile>/mawsd/mawsd.log`, each cut at LOG_LINE_CHARS characters; of
// `mawsd.out` (the unit's standard output and error, what `mawsd` prints before its log opens) when the log has none;
// null when neither has any. Only the file's end and the heads of its last lines are read: the log runs to 8 MiB
// before it rotates.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON_FILES, type DaemonPaths } from '@shared/daemon/files';
import type { RepairState } from '@shared/repair';

export const LOG_LINES = 20;
export const LOG_LINE_CHARS = 300;
const CHUNK_BYTES = 64 * 1024; // the file is read back from its end in steps of this size
const LINE_HEAD_BYTES = LOG_LINE_CHARS * 4; // enough UTF-8 for LOG_LINE_CHARS characters of any line

// Best-effort (fix wave 1): any failure on a file (absent, unreadable, a directory, a read that fails) counts as a file
// with no lines, so the repair window always shows, with whatever log there is.
export function readLogTail(paths: DaemonPaths): RepairState['log'] {
  for (const name of [DAEMON_FILES.log, DAEMON_FILES.out]) {
    const path = join(paths.dir, name);
    const lines = lastLines(path);
    if (lines.length > 0) return { path, lines };
  }
  return null;
}

function lastLines(path: string): string[] {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    return tailOf(fd);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // nothing to keep of a close that failed
      }
    }
  }
}

// The file's last LOG_LINES lines that are not blank, oldest first, each its first LOG_LINE_CHARS characters. The file is
// scanned back from its end for line breaks, and only each line's head is read, so a line of any length shows its
// start and nothing more than a chunk and the heads is ever held.
function tailOf(fd: number): string[] {
  const size = fstatSync(fd).size;
  const lines: string[] = [];
  const take = (start: number, end: number) => {
    const length = Math.min(end - start, LINE_HEAD_BYTES);
    const head = Buffer.alloc(length);
    readSync(fd, head, 0, length, start);
    const text = head.toString('utf8');
    if (end - start > LINE_HEAD_BYTES || text.trim() !== '') lines.unshift(text.slice(0, LOG_LINE_CHARS));
  };
  let lineEnd = size;
  const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size));
  for (let at = size; at > 0 && lines.length < LOG_LINES; ) {
    const from = Math.max(0, at - CHUNK_BYTES);
    const length = at - from;
    readSync(fd, chunk, 0, length, from);
    for (let i = length - 1; i >= 0 && lines.length < LOG_LINES; i -= 1) {
      if (chunk[i] !== 0x0a) continue;
      take(from + i + 1, lineEnd);
      lineEnd = from + i;
    }
    at = from;
  }
  if (lines.length < LOG_LINES && lineEnd > 0) take(0, lineEnd); // the file's first line, which no break begins
  return lines;
}
