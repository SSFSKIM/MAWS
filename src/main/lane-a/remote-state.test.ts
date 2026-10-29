// A remote lane A session's state from its subscription (P5 O9 M9, "Capabilities", "`model` sends only what changed";
// Decision Log 2026-10-29, pre-flight items 2 to 4): the plane's presence, requests, catalog and main-loop steps folded
// into `LaneAState`, with the override and the model from the bridge's `read status`.
import { describe, expect, it } from 'vitest';
import { RemoteFold } from './remote-state';

const S = 'la-1';
const env = (kind: string, body: unknown, sub: string | null = 'up-1', n: number | null = 1) => ({ project: 'p', machine: 'mini', session: S, kind, sub, n, body });
const controls = { model: { available: true }, 'decide.scope': { available: false, reason: 'not here' } };
const capabilities = { sminos: '1.27.12', protocol: 1, engine: '2.1.312', ops: ['deliver', 'interrupt', 'model'], reads: ['status', 'mcp'], routes: { measured: '2.1.300' }, controls };
const presence = (fields: Record<string, unknown> = {}) => ({ record: { status: 'idle' }, bridge: true, capabilities, launch: 'L1', ...fields });
const snapshot = (fields: Record<string, unknown> = {}) => env('snapshot', { rows: [], more: false, subagents: [], presence: presence(), streaming: [], ...fields }, 'up-1', 0);
const state = (fold: RemoteFold, status: Parameters<RemoteFold['state']>[0]['status'] = null) => fold.state({ appSessionId: S, status, deliveries: [] });

describe('a remote lane A session’s state', () => {
  it('is starting until its first snapshot, then live from the plane’s presence and capabilities', () => {
    const fold = new RemoteFold(S);
    expect(state(fold)).toMatchObject({ bridge: 'starting', launch: null, controls: {} });
    fold.message(snapshot());
    expect(state(fold)).toMatchObject({ appSessionId: S, engineSessionId: S, bridge: 'live', reason: null, launch: 'L1', sminos: '1.27.12', ops: ['deliver', 'interrupt', 'model'], reads: ['status', 'mcp'], controls, turn: { running: false, unknown: false } });
  });

  it('has no bridge, with the reason, when presence names no bridge or no launch, or no process; and predates controls without them', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot({ presence: presence({ bridge: false }) }));
    expect(state(fold)).toMatchObject({ bridge: 'none', reason: 'no bridge' });
    fold.message(env('presence', presence({ launch: undefined }), null, null));
    expect(state(fold)).toMatchObject({ bridge: 'none', reason: 'no bridge', launch: null });
    fold.message(env('presence', presence({ record: null }), null, null));
    expect(state(fold)).toMatchObject({ bridge: 'none', reason: 'the session is not running' });
    fold.message(env('presence', presence({ capabilities: { ...capabilities, controls: undefined } }), null, null));
    expect(state(fold).bridge).toBe('none');
    expect(state(fold).reason).toContain('predates MAWS’s controls');
    fold.message(env('presence', presence({ launch: 'L2' }), null, null));
    expect(state(fold)).toMatchObject({ bridge: 'live', launch: 'L2' });
  });

  it('runs a turn while the engine record says anything but idle, or a main-loop step is open, never from a subagent’s', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot({ streaming: [{ turnId: 't1', agentId: null, step: 2, upTo: 3, blocks: [] }] }));
    expect(state(fold).turn.running).toBe(true); // a watch opened mid-reply knows the step it never saw start
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 2 }));
    expect(state(fold).turn.running).toBe(false);
    fold.message(env('chunk', { turnId: 't2', agentId: 'sub-1', step: 1, chunkIndex: 0, chunk: {} }));
    expect(state(fold).turn.running).toBe(false);
    fold.message(env('chunk', { turnId: 't2', agentId: null, step: 1, chunkIndex: 0, chunk: {} }));
    expect(state(fold).turn.running).toBe(true);
    fold.message(env('step-end', { turnId: 't2', agentId: null, step: 1 }));
    fold.message(env('presence', presence({ record: { status: 'busy' } }), null, null));
    expect(state(fold).turn.running).toBe(true);
    fold.message(env('presence', presence({ record: { status: 'idle' } }), null, null));
    expect(state(fold).turn.running).toBe(false);
  });

  it('takes model and effort from a main-loop step-end that carries them, else the model `read status` gave and no effort', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot());
    const status = { model: 'claude-opus-4-5', override: { model: null, effort: 'high' } };
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: null, override: { model: null, effort: 'high' } });
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 1 }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: null });
    fold.message(env('step-end', { turnId: 't1', agentId: 'sub-1', step: 1, model: 'claude-haiku-4-5', effort: 'low' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: null }); // a subagent’s step says nothing of the main loop
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 2, t: 1730000000000, model: 'claude-haiku-4-5', effort: 'low' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low', override: { model: null, effort: 'high' } });
    expect(state(fold, null)).toMatchObject({ override: null });
  });

  it('keeps the pending requests a snapshot’s following `raised` restate, and the last settlements with their session', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot());
    const raised = { request: 'toolu_1', session: S, tool: 'Bash', input: { command: 'ls' }, mac: 'm' };
    fold.message(env('raised', raised, null, null));
    expect(state(fold).pending).toEqual([raised]);
    expect(fold.raised('toolu_1')).toEqual(raised);
    fold.message(env('settled', { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal', mac: 'm' }, null, null));
    expect(state(fold).pending).toEqual([]);
    expect(state(fold).settled).toEqual([{ request: 'toolu_1', session: S, winner: 'terminal', outcome: 'allow', by: 'terminal', mac: 'm' }]);
    fold.message(env('raised', { ...raised, request: 'toolu_2' }, null, null));
    fold.message(snapshot()); // a fresh view: what is pending comes again after it
    expect(state(fold).pending).toEqual([]);
    expect(state(fold).settled).toHaveLength(1);
    for (let i = 0; i < 120; i++) fold.message(env('settled', { request: `r${i}`, winner: 'web', outcome: 'deny', by: 'm' }, null, null));
    expect(state(fold).settled).toHaveLength(100);
  });

  it('keeps the catalog from the snapshot or a later `catalog`, and its fingerprint in the state', () => {
    const fold = new RemoteFold(S);
    const catalog = { fingerprint: 'f1', commands: [], models: { options: [] } };
    fold.message(snapshot({ catalog }));
    expect(fold.catalog()).toEqual(catalog);
    expect(state(fold).catalog).toEqual({ fingerprint: 'f1' });
    fold.message(env('catalog', { ...catalog, fingerprint: 'f2' }));
    expect(state(fold).catalog).toEqual({ fingerprint: 'f2' });
    fold.message(snapshot()); // an older producer's snapshot carries none: the last one stands
    expect(state(fold).catalog).toEqual({ fingerprint: 'f2' });
  });
});
