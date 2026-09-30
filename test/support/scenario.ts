// Shell scenarios (C5 execution document, Interfaces "Scenario format"): a JSON file under `test/fixtures/shell/`
// listing projects, sessions, digests, engine statuses in a compact form, attention items with their originating
// requests, and a timeline of changes. Shared by the unit tests and main's stub source. Validation uses the X1 and X2
// schemas themselves, and C3's `EngineSessionStatusSchema` for the expanded statuses, so a scenario can never carry a
// shape production would refuse. Keys named `_from`, `_synthetic` or `_note` anywhere in the file are provenance
// annotations (which probe journal a value was copied from, what was invented) and are dropped before validation.
import { readFileSync } from 'node:fs';
import * as z from 'zod';
import { AttentionItemSchema } from '../../src/shared/graph/attention';
import { SessionEventSchema, type SessionEvent } from '../../src/shared/graph/events';
import { AppSessionIdSchema, EventIdSchema, type AppSessionId } from '../../src/shared/graph/ids';
import { SessionRecordSchema, type SessionRecord } from '../../src/shared/graph/session';
import { EffortSchema } from '../../src/shared/engine/launch-spec';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '../../src/shared/engine/status';
import { ProjectRecordSchema, SessionDigestSchema, type ProjectRecord } from '../../src/shared/ipc/schema/session';
import type { AttentionItem } from '../../src/shared/graph/attention';

// The gateway relay's URL, the value of C3's `RELAY_URL` in `src/engine-host/launch.ts`. Held here rather than imported:
// this loader ships in the main bundle through the stub source, and C3's launch module is engine-host code.
export const RELAY_URL = 'http://127.0.0.1:8641';

const StatusShape = EngineSessionStatusSchema.shape;
// The compact turn carries no `id` (the expansion mints the turn's `turn.started` event id) and may leave out
// `acceptedAt`; the expansion fills it with `startedAt` (a mid-turn session was accepted).
const CompactTurnSchema = StatusShape.turn.unwrap().omit({ id: true }).extend({ acceptedAt: z.string().nullable().optional() }).nullable();
export const CompactEngineSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  process: StatusShape.process,
  engineState: StatusShape.engineState,
  turn: CompactTurnSchema,
  pendingRequests: StatusShape.pendingRequests,
  exit: z.strictObject({ reason: z.enum(['quit', 'stop', 'archive', 'crash', 'unknown']) }).optional(),
});
export type CompactEngine = z.infer<typeof CompactEngineSchema>;

export const ScenarioDigestSchema = SessionDigestSchema.omit({ revision: true });
export type ScenarioDigest = z.infer<typeof ScenarioDigestSchema>;

const AttentionEntrySchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  items: z.array(AttentionItemSchema),
  requests: z.record(z.string(), SessionEventSchema), // requestId → the originating *.requested event
});

const at = z.number().int().nonnegative(); // ms after the scenario starts
const TimelineEntrySchema = z.discriminatedUnion('op', [
  z.strictObject({ at, op: z.literal('attention'), appSessionId: AppSessionIdSchema, items: z.array(AttentionItemSchema), requests: z.record(z.string(), SessionEventSchema) }),
  z.strictObject({ at, op: z.literal('digest'), digest: ScenarioDigestSchema }),
  z.strictObject({ at, op: z.literal('engine'), appSessionId: AppSessionIdSchema, engine: CompactEngineSchema.nullable() }), // null removes the status
  z.strictObject({ at, op: z.literal('session'), record: SessionRecordSchema }),
  z.strictObject({ at, op: z.literal('removeSession'), appSessionId: AppSessionIdSchema }),
]);

export const ScenarioFileSchema = z.strictObject({
  version: z.literal(1),
  projects: z.array(ProjectRecordSchema),
  sessions: z.array(SessionRecordSchema),
  digests: z.array(ScenarioDigestSchema),
  engine: z.array(CompactEngineSchema),
  attention: z.array(AttentionEntrySchema),
  timeline: z.array(TimelineEntrySchema),
});
export type ScenarioFile = z.infer<typeof ScenarioFileSchema>;

