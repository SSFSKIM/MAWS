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
const isAbsence = (error: unknown): boolean => codeOf(error) === 'ENOENT' || codeOf(error) === 'ENOTDIR';

/**
 * Why a record reads `unreadable`: each a fixed sentence, which names no path and echoes nothing of the record, since
 * a window may show it.
 */
export const UNREADABLE = {
  record: 'The record’s directory could not be read.',
  notFile: 'A file of the record is a link or not a regular file.',
  state: 'The record’s state could not be read.',
  utf8: 'The record’s state is not UTF-8.',
  json: 'The record’s state is not JSON.',
  version: 'The record’s state is of a version this build does not read.',
  schema: 'The record’s state is not one this build reads.',
  session: 'The record’s state names another session.',
  inbox: 'The record’s inbox could not be read.',
} as const;
export type UnreadableReason = (typeof UNREADABLE)[keyof typeof UNREADABLE];

/** What the file-system io throws for a file of the record it will not read, with the sentence that says why. */
export class UnreadableFile extends Error {
  constructor(readonly reason: UnreadableReason) {
    super(reason);
  }
}

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
    // A state that cannot be looked at is listed: reading it then says the record is unreadable, not gone.
    const state = await recordIo.entry(join(root, entry.name, 'state.json')).catch(() => 'other' as const);
    if (state !== null) out.push(entry.name);
  }
  return out.sort();
}

/** The file system as a reader touches it; a test moves a record under the reader through it. */
export interface RecordIo {
  /** What `lstat` finds at a path; null only when nothing is there (ENOENT, ENOTDIR), and it throws on any other failure. */
  entry(path: string): Promise<'directory' | 'file' | 'other' | null>;
  /** A `state.json` decoded as UTF-8 and parsed; throws ENOENT when there is none, and `UnreadableFile` for a link, a
   * file that is not regular, bytes that are not UTF-8 and text that is not JSON. */
  readState(path: string): Promise<unknown>;
  /** An inbox's bytes from `offset` to its end; none when there is no inbox or it ends before the offset. */
  readTail(path: string, offset: number): Promise<Uint8Array>;
  /** A file's size and its modification time floored to a millisecond, following links; null when it cannot be read. */
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
}

// A file of the record opened as itself: never through a link at its last component, never blocking on a special file.
async function openRegular(path: string) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw codeOf(error) === 'ELOOP' ? new UnreadableFile(UNREADABLE.notFile) : error;
  }
  const st = await handle.stat();
  if (!st.isFile()) {
    await handle.close();
    throw new UnreadableFile(UNREADABLE.notFile);
  }
  return { handle, size: st.size };
}

// The record's text as sminos's reader decodes it: invalid bytes refused, a byte order mark kept (and so not JSON).
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Nanoseconds floored to a millisecond: the float `mtimeMs` rounds the other way on some values.
const floorMs = (ns: bigint): number => Number(ns / 1_000_000n - (ns < 0n && ns % 1_000_000n !== 0n ? 1n : 0n));

export const recordIo: RecordIo = {
  async entry(path) {
    try {
      const st = await lstat(path);
      return st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
    } catch (error) {
      if (isAbsence(error)) return null;
      throw error;
    }
  },
  async readState(path) {
    const { handle } = await openRegular(path);
    let text: string;
    try {
      text = strictUtf8.decode(await handle.readFile());
    } catch (error) {
      throw error instanceof TypeError ? new UnreadableFile(UNREADABLE.utf8) : error;
    } finally {
      await handle.close();
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new UnreadableFile(UNREADABLE.json);
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

type Read = { state: SheetState } | { unreadable: UnreadableReason } | null;

const reasonOf = (error: unknown, otherwise: UnreadableReason): UnreadableReason => (error instanceof UnreadableFile ? error.reason : otherwise);

// One read of a record's state: null when it is gone; unreadable when it is not a state of version 1 that this build
// reads, or names another session than the directory's.
async function readState(io: RecordIo, path: string, session: string): Promise<Read> {
  let raw: unknown;
  try {
    raw = await io.readState(path);
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return null;
    return { unreadable: reasonOf(error, UNREADABLE.state) };
  }
  if ((raw as { v?: unknown } | null)?.v !== 1) return { unreadable: UNREADABLE.version };
  const parsed = SheetStateSchema.safeParse(raw);
  if (!parsed.success) return { unreadable: UNREADABLE.schema };
  return parsed.data.session === session ? { state: parsed.data } : { unreadable: UNREADABLE.session };
}

/**
 * A record's model, read as C2's I4 step 1 reads it: `state.json`, the inbox from its offset, `state.json` again, over
 * while `seq` moved, at most four times; when it moved every time, `busy`, and no pair that was not verified. Null
 * when the session has no record here, and for a name that is not a session id, before any path is made from it; a
 * record that is there and cannot be read is `unreadable`, with one of `UNREADABLE`'s sentences, never gone.
 */
export async function readRecord(
  home: string,
  session: string,
  io: RecordIo = recordIo,
): Promise<{ model: SheetModel } | { unreadable: UnreadableReason } | { busy: true } | null> {
  if (!isSheetSession(session)) return null;
  const record = join(sheetRoot(home), session);
  let kind;
  try {
    kind = await io.entry(record);
  } catch {
    return { unreadable: UNREADABLE.record };
  }
  if (kind !== 'directory') return null;
  const statePath = join(record, 'state.json');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const first = await readState(io, statePath, session);
    if (first === null || 'unreadable' in first) return first;
    let tail: Uint8Array;
    try {
      tail = await io.readTail(join(record, 'inbox.jsonl'), first.state.inbox.offset);
    } catch (error) {
      return { unreadable: reasonOf(error, UNREADABLE.inbox) };
    }
    const second = await readState(io, statePath, session);
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
