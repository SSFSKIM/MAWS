// The fake machine as the machine-side wave's MW2 producer (`producer: 'mw2'`), on the local runtime through the
// stand-in: a bridged session's presence carries `btw` among its ops and `controls.btw` available, the machine's desk
// names the `btw` RPC; a side question is answered `started` at once, whether or not a turn runs, and its answer follows
// as `op` start and end under the RPC's nonce, as the MW2 live check recorded them on 2.1.310; a malformed one, one on a
// stale session and one on a read-only machine are refused before anything runs; compact takes `instructions` up to
// 4,096 characters; and an MW1 producer knows no `btw`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, MW2_BTW, MW2_CAPABILITIES, TWO_SUBAGENTS, type Producer } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { importOrgKey, newNonce, sealRpc } from '../../src/protocol/codes';
import type { RpcDraft, RpcName } from '../../src/protocol/rpc';
import { CONTROL_KEYS, type OpBody, type SessionMessage, type SessionPresence } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(13);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `9c3e0a8e-3b2d-4c5e-9f72-${(++count).toString(16).padStart(12, '0')}`;

async function setUp(options: { producer?: Producer; readOnly?: boolean; staleSessions?: string[] } = {}) {
  const project = newProject();
  const name = `mw2-${count}`;
  const recording = loadRecording(TWO_SUBAGENTS);
  const credentials = await enroll(hub, ADMIN, name);
  const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [recording], member, producer: options.producer ?? 'mw2', readOnly: options.readOnly, staleSessions: options.staleSessions });
  await fm.connect();
  const b = await BrowserClient.open(hub, ADMIN, project);
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
  const S = recording.session;
  const call = async (rpc: RpcName, args: Record<string, unknown>) => {
    const sealed = await sealRpc(await KEY, { rpc, project, machine: fm.name, member, created: new Date().toISOString(), nonce: newNonce(), args: { session: S, ...args } } as unknown as RpcDraft);
    b.send({ t: 'rpc', rpc: sealed });
    return (await b.next((f) => f.t === 'rpc-state' && f.nonce === sealed.nonce && f.state !== 'forwarded', `the ${rpc}`, 0, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
  };
  return { fm, b, S, call };
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

describe('the MW2 recording', () => {
  it('is the file the README names, byte for byte', () => {
    const at = (name: string) => fileURLToPath(new URL(`../../fake-machine/dx4/${name}`, import.meta.url));
    const sha = createHash('sha256').update(readFileSync(at('mw2-ops.json'))).digest('hex');
    expect(readFileSync(at('README.md'), 'utf8')).toContain(sha);
  });

  it("holds the live check's side question: framed as the spec has it, refused before the first request, its answer a start and an end", () => {
    const recorded = JSON.parse(readFileSync(fileURLToPath(new URL('../../fake-machine/dx4/mw2-ops.json', import.meta.url)), 'utf8')) as { btw: { request_last_user: string; prompt: string } };
    expect(recorded.btw.request_last_user).toBe(`Answer the following without using any tools and without continuing your current task; one reply, then stop.\n\n${recorded.btw.prompt}`);
    expect(MW2_BTW.refused).toMatchObject({ ok: false, code: 'nothing-to-fork' });
    expect(MW2_BTW.events.map((e) => e.phase)).toEqual(['start', 'end']);
    expect(MW2_BTW.events[1]).toMatchObject({ text: expect.any(String), usage: { input: expect.any(Number), output: expect.any(Number) } });
  });
});

describe('the fake machine as the MW2 producer', () => {
  it('advertises the side question: btw among the ops, its control available, and the RPC in its desk', async () => {
    const { fm, b } = await setUp();
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk).toEqual({ sminos: '1.12.0', rpcs: expect.arrayContaining(['btw', 'command', 'compact']), reads: [] });
    const capabilities = presences(b).at(-1)?.capabilities;
    expect(capabilities).toEqual(MW2_CAPABILITIES);
    expect(capabilities?.ops).toContain('btw');
    const controls = capabilities?.controls ?? {};
    expect(Object.keys(controls)).toEqual([...CONTROL_KEYS]);
    expect(controls.btw).toEqual({ available: true });
    b.close();
    await fm.close();
  });

  it('answers a side question started at once; its answer follows as op start and end under the nonce', async () => {
    const { fm, b, S, call } = await setUp();
    const asked = await call('btw', { prompt: 'one line: what is this session doing?' });
    expect(asked.outcome).toEqual({ state: 'done', result: { started: true, id: expect.any(String) } });
    const id = (asked.outcome as { result: { id: string } }).result.id;
    await until(() => ops(b).length === 2, 'the op start and end');
    const end = MW2_BTW.events[1];
    expect(ops(b)).toEqual([
      { rpc: asked.nonce, op: 'btw', phase: 'start', id, t: expect.any(Number) },
      { rpc: asked.nonce, op: 'btw', phase: 'end', id, t: expect.any(Number), text: end.text, usage: end.usage },
    ]);
    expect(sessionMessages(b, 'op').every((m) => m.session === S && m.sub === null && m.n === null)).toBe(true);
    b.close();
    await fm.close();
  });

  it('answers a side question mid-turn without waiting for the turn', async () => {
    const { fm, b, call } = await setUp();
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-start' && s.agentId === null });
    const asked = await call('btw', { prompt: 'anything?' });
    expect(asked.outcome).toMatchObject({ state: 'done', result: { started: true } });
    await until(() => ops(b).length === 2, 'the answer, before the turn ends');
    expect(ops(b)[1]).toMatchObject({ rpc: asked.nonce, op: 'btw', phase: 'end' });
    await fm.play({ speed: 0 });
    b.close();
    await fm.close();
  });

  it('refuses a malformed side question, and one on a read-only machine or a stale session, before anything runs', async () => {
    const { fm, b, call } = await setUp();
    for (const args of [{}, { prompt: '' }, { prompt: '  \n' }, { prompt: 5 }, { prompt: 'x'.repeat(8193) }]) {
      expect((await call('btw', args)).outcome, JSON.stringify(args).slice(0, 40)).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    }
    expect((await call('btw', { prompt: '가'.repeat(8192) })).outcome, '8,192 characters is a question').toMatchObject({ state: 'done' });
    await until(() => ops(b).length === 2, 'the one question asked');
    b.close();
    await fm.close();

    const readOnly = await setUp({ readOnly: true });
    expect((await readOnly.call('btw', { prompt: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'read-only' } });
    const stale = await setUp({ staleSessions: [loadRecording(TWO_SUBAGENTS).session] });
    expect((await stale.call('btw', { prompt: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect([...ops(readOnly.b), ...ops(stale.b)]).toEqual([]);
    for (const s of [readOnly, stale]) {
      s.b.close();
      await s.fm.close();
    }
  });

  it('compacts with instructions of up to 4,096 characters, and refuses longer or non-text ones', async () => {
    const { fm, b, call } = await setUp();
    expect((await call('compact', { instructions: 'keep the plan\nand the open questions' })).outcome).toEqual({ state: 'done', result: { at: 'now' } });
    expect((await call('compact', { instructions: 'x'.repeat(4096) })).outcome).toMatchObject({ state: 'done' });
    for (const instructions of ['x'.repeat(4097), 5, ['keep']]) {
      expect((await call('compact', { instructions })).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    }
    b.close();
    await fm.close();
  });

  it('as an MW1 producer, knows no btw and names none in its desk', async () => {
    const { fm, b, call } = await setUp({ producer: 'mw1' });
    const machines = ((await b.next((f) => f.t === 'machines' && f.machines.length > 0, 'machines')) as Extract<ProjectDown, { t: 'machines' }>).machines;
    expect(machines[0].desk?.rpcs).not.toContain('btw');
    expect(presences(b).at(-1)?.capabilities?.ops).not.toContain('btw');
    expect((await call('btw', { prompt: 'x' })).outcome).toEqual({ state: 'failed', error: { code: 'bad-shape', message: 'no RPC "btw"' } });
    b.close();
    await fm.close();
  });
});
