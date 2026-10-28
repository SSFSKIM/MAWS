// Small valid X1/X2 values for unit tests: a session record, an attention item, a digest, and C3's engine status
// (through the scenario loader's expansion, so the status is exactly what a scenario would produce).
import type { AttentionItem } from '../../src/shared/graph/attention';
import type { AttentionKind, AttentionState } from '../../src/shared/graph/enums';
import type { AppSessionId, AttentionId, ProjectId, RequestId, SessionId } from '../../src/shared/graph/ids';
import type { SessionRecord } from '../../src/shared/graph/session';
import type { EngineSessionStatus } from '../../src/shared/engine/status';
import type { ProjectRecord, SessionDigest } from '../../src/shared/ipc/schema/session';
import type { DaemonStatus } from '../../src/shared/ipc/schema/daemon'; // P5 O2 M7
import { expandEngine, type CompactEngine } from './scenario';

export const T0 = '2026-09-28T10:00:00.000Z';

export function record(appId: string, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    appId: appId as AppSessionId, engineSessionId: `eng-${appId}` as SessionId, projectId: null, directory: `/work/${appId}`, additionalDirectories: [],
    worktree: null, branch: null, title: { text: appId, source: 'user' }, pinned: false, archived: false, holder: { kind: 'self' },
    lastSeen: { messageUuid: null, at: null }, unread: false, engineVersion: '2.1.283', gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'unknown' },
    model: { requested: null, resolved: 'claude-opus' }, effort: null, permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
    lineage: null /* E3 */, createdAt: T0, updatedAt: T0, ...over,
  };
}

export function project(id: string, order: number, over: Partial<ProjectRecord> = {}): ProjectRecord {
  return { id: id as ProjectId, name: id, directory: `/work/${id}`, order, createdAt: T0, ...over };
}

export function item(appSessionId: string, kind: AttentionKind, createdAt: string, over: Partial<AttentionItem> = {}): AttentionItem {
  const state: AttentionState = 'pending';
  return {
    id: `att-${appSessionId}-${kind}-${createdAt}` as AttentionId, appSessionId: appSessionId as AppSessionId, sessionId: null, kind,
    request: { requestId: `req-${appSessionId}` as RequestId, toolUseId: null, taskId: null, agentId: null },
    summary: `${kind} for ${appSessionId}`, createdAt, state, stateChangedAt: createdAt, expiresAt: null, ...over,
  };
}

export function digest(appSessionId: string, over: Partial<SessionDigest> = {}): SessionDigest {
  return {
    appSessionId: appSessionId as AppSessionId, phase: 'idle', activity: null, lastAssistantLine: null, turnStartedAt: null, lastTurnEndedAt: null,
    context: null, cost: null, childAgents: { active: 0, done: 0 }, pendingRequests: 0, revision: 1, availability: 'usable' /* P2-A */, ...over,
  };
}

export function status(appSessionId: string, compact: Partial<Omit<CompactEngine, 'appSessionId'>> = {}): EngineSessionStatus {
  const full: CompactEngine = { appSessionId: appSessionId as AppSessionId, process: 'ready', engineState: 'idle', turn: null, pendingRequests: 0, ...compact };
  return expandEngine(full, record(appSessionId), { launchedAt: T0, playedAt: T0 }, 'test');
}

export const humanTurn = { origin: 'human' as const, startedAt: T0, userMessageUuids: [] };

// P5 O2 M7: a private `mawsd`'s daemon.status, both hosts ready
export function daemonStatus(over: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    pid: 4100,
    startedAt: T0,
    kind: 'private',
    build: { version: '0.0.0', commit: 'a1b2c3d4', builtAt: T0, buildId: 'mawsd00000000001', engineHostBuildId: 'engine0000000001' },
    machine: 'mRef0123456789abcdefAB' as DaemonStatus['machine'],
    profile: '/p',
    platform: 'darwin',
    role: 'laptop',
    hosts: { 'engine-host': { state: 'ready', pid: 4200, build: 'engine0000000001', liveSessions: 0 }, 'pty-host': { state: 'ready', pid: 4300, build: 'pty0000000000001', liveSessions: 0 } },
    clients: { engineHost: true, ptyHost: true, machine: 1 },
    idleExitAt: null,
    logPath: '/p/mawsd/mawsd.log',
    endpoint: { present: false, detail: null },
    ...over,
  };
}
