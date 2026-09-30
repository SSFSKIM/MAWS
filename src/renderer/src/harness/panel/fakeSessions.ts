// The `#panel` harness's fake sessions (C8a, ruling O1): records A (a plain directory) and B (a worktree), built from
// the committed harness scenario that main also serves under `MAWS_SESSION_SOURCE=stub:test/fixtures/panel/
// harness-sessions.json`, so main's read model knows both and `layout.set` accepts their panel keys. The page seeds
// `useSessions` itself: there is no `connectShell` here, whose snapshot would replace these records.
import * as z from 'zod';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { SessionRecordSchema, type SessionRecord } from '@shared/graph/session';
import { SessionDigestSchema, type SessionDigest } from '@shared/ipc/schema';
import { useSessions } from '../../stores/sessions';
import scenario from '../../../../../test/fixtures/panel/harness-sessions.json';

export const FAKE_IDS = ['A', 'B'] as const;
export type FakeId = (typeof FAKE_IDS)[number];

const records = z.array(SessionRecordSchema).parse(scenario.sessions);
const digests = z.array(SessionDigestSchema.omit({ revision: true })).parse(scenario.digests);

export const FAKE_RECORDS: ReadonlyMap<AppSessionId, SessionRecord> = new Map(records.map((r) => [r.appId, r]));

export const fakeId = (id: FakeId): AppSessionId => id as AppSessionId;

// A's engine status (M2): live in this app, idle, with a shell and a workflow in the background, so the summary's
// Background work reads `1 shell · 1 workflow`; B has none, so it is disk-only.
export function liveStatus(record: SessionRecord): EngineSessionStatus {
  return EngineSessionStatusSchema.parse({
    appSessionId: record.appId, engineSessionId: record.engineSessionId, pid: null, launchId: 'harness', launchedAt: record.createdAt, taskListId: null,
    cwd: record.directory, pendingPlan: null, process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: record.model,
    effort: null, permissionMode: record.permissionMode, prePlanMode: null,
    gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLane: null }, subagentModel: null, modelOverrides: {},
    engineVersion: record.engineVersion, fileCheckpointing: true, fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [],
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
    digests: new Map(digests.map((d): [AppSessionId, SessionDigest] => [d.appSessionId, { ...d, revision: 1 }])),
    engine: new Map([[fakeId('A'), liveStatus(FAKE_RECORDS.get(fakeId('A'))!)]]),
    recordsVersion: s.recordsVersion + 1,
    digestsVersion: s.digestsVersion + 1,
  }));
}
