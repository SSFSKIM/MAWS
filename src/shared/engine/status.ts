// The engine host's status for one live process (charter §4.4; C3 execution document, Interfaces "Process table and
// status"): what `session.status` and `engine.sessions` answer and C8's Session info and C12's budget read, and
// `toSessionRecordPatch`, what C4's index applies from a status. Strict: an app shape.
import * as z from 'zod';
import { AUTO_MODE_REFUSAL_CODES, PermissionModeSchema } from '../graph/enums';
import { AppSessionIdSchema, EventIdSchema, MessageUuidSchema, SessionIdSchema, TaskIdSchema } from '../graph/ids';
import type { SessionRecord } from '../graph/session';
import { EffortSchema } from './launch-spec';

// C12 start: what a live process holds that an exit would lose or interrupt (charter §4.4 as amended 2026-09-29; C12
// execution document, Interfaces "X6 status"): an open turn, host work in flight without one (`busy`), background tasks
// or workflows, a pending request, queued messages, a held peer message, a listed stateful MCP server connected or
// connecting. Session grants are not one: the snapshot re-applies on resume.
export const HardReasonSchema = z.enum(['turn', 'busy', 'background_tasks', 'pending_request', 'queued_messages', 'held_peer_message', 'stateful_mcp']);
export type HardReason = z.infer<typeof HardReasonSchema>;
// C12 end

export const EngineSessionStatusSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, engineSessionId: SessionIdSchema.nullable(), pid: z.number().int().nullable(), launchId: z.string(), launchedAt: z.string(),
  taskListId: z.string().nullable(), // C8's ask (M5): the launch env's CLAUDE_CODE_TASK_LIST_ID when set, else the engine session id once known; null before (SPEC 20:167–203)
  cwd: z.string(), // the launch spec's cwd, present from the reservation onward (C10 counts reservations by directory through engine.sessions)
  pendingPlan: z.string().nullable(), // a clear_and_implement plan kept for retry after the pre-plan mode could not be restored (M3 review)
  process: z.enum(['starting', 'initializing', 'ready', 'exiting', 'exited']),
  exit: z.strictObject({
    code: z.number().int().nullable(), signal: z.string().nullable(), reason: z.enum(['quit', 'stop', 'archive', 'crash', 'unknown', 'budget' /* C12 */]), at: z.string(),
    release: z.strictObject({ limitKiB: z.number().int(), totalKiB: z.number().int() }).nullable(), // C12: the budget and the sum at a release; non-null exactly when the reason is `budget`
  }).nullable(),
  engineState: z.enum(['idle', 'running', 'requires_action', 'unknown']), // session_state_changed; 'unknown' before the first frame
  activity: z.enum(['compacting', 'requesting']).nullable(), // system/status
  turn: z.strictObject({ id: EventIdSchema /* the open turn's turn.started event id; C11 compares gateway.localLane.observedInTurn with it */, origin: z.enum(['human', 'engine']), startedAt: z.string(), acceptedAt: z.string().nullable(), userMessageUuids: z.array(MessageUuidSchema) }).nullable(), // startedAt: the engine's `started` lifecycle for the prompt (human) or system/init (engine); acceptedAt equals startedAt (coordinator ruling after M6)
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
  keepAlive: z.array(HardReasonSchema), // C12: the hard reasons that keep this process live under the budget (§4.4 as amended)
  // C12 start: `busy`, the host has work in flight: the queue's own predicate (an open turn, a message written but not
  // yet started, a submission whose turn has not ended), a `!` command still running, or a held clear-and-implement.
  // `lastUsedAt`, when the human last used the session (the launch, a turn's end, any command the human sent): the
  // budget's least-recently-used order.
  busy: z.boolean(),
  lastUsedAt: z.string(),
  // C12 end
  memory: z.strictObject({ rssKiB: z.number().int().nullable(), treeRssKiB: z.number().int().nullable(), sampledAt: z.string().nullable() }),
  journalPath: z.string(), hostHooks: z.array(z.string()), lastEventSeq: z.number().int(),
  // C10 start (additive X6, flagged to the coordinator): `attested` iff the launch spec carried `trust`; `recorded` the
  // initialize response's `workspace_trust_recorded`, null before the response or when it carries none. Not copied to
  // the record by toSessionRecordPatch (the trust notice is the session's evidence).
  trust: z.strictObject({ attested: z.boolean(), recorded: z.boolean().nullable() }),
  // C10 end
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

// W7: whether a live process can end without losing work when a foreign writer has taken its session (the yield, and
// `session.stop { ifIdle }`): ready, and nothing holds it but its own queue (which survives the exit in the state file)
// and a stateful MCP server (whose state the other writer has already overtaken).
const YIELDS_OVER: ReadonlySet<HardReason> = new Set(['queued_messages', 'stateful_mcp']);
export const canYield = (status: Pick<EngineSessionStatus, 'process' | 'keepAlive'>): boolean => status.process === 'ready' && status.keepAlive.every((reason) => YIELDS_OVER.has(reason));
