// X1 identifiers (charter §13 X1; C1 execution document, Interfaces "X1 — identifiers").
// Runtime strings, branded at the type level: the eight wire identifiers stay distinct types and are never flattened,
// and four app-side ids join them. A function taking a `ToolUseId` does not accept a `TaskId`, nor a `ParentToolUseId`.
import * as z from 'zod';

const brandedId = <B extends string>() => z.string().min(1).brand<B>();

export const SessionIdSchema = brandedId<'SessionId'>(); // engine session id (`session_id` on frames)
export const AppSessionIdSchema = brandedId<'AppSessionId'>(); // MAWS's own id for a session record
export const MessageUuidSchema = brandedId<'MessageUuid'>(); // `uuid` on stdout frames and stdin user frames
export const ApiMessageIdSchema = brandedId<'ApiMessageId'>(); // `message.id` (msg_…)
export const ToolUseIdSchema = brandedId<'ToolUseId'>(); // toolu_…
export const ParentToolUseIdSchema = brandedId<'ParentToolUseId'>(); // `parent_tool_use_id`: the parent conversation's tool use that spawned this child traffic
export const TaskIdSchema = brandedId<'TaskId'>(); // `task_id` on task frames
export const AgentIdSchema = brandedId<'AgentId'>(); // sidecar `agentId` (agent-<id>.jsonl)
export const RequestIdSchema = brandedId<'RequestId'>(); // `request_id` on control frames
export const ProjectIdSchema = brandedId<'ProjectId'>();
export const AttentionIdSchema = brandedId<'AttentionId'>();
export const EventIdSchema = brandedId<'EventId'>(); // app-assigned, unique within a session

export type SessionId = z.infer<typeof SessionIdSchema>;
export type AppSessionId = z.infer<typeof AppSessionIdSchema>;
export type MessageUuid = z.infer<typeof MessageUuidSchema>;
export type ApiMessageId = z.infer<typeof ApiMessageIdSchema>;
export type ToolUseId = z.infer<typeof ToolUseIdSchema>;
export type ParentToolUseId = z.infer<typeof ParentToolUseIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type AttentionId = z.infer<typeof AttentionIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;

// The one sanctioned crossing: a `ParentToolUseId` carries the same `toolu_…` string as a `ToolUseId` in the parent
// conversation, and a consumer looking up that parent cell converts here, on purpose, greppably.
export function toolUseOf(id: ParentToolUseId): ToolUseId {
  return (id as string) as ToolUseId;
}
