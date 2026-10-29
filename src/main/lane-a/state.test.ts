// A bridged session's state (P5 O9 M2, Interfaces §A `LaneAState`): what `/status` says it can do, and what its state
// stream says it is doing.
import { describe, expect, it } from 'vitest';
import { classify, SessionFold } from './state';

const controls = { model: { available: true } };

describe('the bridge’s state from /status', () => {
  it('is live once ready with capabilities.controls, starting while not ready, observer for a lane B verdict', () => {
    expect(classify({ ready: true, capabilities: { sminos: '1.25.0', controls } })).toEqual({ bridge: 'live', reason: null });
    expect(classify({ ready: false })).toEqual({ bridge: 'starting', reason: 'the session’s bridge is starting' });
    expect(classify({ ready: true, lane: 'match', capabilities: { controls } })).toEqual({ bridge: 'observer', reason: 'MAWS controls this session' });
    // the bridge observes until its verdict is mismatch, and retries an unresolved one: MAWS waits for it as for a start
    expect(classify({ ready: true, lane: 'unresolved', capabilities: { controls } })).toEqual({ bridge: 'starting', reason: 'the bridge is still deciding whether MAWS controls this session' });
    expect(classify({ ready: true, lane: 'mismatch', capabilities: { controls } }).bridge).toBe('live');
  });

  it('is none for a sminos whose capabilities carry no controls, naming the update', () => {
    expect(classify({ ready: true, capabilities: { sminos: '1.10.2', ops: [] } })).toEqual({
      bridge: 'none',
      reason: 'this session’s sminos (1.10.2) predates MAWS’s controls: update sminos, then run /reload-plugins in the terminal',
    });
    expect(classify({ ready: true }).bridge).toBe('none');
  });
});

describe('the session fold', () => {
  const snapshot = {
    type: 'snapshot', sessionInfo: { model: 'claude-opus-4-5' }, turns: [{ turnId: 't1', agentId: null }], override: { model: 'haiku', effort: null },
    catalog: { fingerprint: 'fp', commands: [], models: { options: [], aliases: {} } },
    pending: [{ request: 'r1', tool: 'Bash', input: {}, agentId: null }], settled: [{ request: 'r0', winner: 'terminal', outcome: 'allow', by: 'terminal' }],
  };

  it('takes the turn, the model, the override, the catalog and the requests from a snapshot', () => {
    const fold = new SessionFold('s');
    fold.snapshot(snapshot);
    expect(fold.view()).toEqual({
      turn: { running: true, unknown: false }, model: 'claude-opus-4-5', override: { model: 'haiku', effort: null }, catalog: { fingerprint: 'fp' },
      pending: [{ request: 'r1', session: 's', tool: 'Bash', input: {} }], settled: [{ request: 'r0', session: 's', winner: 'terminal', outcome: 'allow', by: 'terminal' }],
    });
    expect(fold.catalogBody()).toMatchObject({ fingerprint: 'fp' });
  });

  it('follows the main loop’s turn alone: a subagent’s turn completing leaves it running', () => {
    const fold = new SessionFold('s');
    fold.snapshot({ ...snapshot, turns: [] });
    expect(fold.event({ type: 'turn', phase: 'start', turnId: 't2', agentId: null })).toBe(true);
    expect(fold.view().turn.running).toBe(true);
    fold.event({ type: 'turn', phase: 'start', turnId: 't3', agentId: 'a1' });
    fold.event({ type: 'turn', phase: 'complete', turnId: 't3', agentId: 'a1' });
    expect(fold.view().turn.running).toBe(true);
    fold.event({ type: 'turn', phase: 'complete', turnId: 't2', agentId: null });
    expect(fold.view().turn.running).toBe(false);
    fold.event({ type: 'heartbeat', state: { mainTurn: null, isTurnUnknown: true } });
    expect(fold.view().turn).toEqual({ running: false, unknown: true });
  });

  it('raises and settles requests, keeps the last 100 settlements, and follows the override and the catalog', () => {
    const fold = new SessionFold('s');
    fold.snapshot({ ...snapshot, pending: [], settled: [] });
    fold.event({ type: 'raised', request: 'r2', tool: 'Bash', input: {}, agentId: 'a1', deadline: 0 });
    expect(fold.view().pending).toEqual([{ request: 'r2', session: 's', tool: 'Bash', input: {}, agentId: 'a1', deadline: new Date(0).toISOString() }]);
    expect(fold.raised('r2')).toMatchObject({ request: 'r2' });
    fold.event({ type: 'settled', request: 'r2', winner: 'web', outcome: 'allow', by: 'maws' });
    expect(fold.view().pending).toEqual([]);
    expect(fold.settledOf('r2')).toMatchObject({ winner: 'web' });
    for (let i = 0; i < 120; i += 1) fold.event({ type: 'settled', request: `x${i}`, winner: 'terminal', outcome: 'deny', by: 'terminal' });
    expect(fold.view().settled).toHaveLength(100);
    fold.event({ type: 'model', model: null, effort: null });
    expect(fold.view().override).toBeNull();
    fold.event({ type: 'model', model: null, effort: 'low' });
    expect(fold.view().override).toEqual({ model: null, effort: 'low' });
    fold.event({ type: 'catalog', fingerprint: 'fp2', commands: [], models: {} });
    expect(fold.view().catalog).toEqual({ fingerprint: 'fp2' });
    expect(fold.event({ type: 'chunk' })).toBe(false);
  });

  // P5 O9 M6: the digest's activity reads the main loop's latest tool call of its running turn
  it('follows the main loop’s latest tool call while its turn runs, leaving the state unchanged', () => {
    const fold = new SessionFold('s');
    fold.snapshot({ ...snapshot, turns: [] });
    fold.event({ type: 'turn', phase: 'start', turnId: 't1', agentId: null });
    expect(fold.mainTool()).toBeNull();
    expect(fold.event({ type: 'tool', phase: 'call', toolUseId: 'u1', tool: 'Bash', agentId: null, input: { command: 'ls' } })).toBe(false);
    expect(fold.mainTool()).toEqual({ tool: 'Bash', input: { command: 'ls' }, running: true });
    fold.event({ type: 'tool', phase: 'call', toolUseId: 'u2', tool: 'Read', agentId: 'a1', input: {} }); // a subagent's
    expect(fold.mainTool()?.tool).toBe('Bash');
    fold.event({ type: 'tool', phase: 'result', toolUseId: 'u1', tool: 'Bash', agentId: null });
    expect(fold.mainTool()).toEqual({ tool: 'Bash', input: { command: 'ls' }, running: false });
    fold.event({ type: 'turn', phase: 'complete', turnId: 't1', agentId: null });
    expect(fold.mainTool()).toBeNull();
  });
});
