// Prompt history as the composer recalls it (C7 execution document, Interfaces "X2 additions"): the terminal's own
// record shapes (SPEC 42 §42.15.7), shared by main (which answers `session.history.*`) and the renderer (ArrowUp).
import * as z from 'zod';

// One pasted segment of a history entry, keyed in `pastedContents` by its placeholder number. `content` is the body,
// inline; for a terminal row whose body lives in the terminal's paste cache, main resolves `contentHash` read-only and
// answers `content: null` when it cannot (unresolved: the composer recalls an unavailable chip, never the placeholder).
export const PastedContentSchema = z.strictObject({
  id: z.number().int(),
  type: z.enum(['text', 'image']),
  content: z.string().nullable(),
  contentHash: z.string().nullable(),
  mediaType: z.string().nullable(),
  filename: z.string().nullable(),
});
export type PastedContent = z.infer<typeof PastedContentSchema>;

export const HistoryEntrySchema = z.strictObject({
  display: z.string(), // the prompt as typed, `[Pasted text #n +L lines]` and `[Image #n]` placeholders in place
  at: z.string(), // ISO time
  source: z.enum(['maws', 'terminal']),
  sessionId: z.string().nullable(), // the engine session id when the record names one
  pastedContents: z.record(z.string(), PastedContentSchema), // keyed by the placeholder number as a string, the terminal's key; {} when none
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
