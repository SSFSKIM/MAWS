// Discovery (C4 execution document, M2; charter §4.3): which sessions exist under `<configHome>/projects/` and what
// their heads and tails say, without parsing whole files. A session id maps to its files by listing
// (`projects/*/<sessionId>.jsonl`), never from a cwd string; the session's directory comes from its first record.
// Read-only: files are opened with flag 'r' only.
import { open, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as z from 'zod';
import type { SessionId } from '@shared/graph/ids';
import type { TranscriptSummary } from '@shared/wire/store';
import type { StorePaths } from './paths';
import { isMissing, noteReadable, noteUnreadable, readJsonWithRetry } from './sidecars';
import { HEAD_TAIL_BYTES, headCwd, lineCwd, summarize } from './summarize';
import { SESSION_ID } from './watcher';

export interface ListedTranscript {
  sessionId: SessionId;
  slug: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export const SUMMARY_CONCURRENCY = 16;
// How far from a transcript's start discovery looks for its first folder when the head window names none (a head of
// file-history snapshots: seen 2026-11-23, a 620 MB transcript's first `cwd` at byte 473,059), in all; it reads in
// chunks of SCAN_CHUNK_BYTES through one buffer, and of each line looks only at its first LINE_START_BYTES, where a
// record's own keys sit, so a scan holds at most a chunk and a line's start however long the lines are.
export const LAUNCH_CWD_SCAN_BYTES = 16 * 1024 * 1024;
const SCAN_CHUNK_BYTES = 1024 * 1024;
const LINE_START_BYTES = 64 * 1024;
const CHANGED_RETRIES = 2;

// The file shrank under a read (truncated or rewritten after its stat): nothing read describes the stat taken.
class TranscriptChanged extends Error {}

// What the scan past the head learned of one transcript: the file it read (device and inode), the folder it found or
// null, and how far it looked: the end of the line that named the folder, else where to go on from (the start of the
// line it had not seen whole, or the cap). A file replaced (another inode) or shorter than it was is scanned afresh.
interface LaunchScan {
  dev: number;
  ino: number;
  cwd: string | null;
  scanned: number;
  size: number; // the file's size when it was scanned: an unchanged file is not read again
}

// U8c-1 (M1 decision 8): a test-only hook that holds an interleaving open, awaited at a named point with what the point is
// about: before a scan's listing reads a project folder (its name), before a transcript is summarised (its path), and
// after a look has read the project folders and before it decides for a session (its id). Undefined in the product.
export interface StoreHooks {
  at?(point: 'listing' | 'summary' | 'look', detail: string): Promise<void>;
}

// `<slug>/<sessionId>/custom-title.json` (SPEC 35.10: `{"customTitle": string}`).
const CustomTitleSchema = z.looseObject({ customTitle: z.string() });

export class Discovery {
  // The last title each `custom-title.json` read whole, by sidecar path: what a torn rewrite falls back to.
  private readonly sidecarTitles = new Map<string, string>();
  // The scan past the head window, by transcript path: a transcript only grows, so an unchanged one is not read again and
  // a grown one only past where the scan stopped.
  private readonly launchScans = new Map<string, LaunchScan>();

  constructor(
    private readonly paths: StorePaths,
    private readonly hooks?: StoreHooks,
  ) {}

  // Every `<uuid>.jsonl` directly under a slug directory, stat'ed. A root or slug that vanishes mid-listing is simply
  // not listed: the next change event or scan sees the store as it then is.
  async list(): Promise<ListedTranscript[]> {
    const slugs = await readdirOrEmpty(this.paths.projects);
    const perSlug = await Promise.all(
      slugs.filter((entry) => entry.isDirectory()).map(async ({ name: slug }) => {
        const dir = join(this.paths.projects, slug);
        if (this.hooks?.at) await this.hooks.at('listing', slug);
        const entries = await readdirOrEmpty(dir).catch((error: unknown) => {
          console.error(`[fs] cannot list ${dir}:`, error instanceof Error ? error.message : error);
          return [];
        });
        const files = await Promise.all(
          entries.map(async (entry): Promise<ListedTranscript | null> => {
            const sessionId = transcriptSessionId(entry.name);
            if (sessionId === null || entry.isDirectory()) return null;
            const path = join(dir, entry.name);
            try {
              const info = await stat(path);
              return info.isFile() ? { sessionId, slug, path, size: info.size, mtimeMs: info.mtimeMs } : null;
            } catch (error) {
              if (!isMissing(error)) console.error(`[fs] cannot stat ${path}:`, error instanceof Error ? error.message : error);
              return null;
            }
          }),
        );
        return files.filter((file) => file !== null);
      }),
    );
    return perSlug.flat();
  }

  // U8c-1 (M1 decision 4): where each asked-for session's transcript lies now, from the names in every project folder
  // (one readdir per folder, no stat); a transcript under two folders (a move caught between its two renames' ends) is
  // the one written last, which alone is stat'ed. A session whose transcript lies nowhere is absent from the answer.
  async find(sessionIds: ReadonlySet<SessionId>): Promise<Map<SessionId, string>> {
    const found = new Map<SessionId, string[]>();
    if (sessionIds.size === 0) return new Map();
    const slugs = await readdirOrEmpty(this.paths.projects);
    await Promise.all(
      slugs.filter((entry) => entry.isDirectory()).map(async ({ name: slug }) => {
        const dir = join(this.paths.projects, slug);
        const entries = await readdirOrEmpty(dir).catch((error: unknown) => {
          console.error(`[fs] cannot list ${dir}:`, error instanceof Error ? error.message : error);
          return [];
        });
        for (const entry of entries) {
          const sessionId = transcriptSessionId(entry.name);
          if (sessionId === null || entry.isDirectory() || !sessionIds.has(sessionId)) continue;
          found.set(sessionId, [...(found.get(sessionId) ?? []), join(dir, entry.name)]);
        }
      }),
    );
    const answer = new Map<SessionId, string>();
    await Promise.all(
      [...found].map(async ([sessionId, paths]) => {
        const path = paths.length === 1 ? paths[0] : await writtenLast(paths);
        if (path !== null) answer.set(sessionId, path);
      }),
    );
    return answer;
  }

  // The first and last 64 KiB of one transcript through `summarize`, with the `custom-title.json` beside it folded
  // in; null when the transcript does not exist. Size and mtime are the opened file's, so they describe the bytes read.
  // A file that shrank while it was read is read again, from its new stat, up to CHANGED_RETRIES times.
  async summarizeOne(path: string): Promise<TranscriptSummary | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.summarizeOnce(path);
      } catch (error) {
        if (!(error instanceof TranscriptChanged) || attempt >= CHANGED_RETRIES) throw error;
      }
    }
  }

  private async summarizeOnce(path: string): Promise<TranscriptSummary | null> {
    let file;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    let head: Buffer, tail: Buffer, info;
    let launchCwd: string | null = null;
    try {
      info = await file.stat();
      head = await readWhole(file, 0, Math.min(HEAD_TAIL_BYTES, info.size), path);
      tail = info.size <= HEAD_TAIL_BYTES ? head : await readWhole(file, info.size - HEAD_TAIL_BYTES, HEAD_TAIL_BYTES, path);
      if (info.size > head.length && headCwd(head, info.size) === null) launchCwd = await this.launchCwd(file, path, info);
    } finally {
      await file.close();
    }
    const sessionId = basename(path, '.jsonl');
    const sidecarTitle = await this.readSidecarTitle(join(dirname(path), sessionId, 'custom-title.json'));
    return summarize(head, tail, { size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs }, path, basename(dirname(path)), sidecarTitle, launchCwd);
  }

  // The first folder of a transcript whose head window names none, from the scan past it (`launchScans`); null when the
  // first LAUNCH_CWD_SCAN_BYTES name none.
  private async launchCwd(file: FileHandle, path: string, info: { dev: number; ino: number; size: number }): Promise<string | null> {
    const known = this.launchScans.get(path);
    const same = known !== undefined && known.dev === info.dev && known.ino === info.ino && info.size >= known.size;
    if (same && (known.cwd !== null || known.size === info.size)) return known.cwd;
    const from = same ? known.scanned : 0;
    if (from >= Math.min(info.size, LAUNCH_CWD_SCAN_BYTES)) return null; // the cap reached: nothing more is looked at
    const { cwd, scanned } = await scanForCwd(file, from, info.size, path);
    this.launchScans.set(path, { dev: info.dev, ino: info.ino, cwd, scanned, size: info.size });
    return cwd;
  }

  // A sidecar that never reads whole (torn, or unreadable) keeps the title it last had; one that is gone has none.
  private async readSidecarTitle(sidecar: string): Promise<string | null> {
    const read = await readJsonWithRetry(sidecar, (raw) => CustomTitleSchema.parse(raw).customTitle);
    if (read.status === 'unreadable') noteUnreadable(sidecar, read.code);
    else noteReadable(sidecar);
    if (read.status === 'ok') this.sidecarTitles.set(sidecar, read.value);
    else if (read.status === 'absent') this.sidecarTitles.delete(sidecar);
    return this.sidecarTitles.get(sidecar) ?? null;
  }

  // Summaries of `files`, most recently modified first, at most 16 reads in flight, yielded as they complete. A file
  // that vanished between listing and reading is skipped, and so, with a log line, is one that cannot be read.
  async *summarizeAll(files: readonly ListedTranscript[]): AsyncIterable<TranscriptSummary> {
    const ordered = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
    const summarizeLogged = (file: ListedTranscript) =>
      this.summarizeOne(file.path).catch((error: unknown) => {
        console.error(`[fs] cannot summarise ${file.path}:`, error instanceof Error ? error.message : error);
        return null;
      });
    for await (const summary of mapConcurrent(ordered, SUMMARY_CONCURRENCY, summarizeLogged)) {
      if (summary !== null) yield summary;
    }
  }

  // Every listed transcript whose `(size, mtimeMs)` does not match `known`, summarised.
  async *scan(known: Map<SessionId, { size: number; mtimeMs: number }>): AsyncIterable<TranscriptSummary> {
    const files = await this.list();
    yield* this.summarizeAll(files.filter((file) => !matchesKnown(file, known.get(file.sessionId))));
  }
}

