// The engine host's status for one live process (charter §4.4; C3 execution document, Interfaces "Process table and
// status"): what `session.status` and `engine.sessions` answer and C8's Session info and C12's budget read. M3 fills
// the process, turn, permission-mode, gateway, grant and request fields; M4's process table adds background tasks,
// held peer messages, queue, memory and `toSessionRecordPatch`. Strict: an app shape.
import * as z from 'zod';
import { AUTO_MODE_REFUSAL_CODES, PermissionModeSchema } from '../graph/enums';
import { AppSessionIdSchema, MessageUuidSchema, SessionIdSchema, TaskIdSchema } from '../graph/ids';
import { EffortSchema } from './launch-spec';

export const EngineSessionStatusSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, engineSessionId: SessionIdSchema.nullable(), pid: z.number().int().nullable(), launchId: z.string(), launchedAt: z.string(),
  process: z.enum(['starting', 'initializing', 'ready', 'exiting', 'exited']),
  exit: z.strictObject({ code: z.number().int().nullable(), signal: z.string().nullable(), reason: z.enum(['quit', 'stop', 'archive', 'crash', 'unknown']), at: z.string() }).nullable(),
  engineState: z.enum(['idle', 'running', 'requires_action', 'unknown']), // session_state_changed; 'unknown' before the first frame
  activity: z.enum(['compacting', 'requesting']).nullable(), // system/status
  turn: z.strictObject({ origin: z.enum(['human', 'engine']), startedAt: z.string(), acceptedAt: z.string().nullable(), userMessageUuids: z.array(MessageUuidSchema) }).nullable(), // startedAt: the querying frame's write (human) or system/init (engine); acceptedAt: the system/init inside a human turn
  model: z.strictObject({ requested: z.string().nullable(), resolved: z.string().nullable() }),
  effort: EffortSchema.nullable(),
  permissionMode: z.strictObject({ requested: PermissionModeSchema, effective: PermissionModeSchema, refusal: z.enum(AUTO_MODE_REFUSAL_CODES).nullable() }),
  prePlanMode: PermissionModeSchema.nullable(),
  gateway: z.strictObject({
    mode: z.enum(['gateway', 'direct']), baseUrl: z.string().nullable(), verified: z.enum(['pending', 'routed', 'direct', 'mismatch']),
    autoModeServer: z.enum(['enabled', 'disabled', 'unknown']), localLaneObserved: z.boolean(),
  }),
  subagentModel: z.string().nullable(), modelOverrides: z.record(z.string(), z.string()), // ANTHROPIC_DEFAULT_*_MODEL in effect (names and values from the constructed env)
  engineVersion: z.string().nullable(), fileCheckpointing: z.boolean(),
  backgroundTasks: z.array(z.strictObject({ taskId: TaskIdSchema, taskType: z.string(), description: z.string(), ambient: z.boolean() })),
  grants: z.array(z.string()), // the snapshot's rule strings
  mcpServers: z.array(z.strictObject({ name: z.string(), status: z.string(), source: z.string().nullable() })),
  heldPeerMessages: z.array(z.strictObject({ messageUuid: z.string().nullable(), from: z.string(), fromName: z.string().nullable(), lane: z.string(), heldAt: z.string(), expiresAt: z.string() })),
  pendingRequests: z.number().int(), queue: z.strictObject({ length: z.number().int(), paused: z.boolean() }),
  keepAlive: z.array(z.enum(['turn', 'background_tasks', 'grants', 'mcp_connected', 'held_peer_message'])), // §4.4: what would keep this process live under a budget; informational under the never-exit rule
  memory: z.strictObject({ rssKiB: z.number().int().nullable(), treeRssKiB: z.number().int().nullable(), sampledAt: z.string().nullable() }),
  journalPath: z.string(), hostHooks: z.array(z.string()), lastEventSeq: z.number().int(),
});
export type EngineSessionStatus = z.infer<typeof EngineSessionStatusSchema>;
