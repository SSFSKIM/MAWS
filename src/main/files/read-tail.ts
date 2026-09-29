// The last `bytes` of a file another program appends to (ClaudeUsage's history, the terminal's `history.jsonl`), read
// through a read-only handle that takes no lock (C7 execution document, M1 decisions). When the read starts mid-file the
// partial first line is dropped; a torn last line is the caller's to skip. Null when the file does not exist.
import { open as openFile, type FileHandle } from 'node:fs/promises';

export type OpenFile = (path: string, flags: string) => Promise<FileHandle>;

export async function readTail(path: string, bytes: number, open: OpenFile = openFile): Promise<string | null> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    // one byte before the tail too, so a tail that starts exactly on a line keeps it: the partial line is what precedes
    // the first newline of the read, and when that byte is itself the newline there is none
    const start = Math.max(0, size - bytes - 1);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
  } finally {
    await handle.close();
  }
}

// One JSON value per non-empty line; a line that does not parse (torn, or cut by the tail) is skipped.
export function jsonLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn or partial line */
    }
  }
  return out;
}
