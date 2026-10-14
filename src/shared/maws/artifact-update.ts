// E2's `artifact_update` (P1 X9 and X12), frozen. P3-A (M6; X25) retired the tool into `artifact_publish`: it is no
// longer in `MAWS_TOOL_NAMES` and nothing serves it. Its name, input and result schemas stay only so the journals and
// fixtures written before keep reading as they did (the normaliser's `maws.delivery.artifact`, the transcript's row),
// as `./browser` keeps the browser tools'.
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';
import { ARTIFACT_ID } from './artifact-id';

export const HISTORICAL_ARTIFACT_UPDATE = 'artifact_update';

export const ArtifactUpdateInputSchema = z.strictObject({
  id: z.string().regex(ARTIFACT_ID),
  html_path: z.string().min(1).max(4096),
  title: z.string().min(1).max(200).optional(),
});
export type ArtifactUpdateInput = z.infer<typeof ArtifactUpdateInputSchema>;

// `ownerAppSessionId` (P2-E1, D10): the side thread's ancestor whose record the version belongs to.
export const ArtifactUpdateResultSchema = z.strictObject({
  status: z.literal('updated'), id: z.string(), deliverableId: z.uuid(), version: z.number().int().min(2), title: z.string(), externalReferences: z.number().int().min(0),
  ownerAppSessionId: AppSessionIdSchema.optional(),
});
export type ArtifactUpdateResult = z.infer<typeof ArtifactUpdateResultSchema>;
