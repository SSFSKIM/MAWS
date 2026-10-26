// The fake machine as the machine-side wave's MW4 producer (`producer: 'mw4'`), on the local runtime through the
// stand-in: a bridged session's presence carries `stop-agent` and `tell` among its ops and available among its controls,
// the machine's desk names both RPCs; a stop by the Agent call's name answers with the spelling asked and the id it
// resolved, a stop by an id with that id alone, a message is sent, each answer the outcome (no `op` follows), as the MW4
// live check recorded them on 2.1.310; an agent the bridge's tree does not hold as running is refused `unknown-agent`
// before the claim, a name two running agents hold `ambiguous-agent`, a malformed call `bad-shape`, a stale session's and
// a read-only machine's before anything runs; a stop is kept across a crash after its effect; and an MW3 producer knows
// neither RPC.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentStopNote, emptyMemory, FakeMachine, loadRecording, type RpcScript, MW4_AGENTS, MW4_CAPABILITIES, TWO_SUBAGENTS, type Producer } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { importOrgKey, newNonce, sealRpc } from '../../src/protocol/codes';
import type { RpcDraft, RpcName } from '../../src/protocol/rpc';
import { CONTROL_KEYS, type SessionMessage, type SessionPresence } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(14);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `9c3e0a8e-3b2d-4c5e-9f73-${(++count).toString(16).padStart(12, '0')}`;
/** The two-subagents recording's first agent, unnamed, running once its spawn is played. */
const ALPHA = 'ad435b3acfda88bfa';

async function setUp(options: { producer?: Producer; readOnly?: boolean; staleSessions?: string[]; script?: RpcScript } = {}) {
  const project = newProject();
  const name = `mw4-${count}`;
  const recording = loadRecording(TWO_SUBAGENTS);
  const credentials = await enroll(hub, ADMIN, name);
  // Miniflare sees a stream's close only when a write to it fails, so a test that crashes the machine beats often.
  await hub.timing(name, { heartbeatMs: 250, leaseMs: 45_000 });
  const memory = emptyMemory();
  const make = () => new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [recording], member, memory, producer: options.producer ?? 'mw4', readOnly: options.readOnly, staleSessions: options.staleSessions, script: options.script });
  const fm = make();
  await fm.connect();
  const b = await BrowserClient.open(hub, ADMIN, project);
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
  const S = recording.session;
  const seal = async (rpc: RpcName, args: Record<string, unknown>) =>
    sealRpc(await KEY, { rpc, project, machine: fm.name, member, created: new Date().toISOString(), nonce: newNonce(), args: { session: S, ...args } } as unknown as RpcDraft);
  const call = async (rpc: RpcName, args: Record<string, unknown>) => {
    const sealed = await seal(rpc, args);
    b.send({ t: 'rpc', rpc: sealed });
    return (await b.next((f) => f.t === 'rpc-state' && f.nonce === sealed.nonce && f.state !== 'forwarded', `the ${rpc}`, 0, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
  };
  return { fm, b, S, call, seal, make, memory };
}

const sessionMessages = (b: BrowserClient, kind: SessionMessage['kind']) => b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === kind ? [f.message] : []));
const presences = (b: BrowserClient) => sessionMessages(b, 'presence').map((m) => m.body as SessionPresence);

