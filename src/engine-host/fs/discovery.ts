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
import { HEAD_TAIL_BYTES, summarize } from './summarize';
import { SESSION_ID } from './watcher';

export interface ListedTranscript {
  sessionId: SessionId;
  slug: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export const SUMMARY_CONCURRENCY = 16;

// `<slug>/<sessionId>/custom-title.json` (SPEC 35.10: `{"customTitle": string}`).
const CustomTitleSchema = z.looseObject({ customTitle: z.string() });

export class Discovery {
  // The last title each `custom-title.json` read whole, by sidecar path: what a torn rewrite falls back to.
  private readonly sidecarTitles = new Map<string, string>();

  constructor(private readonly paths: StorePaths) {}

  // Every `<uuid>.jsonl` directly under a slug directory, stat'ed. A root or slug that vanishes mid-listing is simply
  // not listed: the next change event or scan sees the store as it then is.
  async list(): Promise<ListedTranscript[]> {
    const slugs = await readdirOrEmpty(this.paths.projects);
    const perSlug = await Promise.all(
      slugs.filter((entry) => entry.isDirectory()).map(async ({ name: slug }) => {
        const dir = join(this.paths.projects, slug);
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

  // The first and last 64 KiB of one transcript through `summarize`, with the `custom-title.json` beside it folded
  // in; null when the transcript does not exist. Size and mtime are the opened file's, so they describe the bytes read.
  async summarizeOne(path: string): Promise<TranscriptSummary | null> {
    let file;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    let head: Buffer, tail: Buffer, info;
    try {
      info = await file.stat();
      head = await readRange(file, 0, Math.min(HEAD_TAIL_BYTES, info.size));
      tail = info.size <= HEAD_TAIL_BYTES ? head : await readRange(file, info.size - HEAD_TAIL_BYTES, HEAD_TAIL_BYTES);
    } finally {
      await file.close();
    }
    const sessionId = basename(path, '.jsonl');
    const sidecarTitle = await this.readSidecarTitle(join(dirname(path), sessionId, 'custom-title.json'));
    return summarize(head, tail, { size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs }, path, basename(dirname(path)), sidecarTitle);
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

async function readRange(file: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
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
