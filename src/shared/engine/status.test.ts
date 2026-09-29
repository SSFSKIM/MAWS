import { describe, expect, it } from 'vitest';
import { SessionRecordSchema, type SessionRecord } from '../graph/session';
import { EngineSessionStatusSchema, toSessionRecordPatch, type EngineSessionStatus } from './status';

const status = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus =>
  EngineSessionStatusSchema.parse({
    appSessionId: 'app-1', engineSessionId: '33333333-3333-4333-8333-333333333333', pid: 42, launchId: 'L1', launchedAt: '2026-09-28T10:00:00.000Z', taskListId: null, cwd: '/w', pendingPlan: null,
    process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: { requested: 'sonnet', resolved: 'claude-sonnet-5' }, effort: 'high',
    permissionMode: { requested: 'auto', effective: 'auto', refusal: null }, prePlanMode: null,
    gateway: { mode: 'gateway', baseUrl: 'http://127.0.0.1:8641', verified: 'routed', autoModeServer: 'enabled', localLane: null },
    subagentModel: null, modelOverrides: {}, engineVersion: '2.1.283', fileCheckpointing: true,
    fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [],
    backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0, queue: { length: 0, paused: false }, keepAlive: [],
    memory: { rssKiB: null, treeRssKiB: null, sampledAt: null }, journalPath: '/j', hostHooks: [], lastEventSeq: 0, trust: { attested: false, recorded: null } /* C10 */, ...over,
  });

const record = (): SessionRecord =>
  SessionRecordSchema.parse({
    appId: 'app-1', engineSessionId: null, projectId: null, directory: '/w', additionalDirectories: [], worktree: null, branch: null, title: { text: 'Untitled', source: 'none' },
    pinned: false, archived: false, holder: { kind: 'none' }, lastSeen: { messageUuid: null, at: null }, unread: false, engineVersion: null,
    gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' }, model: { requested: null, resolved: null }, effort: null,
    permissionMode: { requested: 'default', effective: 'default', refusal: null }, createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z',
  });

describe('toSessionRecordPatch', () => {
  it('maps a live routed status onto the X1 session record, holder self, and the patched record validates', () => {
    const patch = toSessionRecordPatch(status());
    expect(patch).toEqual({
      engineSessionId: '33333333-3333-4333-8333-333333333333', engineVersion: '2.1.283', gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'enabled' },
      model: { requested: 'sonnet', resolved: 'claude-sonnet-5' }, effort: 'high', permissionMode: { requested: 'auto', effective: 'auto', refusal: null }, holder: { kind: 'self' },
    });
    expect(SessionRecordSchema.parse({ ...record(), ...patch })).toMatchObject(patch);
  });

  it('leaves the holder out once the process has exited, and the gateway out while it is unverified', () => {
    const patch = toSessionRecordPatch(status({ process: 'exited', gateway: { mode: 'gateway', baseUrl: null, verified: 'pending', autoModeServer: 'unknown', localLane: null } }));
    expect(patch).not.toHaveProperty('holder');
    expect(patch).not.toHaveProperty('gateway');
    expect(toSessionRecordPatch(status({ gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'disabled', localLane: null } })).gateway).toEqual({ routed: false, baseUrl: null, autoModeServer: 'disabled' });
  });

  it('a mode the engine moved to without a refusal reads as the requested mode, so the record\'s refusal rule holds', () => {
    const patch = toSessionRecordPatch(status({ permissionMode: { requested: 'auto', effective: 'plan', refusal: null } }));
    expect(patch.permissionMode).toEqual({ requested: 'plan', effective: 'plan', refusal: null });
    const refused = toSessionRecordPatch(status({ permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' } }));
    expect(refused.permissionMode).toEqual({ requested: 'auto', effective: 'default', refusal: 'auto_mode_model' });
    expect(SessionRecordSchema.parse({ ...record(), ...patch }).permissionMode.effective).toBe('plan');
  });

  it('the status carries C11\'s fast mode and plugin fields and the per-turn local lane', () => {
    const s = status({
      fastMode: { state: 'off', disabledReason: 'sdk_opt_in_required' }, plugins: [{ name: 'ptc', path: '/p', source: 'ptc@ptc-tool', version: '0.5.0' }],
      pluginErrors: [{ plugin: 'inline[0]', type: 'path-not-found', message: 'missing', path: '/x' }], pluginWarnings: [{ plugin: 'p', type: 'w', message: 'm' }],
      gateway: { mode: 'gateway', baseUrl: null, verified: 'routed', autoModeServer: 'enabled', localLane: { observedInTurn: 'app-1:L1:4:0' as never, at: '2026-09-28T10:00:00.000Z' } },
    });
    expect(EngineSessionStatusSchema.parse(s)).toEqual(s);
    expect(() => EngineSessionStatusSchema.parse({ ...s, gateway: { ...s.gateway, localLaneObserved: true } })).toThrow();
  });
});
