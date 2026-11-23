// E1's `send_file` (P1 X9 and X12), frozen. Board ticket 848 (the X9 amendment of 2026-11-23, the P1 spec's Decision
// Log) retired it: a file reaches the user as a Markdown link to its path in the agent's message. It is no longer in
// `MAWS_TOOL_NAMES`, a call is answered `TOOL_ERRORS.sendFileRetired`, and nothing serves it. Its name, input and result
// schemas stay only so the journals and fixtures written before keep reading as they did (the normaliser's
// `maws.delivery.file`, the transcript's delivery row), as `./artifact-update` and `./browser` keep theirs.
import * as z from 'zod';

export const HISTORICAL_SEND_FILE = 'send_file';

export const SendFileInputSchema = z.strictObject({
  files: z.array(z.string().min(1)).min(1).max(20),
  caption: z.string().max(2000).optional(),
  urgency: z.enum(['normal', 'high']).optional(),
});
export type SendFileInput = z.infer<typeof SendFileInputSchema>;

export const DeliveredFileSchema = z.strictObject({ id: z.string(), path: z.string(), name: z.string() });
export type DeliveredFile = z.infer<typeof DeliveredFileSchema>;
export const SendFileResultSchema = z.strictObject({ status: z.literal('delivered'), deliverables: z.array(DeliveredFileSchema) });
export type SendFileResult = z.infer<typeof SendFileResultSchema>;