describe('the MW4 recording', () => {
  it('is the file the README names, byte for byte', () => {
    const at = (name: string) => fileURLToPath(new URL(`../../fake-machine/dx4/${name}`, import.meta.url));
    const sha = createHash('sha256').update(readFileSync(at('mw4-agents.json'))).digest('hex');
    expect(readFileSync(at('README.md'), 'utf8')).toContain(sha);
  });

  it("holds the live check's answers: a name resolved to its id, an id answered alone, a message sent, an unknown agent refused, and the note", () => {
    expect(MW4_AGENTS.stop.byName.answer).toEqual({ ok: true, result: { agentId: 'bg-sleeper', accepted: true, resolvedAgentId: MW4_AGENTS.spawn.agentId } });
    expect(MW4_AGENTS.stop.byId.answer).toEqual({ ok: true, result: { agentId: MW4_AGENTS.stop.byId.asked, accepted: true } });
    expect(MW4_AGENTS.stop.foreground.answer).toMatchObject({ ok: true, result: { agentId: 'fg-sleeper', accepted: true, resolvedAgentId: expect.any(String) } });
    expect(MW4_AGENTS.stop.again).toMatchObject({ ok: false, code: 'unknown-agent' });
    expect(MW4_AGENTS.tell.answer).toEqual({ ok: true, result: { sent: true } });
    expect(MW4_AGENTS.tell.read).toContain('From the person at the desk, not from your coordinator:\nMW4-TELL');
    for (const refused of Object.values(MW4_AGENTS.unknown)) expect(refused).toMatchObject({ ok: false, code: 'unknown-agent' });
    expect(MW4_AGENTS.note).toBe('Agent bg-sleeper was stopped by the person from the desk: it is not running. Do not start it again or redo its task unless the person asks.');
    expect(agentStopNote(ALPHA)).toBe(`Agent ${ALPHA} was stopped by the person from the desk: it is not running. Do not start it again or redo its task unless the person asks.`);
  });
});

