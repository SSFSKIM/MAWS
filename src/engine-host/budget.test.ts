import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import { DEFAULT_BUDGET_FRACTION, defaultBudgetKiB, evaluate, EXITED_RING, EXITED_ROWS_MAX, hardReasons, type BudgetInput } from './budget';

const id = (s: string) => s as AppSessionId;

// A ready, idle, measured process with nothing held: a candidate once quiet.
function row(appSessionId: string, over: Partial<EngineSessionStatus> = {}): EngineSessionStatus {
  return EngineSessionStatusSchema.parse({
    appSessionId, engineSessionId: null, pid: 100, launchId: 'L1', launchedAt: '2026-09-29T10:00:00.000Z', taskListId: null, cwd: '/w', pendingPlan: null,
    process: 'ready', exit: null, engineState: 'idle', activity: null, turn: null, model: { requested: null, resolved: null }, effort: null,
    permissionMode: { requested: 'default', effective: 'default', refusal: null }, prePlanMode: null,
    gateway: { mode: 'gateway', baseUrl: null, verified: 'routed', autoModeServer: 'unknown', localLane: null },
    subagentModel: null, modelOverrides: {}, engineVersion: '2.1.283', fileCheckpointing: true, bin: '/b/claude', fastMode: { state: null, disabledReason: null },
    plugins: [], pluginErrors: [], pluginWarnings: [], backgroundTasks: [], grants: [], mcpServers: [], heldPeerMessages: [], pendingRequests: 0,
    queue: { length: 0, paused: false }, keepAlive: [], busy: false, lastUsedAt: '2026-09-29T10:00:00.000Z',
    memory: { rssKiB: 100_000, treeRssKiB: 400_000, sampledAt: '2026-09-29T10:00:10.000Z' }, journalPath: '/j', hostHooks: [], lastEventSeq: 7,
    trust: { attested: false, recorded: null }, ...over,
  });
}

const TURN = { id: 'app:L1:4:0' as never, origin: 'human' as const, startedAt: '2026-09-29T10:00:00.000Z', acceptedAt: '2026-09-29T10:00:00.000Z', userMessageUuids: [] };
const NONE: ReadonlySet<string> = new Set();

function input(rows: EngineSessionStatus[], over: Partial<BudgetInput> = {}): BudgetInput {
  return {
    rows, policy: { enabled: true, limitKiB: 1, statefulMcpServers: [] }, quiet: new Set(rows.map((r) => r.appSessionId)), releasing: null, previousOverWithoutCandidate: false, ...over,
  };
}

