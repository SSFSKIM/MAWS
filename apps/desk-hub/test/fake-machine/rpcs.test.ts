// The fake machine's RPCs and its own writes, at their edges, on the local runtime: writes to its own feeds are
// sequenced one at a time; a decision or an answer must fit the request it names; every accepted effect is complete
// before the crash-after-effect checkpoint and before its outcome is recorded; a malformed RPC is refused before any
// claim, and an effect or a script that throws ends as a recorded `failed` outcome rather than a claim left open.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyMemory, FakeMachine, type Memory, type Recording, type RpcScript } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { inputSha256, newNonce, sealRpc, importOrgKey } from '../../src/protocol/codes';
import type { Rpc, RpcDraft } from '../../src/protocol/rpc';
import type { Raised } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(3);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `5d4e0a8e-3b2d-4c5e-9f70-${(++count).toString(16).padStart(12, '0')}`;
const SESSION = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b0a';

/** A session whose timeline raises three requests and stops: a permission, a question, and an async question. */
const requests: Recording = {
  name: 'requests',
  session: SESSION,
  cwd: '/src/demo',
  member: null,
  rows: { main: [], agents: {} },
  meta: {},
  diff: '',
  chunks: 'synthesized',
  steps: [
    { at: 0, k: 'raised', draft: { request: 'toolu_bash', tool: 'Bash', input: { command: 'pnpm e2e' } } },
    { at: 1, k: 'raised', draft: { request: 'toolu_q', tool: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [{ label: 'a' }, { label: 'b' }] }] } } },
    {
      at: 2,
      k: 'raised',
      draft: { request: 'toolu_plugin_async', tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: [{ question: 'Later?', options: [{ label: 'yes' }] }] }, async: true },
    },
  ],
};

