// The `#panel` harness's fake sessions (C8a, ruling O1): records A (a plain directory) and B (a worktree), built from
// the committed harness scenario that main also serves under `MAWS_SESSION_SOURCE=stub:test/fixtures/panel/
// harness-sessions.json`, so main's read model knows both and `layout.set` accepts their panel keys. The page seeds
// `useSessions` itself: there is no `connectShell` here, whose snapshot would replace these records. P5 O6 M2: the page
// holds addresses, so the scenario's bare ids are lifted with the local machine, as the client lifts main's answers.
import * as z from 'zod';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { SessionRecordSchema, type SessionRecord } from '@shared/graph/session';
import { ProjectRecordSchema, SessionDigestSchema, type SessionDigest } from '@shared/ipc/schema';
import { addressOf, compileAddressing } from '@shared/machine/address';
import { ipc } from '../../ipc/client';
import { useSessions } from '../../stores/sessions';
import scenario from '../../../../../test/fixtures/panel/harness-sessions.json';

export const FAKE_IDS = ['A', 'B'] as const;
export type FakeId = (typeof FAKE_IDS)[number];

const lifted = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => compileAddressing(schema).lift(schema.parse(value), ipc.localMachine);
const records = lifted(z.array(SessionRecordSchema), scenario.sessions);
const projects = lifted(z.array(ProjectRecordSchema), scenario.projects);
const digests = lifted(z.array(SessionDigestSchema.omit({ revision: true, availability: true })), scenario.digests); // P2-A: availability is main's read model's

export const FAKE_RECORDS: ReadonlyMap<AppSessionId, SessionRecord> = new Map(records.map((r) => [r.appId, r]));

// The page's id of a fake session: its local address (main, over the raw bridge, knows it as the bare 'A' or 'B').
export const fakeId = (id: FakeId): AppSessionId => addressOf(ipc.localMachine, id as AppSessionId);

// A's engine status (M2): live in this app, idle, with a shell and a workflow in the background, so the summary's
// Background work reads `1 shell · 1 workflow`; B has none, so it is disk-only.
export function liveStatus(record: SessionRecord): EngineSessionStatus {
  return EngineSessionStatusSchema.parse({
    appSessionId: record.appId, engineSessionId: record.engineSessionId, pid: null, launchId: 'harness', launchedAt: record.createdAt, taskListId: null,
    cwd: record.directory, pendingPlan: null, process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: record.model,
    effort: null, permissionMode: record.permissionMode, prePlanMode: null,
    gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLane: null }, subagentModel: null, modelOverrides: {},
    engineVersion: record.engineVersion, fileCheckpointing: true, bin: `/Users/owner/.local/share/claude/versions/${record.engineVersion ?? '2.1.283'}`, fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [], pluginsObservedAt: null /* P2-A */,
    backgroundTasks: [
      { taskId: 'harness-shell', taskType: 'local_bash', description: 'pnpm dev', ambient: false },
      { taskId: 'harness-workflow', taskType: 'local_workflow', description: 'review pass', ambient: false },
    ],
    grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0, queue: { length: 0, paused: false }, keepAlive: ['background_tasks'], busy: false, lastUsedAt: record.createdAt, // C12: busy and lastUsedAt
    memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '', hostHooks: [], lastEventSeq: 0,
    trust: { attested: false, recorded: null }, // C10's X6 field
  });
}

export function seedFakeSessions(): void {
  useSessions.setState((s) => ({
    loaded: true,
    records: new Map(FAKE_RECORDS),
    projects: new Map(projects.map((project) => [project.id, project])),
    // P2-A: what main's read model would derive: A's process is ready, B is disk-only
    digests: new Map(digests.map((d): [AppSessionId, SessionDigest] => [d.appSessionId, { ...d, availability: d.appSessionId === fakeId('A') ? 'usable' : 'resumable', revision: 1 }])),
    engine: new Map([[fakeId('A'), liveStatus(FAKE_RECORDS.get(fakeId('A'))!)]]),
    recordsVersion: s.recordsVersion + 1,
    projectsVersion: s.projectsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  }));
}
