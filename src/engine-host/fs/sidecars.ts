// Whole-file JSON sidecars under the config home (C4 execution document, "Filesystem service internals"; charter
// residue *Sidecar write-atomicity retry*). `custom-title.json`, `agent-*.meta.json`, `wf_*.json`, `tasks/*/*.json`,
// `sessions/*.json` and `jobs/*/state.json` are written without a documented atomic rename (SPEC 35.10, 35.27.1,
// 20.2.4, 40.16), so a reader can see a truncated or half-written file: it reads, parses and checks again on a fixed
// schedule until the value is whole. Read-only: this module never opens anything for writing.
import { readFile } from 'node:fs/promises';

// Attempt times, in ms after the change that asked for the read (absolute offsets, not gaps).
export const RETRY_SCHEDULE_MS = [0, 20, 50, 100, 250, 500] as const;

// What a read concluded. `absent`: the file does not exist, so whatever it said is gone. `unparseable`: it exists but
// its content never read whole within the schedule (torn or malformed JSON), so the caller keeps its previous value
// (a torn `custom-title.json` must not clear a valid title, nor a torn registry record end a holder). `unreadable`:
// the last attempt still failed with a filesystem error other than ENOENT (EACCES, EIO): background readers keep their
// previous value as for `unparseable`, but a caller that must answer for the store as it is now (`fs.holders`) refuses.
export type SidecarRead<T> = { status: 'ok'; value: T } | { status: 'absent' } | { status: 'unparseable' } | { status: 'unreadable'; code: string };

// Reads the whole file, `JSON.parse`s it, maps it through `parse` (which throws on a shape it refuses) and applies
// `accept`; a failure at any step waits for the next attempt. A file that does not exist is `absent` at once: the
// engine's writers never make a file vanish mid-write (`writeFile` truncates in place; a rename replaces atomically).
export async function readJsonWithRetry<T>(path: string, parse: (raw: unknown) => T, accept?: (value: T) => boolean): Promise<SidecarRead<T>> {
  const started = Date.now();
  let failedReading: string | null = null; // the errno of the last attempt, when it failed at the read, not the content
  for (const at of RETRY_SCHEDULE_MS) {
    const wait = started + at - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (isMissing(error)) return { status: 'absent' };
      failedReading = (error as NodeJS.ErrnoException).code ?? 'EUNKNOWN';
      continue;
    }
    failedReading = null;
    try {
      const value = parse(JSON.parse(text) as unknown);
      if (accept === undefined || accept(value)) return { status: 'ok', value };
    } catch {
      // torn or malformed: the next attempt
    }
  }
  return failedReading === null ? { status: 'unparseable' } : { status: 'unreadable', code: failedReading };
}

// Background readers log a file that stays unreadable once, not on every poll, and again only after it has read.
const reportedUnreadable = new Set<string>();

export function noteUnreadable(path: string, code: string): void {
  const key = `${path}\0${code}`;
  if (reportedUnreadable.has(key)) return;
  reportedUnreadable.add(key);
  console.error(`[fs] ${path} is unreadable (${code}); keeping its last value`);
}

export function noteReadable(path: string): void {
  for (const key of reportedUnreadable) if (key.startsWith(`${path}\0`)) reportedUnreadable.delete(key);
}

export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
