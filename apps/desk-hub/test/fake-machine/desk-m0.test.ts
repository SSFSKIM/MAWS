// The fake machine as the desk control surface's M0 producer (`producer: 'm0'`), on the local runtime through the
// stand-in: each bridged session's presence carries its capabilities (a stale session's none, until its mod reloads),
// the machine presence its `desk`; a `read status` is answered on the sub that asked; a `command` RPC is answered at
// once and its outcome follows as `op` messages under the RPC's nonce — at once when idle, at the turn's end when one
// runs — a refused one fails with the bridge's code and reason, a read-only machine refuses it, and an older producer
// knows none of it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, M0_CAPABILITIES, TWO_SUBAGENTS, type Producer } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { importOrgKey, newNonce, sealRpc } from '../../src/protocol/codes';
import type { RpcDraft } from '../../src/protocol/rpc';
import type { OpBody, SessionMessage, SessionPresence } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(11);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `9c3e0a8e-3b2d-4c5e-9f70-${(++count).toString(16).padStart(12, '0')}`;

async function setUp(options: { producer?: Producer; readOnly?: boolean; staleSessions?: string[] } = {}) {
  const project = newProject();
  const name = `m0-${count}`;
  const recording = loadRecording(TWO_SUBAGENTS);
  const credentials = await enroll(hub, ADMIN, name);
  const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [recording], member, producer: options.producer ?? 'm0', readOnly: options.readOnly, staleSessions: options.staleSessions });
  await fm.connect();
  const b = await BrowserClient.open(hub, ADMIN, project);
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
  const S = recording.session;
  const call = async (args: Record<string, unknown>) => {
    const rpc = await sealRpc(await KEY, { rpc: 'command', project, machine: fm.name, member, created: new Date().toISOString(), nonce: newNonce(), args: { session: S, ...args } } as unknown as RpcDraft);
    b.send({ t: 'rpc', rpc });
    return (await b.next((f) => f.t === 'rpc-state' && f.nonce === rpc.nonce && f.state !== 'forwarded', 'the command', 0, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
  };
  return { project, fm, b, recording, S, call };
}

const sessionMessages = (b: BrowserClient, kind: SessionMessage['kind']) => b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === kind ? [f.message] : []));
const ops = (b: BrowserClient) => sessionMessages(b, 'op').map((m) => m.body as OpBody);
const presences = (b: BrowserClient) => sessionMessages(b, 'presence').map((m) => m.body as SessionPresence);

