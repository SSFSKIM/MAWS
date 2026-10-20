// What a resumed process restored, read back from the session's transcript (tracker row 2026-09-29; digest.ts's cost
// ledger). At exit the engine records its running total as a `cost-state` record (`totalCostUSD`, under the session's
// `sessionId`), and a resumed process restores the last one recorded for its session (resume-fork-*, and
// p1-side-thread-live-resume: 0.0031984 recorded, the resume's first total 0.00593705 carrying it). Main reads it when the
// ledger cannot place a resume alone: the transcript's end is scanned backwards in chunks, through a read-only handle,
// for at most `bound` bytes, stopping at the first whole record found.
import { open as openFile, type FileHandle } from 'node:fs/promises';
import type { OpenFile } from '../files/read-tail';

export const RESTORED_COST_SCAN_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const MARK = Buffer.from('"cost-state"');
const NEWLINE = 0x0a;

// The last `cost-state` total recorded for `sessionId` in the transcript at `path`: 0 when the whole transcript holds
// none (nothing was restored), null when it cannot say (no such file, or none within the bound).
export async function readRestoredCost(path: string, sessionId: string, open: OpenFile = openFile, bound = RESTORED_COST_SCAN_BYTES, chunk = CHUNK_BYTES): Promise<number | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const floor = Math.max(0, size - bound);
    let end = size;
    let head = Buffer.alloc(0); // the start of a line whose beginning lies before `end`, carried to the next read
    while (end > floor) {
      const start = Math.max(floor, end - chunk);
      const read = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(read, 0, read.length, start);
      const buffer = Buffer.concat([read.subarray(0, bytesRead), head]);
      // whole lines only: what precedes the buffer's first newline may begin further back (unless the file starts here)
      const newline = buffer.indexOf(NEWLINE);
      const from = start === 0 ? 0 : newline === -1 ? buffer.length : newline + 1;
      const found = lastCostState(buffer, from, sessionId);
      if (found !== null) return found;
      head = buffer.subarray(0, from);
      end = start;
    }
    return floor === 0 ? 0 : null;
  } finally {
    await handle.close();
  }
}

// The last whole line at or after `from` that is a cost-state record of the session, by its total.
function lastCostState(buffer: Buffer, from: number, sessionId: string): number | null {
  let at = buffer.length;
  while (at > from) {
    const mark = buffer.lastIndexOf(MARK, at - 1);
    if (mark < from) return null;
    const start = buffer.lastIndexOf(NEWLINE, mark) + 1;
    const end = buffer.indexOf(NEWLINE, mark);
    const total = totalOf(buffer.toString('utf8', start, end === -1 ? buffer.length : end), sessionId);
    if (total !== null) return total;
    at = start;
  }
  return null;
}

// A line naming `"cost-state"` that is not such a record (a prompt quoting the word, a torn last line, another
// session's) is passed over.
function totalOf(line: string, sessionId: string): number | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (record === null || typeof record !== 'object') return null;
  const { type, sessionId: of, totalCostUSD } = record as Record<string, unknown>;
  return type === 'cost-state' && of === sessionId && typeof totalCostUSD === 'number' && Number.isFinite(totalCostUSD) && totalCostUSD >= 0 ? totalCostUSD : null;
}