async function setUp(options: { memory?: Memory; script?: RpcScript } = {}) {
  const project = newProject();
  const name = `rp-${count}`;
  const credentials = await enroll(hub, ADMIN, name);
  // Miniflare sees a stream's close only when a write to it fails, so a test that crashes the machine beats often.
  await hub.timing(name, { heartbeatMs: 250, leaseMs: 45_000 });
  const memory = options.memory ?? emptyMemory();
  const make = () => new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [requests], member, memory, script: options.script });
  const fm = make();
  await fm.connect();
  await fm.play({ speed: 0 });
  const b = await BrowserClient.open(hub, ADMIN, project);
  const raised = (request: string) => fm.pendingRequests().find((r) => r.request === request) as Raised;
  const call = async (name: Rpc['rpc'], args: Record<string, unknown>, nonce = newNonce()) => {
    const rpc = await sealRpc(await KEY, { rpc: name, project, machine: fm.name, member, created: new Date().toISOString(), nonce, args } as unknown as RpcDraft);
    b.send({ t: 'rpc', rpc });
    return rpc;
  };
  const final = async (rpc: Rpc, from = 0) =>
    (await b.next((f) => f.t === 'rpc-state' && f.nonce === rpc.nonce && (f.state === 'done' || f.state === 'failed'), `${rpc.rpc}'s outcome`, from, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
  const digest = async (r: Raised) => ({ session: r.session, request: r.request, tool: r.tool, input_sha256: await inputSha256(r.input) });
  return { project, fm, b, raised, call, final, digest, memory, make };
}

describe("the fake machine's own writes", () => {
  it('are sequenced one at a time: concurrent writes to one feed land at consecutive seqs, each once', async () => {
    const { fm, b } = await setUp();
    const writer = `${fm.name}/${SESSION}`;
    const [one, two, three] = await Promise.all([
      fm.write('a', writer, { kind: 'say', from: 'x', to: '*', text: 'one' }),
      fm.write('b', writer, { kind: 'say', from: 'x', to: '*', text: 'two' }),
      fm.write('a', writer, { kind: 'say', from: 'x', to: '*', text: 'one again' }),
    ]);
    expect([one.seq, two.seq]).toEqual([1, 2]);
    expect(three).toBe(one); // the same source is written once
    expect(fm.memory.log[fm.project].filter((e) => e.writer === writer).map((e) => e.seq)).toEqual([1, 2]);
    expect(fm.refusals).toEqual([]);
    b.close();
    await fm.close();
  });
});

describe('decisions and answers', () => {
  it('must fit the request: no deny for an async question, no answer for a permission, answers keyed by its questions', async () => {
    const { fm, b, raised, call, final, digest } = await setUp();
    const deny = await call('decide', { session: SESSION, decision: 'deny', digest: await digest(raised('toolu_plugin_async')) });
    expect((await final(deny)).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    const answerPermission = await call('answer', { session: SESSION, digest: await digest(raised('toolu_bash')), answers: { x: 'y' } });
    expect((await final(answerPermission)).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    const allowQuestion = await call('decide', { session: SESSION, decision: 'allow', digest: await digest(raised('toolu_q')) });
    expect((await final(allowQuestion)).outcome).toMatchObject({ state: 'failed', error: { code: 'unsupported' } });
    const wrongKeys = await call('answer', { session: SESSION, digest: await digest(raised('toolu_q')), answers: { 'Not asked?': 'a' } });
    expect((await final(wrongKeys)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    // Nothing was settled by any of them.
    expect(fm.pendingRequests().map((r) => r.request).sort()).toEqual(['toolu_bash', 'toolu_plugin_async', 'toolu_q']);
    // The fitting ones: the async question answered, a native question denied, the permission allowed.
    const answer = await call('answer', { session: SESSION, digest: await digest(raised('toolu_plugin_async')), answers: { 'Later?': 'yes' } });
    expect((await final(answer)).outcome).toEqual({ state: 'done', result: {} });
    const denyQuestion = await call('decide', { session: SESSION, decision: 'deny', digest: await digest(raised('toolu_q')) });
    expect((await final(denyQuestion)).outcome).toEqual({ state: 'done', result: {} });
    await b.next((f) => f.t === 'decided' && f.decision.settled.request === 'toolu_q', 'decided');
    const decided = b.frames.flatMap((f) => (f.t === 'decided' ? [[f.decision.settled.request, f.decision.settled.outcome]] : []));
    expect(decided).toEqual([
      ['toolu_plugin_async', 'answered'],
      ['toolu_q', 'deny'],
    ]);
    b.close();
    await fm.close();
  });
});

describe('an RPC crashed after its effect', () => {
  it('has settled the request it decided before the crash, and the machine that comes back answers the retry from the trace', async () => {
    const memory = emptyMemory();
    const { fm, b, raised, call, final, digest, make } = await setUp({ memory });
    const d = await digest(raised('toolu_bash'));
    fm.crashAfterEffect();
    const allow = await call('decide', { session: SESSION, decision: 'allow', digest: d });
    await b.next((f) => f.t === 'decided' && f.decision.settled.request === 'toolu_bash', 'the settlement before the crash', 0, 10_000);
    await b.next((f) => f.t === 'rpc-state' && f.nonce === allow.nonce && f.state === 'uncertain', 'uncertain', 0, 10_000);
    expect(memory.ledger[allow.nonce]?.outcome).toBeNull();

    const again = make();
    await again.connect();
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: allow });
    expect((await final(allow, from)).outcome).toEqual({ state: 'done', result: {} });
    expect(again.rpcs).toMatchObject([{ nonce: allow.nonce, executed: false }]);
    expect(b.frames.filter((f) => f.t === 'decided')).toHaveLength(1);
    b.close();
    await again.close();
  });

  it('has written a spawn’s joined before the crash, once, and a retry answers the same session', async () => {
    const memory = emptyMemory();
    const { fm, b, call, final, make } = await setUp({ memory });
    b.send({ t: 'resume', after: 0 });
    fm.crashAfterEffect();
    const spawn = await call('spawn', { checkout: '/src/demo', brief: 'look' });
    await b.next((f) => f.t === 'log' && f.events.some((e) => e.event.kind === 'joined' && e.event.by === member), 'the joined before the crash', 0, 10_000);
    await b.next((f) => f.t === 'rpc-state' && f.nonce === spawn.nonce && f.state === 'uncertain', 'uncertain', 0, 10_000);
    const again = make();
    await again.connect();
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: spawn });
    const result = (await final(spawn, from)).outcome as { state: 'done'; result: { session: string } };
    expect(result.state).toBe('done');
    expect(b.logged.filter((e) => e.event.kind === 'joined' && e.event.session === result.result.session)).toHaveLength(1);
    b.close();
    await again.close();
  });
});

describe('a malformed or failing RPC', () => {
  it('is refused before any claim when its arguments are malformed', async () => {
    const { fm, b, call, final, memory } = await setUp();
    const missing = await call('decide', { session: SESSION, decision: 'allow' });
    expect((await final(missing)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    const wrong = await call('steer', { session: SESSION, text: 7 });
    expect((await final(wrong)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    expect(memory.ledger[missing.nonce]).toBeUndefined();
    expect(memory.ledger[wrong.nonce]).toBeUndefined();
    b.close();
    await fm.close();
  });

  it('ends as a recorded failed outcome when its script throws, and a retry is answered from the ledger', async () => {
    const { fm, b, call, final, memory } = await setUp({
      script: {
        model: () => {
          throw new Error('the bridge went away');
        },
      },
    });
    const model = await call('model', { session: SESSION, model: 'sonnet' });
    expect((await final(model)).outcome).toEqual({ state: 'failed', error: { code: 'failed', message: 'the bridge went away' } });
    expect(memory.ledger[model.nonce]?.outcome).toEqual({ state: 'failed', error: { code: 'failed', message: 'the bridge went away' } });
    b.close();
    await fm.close();
  });
});
