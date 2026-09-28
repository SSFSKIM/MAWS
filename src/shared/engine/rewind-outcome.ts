// What `session.rewind` and `session.rewindFiles` answer (C3 execution document, Interfaces "Rewind, `!`, `#`"). Shared
// because X2's `session.ts` schema module validates them in the renderer's direction too; `src/engine-host/rewind.ts`
// builds them from the two control responses. Strict: app shapes.
import * as z from 'zod';
import { MessageUuidSchema } from '../graph/ids';

export const RewindOutcomeSchema = z.strictObject({
  rewound: z.boolean(), reason: z.string().nullable(), error: z.string().nullable(), prefillText: z.string().nullable(), precedingAssistantUuid: MessageUuidSchema.nullable(),
  files: z.strictObject({ canRewind: z.boolean(), skippedLinks: z.number().nullable(), error: z.string().nullable() }).nullable(), // the restore's own answer; counts come from a dry run
});
export type RewindOutcome = z.infer<typeof RewindOutcomeSchema>;

export const RewindFilesOutcomeSchema = z.strictObject({
  ok: z.boolean(), enabled: z.boolean(), message: z.string().nullable(), dryRun: z.boolean(),
  changedFiles: z.array(z.string()).nullable(), insertions: z.number().nullable(), deletions: z.number().nullable(), // dry run only: the paths the restore would touch and the line counts
  skippedLinks: z.number().nullable(), // restore only: paths skipped for link safety
});
export type RewindFilesOutcome = z.infer<typeof RewindFilesOutcomeSchema>;
