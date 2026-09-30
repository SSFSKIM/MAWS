import { describe, expect, it } from 'vitest';
import { EngineSessionStatusSchema } from '../../src/shared/engine/status';
import { join } from 'node:path';
import { TEST_FIXTURE_DIR } from './fixtures';
import { RELAY_URL as C3_RELAY_URL } from '../../src/engine-host/launch';
import { loadScenario, parseScenario, RELAY_URL, ScenarioError } from './scenario';

const NOW = Date.parse('2026-09-28T10:00:00.000Z');

const record = (appId: string, over: Record<string, unknown> = {}) => ({
  appId, engineSessionId: `eng-${appId}`, projectId: null, directory: '/tmp/x', additionalDirectories: [], worktree: null, branch: null,
  title: { text: appId, source: 'user', _synthetic: true }, pinned: false, archived: false, holder: { kind: 'self' },
  lastSeen: { messageUuid: null, at: null }, unread: false, engineVersion: '2.1.283', gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'unknown' },
  model: { requested: null, resolved: 'claude-opus' }, effort: null, permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
  createdAt: '2026-09-28T09:00:00Z', updatedAt: '2026-09-28T09:00:00Z', _from: 'hand-written', ...over,
});
const turn = { origin: 'human', startedAt: '2026-09-28T09:59:00Z', userMessageUuids: [] };
const file = (over: Record<string, unknown> = {}) => ({
  version: 1, projects: [], digests: [], attention: [], timeline: [],
  sessions: [record('a'), record('b', { gateway: { routed: false, baseUrl: null, autoModeServer: 'enabled' }, effort: 'high' })],
  engine: [
    { appSessionId: 'a', process: 'ready', engineState: 'running', turn, pendingRequests: 0 },
    { appSessionId: 'b', process: 'ready', engineState: 'idle', turn: null, pendingRequests: 0 },
  ],
  ...over,
});

describe('scenario loader', () => {
  it('expands every engine entry and engine op of the shell scenarios into a status C3’s schema accepts', () => {
    for (const name of ['nine-sessions', 'empty', 'many-sessions']) {
      const scenario = loadScenario(join(TEST_FIXTURE_DIR, `shell/${name}.json`), NOW);
      const statuses = [...scenario.engine, ...scenario.timeline.flatMap((op) => (op.op === 'engine' && op.engine ? [op.engine] : []))];
      for (const status of statuses) expect(EngineSessionStatusSchema.safeParse(status).success, `${name} ${status.appSessionId}`).toBe(true);
      if (name === 'nine-sessions') expect(statuses.length).toBeGreaterThanOrEqual(7 + 3);
    }
  });

  it('expands the standard scenario and an engine timeline replacement to C3’s landed shape (ninth ask)', () => {
    const scenario = loadScenario(join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json'), NOW);
    const charter = scenario.sessions.find((s) => s.title.text === 'Charter + research')!;
    const atLoad = scenario.engine.find((s) => s.appSessionId === charter.appId)!;
    const replaced = scenario.timeline.find((op) => op.op === 'engine' && op.appSessionId === charter.appId);
    if (replaced?.op !== 'engine' || !replaced.engine) throw new Error('the 3 s entry replaces Charter + research’s status');
    for (const status of [atLoad, replaced.engine]) {
      expect(EngineSessionStatusSchema.parse(status)).toEqual(status);
      expect(status).toMatchObject({
        taskListId: null,
        cwd: charter.directory,
        pendingPlan: null,
        fastMode: { state: null, disabledReason: null },
        plugins: [],
        pluginErrors: [],
        pluginWarnings: [],
        gateway: { localLane: null },
        turn: { id: `${charter.appId}:scenario:1:0` },
      });
    }
  });

  it('expands compact engine entries into C3’s full status', () => {
    const scenario = parseScenario(file(), NOW);
    for (const status of scenario.engine) expect(EngineSessionStatusSchema.safeParse(status).success).toBe(true);
    const [a, b] = scenario.engine;
    expect(a).toMatchObject({ launchId: 'scenario', launchedAt: '2026-09-28T10:00:00.000Z', pid: null, exit: null, keepAlive: ['turn'], fileCheckpointing: true });
    expect(a.turn).toEqual({ ...turn, id: 'a:scenario:1:0', acceptedAt: turn.startedAt });
    expect(a).toMatchObject({ cwd: '/tmp/x', pendingPlan: null, fastMode: { state: null, disabledReason: null }, plugins: [], pluginErrors: [], pluginWarnings: [] });
    expect(b).toMatchObject({ keepAlive: [], turn: null, effort: 'high' });
  });

  it('keeps an explicit acceptedAt', () => {
    const scenario = parseScenario(file({ engine: [{ appSessionId: 'a', process: 'ready', engineState: 'running', turn: { ...turn, acceptedAt: null }, pendingRequests: 0 }] }), NOW);
    expect(scenario.engine[0].turn?.acceptedAt).toBeNull();
  });

  it('converts the record’s gateway, never copies it', () => {
    const [a, b] = parseScenario(file(), NOW).engine;
    expect(a.gateway).toEqual({ mode: 'gateway', baseUrl: 'http://127.0.0.1:8641', verified: 'routed', autoModeServer: 'unknown', localLane: null });
    expect(b.gateway).toEqual({ mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'enabled', localLane: null }); // the record's
  });

  it('holds the relay URL C3 launches through', () => {
    expect(RELAY_URL).toBe(C3_RELAY_URL);
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
    expect(exit.op === 'engine' && exit.engine?.exit).toEqual({ code: null, signal: null, reason: 'unknown', at: '2026-09-28T10:00:12.000Z', release: null /* C12 */ });
  });
});
