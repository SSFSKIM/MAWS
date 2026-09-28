import { describe, expect, it } from 'vitest';
import { EngineSessionStatusSchema } from '../../src/shared/engine/status';
import { parseScenario, ScenarioError } from './scenario';

const NOW = Date.parse('2026-09-28T10:00:00.000Z');

const record = (appId: string, over: Record<string, unknown> = {}) => ({
  appId, engineSessionId: `eng-${appId}`, projectId: null, directory: '/tmp/x', additionalDirectories: [], worktree: null, branch: null,
  title: { text: appId, source: 'user', _synthetic: true }, pinned: false, archived: false, holder: { kind: 'self' },
  lastSeen: { messageUuid: null, at: null }, unread: false, engineVersion: '2.1.283', gateway: { routed: true },
  model: { requested: null, resolved: 'claude-opus' }, effort: null, permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
  createdAt: '2026-09-28T09:00:00Z', updatedAt: '2026-09-28T09:00:00Z', _from: 'hand-written', ...over,
});
const turn = { origin: 'human', startedAt: '2026-09-28T09:59:00Z', userMessageUuids: [] };
const file = (over: Record<string, unknown> = {}) => ({
  version: 1, projects: [], digests: [], attention: [], timeline: [],
  sessions: [record('a'), record('b', { gateway: { routed: false }, effort: 'high' })],
  engine: [
    { appSessionId: 'a', process: 'ready', engineState: 'running', turn, pendingRequests: 0 },
    { appSessionId: 'b', process: 'ready', engineState: 'idle', turn: null, pendingRequests: 0 },
  ],
  ...over,
});

describe('scenario loader', () => {
  it('expands compact engine entries into C3’s full status', () => {
    const scenario = parseScenario(file(), NOW);
    for (const status of scenario.engine) expect(EngineSessionStatusSchema.safeParse(status).success).toBe(true);
    const [a, b] = scenario.engine;
    expect(a).toMatchObject({ launchId: 'scenario', launchedAt: '2026-09-28T10:00:00.000Z', pid: null, exit: null, keepAlive: ['turn'], fileCheckpointing: true });
    expect(a.turn).toEqual({ ...turn, acceptedAt: turn.startedAt });
    expect(b).toMatchObject({ keepAlive: [], turn: null, effort: 'high' });
  });

  it('keeps an explicit acceptedAt', () => {
    const scenario = parseScenario(file({ engine: [{ appSessionId: 'a', process: 'ready', engineState: 'running', turn: { ...turn, acceptedAt: null }, pendingRequests: 0 }] }), NOW);
    expect(scenario.engine[0].turn?.acceptedAt).toBeNull();
  });

  it('converts the record’s gateway, never copies it', () => {
    const [a, b] = parseScenario(file(), NOW).engine;
    expect(a.gateway).toEqual({ mode: 'gateway', baseUrl: 'http://127.0.0.1:8641', verified: 'routed', autoModeServer: 'unknown', localLaneObserved: false });
    expect(b.gateway).toEqual({ mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'unknown', localLaneObserved: false });
  });

  it('fails the load naming the entry whose session has an effort that is not an effort level', () => {
    const bad = file({ sessions: [record('a'), record('b', { effort: 'turbo' })] });
    expect(() => parseScenario(bad, NOW)).toThrow(ScenarioError);
    expect(() => parseScenario(bad, NOW)).toThrow(/^engine\[1\]: .*"turbo"/);
  });

  it('reports the first invalid entry by path', () => {
    expect(() => parseScenario(file({ sessions: [record('a', { pinned: 'yes' })] }), NOW)).toThrow(/^sessions\[0\]\.pinned: /);
    expect(() => parseScenario(file({ digests: [{ appSessionId: 'zz' }] }), NOW)).toThrow(/^digests\[0\]/);
  });

  it('stamps a timeline exit at its play time and orders entries by time, then file order', () => {
    const scenario = parseScenario(
      file({
        timeline: [
          { at: 12000, op: 'engine', appSessionId: 'a', engine: { appSessionId: 'a', process: 'exited', engineState: 'idle', turn: null, pendingRequests: 0, exit: { reason: 'unknown' } } },
          { at: 3000, op: 'removeSession', appSessionId: 'b' },
          { at: 3000, op: 'engine', appSessionId: 'b', engine: null },
        ],
      }),
      NOW,
    );
    expect(scenario.timeline.map((op) => [op.at, op.op])).toEqual([[3000, 'removeSession'], [3000, 'engine'], [12000, 'engine']]);
    const exit = scenario.timeline[2];
    expect(exit.op === 'engine' && exit.engine?.exit).toEqual({ code: null, signal: null, reason: 'unknown', at: '2026-09-28T10:00:12.000Z' });
  });
});