describe('the fake machine as the MW4 producer', () => {
  it('advertises one agent stopped or told: both ops, both controls available, both RPCs in its desk', async () => {
    const { fm, b } = await setUp();
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk).toEqual({ sminos: '1.14.0', rpcs: expect.arrayContaining(['stop-agent', 'tell', 'btw', 'command']), reads: [] });
    const capabilities = presences(b).at(-1)?.capabilities;
    expect(capabilities).toEqual(MW4_CAPABILITIES);
    expect(capabilities?.ops).toEqual(expect.arrayContaining(['stop-agent', 'tell']));
    const controls = capabilities?.controls ?? {};
    expect(Object.keys(controls)).toEqual([...CONTROL_KEYS]);
    expect(controls['stop-agent']).toEqual({ available: true });
    expect(controls.tell).toEqual({ available: true });
    b.close();
    await fm.close();
  });

  it('stops the recorded agent by its name, answering the spelling asked and the id; the answer is the outcome, and a second stop finds none', async () => {
    const { fm, b, S, call } = await setUp();
    const id = await fm.spawnRecordedAgent(S);
    expect(id).toBe(MW4_AGENTS.spawn.agentId);
    const stopped = await call('stop-agent', { agentId: 'bg-sleeper' });
    expect(stopped.outcome).toEqual({ state: 'done', result: MW4_AGENTS.stop.byName.answer.result });
    expect(fm.sessions.get(S)!.runningAgent('bg-sleeper')).toBeNull();
    expect((await call('stop-agent', { agentId: 'bg-sleeper' })).outcome).toMatchObject({ state: 'failed', error: { code: 'unknown-agent' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessionMessages(b, 'op'), 'no op follows a stop').toEqual([]);
    b.close();
    await fm.close();
  });

  it("stops a replayed agent by its id, answering the id alone; tells one, by its name or its id, sent to its id", async () => {
    const { fm, b, S, call } = await setUp();
    await fm.play({ speed: 0, until: (s) => s.k === 'agent' && s.agentId === ALPHA });
    await fm.step();
    await fm.spawnRecordedAgent(S);
    expect((await call('tell', { agentId: 'bg-sleeper', text: 'also the cache' })).outcome).toEqual({ state: 'done', result: { sent: true } });
    expect((await call('tell', { agentId: ALPHA, text: 'and you' })).outcome).toEqual({ state: 'done', result: { sent: true } });
    expect(fm.told).toEqual([
      { session: S, agentId: MW4_AGENTS.spawn.agentId, text: 'also the cache' },
      { session: S, agentId: ALPHA, text: 'and you' },
    ]);
    expect((await call('stop-agent', { agentId: ALPHA })).outcome).toEqual({ state: 'done', result: { agentId: ALPHA, accepted: true } });
    b.close();
    await fm.close();
  });

  it('refuses an agent its tree does not hold as running unknown-agent, before the claim: nobody, a description, a name with a space', async () => {
    const { fm, b, S, call } = await setUp();
    await fm.spawnRecordedAgent(S);
    const before = fm.rpcs.length;
    for (const agentId of ['nobody', MW4_AGENTS.spawn.description, 'bg sleeper', 'BG-SLEEPER']) {
      expect((await call('stop-agent', { agentId })).outcome, agentId).toMatchObject({ state: 'failed', error: { code: 'unknown-agent' } });
      expect((await call('tell', { agentId, text: 'x' })).outcome, agentId).toMatchObject({ state: 'failed', error: { code: 'unknown-agent' } });
    }
    const refused = fm.rpcs.slice(before);
    expect(refused.every((r) => !r.executed && fm.memory.ledger[r.nonce] === undefined), 'nothing claimed').toBe(true);
    expect(fm.told).toEqual([]);
    b.close();
    await fm.close();
  });

  it('resolves an id first, then the name of exactly one running agent: a name two running agents hold is ambiguous-agent before the claim, naming both', async () => {
    const { fm, b, S, call } = await setUp();
    await fm.spawnRecordedAgent(S);
    const twin = await fm.spawnRecordedAgent(S, { agentId: 'a0000000000000twin' });
    const before = fm.rpcs.length;
    for (const [rpc, args] of [['stop-agent', {}], ['tell', { text: 'x' }]] as const) {
      const refused = (await call(rpc, { agentId: 'bg-sleeper', ...args })).outcome;
      expect(refused).toMatchObject({ state: 'failed', error: { code: 'ambiguous-agent' } });
      expect(JSON.stringify(refused)).toContain(MW4_AGENTS.spawn.agentId);
      expect(JSON.stringify(refused)).toContain(twin);
    }
    expect(fm.rpcs.slice(before).every((r) => !r.executed && fm.memory.ledger[r.nonce] === undefined), 'nothing claimed').toBe(true);
    // An id names its agent alone, the twin's name notwithstanding; one the tree holds as ended is no other agent's name.
    const named = await fm.spawnRecordedAgent(S, { agentId: 'a00000000000000id', name: twin });
    expect((await call('tell', { agentId: twin, text: 'you' })).outcome).toEqual({ state: 'done', result: { sent: true } });
    expect(fm.told.at(-1)).toEqual({ session: S, agentId: twin, text: 'you' });
    expect((await call('stop-agent', { agentId: twin })).outcome).toEqual({ state: 'done', result: { agentId: twin, accepted: true } });
    expect((await call('stop-agent', { agentId: twin })).outcome).toMatchObject({ state: 'failed', error: { code: 'unknown-agent' } });
    expect(fm.sessions.get(S)!.runningAgent(named)).not.toBeNull();
    b.close();
    await fm.close();
  });

  it('keeps a stop across a crash after its effect: the machine that comes back reconciles it from the trace, and its agent stays stopped, its note written once', async () => {
    const { fm, b, S, seal, make } = await setUp();
    await fm.spawnRecordedAgent(S);
    fm.crashAfterEffect();
    const stop = await seal('stop-agent', { agentId: 'bg-sleeper' });
    b.send({ t: 'rpc', rpc: stop });
    await b.next((f) => f.t === 'rpc-state' && f.nonce === stop.nonce && f.state === 'uncertain', 'uncertain', 0, 10_000);
    const again = make();
    await again.connect();
    await again.spawnRecordedAgent(S);
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: stop });
    const final = (await b.next((f) => f.t === 'rpc-state' && f.nonce === stop.nonce && (f.state === 'done' || f.state === 'failed'), 'the outcome', from, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
    expect(final.outcome).toEqual({ state: 'done', result: MW4_AGENTS.stop.byName.answer.result });
    expect(again.rpcs).toMatchObject([{ nonce: stop.nonce, executed: false }]);
    const depth = again.sessions.get(S)!;
    expect(depth.runningAgent('bg-sleeper'), 'stopped as before the crash').toBeNull();
    expect(depth.rows.get('main')!.filter((r) => JSON.stringify(r).includes(agentStopNote('bg-sleeper')))).toHaveLength(1);
    // A later resync of the tree that still lists it running neither undoes the stop nor writes its note again.
    const listed = { ...MW4_AGENTS.spawn, running: true };
    depth.apply({ at: Date.now(), k: 'agents', agents: [listed] });
    depth.apply({ at: Date.now(), k: 'agent', agentId: MW4_AGENTS.spawn.agentId, spawn: MW4_AGENTS.spawn });
    expect(depth.runningAgent('bg-sleeper'), 'still stopped after the resync').toBeNull();
    expect(depth.rows.get('main')!.filter((r) => JSON.stringify(r).includes(agentStopNote('bg-sleeper')))).toHaveLength(1);
    b.close();
    await again.close();
  });

  it("tells only the agent its check resolved, while it runs: one that ended before the message went is refused, its namesake never told", async () => {
    // What happens at the script's boundary, set once the agent is spawned.
    const boundary: { run?: () => void } = {};
    const { fm, b, S, call } = await setUp({ script: { tell: () => (boundary.run?.(), undefined) } });
    await fm.spawnRecordedAgent(S);
    const depth = fm.sessions.get(S)!;
    boundary.run = () => {
      depth.apply({ at: Date.now(), k: 'agent-stop', agentId: MW4_AGENTS.spawn.agentId });
      depth.apply({ at: Date.now(), k: 'agent', agentId: 'a0000000000000new', spawn: MW4_AGENTS.spawn });
    };
    const told = (await call('tell', { agentId: 'bg-sleeper', text: 'x' })).outcome;
    expect(told).toMatchObject({ state: 'failed', error: { code: 'failed' } });
    expect(JSON.stringify(told)).toContain('unknown-agent');
    expect(fm.told).toEqual([]);
    b.close();
    await fm.close();
  });

  it('refuses a malformed stop or message, and one on a read-only machine or a stale session, before anything runs', async () => {
    const { fm, b, S, call } = await setUp();
    await fm.spawnRecordedAgent(S);
    for (const agentId of [undefined, '', '   ', 'a\nb', 'a\u007f', 'x'.repeat(129), 7]) {
      expect((await call('stop-agent', { agentId })).outcome, JSON.stringify(agentId)).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
      expect((await call('tell', { agentId, text: 'x' })).outcome, JSON.stringify(agentId)).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    }
    for (const text of [undefined, '', ' \n', 5]) {
      expect((await call('tell', { agentId: 'bg-sleeper', text })).outcome, JSON.stringify(text)).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    }
    expect(fm.sessions.get(S)!.runningAgent('bg-sleeper')).not.toBeNull();
    b.close();
    await fm.close();

    const readOnly = await setUp({ readOnly: true });
    await readOnly.fm.spawnRecordedAgent(readOnly.S);
    expect((await readOnly.call('stop-agent', { agentId: 'bg-sleeper' })).outcome).toMatchObject({ state: 'failed', error: { code: 'read-only' } });
    const stale = await setUp({ staleSessions: [loadRecording(TWO_SUBAGENTS).session] });
    await stale.fm.spawnRecordedAgent(stale.S);
    expect((await stale.call('tell', { agentId: 'bg-sleeper', text: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    expect(readOnly.fm.sessions.get(readOnly.S)!.runningAgent('bg-sleeper')).not.toBeNull();
    for (const s of [readOnly, stale]) {
      s.b.close();
      await s.fm.close();
    }
  });

  it('as an MW3 producer, knows neither RPC and names neither in its desk', async () => {
    const { fm, b, call } = await setUp({ producer: 'mw3' });
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk?.rpcs).not.toContain('stop-agent');
    expect(machines[0].desk?.rpcs).not.toContain('tell');
    expect(presences(b).at(-1)?.capabilities?.ops).not.toContain('stop-agent');
    expect((await call('stop-agent', { agentId: 'x' })).outcome).toEqual({ state: 'failed', error: { code: 'bad-shape', message: 'no RPC "stop-agent"' } });
    expect((await call('tell', { agentId: 'x', text: 'y' })).outcome).toEqual({ state: 'failed', error: { code: 'bad-shape', message: 'no RPC "tell"' } });
    b.close();
    await fm.close();
  });
});
