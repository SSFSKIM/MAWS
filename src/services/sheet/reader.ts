// Reading the question sheet's records on the machine that holds them (docs/doperpowers/plans/
// 2026-11-23-question-sheet-c3-maws-app.md §C; C2's I1 and I4, step 1): which sessions under a sminos home have a
// record, and each record's model, read as one verified pair of `state.json` and the inbox's tail. A reader takes no
// lock and writes nothing; it reads only `<home>/sheet/<session>`, a real directory named by a session id.
import { constants } from 'node:fs';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SheetStateSchema, isSheetSession, type SheetModel, type SheetState, type StoredReference } from '@shared/sheet/model';
import { modelOf } from '@shared/sheet/read';

export const sheetRoot = (home: string): string => join(home, 'sheet');

const codeOf = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
// Why a file of the record could not be read, naming no path: a system error by its code, any other by its message.
const whyOf = (error: unknown): string => {
  const code = codeOf(error);
  return typeof code === 'string' ? code : (error as Error).message;
};

/** The session ids with a record under a home: every real directory of the sheet's root, named by one, that holds a `state.json`. */
export async function listRecords(home: string): Promise<string[]> {
  const root = sheetRoot(home);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR') return [];
    throw error;
  }
  const out: string[] = [];
  // `surfaces`, `.staging` and the `<session>.lock` files (I1) are no session id; a link is no real directory.
  for (const entry of entries) {
    if (!isSheetSession(entry.name) || !entry.isDirectory()) continue;
    if ((await recordIo.entry(join(root, entry.name, 'state.json'))) !== null) out.push(entry.name);
  }
  return out.sort();
}

/** The file system as a reader touches it; a test moves a record under the reader through it. */
export interface RecordIo {
  /** What `lstat` finds at a path, or null when nothing is there. */
  entry(path: string): Promise<'directory' | 'file' | 'other' | null>;
  /** A `state.json` parsed; throws ENOENT when there is none, and refuses a path that is not a regular file. */
  readState(path: string): Promise<unknown>;
  /** An inbox's bytes from `offset` to its end; none when there is no inbox or it ends before the offset. */
  readTail(path: string, offset: number): Promise<Uint8Array>;
  /** A file's size and its modification time floored to a millisecond, following links; null when it cannot be read. */
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
}

// A file of the record opened as itself: never through a link at its last component, never blocking on a special file.
async function openRegular(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const st = await handle.stat();
  if (!st.isFile()) {
    await handle.close();
    throw new Error('not a regular file');
  }
  return { handle, size: st.size };
}

// Nanoseconds floored to a millisecond: the float `mtimeMs` rounds the other way on some values.
const floorMs = (ns: bigint): number => Number(ns / 1_000_000n - (ns < 0n && ns % 1_000_000n !== 0n ? 1n : 0n));

export const recordIo: RecordIo = {
  async entry(path) {
    try {
      const st = await lstat(path);
      return st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
    } catch {
      return null;
    }
  },
  async readState(path) {
    const { handle } = await openRegular(path);
    try {
      return JSON.parse(await handle.readFile('utf8'));
    } finally {
      await handle.close();
    }
  },
  async readTail(path, offset) {
    let opened;
    try {
      opened = await openRegular(path);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return new Uint8Array();
      throw error;
    }
    const { handle, size } = opened;
    try {
      const out = new Uint8Array(Math.max(0, size - offset));
      let done = 0;
      while (done < out.length) {
        const { bytesRead } = await handle.read(out, done, out.length - done, offset + done);
        if (bytesRead === 0) break; // the file was cut back while it was read
        done += bytesRead;
      }
      return out.subarray(0, done);
    } finally {
      await handle.close();
    }
  },
  async stat(path) {
    try {
      const st = await stat(path, { bigint: true });
      return { size: Number(st.size), mtimeMs: floorMs(st.mtimeNs) };
    } catch {
      return null;
    }
  },
};

type Read = { state: SheetState } | { unreadable: string } | null;

async function readState(io: RecordIo, path: string): Promise<Read> {
  let raw: unknown;
  try {
    raw = await io.readState(path);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    return { unreadable: `state.json could not be read: ${whyOf(error)}` };
  }
  const v = (raw as { v?: unknown } | null)?.v;
  if (v !== 1) return { unreadable: `state.json is of version ${JSON.stringify(v)}, and this build reads version 1` };
  const parsed = SheetStateSchema.safeParse(raw);
  return parsed.success ? { state: parsed.data } : { unreadable: `state.json is not a record this build reads: ${parsed.error.issues[0]?.message ?? 'invalid'}` };
}

/**
 * A record's model, read as C2's I4 step 1 reads it: `state.json`, the inbox from its offset, `state.json` again, over
 * while `seq` moved, at most four times; when it moved every time, `busy`, and no pair that was not verified. Null
 * when the session has no record here, and for a name that is not a session id, before any path is made from it.
 */
export async function readRecord(
  home: string,
  session: string,
  io: RecordIo = recordIo,
): Promise<{ model: SheetModel } | { unreadable: string } | { busy: true } | null> {
  if (!isSheetSession(session)) return null;
  const record = join(sheetRoot(home), session);
  if ((await io.entry(record)) !== 'directory') return null;
  const statePath = join(record, 'state.json');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const first = await readState(io, statePath);
    if (first === null || 'unreadable' in first) return first;
    let tail: Uint8Array;
    try {
      tail = await io.readTail(join(record, 'inbox.jsonl'), first.state.inbox.offset);
    } catch (error) {
      return { unreadable: `inbox.jsonl could not be read: ${whyOf(error)}` };
    }
    const second = await readState(io, statePath);
    if (second === null || 'unreadable' in second) return second;
    if (second.state.seq === first.state.seq) return { model: modelOf(second.state, tail, await changesOf(io, second.state)) };
  }
  return { busy: true };
}

// Whether each reference's file differs from the one captured, by its size and modification time; a missing file has.
async function changesOf(io: RecordIo, state: SheetState): Promise<(reference: StoredReference) => boolean> {
  const files = new Map<string, { size: number; mtimeMs: number } | null>();
  for (const question of state.questions) {
    for (const reference of question.references) if (!files.has(reference.abs)) files.set(reference.abs, await io.stat(reference.abs));
  }
  return (reference) => {
    const now = files.get(reference.abs) ?? null;
    return now === null || now.size !== reference.size || now.mtimeMs !== reference.mtimeMs;
  };
}