// What a player consumes: engine entries expanded to C3's full status.
export type ScenarioOp =
  | { at: number; op: 'attention'; appSessionId: AppSessionId; items: AttentionItem[]; requests: Record<string, SessionEvent> }
  | { at: number; op: 'digest'; digest: ScenarioDigest }
  | { at: number; op: 'engine'; appSessionId: AppSessionId; engine: EngineSessionStatus | null }
  | { at: number; op: 'session'; record: SessionRecord }
  | { at: number; op: 'removeSession'; appSessionId: AppSessionId };

export interface Scenario {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  digests: ScenarioDigest[];
  engine: EngineSessionStatus[];
  attention: { appSessionId: AppSessionId; items: AttentionItem[]; requests: Record<string, SessionEvent> }[];
  timeline: ScenarioOp[]; // in play order: by `at`, file order within the same `at`
}

export class ScenarioError extends Error {}

const ANNOTATIONS = new Set(['_from', '_synthetic', '_note']);
function stripAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAnnotations);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ANNOTATIONS.has(key)).map(([key, v]) => [key, stripAnnotations(v)]));
}

const pathOf = (path: readonly PropertyKey[]) =>
  path.reduce<string>((out, part) => (typeof part === 'number' ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part)), '');

// X1's record carries `gateway { routed, baseUrl, autoModeServer }`, C3's status `{ mode, baseUrl, verified, … }`: the
// scripted `routed` is converted, never copied, to the two outcomes C3's verification produces for a verified launch;
// an unknown `routed` (null) is a routed launch whose verification has not answered yet.
function gatewayOf(record: SessionRecord): EngineSessionStatus['gateway'] {
  const { autoModeServer } = record.gateway;
  if (record.gateway.routed === null) return { mode: 'gateway', baseUrl: null, verified: 'pending', autoModeServer, localLane: null };
  return record.gateway.routed
    ? { mode: 'gateway', baseUrl: RELAY_URL, verified: 'routed', autoModeServer, localLane: null }
    : { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer, localLane: null };
}

export function expandEngine(compact: CompactEngine, record: SessionRecord, times: { launchedAt: string; playedAt: string }, where: string): EngineSessionStatus {
  const effort = EffortSchema.nullable().safeParse(record.effort);
  if (!effort.success) throw new ScenarioError(`${where}: the session's effort ${JSON.stringify(record.effort)} is not an effort level`);
  const status: EngineSessionStatus = {
    appSessionId: compact.appSessionId,
    engineSessionId: record.engineSessionId,
    pid: null,
    launchId: 'scenario',
    launchedAt: times.launchedAt,
    taskListId: null,
    cwd: record.directory,
    pendingPlan: null,
    process: compact.process,
    exit: compact.exit ? { code: null, signal: null, reason: compact.exit.reason, at: times.playedAt, release: null /* C12 */ } : null,
    engineState: compact.engineState,
    activity: null,
    turn:
      compact.turn === null
        ? null
        : {
            ...compact.turn,
            // X1's EventId form `${appSessionId}:${launchId}:${seq}:${i}`: the turn.started event of the scenario launch
            id: EventIdSchema.parse(`${compact.appSessionId}:scenario:1:0`),
            acceptedAt: compact.turn.acceptedAt === undefined ? compact.turn.startedAt : compact.turn.acceptedAt,
          },
    model: record.model,
    effort: effort.data,
    permissionMode: record.permissionMode,
    prePlanMode: null,
    gateway: gatewayOf(record),
    subagentModel: null,
    modelOverrides: {},
    engineVersion: record.engineVersion,
    fileCheckpointing: true, // C3 sets CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING on every launch
    fastMode: { state: null, disabledReason: null },
    plugins: [],
    pluginErrors: [],
    pluginWarnings: [],
    backgroundTasks: [],
    grants: [],
    mcpServers: [],
    heldPeerMessages: [],
    pendingRequests: compact.pendingRequests,
    queue: { length: 0, paused: false },
    keepAlive: compact.turn === null ? [] : ['turn'],
    // C12 start: an open turn is the queue's busy; the launch is the last use
    busy: compact.turn !== null,
    lastUsedAt: times.launchedAt,
    // C12 end
    memory: { rssKiB: null, treeRssKiB: null, sampledAt: null },
    journalPath: '',
    hostHooks: [],
    lastEventSeq: 0,
    trust: { attested: false, recorded: null }, // C10: a scenario session attests nothing
  };
  const parsed = EngineSessionStatusSchema.safeParse(status);
  if (!parsed.success) throw new ScenarioError(`${where}: ${pathOf(parsed.error.issues[0].path)}: ${parsed.error.issues[0].message}`);
  return parsed.data;
}

