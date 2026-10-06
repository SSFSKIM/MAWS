// X12, the deliverable record (P1 spec §10 X12; E1 execution document, Interfaces "X9", residue 7): one record per
// delivered file, written by the engine host under `<userData>/deliverables/<appSessionId>/<id>.json`, the file itself
// referenced in place (A-3). E2 owns the record and its viewer and may move the store into the index (ledger §4,
// version 5); E1 writes `kind: 'file'` with the basename as the title and one version, the file as delivered.
import * as z from 'zod';
import { AppSessionIdSchema, ToolUseIdSchema } from '../graph/ids';

export const DeliverableRecordSchema = z.strictObject({
  id: z.uuid(),
  appSessionId: AppSessionIdSchema,
  kind: z.enum(['file', 'artifact', 'screenshot']),
  path: z.string(),
  title: z.string().optional(),
  caption: z.string().optional(),
  versions: z.array(z.strictObject({ path: z.string(), at: z.string() })),
  toolUseId: ToolUseIdSchema.optional(), // the call that delivered it (`_meta["claudecode/toolUseId"]`)
  createdAt: z.string(),
});
export type DeliverableRecord = z.infer<typeof DeliverableRecordSchema>;