describe('hard reasons', () => {
  it('names nothing for an idle process with nothing held', () => {
    expect(hardReasons(row('a'), NONE)).toEqual([]);
  });

  it('names each reason alone', () => {
    expect(hardReasons(row('a', { turn: TURN, busy: true }), NONE)).toEqual(['turn']); // an open turn is the queue's busy too: named once, as the turn
    expect(hardReasons(row('a', { busy: true }), NONE)).toEqual(['busy']);
    expect(hardReasons(row('a', { backgroundTasks: [{ taskId: 't1' as never, taskType: 'local_bash', description: 'sleep 900', ambient: false }] }), NONE)).toEqual(['background_tasks']);
    expect(hardReasons(row('a', { pendingRequests: 1 }), NONE)).toEqual(['pending_request']);
    expect(hardReasons(row('a', { pendingPlan: 'the plan' }), NONE)).toEqual(['pending_request']); // a clear-and-implement plan kept for retry
    expect(hardReasons(row('a', { queue: { length: 1, paused: false } }), NONE)).toEqual(['queued_messages']);
    expect(hardReasons(row('a', { queue: { length: 1, paused: true } }), NONE)).toEqual(['queued_messages']); // paused or not
    expect(hardReasons(row('a', { heldPeerMessages: [{ messageUuid: 'm', from: 'uds:/x', fromName: null, lane: 'socket', heldAt: 'x', expiresAt: 'y' }] }), NONE)).toEqual(['held_peer_message']);
    expect(hardReasons(row('a', { mcpServers: [{ name: 'c12-kernel', status: 'connected', source: 'project' }] }), new Set(['c12-kernel']))).toEqual(['stateful_mcp']);
  });

  it('names every reason a process holds, in a fixed order', () => {
    const all = row('a', {
      turn: TURN, busy: true, pendingRequests: 2, queue: { length: 1, paused: true },
      backgroundTasks: [{ taskId: 't1' as never, taskType: 'local_workflow', description: 'w', ambient: false }],
      heldPeerMessages: [{ messageUuid: 'm', from: 'uds:/x', fromName: null, lane: 'socket', heldAt: 'x', expiresAt: 'y' }],
      mcpServers: [{ name: 'k', status: 'pending', source: null }],
    });
    expect(hardReasons(all, new Set(['k']))).toEqual(['turn', 'background_tasks', 'pending_request', 'queued_messages', 'held_peer_message', 'stateful_mcp']);
  });

  it('session grants and a connected server nobody listed never block (§4.4 as amended)', () => {
    const s = row('a', { grants: ['Bash(touch c12-before.txt)'], mcpServers: [{ name: 'plugin:ptc:ptc', status: 'connected', source: 'plugin' }, { name: 'gh', status: 'connected', source: 'user' }] });
    expect(hardReasons(s, NONE)).toEqual([]);
    expect(hardReasons(s, new Set(['c12-kernel']))).toEqual([]);
  });

  it('a listed server blocks while pending and while connected, matched by its exact name, and not once failed, disabled or needing auth', () => {
    const listed = new Set(['plugin:ptc:ptc']);
    const withStatus = (status: string, name = 'plugin:ptc:ptc') => row('a', { mcpServers: [{ name, status, source: null }] });
    expect(hardReasons(withStatus('connected'), listed)).toEqual(['stateful_mcp']);
    expect(hardReasons(withStatus('pending'), listed)).toEqual(['stateful_mcp']);
    for (const status of ['failed', 'disabled', 'needs-auth']) expect(hardReasons(withStatus(status), listed), status).toEqual([]);
    expect(hardReasons(withStatus('connected', 'ptc'), listed)).toEqual([]);
    expect(hardReasons(withStatus('connected', 'Plugin:ptc:ptc'), listed)).toEqual([]);
  });

  it("ambient tasks are the engine's housekeeping, not the owner's work: they never block, and a real task beside one still does", () => {
    const ambient = { taskId: 't-dream' as never, taskType: 'dream', description: 'memory consolidation', ambient: true };
    expect(hardReasons(row('a', { backgroundTasks: [ambient] }), NONE)).toEqual([]);
    expect(hardReasons(row('a', { backgroundTasks: [ambient, { taskId: 't2' as never, taskType: 'local_bash', description: 'sleep 900', ambient: false }] }), NONE)).toEqual(['background_tasks']);
  });
});

