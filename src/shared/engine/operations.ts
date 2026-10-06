// Operations (C3 execution document, Interfaces "Deadlines and operations"): the X2 commands whose engine round trip is
// a `long` control and may outlast the bridge's 10 s router timeout. Each answers a receipt `{ opId }` once its request
// frame is flushed (`opId` is the minted request id, so the journal correlates it) and completes through the event
// `session.operation`, once per settlement and once more with `late: true` when a timed-out request answers inside the
// late table. Shared because X2's `session.ts` module validates both in the renderer's direction too.
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';
import { GenerateSessionTitleResponseSchema, ReloadPluginsResponseSchema, ReloadSkillsResponseSchema, SideQuestionResponseSchema } from '../wire/control';

export const OPERATION_COMMANDS = ['session.generateTitle', 'session.reloadPlugins', 'session.sideQuestion', 'session.mcpReconnect', 'session.mcpToggle', 'session.reloadSkills' /* E8 */] as const;
export type OperationCommand = (typeof OPERATION_COMMANDS)[number];

export const OperationReceiptSchema = z.strictObject({ opId: z.string() });
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;

export const OperationErrorSchema = z.strictObject({ code: z.enum(['timeout', 'engine_error', 'write_failed', 'exited']), message: z.string(), engineCode: z.string().nullable() });
export type OperationError = z.infer<typeof OperationErrorSchema>;

export const OperationEventSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  opId: z.string(),
  command: z.enum(OPERATION_COMMANDS),
  late: z.boolean(),
  outcome: z.union([
    z.strictObject({ ok: z.literal(true), value: z.union([GenerateSessionTitleResponseSchema, ReloadPluginsResponseSchema, SideQuestionResponseSchema, z.null(), ReloadSkillsResponseSchema /* E8 */]) }), // null for the two MCP commands
    z.strictObject({ ok: z.literal(false), error: OperationErrorSchema }),
  ]),
});
export type OperationEvent = z.infer<typeof OperationEventSchema>;