export function matchesKnown(file: { size: number; mtimeMs: number }, known: { size: number; mtimeMs: number } | undefined): boolean {
  return known !== undefined && known.size === file.size && known.mtimeMs === file.mtimeMs;
}

export function transcriptSessionId(name: string): SessionId | null {
  if (!name.endsWith('.jsonl')) return null;
  const stem = name.slice(0, -'.jsonl'.length);
  return SESSION_ID.test(stem) ? (stem as SessionId) : null;
}

async function readdirOrEmpty(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

// The one of `paths` modified last; null when none is there any longer.
async function writtenLast(paths: readonly string[]): Promise<string | null> {
  const stated = await Promise.all(
    paths.map(async (path) => {
      try {
        return { path, mtimeMs: (await stat(path)).mtimeMs };
      } catch (error) {
        if (!isMissing(error)) console.error(`[fs] cannot stat ${path}:`, error instanceof Error ? error.message : error);
        return null;
      }
    }),
  );
  let last: { path: string; mtimeMs: number } | null = null;
  for (const entry of stated) if (entry !== null && (last === null || entry.mtimeMs > last.mtimeMs)) last = entry;
  return last?.path ?? null;
}

type FileHandle = Awaited<ReturnType<typeof open>>;

// `length` bytes at `position`, which the stat said are there; fewer is a file that shrank since (TranscriptChanged).
async function readWhole(file: FileHandle, position: number, length: number, path: string): Promise<Buffer> {
  const buffer = await readRange(file, position, length);
  if (buffer.length < length) throw new TranscriptChanged(`${path} shrank while it was read`);
  return buffer;
}

// The first record's top-level `cwd` from `from` (a line's start) up to LAUNCH_CWD_SCAN_BYTES or `size`, and how far it
// looked (LaunchScan's `scanned`). Each line's first LINE_START_BYTES are kept across chunk edges; the rest of a line is
// passed over. The last line, unfinished or cut by the cap, is looked at too, but scanned again when the scan goes on.
async function scanForCwd(file: FileHandle, from: number, size: number, path: string): Promise<{ cwd: string | null; scanned: number }> {
  const end = Math.min(size, LAUNCH_CWD_SCAN_BYTES);
  const chunk = Buffer.alloc(Math.min(SCAN_CHUNK_BYTES, end - from));
  const start = Buffer.alloc(LINE_START_BYTES);
  let kept = 0; // bytes of the current line's start in `start`
  let lineStart = from;
  for (let position = from; position < end; ) {
    const length = Math.min(chunk.length, end - position);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await file.read(chunk, filled, length - filled, position + filled);
      if (bytesRead === 0) throw new TranscriptChanged(`${path} shrank while it was read`);
      filled += bytesRead;
    }
    const bytes = chunk.subarray(0, length);
    for (let i = 0; i < length; ) {
      const newline = bytes.indexOf(0x0a, i);
      const stop = newline === -1 ? length : newline;
      const take = Math.min(stop - i, LINE_START_BYTES - kept);
      if (take > 0) kept += bytes.copy(start, kept, i, i + take);
      if (newline === -1) break;
      const cwd = lineCwd(start.subarray(0, kept));
      if (cwd !== null) return { cwd, scanned: position + newline + 1 };
      kept = 0;
      lineStart = position + newline + 1;
      i = newline + 1;
    }
    position += length;
  }
  const cwd = kept > 0 ? lineCwd(start.subarray(0, kept)) : null;
  if (cwd !== null) return { cwd, scanned: end };
  return { cwd: null, scanned: end >= LAUNCH_CWD_SCAN_BYTES ? LAUNCH_CWD_SCAN_BYTES : lineStart };
}

async function readRange(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await file.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

// `fn` over `items` with at most `limit` calls in flight, results yielded in completion order.
export async function* mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): AsyncIterable<R> {
  const inFlight = new Map<number, Promise<{ index: number; result: R }>>();
  let next = 0;
  const launch = () => {
    const index = next++;
    inFlight.set(index, fn(items[index]).then((result) => ({ index, result })));
  };
  while (next < items.length && inFlight.size < limit) launch();
  while (inFlight.size > 0) {
    const { index, result } = await Promise.race(inFlight.values());
    inFlight.delete(index);
    if (next < items.length) launch();
    yield result;
  }
}