describe('evaluate', () => {
  it('sums the trees of starting, initializing and ready processes; exiting and exited trees are not counted', () => {
    const rows = [
      row('a', { memory: { rssKiB: 1, treeRssKiB: 100, sampledAt: 'x' } }),
      row('b', { process: 'starting', memory: { rssKiB: 1, treeRssKiB: 20, sampledAt: 'x' } }),
      row('c', { process: 'initializing', memory: { rssKiB: 1, treeRssKiB: 3, sampledAt: 'x' } }),
      row('d', { process: 'exiting', memory: { rssKiB: 1, treeRssKiB: 5_000, sampledAt: 'x' } }),
      row('e', { process: 'exited', memory: { rssKiB: 1, treeRssKiB: 7_000, sampledAt: 'x' } }),
    ];
    const v = evaluate(input(rows, { policy: { enabled: true, limitKiB: 200, statefulMcpServers: [] } }));
    expect(v).toMatchObject({ totalKiB: 123, limitKiB: 200, over: false, release: null });
  });

  it('counts the live rows with no sample yet as unmeasured, each counted as 0 in the sum', () => {
    const unmeasured = { rssKiB: null, treeRssKiB: null, sampledAt: null };
    const rows = [row('a', { memory: { rssKiB: 1, treeRssKiB: 50, sampledAt: 'x' } }), row('b', { memory: unmeasured }), row('c', { process: 'starting', pid: null, memory: unmeasured }), row('d', { process: 'exiting', memory: unmeasured })];
    expect(evaluate(input(rows))).toMatchObject({ totalKiB: 50, unmeasured: 2 });
  });

  it('is over only when the sum exceeds the budget, and releases nothing when not over', () => {
    const rows = [row('a', { memory: { rssKiB: 1, treeRssKiB: 600, sampledAt: 'x' } }), row('b', { memory: { rssKiB: 1, treeRssKiB: 400, sampledAt: 'x' } })];
    expect(evaluate(input(rows, { policy: { enabled: true, limitKiB: 1_000, statefulMcpServers: [] } }))).toMatchObject({ over: false, release: null, candidates: 2 });
    expect(evaluate(input(rows, { policy: { enabled: true, limitKiB: 999, statefulMcpServers: [] } }))).toMatchObject({ over: true, candidates: 2 });
  });

  it('releases the least recently used candidate, ties broken by appSessionId, one per evaluation', () => {
    const rows = [
      row('c', { lastUsedAt: '2026-09-29T10:05:00.000Z' }),
      row('b', { lastUsedAt: '2026-09-29T10:01:00.000Z' }),
      row('a', { lastUsedAt: '2026-09-29T10:03:00.000Z' }),
    ];
    const v = evaluate(input(rows));
    expect(v).toMatchObject({ over: true, candidates: 3, release: 'b' });
    const tied = [row('z', { lastUsedAt: '2026-09-29T10:01:00.000Z' }), row('y', { lastUsedAt: '2026-09-29T10:01:00.000Z' }), row('x', { lastUsedAt: '2026-09-29T10:09:00.000Z' })];
    expect(evaluate(input(tied)).release).toBe('y');
  });

  it('releases nothing while a release is still exiting, and says which', () => {
    const v = evaluate(input([row('a'), row('b')], { releasing: id('gone') }));
    expect(v).toMatchObject({ over: true, candidates: 2, release: null });
  });

  it('excludes each non-candidate alone: not ready, engine not idle, unmeasured, not quiet; each counts as settling', () => {
    const notCandidates: [string, EngineSessionStatus][] = [
      ['starting', row('x', { process: 'starting' })],
      ['initializing', row('x', { process: 'initializing' })],
      ['engine running', row('x', { engineState: 'running' })],
      ['engine requires_action', row('x', { engineState: 'requires_action' })],
      ['unmeasured', row('x', { memory: { rssKiB: null, treeRssKiB: null, sampledAt: null } })],
    ];
    for (const [why, s] of notCandidates) {
      expect(evaluate(input([s])), why).toMatchObject({ candidates: 0, settling: 1, blocked: [], release: null });
    }
    // a row whose lastEventSeq moved since the previous sample is not in `quiet`
    expect(evaluate(input([row('x')], { quiet: new Set() }))).toMatchObject({ candidates: 0, settling: 1, release: null });
  });

  // The pinned engine emits `session_state_changed` only under CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS, which X6 sets
  // from C12 M5 on; before its first frame (and on any launch without the variable, as M3's live run was) a row's engine
  // state is `unknown`. Such a row is a candidate once ready, measured, quiet and holding nothing; an engine's own
  // follow-up turn after its background tasks end moves `lastEventSeq` (so the row is not quiet) and then opens a turn
  // (a hard reason).
  it('a ready row whose engine never reported its state (unknown) is a candidate once quiet; the follow-up window is not quiet', () => {
    const silent = row('x', { engineState: 'unknown' });
    expect(evaluate(input([silent]))).toMatchObject({ candidates: 1, settling: 0, release: id('x') });
    expect(evaluate(input([silent], { quiet: new Set() }))).toMatchObject({ candidates: 0, settling: 1, release: null });
    expect(evaluate(input([row('x', { engineState: 'unknown', turn: { ...TURN, origin: 'engine' } })]))).toMatchObject({ candidates: 0, release: null, blocked: [{ appSessionId: id('x'), reasons: ['turn'] }] });
  });

  it('a busy process (a written message not yet started, a ! command pending, a held clear-and-implement) is blocked, never a candidate', () => {
    const v = evaluate(input([row('x', { busy: true })]));
    expect(v).toMatchObject({ candidates: 0, settling: 0, release: null, blocked: [{ appSessionId: 'x', reasons: ['busy'] }] });
  });

  it('lists every live row with a hard reason as blocked, with why, and releases around them', () => {
    const rows = [
      row('turn', { turn: TURN, busy: true, lastUsedAt: '2026-09-29T09:00:00.000Z' }),
      row('kernel', { mcpServers: [{ name: 'c12-kernel', status: 'connected', source: 'project' }], lastUsedAt: '2026-09-29T09:00:00.000Z' }),
      row('free', { lastUsedAt: '2026-09-29T11:00:00.000Z' }),
      row('leaving', { process: 'exiting', turn: TURN }),
    ];
    const v = evaluate(input(rows, { policy: { enabled: true, limitKiB: 1, statefulMcpServers: ['c12-kernel'] } }));
    expect(v.blocked).toEqual([{ appSessionId: 'turn', reasons: ['turn'] }, { appSessionId: 'kernel', reasons: ['stateful_mcp'] }]);
    expect(v).toMatchObject({ candidates: 1, settling: 0, release: 'free' });
  });

  it('flags over-with-no-candidate only on the second consecutive sample', () => {
    const blocked = [row('a', { turn: TURN })];
    const first = evaluate(input(blocked, { previousOverWithoutCandidate: false }));
    expect(first).toMatchObject({ over: true, candidates: 0, overWithoutCandidate: false });
    expect(evaluate(input(blocked, { previousOverWithoutCandidate: true }))).toMatchObject({ overWithoutCandidate: true });
    // a candidate, or being under budget, clears it whatever the previous sample said
    expect(evaluate(input([row('a')], { previousOverWithoutCandidate: true }))).toMatchObject({ overWithoutCandidate: false, release: 'a' });
    expect(evaluate(input(blocked, { previousOverWithoutCandidate: true, policy: { enabled: true, limitKiB: 10_000_000, statefulMcpServers: [] } }))).toMatchObject({ over: false, overWithoutCandidate: false });
  });

  // W7: settings' switch off (charter §4.4 as amended 2026-10-01): the sum and the classification stand, nothing is over
  it('with the budget off, sums and classifies as ever but is never over: no release and no flag', () => {
    const off = { enabled: false, limitKiB: 1, statefulMcpServers: [] };
    const free = evaluate(input([row('a'), row('b', { turn: TURN })], { policy: off }));
    expect(free).toMatchObject({ totalKiB: 800_000, over: false, release: null, candidates: 1, blocked: [{ appSessionId: 'b', reasons: ['turn'] }] });
    expect(evaluate(input([row('b', { turn: TURN })], { policy: off, previousOverWithoutCandidate: true }))).toMatchObject({ over: false, overWithoutCandidate: false });
  });

  it('answers the same verdict for the same input (pure: no clock, no state)', () => {
    const i = input([row('a', { lastUsedAt: '2026-09-29T10:01:00.000Z' }), row('b', { turn: TURN })]);
    expect(evaluate(i)).toEqual(evaluate(i));
  });
});

describe('policy constants', () => {
  it('defaults the budget to a quarter of physical memory, in KiB: 8 GiB on a 32 GiB Mac', () => {
    expect(DEFAULT_BUDGET_FRACTION).toBe(0.25);
    expect(defaultBudgetKiB(32 * 1024 ** 3)).toBe(8 * 1024 ** 2);
    expect(defaultBudgetKiB(1_000_003)).toBe(Math.floor((1_000_003 / 1024) * 0.25));
  });

  it('bounds exited history: 500 events per exited stream, 24 exited rows', () => {
    expect(EXITED_RING).toBe(500);
    expect(EXITED_ROWS_MAX).toBe(24);
  });
});
