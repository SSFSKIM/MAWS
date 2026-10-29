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

  // The O9 M10 sitting: the engine record is not idle for more than a main turn (2.1.312): `shell` while a background
  // shell runs beside an idle loop, `busy` while background agents work, `waiting` while a panel a terminal command
  // opened is up. Stop interrupted nothing there.
  describe('when no main turn runs', () => {
    let n = 0;
    const row = (fields: Record<string, unknown>) => ({ uuid: `r${++n}`, parentUuid: null, timestamp: '2026-10-29T18:57:00.000Z', ...fields });
    const prompt = (text: string) => row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
    const call = () => row({ type: 'assistant', message: { id: `m${n}`, model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: {} }] } });
    const result = () => row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'ok' }] } });
    const ended = () => row({ type: 'system', subtype: 'turn_duration', durationMs: 1000 });
    const marker = () => row({ type: 'user', isMeta: true, origin: { kind: 'plugin', name: 'sminos' }, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    const caveat = () => row({ type: 'user', isMeta: true, message: { role: 'user', content: '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>' } });
    const echo = (parentUuid: string | null) => row({ type: 'user', parentUuid, message: { role: 'user', content: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>haiku</command-args>' } });
    const skill = () => row({ type: 'user', message: { role: 'user', content: '<command-message>doperpowers:brainstorming</command-message>\n<command-name>/doperpowers:brainstorming</command-name>\n<command-args>a feature</command-args>' } });
    const output = () => row({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Set model to `Haiku 5.5`</local-command-stdout>' } });
    const status = (fold: RemoteFold, s: string) => fold.message(env('presence', presence({ record: { status: s } }), null, null));
    const live = (fold: RemoteFold, r: Record<string, unknown>) => fold.message(env('row', { row: r }));

    it('a background shell beside an idle loop (`shell`) runs no turn', () => {
      const fold = new RemoteFold(S);
      fold.message(snapshot({ presence: presence({ record: { status: 'shell' } }) }));
      expect(state(fold).turn.running).toBe(false);
    });

    it('`busy` or `waiting` after the main turn’s end row runs none, until a row of a turn running again', () => {
      const fold = new RemoteFold(S);
      fold.message(snapshot({ rows: [ended(), call(), prompt('Spawn two agents.')], presence: presence({ record: { status: 'busy' } }) }));
      expect(state(fold).turn.running).toBe(false); // the agents it started work in the background
      const typed = caveat();
      for (const r of [typed, echo(typed.uuid), output()]) live(fold, r); // a command typed at the terminal runs no turn
      status(fold, 'waiting'); // its panel, up in the terminal
      expect(state(fold).turn.running).toBe(false);
      live(fold, prompt('Go on.'));
      status(fold, 'busy');
      expect(state(fold).turn.running).toBe(true);
      live(fold, call());
      live(fold, result());
      expect(state(fold).turn.running).toBe(true);
      live(fold, marker()); // the bridge's interrupt
      expect(state(fold).turn.running).toBe(false);
    });

    it('a skill invoked at the terminal runs its turn from its record, before any chunk: it has no caveat', () => {
      const fold = new RemoteFold(S);
      fold.message(snapshot({ rows: [ended(), call(), prompt('Earlier.')], presence: presence({ record: { status: 'busy' } }) }));
      expect(state(fold).turn.running).toBe(false);
      live(fold, skill());
      expect(state(fold).turn.running).toBe(true);
      const typed = caveat(); // the same read in a snapshot, newest first: a command under its caveat marks nothing
      const later = new RemoteFold(S);
      later.message(snapshot({ rows: [output(), echo(typed.uuid), typed, ended()], presence: presence({ record: { status: 'waiting' } }) }));
      expect(state(later).turn.running).toBe(false);
    });

    it('a main turn between its steps, a permission prompt up, runs; with no turn row seen, the record says', () => {
      const fold = new RemoteFold(S);
      fold.message(snapshot({ rows: [call(), prompt('Edit it.')], presence: presence({ record: { status: 'waiting' } }) }));
      expect(state(fold).turn.running).toBe(true);
      const fresh = new RemoteFold(S);
      fresh.message(snapshot({ presence: presence({ record: { status: 'busy' } }) }));
      expect(state(fresh).turn.running).toBe(true);
    });
  });

  it('takes model and effort from a main-loop step-end that carries them, else the model `read status` gave and no effort', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot());
    const status = { model: 'claude-opus-4-5', override: { model: null, effort: 'high' }, mode: null, launch: 'L1' };
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: null, override: { model: null, effort: 'high' } });
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 1 }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: null });
    fold.message(env('step-end', { turnId: 't1', agentId: 'sub-1', step: 1, model: 'claude-haiku-4-5', effort: 'low' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: null }); // a subagent’s step says nothing of the main loop
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 2, t: 1730000000000, model: 'claude-haiku-4-5', effort: 'low' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low', override: { model: null, effort: 'high' } });
    expect(state(fold, null)).toMatchObject({ override: null });
  });

  it('folds a step-end’s model and effort each on its own: an effort-only step-end keeps the status read’s model', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot());
    const status = { model: 'claude-opus-4-5', override: null, mode: null, launch: 'L1' };
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 1, effort: 'low' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-opus-4-5', effort: 'low' });
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 2, model: 'claude-haiku-4-5' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-haiku-4-5', effort: 'low' }); // absent: not known, so kept
    fold.message(env('step-end', { turnId: 't2', agentId: null, step: 1, effort: 'max' }));
    expect(state(fold, status)).toMatchObject({ model: 'claude-haiku-4-5', effort: 'max' });
  });

  it('reads a present `effort: null` as the default effort observed, and an absent effort as unknown', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot());
    const status = { model: 'claude-opus-4-5', override: null, mode: null, launch: 'L1' };
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 1, model: 'claude-opus-4-5', effort: 'low' }));
    expect(state(fold, status)).toMatchObject({ effort: 'low' });
    fold.message(env('step-end', { turnId: 't1', agentId: null, step: 2, model: 'claude-opus-4-5' })); // a watch joined mid-step: no effort known
    expect(state(fold, status)).toMatchObject({ effort: 'low' });
    fold.message(env('step-end', { turnId: 't2', agentId: null, step: 1, model: 'claude-opus-4-5', effort: null })); // the request named none
    expect(state(fold, status)).toMatchObject({ effort: null });
  });

  // sminos 1.27.14: `read status` carries the mode the session last reported; the plane carries none
  it('takes the mode `read status` reported, none before a status read or while it reports none', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot({ presence: presence({ capabilities: { ...capabilities, sminos: '1.27.14' } }) }));
    const mode = { mode: 'bypassPermissions' as const, at: 1_761_700_000_000, from: 'UserPromptSubmit' };
    expect(state(fold).mode).toBeNull();
    expect(state(fold, { model: 'claude-opus-4-5', override: null, mode: null, launch: 'L1' }).mode).toBeNull();
    expect(state(fold, { model: 'claude-opus-4-5', override: null, mode, launch: 'L1' }).mode).toEqual(mode);
  });

  it('shows no mode from a bridge older than sminos 1.27.14, whatever its status read carries', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot()); // sminos 1.27.12
    expect(state(fold, { model: 'claude-opus-4-5', override: null, mode: { mode: 'plan', at: 1, from: 'UserPromptSubmit' }, launch: 'L1' }).mode).toBeNull();
    fold.message(env('presence', presence({ capabilities: { ...capabilities, sminos: '1.27.14' } }), null, null)); // updated, then reloaded
    expect(state(fold, { model: 'claude-opus-4-5', override: null, mode: { mode: 'plan', at: 1, from: 'UserPromptSubmit' }, launch: 'L1' }).mode).toMatchObject({ mode: 'plan' });
  });

  // A new process under the same session (`claude --resume`) starts with no mode: a status read of the one before says
  // nothing of it, until a status read under the new launch
  it('shows no mode from a status read made under another launch than the presence names now', () => {
    const fold = new RemoteFold(S);
    const reported = presence({ capabilities: { ...capabilities, sminos: '1.27.14' } });
    fold.message(snapshot({ presence: reported }));
    const status = { model: 'claude-opus-4-5', override: null, mode: { mode: 'plan' as const, at: 1, from: 'UserPromptSubmit' }, launch: 'L1' };
    expect(state(fold, status).mode).toMatchObject({ mode: 'plan' });
    fold.message(env('presence', { ...reported, launch: 'L2' }, null, null));
    expect(state(fold, status).mode).toBeNull();
    expect(state(fold, { ...status, launch: 'L2' }).mode).toMatchObject({ mode: 'plan' });
  });

  it('carries the link and the acts in flight it is given, and leaves both out when given none', () => {
    const fold = new RemoteFold(S);
    fold.message(snapshot());
    const link = { state: 'down' as const, refusal: null, carrier: null, member: 'm-a', clientClass: 'native-mac', rights: [], reason: 'mini isn’t reachable' };
    const acts = [{ id: 'op-1', control: 'interrupt', progress: 'sent' as const, at: '2026-10-29T00:00:00.000Z' }];
    expect(fold.state({ appSessionId: S, status: null, deliveries: [], link, acts })).toMatchObject({ link, acts });
    expect(state(fold)).not.toHaveProperty('link');
    expect(state(fold)).not.toHaveProperty('acts');
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
