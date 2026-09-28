// The engine host's status for one live process (charter §4.4; C3 execution document, Interfaces "Process table and
// status"): what `session.status` and `engine.sessions` answer and C8's Session info and C12's budget read, and
// `toSessionRecordPatch`, what C4's index applies from a status. Strict: an app shape.
import * as z from 'zod';
import { AUTO_MODE_REFUSAL_CODES, PermissionModeSchema } from '../graph/enums';
import { AppSessionIdSchema, EventIdSchema, MessageUuidSchema, SessionIdSchema, TaskIdSchema } from '../graph/ids';
import type { SessionRecord } from '../graph/session';
import { EffortSchema } from './launch-spec';

export const EngineSessionStatusSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, engineSessionId: SessionIdSchema.nullable(), pid: z.number().int().nullable(), launchId: z.string(), launchedAt: z.string(),
  cwd: z.string(), // the launch spec's cwd, present from the reservation onward (C10 counts reservations by directory through engine.sessions)
  pendingPlan: z.string().nullable(), // a clear_and_implement plan kept for retry after the pre-plan mode could not be restored (M3 review)
  process: z.enum(['starting', 'initializing', 'ready', 'exiting', 'exited']),
  exit: z.strictObject({ code: z.number().int().nullable(), signal: z.string().nullable(), reason: z.enum(['quit', 'stop', 'archive', 'crash', 'unknown']), at: z.string() }).nullable(),
  engineState: z.enum(['idle', 'running', 'requires_action', 'unknown']), // session_state_changed; 'unknown' before the first frame
  activity: z.enum(['compacting', 'requesting']).nullable(), // system/status
  turn: z.strictObject({ id: EventIdSchema /* the open turn's turn.started event id; C11 compares gateway.localLane.observedInTurn with it */, origin: z.enum(['human', 'engine']), startedAt: z.string(), acceptedAt: z.string().nullable(), userMessageUuids: z.array(MessageUuidSchema) }).nullable(), // startedAt: the querying frame's write (human) or system/init (engine); acceptedAt: the system/init inside a human turn
  model: z.strictObject({ requested: z.string().nullable(), resolved: z.string().nullable() }),
  effort: EffortSchema.nullable(),
  permissionMode: z.strictObject({ requested: PermissionModeSchema, effective: PermissionModeSchema, refusal: z.enum(AUTO_MODE_REFUSAL_CODES).nullable() }),
  prePlanMode: PermissionModeSchema.nullable(),
  gateway: z.strictObject({
    mode: z.enum(['gateway', 'direct']), baseUrl: z.string().nullable(), verified: z.enum(['pending', 'routed', 'direct', 'mismatch']),
    autoModeServer: z.enum(['enabled', 'disabled', 'unknown']),
    localLane: z.strictObject({ observedInTurn: EventIdSchema, at: z.string() }).nullable(), // C11's correction (M4): the local auto-mode lane observed in the current turn; observedInTurn is that turn's turn.started event id; cleared at the next turn.started
  }),
  subagentModel: z.string().nullable(), modelOverrides: z.record(z.string(), z.string()), // ANTHROPIC_DEFAULT_*_MODEL in effect (names and values from the constructed env)
  engineVersion: z.string().nullable(), fileCheckpointing: z.boolean(),
  fastMode: z.strictObject({ state: z.enum(['off', 'cooldown', 'on']).nullable(), disabledReason: z.string().nullable() }), // C11's ask: from initialize and every system/init (`fast_mode_state`, `fast_mode_disabled_reason`; pass2/real-settings seq 15 carries `off` / `sdk_opt_in_required`); nulls before the first frame
  plugins: z.array(z.strictObject({ name: z.string(), path: z.string(), source: z.string().nullable(), version: z.string().nullable() })), // system/init.plugins (real-settings lists eleven)
  pluginErrors: z.array(z.strictObject({ plugin: z.string(), type: z.string(), message: z.string(), path: z.string().nullable() })), // system/init.plugin_errors (SPEC 45 §45.10.2; absent when empty)
  pluginWarnings: z.array(z.strictObject({ plugin: z.string(), type: z.string(), message: z.string() })), // system/init.plugin_warnings; all three empty before the first frame
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

export type SessionRecordPatch = Partial<Pick<SessionRecord, 'engineSessionId' | 'engineVersion' | 'gateway' | 'model' | 'effort' | 'permissionMode' | 'holder'>>;

// What C4's index applies from a status. The holder is `self` while this app holds a process and is left out once it
// has exited (the index decides what holds it then); the gateway is left out until `get_status` verified it. The
// record's permission mode requires a refusal exactly when requested and effective differ, so a mode the engine moved
// to on its own (plan mode entered by a tool, the pre-plan mode restored) reads as the requested mode there.
export function toSessionRecordPatch(s: EngineSessionStatus): SessionRecordPatch {
  const { effective, refusal } = s.permissionMode;
  const patch: SessionRecordPatch = {
    engineSessionId: s.engineSessionId,
    engineVersion: s.engineVersion,
    model: { ...s.model },
    effort: s.effort,
    permissionMode: refusal === null ? { requested: effective, effective, refusal } : { ...s.permissionMode },
  };
  if (s.gateway.verified !== 'pending') patch.gateway = { routed: s.gateway.verified === 'routed', baseUrl: s.gateway.baseUrl, autoModeServer: s.gateway.autoModeServer };
  if (s.process !== 'exited') patch.holder = { kind: 'self' };
  return patch;
}