// `now` is the load time in ms: statuses launch then, and a timeline exit is stamped at its scheduled play time.
export function parseScenario(raw: unknown, now: number = Date.now()): Scenario {
  const parsed = ScenarioFileSchema.safeParse(stripAnnotations(raw));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ScenarioError(`${pathOf(issue.path)}: ${issue.message}`);
  }
  const file = parsed.data;
  const records = new Map<AppSessionId, SessionRecord>();
  file.sessions.forEach((record, i) => {
    if (records.has(record.appId)) throw new ScenarioError(`sessions[${i}].appId: duplicate ${record.appId}`);
    records.set(record.appId, record);
  });
  const projectIds = new Set(file.projects.map((p) => p.id));
  file.sessions.forEach((record, i) => {
    if (record.projectId !== null && !projectIds.has(record.projectId)) throw new ScenarioError(`sessions[${i}].projectId: unknown project ${record.projectId}`);
  });
  const known = (id: AppSessionId, where: string) => {
    const record = records.get(id);
    if (!record) throw new ScenarioError(`${where}: unknown session ${id}`);
    return record;
  };
  file.digests.forEach((d, i) => known(d.appSessionId, `digests[${i}].appSessionId`));
  file.attention.forEach((a, i) => known(a.appSessionId, `attention[${i}].appSessionId`));

  const launchedAt = new Date(now).toISOString();
  const engine = file.engine.map((compact, i) =>
    expandEngine(compact, known(compact.appSessionId, `engine[${i}].appSessionId`), { launchedAt, playedAt: launchedAt }, `engine[${i}]`),
  );

  // Records the timeline itself adds (`session` ops) count as known from their entry on.
  const timeline = file.timeline
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at - b.entry.at || a.index - b.index)
    .map(({ entry, index }): ScenarioOp => {
      const where = `timeline[${index}]`;
      switch (entry.op) {
        case 'session':
          records.set(entry.record.appId, entry.record);
          return entry;
        case 'engine': {
          const record = known(entry.appSessionId, `${where}.appSessionId`);
          if (entry.engine === null) return { ...entry, engine: null };
          if (entry.engine.appSessionId !== entry.appSessionId) throw new ScenarioError(`${where}.engine.appSessionId: differs from the op's`);
          const playedAt = new Date(now + entry.at).toISOString();
          return { ...entry, engine: expandEngine(entry.engine, record, { launchedAt, playedAt }, where) };
        }
        case 'digest':
          known(entry.digest.appSessionId, `${where}.digest.appSessionId`);
          return entry;
        default:
          known(entry.appSessionId, `${where}.appSessionId`);
          return entry;
      }
    });

  return { projects: file.projects, sessions: file.sessions, digests: file.digests, engine, attention: file.attention, timeline };
}

export function loadScenario(path: string, now?: number): Scenario {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ScenarioError(`cannot read scenario ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return parseScenario(raw, now);
  } catch (error) {
    if (error instanceof ScenarioError) throw new ScenarioError(`scenario ${path}: ${error.message}`);
    throw error;
  }
}