async function until(test: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('the fake machine as the M0 producer', () => {
  it("advertises its sessions' capabilities and its desk; a stale session's none until its mod reloads", async () => {
    const fresh = await setUp();
    const machines = ((await fresh.b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk).toEqual({ sminos: '1.7.0', rpcs: expect.arrayContaining(['command', 'steer', 'stop']), reads: [] });
    expect(presences(fresh.b).at(-1)).toMatchObject({ bridge: true, capabilities: M0_CAPABILITIES });
    fresh.b.close();
    await fresh.fm.close();

    const stale = await setUp({ staleSessions: [loadRecording(TWO_SUBAGENTS).session] });
    expect(presences(stale.b).at(-1)).toEqual({ record: expect.anything(), bridge: true });
    const before = presences(stale.b).length;
    stale.fm.reload(stale.S);
    await until(() => presences(stale.b).length > before, 'the presence after the reload');
    expect(presences(stale.b).at(-1)?.capabilities).toEqual(M0_CAPABILITIES);
    stale.b.close();
    await stale.fm.close();
  });

  it('answers read status on the sub that asked, and a kind it does not serve as an error', async () => {
    const { fm, b, recording, S } = await setUp();
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: fm.name, session: S, agentId: null, sub });
    await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'snapshot', 'the snapshot');
    b.send({ t: 'read', sub, id: 'r1', what: 'status' });
    b.send({ t: 'read', sub, id: 'r2', what: 'usage' });
    await until(() => sessionMessages(b, 'read').length === 2, 'both answers');
    const [status, usage] = sessionMessages(b, 'read');
    expect(status).toMatchObject({ sub, n: 1, body: { id: 'r1', what: 'status', result: { version: { version: '2.1.307', base: '2.1.307' }, cwd: recording.cwd, root: recording.cwd, surfaces: ['cli'] } } });
    expect(usage).toMatchObject({ sub, n: 2, body: { id: 'r2', what: 'usage', error: { code: 'unsupported', message: 'no read usage' } } });
    b.close();
    await fm.close();
  });

  it('answers a command at once, then its op start and end under the nonce, the rename titling the session', async () => {
    const { fm, b, S, call } = await setUp();
    const done = await call({ name: 'rename', args: 'desk-m0' });
    expect(done.outcome).toMatchObject({ state: 'done', result: { queued: true, route: 'run' } });
    const id = (done.outcome as { result: { id: string } }).result.id;
    await until(() => ops(b).length === 2, 'the op start and end');
    expect(ops(b)).toMatchObject([
      { rpc: done.nonce, op: 'command', phase: 'start', id, name: 'rename', args: 'desk-m0' },
      { rpc: done.nonce, op: 'command', phase: 'end', id, name: 'rename', args: 'desk-m0', settled: { ok: true }, readback: { how: 'row', text: 'Session renamed to: desk-m0', uuid: expect.any(String) } },
    ]);
    expect(sessionMessages(b, 'op').every((m) => m.session === S && m.sub === null && m.n === null)).toBe(true);
    b.send({ t: 'resume', after: 0 });
    await until(() => b.logged.some((e) => e.event.kind === 'titled'), 'the titled event');
    expect(b.logged.find((e) => e.event.kind === 'titled')?.event).toMatchObject({ session: S, title: 'desk-m0' });

    // reload-plugins ends by effect, the daemon's, with no settled value.
    const reload = await call({ name: 'reload-plugins' });
    await until(() => ops(b).filter((o) => o.rpc === reload.nonce).length === 2, 'the reload');
    expect(ops(b).find((o) => o.rpc === reload.nonce && o.phase === 'end')).toEqual(expect.objectContaining({ readback: { how: 'effect' } }));
    expect(ops(b).find((o) => o.rpc === reload.nonce && o.phase === 'end')).not.toHaveProperty('settled');
    b.close();
    await fm.close();
  });

  it("fails a refused command with the bridge's code and reason, and runs nothing", async () => {
    const { fm, b, call } = await setUp();
    for (const [args, code, reason] of [
      [{ name: 'usage' }, 'panel', "opens a panel in the terminal; it would hold the session's queue"],
      [{ name: 'model', args: 'sonnet' }, 'routed', 'use Model instead: /model saves a default for new sessions'],
      [{ name: 'foo' }, 'unknown-builtin', 'not a command this session knows'],
    ] as const) {
      const failed = await call(args);
      expect(failed.outcome).toEqual({ state: 'failed', error: { code: 'failed', message: `${code}: ${reason}` } });
    }
    expect((await call({ name: 'x'.repeat(129) })).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    expect((await call({ name: 'color\nred' })).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ops(b)).toEqual([]);
    b.close();
    await fm.close();
  });

  it("holds a command's end for the running turn's end (H-queue)", async () => {
    const { fm, b, call } = await setUp();
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-start' && s.agentId === null });
    const queued = await call({ name: 'color', args: 'red' });
    expect(queued.outcome).toMatchObject({ state: 'done', result: { queued: true } });
    await until(() => ops(b).length === 1, 'the op start');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ops(b).map((o) => o.phase)).toEqual(['start']);
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-end' && s.agentId === null });
    await until(() => ops(b).length === 2, 'the op end at the turn end');
    expect(ops(b)[1]).toMatchObject({ rpc: queued.nonce, phase: 'end', readback: { how: 'row', text: 'Session color set to: red' } });
    await fm.play({ speed: 0 });
    b.close();
    await fm.close();
  });

  it('refuses a command on a read-only machine, and on a stale session, before anything runs', async () => {
    const readOnly = await setUp({ readOnly: true });
    expect((await readOnly.call({ name: 'rename', args: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'read-only' } });
    readOnly.b.close();
    await readOnly.fm.close();
    const stale = await setUp({ staleSessions: [loadRecording(TWO_SUBAGENTS).session] });
    expect((await stale.call({ name: 'rename', args: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ops(readOnly.b)).toEqual([]);
    expect(ops(stale.b)).toEqual([]);
    stale.b.close();
    await stale.fm.close();
  });

  it('as an older producer, advertises nothing, knows no command, and passes a read by', async () => {
    const { fm, b, S, call } = await setUp({ producer: 'dc8' });
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0]).not.toHaveProperty('desk');
    expect(presences(b).at(-1)).not.toHaveProperty('capabilities');
    expect((await call({ name: 'rename', args: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape', message: 'no RPC "command"' } });
    const sub = newNonce();
    b.send({ t: 'subscribe', machine: fm.name, session: S, agentId: null, sub });
    await b.next((f) => f.t === 'session' && f.message.sub === sub && f.message.kind === 'snapshot', 'the snapshot');
    b.send({ t: 'read', sub, id: 'r1', what: 'status' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sessionMessages(b, 'read')).toEqual([]);
    b.close();
    await fm.close();
  });
});
