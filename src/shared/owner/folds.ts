// The to-human mod's file of fold summaries as MAWS reads it (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-
// U2b-to-human-view.md, Interfaces §M, "The file: a contract, and its reader"; decisions 24, 29 and 30). Pure: the file's
// shape, the reader's limits, and the one path a session's file can have; src/services/owner/folds.ts is the one place
// that opens it. The mod keeps a session's summaries in `to-human/folds/<engine session id>.json` under the engine's
// configuration directory, `{ "shape": 2, "runs": [[<first row id>, <last row id>, <summary>], …] }`, written by atomic
// replacement and merged before each write (the contract, §I item 12). MAWS reads shape 2 and nothing else: a file a
// release before that contract wrote (shape 1, whole and in place, each process from its own memory) reads as no
// summaries. MAWS never writes, moves or removes the file, and names no release, model or price of the mod.
import * as z from 'zod';

export const FOLDS_SHAPE = 2; // the contract's shape (§I item 12)
export const FOLD_SUMMARIES_ENV = 'TO_HUMAN_FOLD_SUMMARIES'; // §I item 10; the one value MAWS writes is 'off'
export const FOLD_SUMMARIES_OFF = 'off';
export const FOLDS_FILE_MAX_BYTES = 4 * 1024 * 1024; // a file past it reads as none
export const STORED_RUNS_MAX = 5000; // of more, the newest (the file's last) are kept
export const RUN_ID_MAX = 256;
export const SUMMARY_MAX = 120; // code points, the mod's own LINE_MAX
const ENGINE_SESSION_ID_MAX = 128;

export interface StoredRun {
  first: string;
  last: string;
  summary: string;
}

// On the wire (`ownerChannel.folds`); the bounds are the reader's, so anything it answers fits them
export const StoredRunSchema = z.strictObject({ first: z.string().min(1).max(RUN_ID_MAX), last: z.string().min(1).max(RUN_ID_MAX), summary: z.string().min(1).max(SUMMARY_MAX * 2) });

// A summary as one line: trimmed, read to its first line, and cut past 120 code points with `…` between code points
// (the mod's `oneLine`, folds.tsx 140 at 0.8.2, which the mod has already applied to what it stores; MAWS applies it
// again because the file is another program's). Empty reads as none.
function oneLine(text: string): string | null {
  const first = text.trim().split(/\r\n|\r|\n/)[0]!.trim();
  if (first === '') return null;
  const chars = Array.from(first);
  return chars.length > SUMMARY_MAX ? `${chars.slice(0, SUMMARY_MAX - 1).join('')}…` : first;
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= RUN_ID_MAX;

// The runs of a file of the contract's shape, oldest first, or null when the text is not one (it does not parse, its
// `shape` is not 2, or `runs` is no array). Follows the mod's `storedRuns` (folds.tsx 450 at 0.8.2) at shape 2: an entry
// that is not three strings is skipped; beyond it, an entry whose id is not 1 to 256 characters or whose summary reads
// as none is skipped, and of more than 5,000 runs the last 5,000 are kept.
export function storedRunsOf(text: string): StoredRun[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { shape, runs } = value as { shape?: unknown; runs?: unknown };
  if (shape !== FOLDS_SHAPE || !Array.isArray(runs)) return null;
  const read = runs.flatMap((run: unknown): StoredRun[] => {
    if (!Array.isArray(run) || run.length !== 3 || !run.every((part) => typeof part === 'string')) return [];
    const [first, last, text] = run as [string, string, string];
    const summary = oneLine(text);
    return isId(first) && isId(last) && summary !== null ? [{ first, last, summary }] : [];
  });
  return read.length > STORED_RUNS_MAX ? read.slice(read.length - STORED_RUNS_MAX) : read;
}

// The path of a session's file, or null for an engine session id that is no plain file name (anything but ASCII
// letters, digits, `-` and `_`, or longer than 128 characters), so no id, however written, leads outside the folder.
export function foldsFileOf(configHome: string, engineSessionId: string): string | null {
  if (engineSessionId.length > ENGINE_SESSION_ID_MAX || !/^[A-Za-z0-9_-]+$/.test(engineSessionId)) return null;
  return `${configHome.replace(/\/+$/, '')}/to-human/folds/${engineSessionId}.json`;
}
