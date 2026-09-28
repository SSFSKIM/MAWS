// X8 journal row (charter §13 X8; C1 execution document, Interfaces "X1 — wire frames"): one row per line of a probe
// recording. `frame` is opaque here; `in` rows are parsed with parseStdoutFrame, `out` rows with parseStdinFrame, and
// `meta` and `stderr` rows (`spawn`, `provenance`, `exit`, `jsonl_snapshot`, `{text}`, …) stay `unknown`.
import * as z from 'zod';

export const JOURNAL_DIRECTIONS = ['in', 'out', 'meta', 'stderr'] as const;
export const JournalDirectionSchema = z.enum(JOURNAL_DIRECTIONS);
export type JournalDirection = z.infer<typeof JournalDirectionSchema>;

// Strict: the row shape is the app's own (X8), so a stray key is a writer bug, not engine drift.
export const JournalRowSchema = z.strictObject({
  seq: z.number().int(),
  direction: JournalDirectionSchema,
  at: z.string(),
  frame: z.unknown(),
});
export type JournalRow = z.infer<typeof JournalRowSchema>;

export function parseJournalRow(row: unknown): JournalRow {
  return JournalRowSchema.parse(row);
}
