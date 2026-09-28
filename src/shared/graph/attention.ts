// X1 attention item (charter §13 X1 and §4.6; C1 execution document, Interfaces "X1 — session record and attention item").
import * as z from 'zod';
import { AttentionKindSchema, AttentionStateSchema } from './enums';
import { AgentIdSchema, AppSessionIdSchema, AttentionIdSchema, RequestIdSchema, SessionIdSchema, TaskIdSchema, ToolUseIdSchema } from './ids';

export const AttentionItemSchema = z.strictObject({
  id: AttentionIdSchema,
  appSessionId: AppSessionIdSchema,
  sessionId: SessionIdSchema.nullable(),
  kind: AttentionKindSchema,
  request: z.strictObject({
    requestId: RequestIdSchema.nullable(),
    toolUseId: ToolUseIdSchema.nullable(),
    taskId: TaskIdSchema.nullable(),
    agentId: AgentIdSchema.nullable(),
  }),
  summary: z.string(), // the one line a Needs-you row shows
  createdAt: z.string(),
  state: AttentionStateSchema,
  stateChangedAt: z.string(),
  expiresAt: z.string().nullable(), // held peer messages expire (§5.7)
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;
