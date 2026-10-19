// The fake machine's RPCs and its own writes, at their edges, on the local runtime: writes to its own feeds are
// sequenced one at a time; a decision or an answer must fit the request it names; every accepted effect is complete
// before the crash-after-effect checkpoint and before its outcome is recorded; a malformed RPC is refused before any
// claim, and an effect or a script that throws ends as a recorded `failed` outcome rather than a claim left open.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyMemory, FakeMachine, type Memory, type Recording, type Row, type RpcScript } from '../../fake-machine';
import { indexOf, loopJobs, stopNote } from '../../fake-machine/jobs';
import type { ProjectDown } from '../../src/protocol/browser';
import { inputSha256, newNonce, sealRpc, importOrgKey } from '../../src/protocol/codes';
import type { JsonObject } from '../../src/protocol/json';
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

const OTHER = '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918';
/** A second session of the same machine, with one permission prompt of its own. */
const other: Recording = {
  ...requests,
  name: 'other',
  session: OTHER,
  steps: [{ at: 0, k: 'raised', draft: { request: 'toolu_other', tool: 'Bash', input: { command: 'rm -rf build' } } }],
};

async function setUp(options: { memory?: Memory; script?: RpcScript; recordings?: Recording[]; bridge?: boolean; readOnly?: boolean; plugin?: 'doperpowers' | 'sminos' } = {}) {
  const project = newProject();
  const name = `rp-${count}`;
  const credentials = await enroll(hub, ADMIN, name);
  // Miniflare sees a stream's close only when a write to it fails, so a test that crashes the machine beats often.
  await hub.timing(name, { heartbeatMs: 250, leaseMs: 45_000 });
  const memory = options.memory ?? emptyMemory();
  const make = () => new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: options.recordings ?? [requests], member, memory, script: options.script, bridge: options.bridge, readOnly: options.readOnly, plugin: options.plugin });
  const fm = make();
  await fm.connect();
  await fm.play({ speed: 0 });
  const b = await BrowserClient.open(hub, ADMIN, project);
  // The hub's connect sequence (welcome, machines, each session's stored presence, pending, deliveries) ends with
  // `deliveries`: once it is in, a frame a test waits for after this point is a new one, never a replayed presence.
  await b.next((f) => f.t === 'deliveries', 'the end of the connect sequence');
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
  it('must fit the request, refused bad-shape before any claim: no deny for an async question, no answer for a permission, no allow for a question, answers keyed by its questions', async () => {
    const { fm, b, raised, call, final, digest } = await setUp();
    const deny = await call('decide', { session: SESSION, decision: 'deny', digest: await digest(raised('toolu_plugin_async')) });
    expect((await final(deny)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    const answerPermission = await call('answer', { session: SESSION, digest: await digest(raised('toolu_bash')), answers: { x: 'y' } });
    expect((await final(answerPermission)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    const allowQuestion = await call('decide', { session: SESSION, decision: 'allow', digest: await digest(raised('toolu_q')) });
    expect((await final(allowQuestion)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    const wrongKeys = await call('answer', { session: SESSION, digest: await digest(raised('toolu_q')), answers: { 'Not asked?': 'a' } });
    expect((await final(wrongKeys)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    // Each was refused before any claim, and nothing was settled by any of them.
    for (const misfit of [deny, answerPermission, allowQuestion, wrongKeys]) expect(fm.memory.ledger[misfit.nonce]).toBeUndefined();
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

describe('a decision, against the session it names and the request as it stands', () => {
  it("is bound to its own session: a digest naming another session is bad-shape before any claim, as the real machine refuses it, and the request stays pending", async () => {
    const { fm, b, raised, call, final, digest, memory } = await setUp({ recordings: [requests, other] });
    const across = await call('decide', { session: SESSION, decision: 'allow', digest: await digest(raised('toolu_other')) });
    expect((await final(across)).outcome).toEqual({ state: 'failed', error: { code: 'bad-shape', message: 'the digest names another session' } });
    expect(memory.ledger[across.nonce]).toBeUndefined();
    expect(fm.pendingRequests().map((r) => r.request)).toContain('toolu_other');
    const own = await call('decide', { session: OTHER, decision: 'allow', digest: await digest(raised('toolu_other')) });
    expect((await final(own)).outcome).toEqual({ state: 'done', result: {} });
    b.close();
    await fm.close();
  });

  it('that loses the race to the terminal while its digest is checked fails not-pending naming the winner, and runs nothing', async () => {
    const { fm, b, raised, call, final, digest, memory } = await setUp();
    const d = await digest(raised('toolu_bash'));
    // The terminal answers while the machine is hashing the request's input for the digest check.
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (algorithm, data) => {
      await fm.answerInTerminal('toolu_bash', 'deny');
      return original(algorithm, data);
    });
    try {
      const late = await call('decide', { session: SESSION, decision: 'allow', digest: d });
      expect((await final(late)).outcome).toMatchObject({ state: 'failed', error: { code: 'not-pending', winner: 'terminal', by: 'terminal' } });
      expect(memory.trace[late.nonce]).toBeUndefined();
      expect(fm.rpcs.find((r) => r.nonce === late.nonce)).toMatchObject({ executed: false });
      await b.next((f) => f.t === 'decided', 'the decision');
      expect(b.frames.filter((f) => f.t === 'decided').map((f) => f.t === 'decided' && f.decision.settled.winner)).toEqual(['terminal']);
    } finally {
      spy.mockRestore();
    }
    b.close();
    await fm.close();
  });
});

describe('a fake machine that stops', () => {
  it("publishes its sessions' presence as ended (record null), as a machine does when its sessions end", async () => {
    const { fm, b } = await setUp({ recordings: [requests, other] });
    const from = b.frames.length;
    await fm.close();
    for (const session of [SESSION, OTHER]) {
      expect(await b.next((f) => f.t === 'session' && f.message.kind === 'presence' && f.message.session === session, `${session}'s presence`, from)).toMatchObject({
        message: { body: { record: null } },
      });
    }
    b.close();
  });
});

const JOBS = '1f2e3d4c-5b6a-4798-8a7b-6c5d4e3f2a1b';
/** A session with a background shell and a monitor running, and a shell that has completed. */
const jobs: Recording = (() => {
  const t = (i: number) => new Date(Date.parse('2026-10-17T10:00:00.000Z') + i * 1000).toISOString();
  const call = (i: number, id: string, name: string, input: JsonObject): Row => ({ type: 'assistant', uuid: `a${i}`, timestamp: t(i), sessionId: JOBS, message: { id: `msg_${i}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const result = (i: number, id: string, content: string, toolUseResult: JsonObject): Row => ({ type: 'user', uuid: `u${i}`, timestamp: t(i), sessionId: JOBS, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] }, toolUseResult });
  const path = (taskId: string) => `/private/tmp/claude-501/-src-demo/${JOBS}/tasks/${taskId}.output`;
  const rows: Row[] = [
    call(1, 'toolu_sleep', 'Bash', { command: 'sleep 600', description: 'Wait a while', run_in_background: true }),
    result(2, 'toolu_sleep', `Command running in background with ID: bsleep001. Output is being written to: ${path('bsleep001')}`, { backgroundTaskId: 'bsleep001' }),
    call(3, 'toolu_watch', 'Monitor', { command: 'tail -f build.log', description: 'Watch the build' }),
    result(4, 'toolu_watch', 'Monitor started', { taskId: 'bmon00001', timeoutMs: 300000, persistent: false }),
    call(5, 'toolu_done', 'Bash', { command: 'true', description: 'Done at once', run_in_background: true }),
    result(6, 'toolu_done', `Command running in background with ID: bdone0001. Output is being written to: ${path('bdone0001')}`, { backgroundTaskId: 'bdone0001' }),
    { type: 'attachment', uuid: 'x7', timestamp: t(7), sessionId: JOBS, attachment: { type: 'task_status', taskId: 'bdone0001', taskType: 'local_bash', status: 'completed', description: 'Done at once' } },
  ];
  return { name: 'jobs', session: JOBS, cwd: '/src/demo', member: null, rows: { main: rows, agents: {} }, meta: {}, diff: '', chunks: 'synthesized', steps: rows.map((row, i) => ({ at: i, k: 'row', agentId: null, row })) };
})();

describe('stop (DC10)', () => {
  const jobsOf = (fm: FakeMachine) => loopJobs(indexOf(fm.sessions.get(JOBS)!.rows.get('main')!), true).jobs;

  it("stops a running shell and a running monitor: done with the task, and the job stopped by the bridge's note its rows now hold", async () => {
    const { fm, b, call, final } = await setUp({ recordings: [jobs] });
    for (const taskId of ['bsleep001', 'bmon00001']) {
      const stop = await call('stop', { session: JOBS, taskId });
      expect((await final(stop)).outcome).toEqual({ state: 'done', result: { taskId } });
      expect(jobsOf(fm).find((j) => j.taskId === taskId)).toMatchObject({ status: 'stopped', summary: stopNote(taskId) });
    }
    const notes = fm.sessions.get(JOBS)!.rows.get('main')!.filter((r) => r.isMeta === true && JSON.stringify(r).includes('was stopped from the desk'));
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ type: 'user', origin: { kind: 'plugin', name: 'doperpowers' } });
    b.close();
    await fm.close();
  });

  it('refuses a task its jobs index does not hold as running with unknown-task, before any claim; a retry after a crash stops nothing twice', async () => {
    const memory = emptyMemory();
    const { fm, b, call, final, make } = await setUp({ recordings: [jobs], memory });
    for (const taskId of ['bdone0001', 'bnone0001']) {
      const stop = await call('stop', { session: JOBS, taskId });
      expect((await final(stop)).outcome).toMatchObject({ state: 'failed', error: { code: 'unknown-task' } });
      expect(memory.ledger[stop.nonce]).toBeUndefined();
    }
    const malformed = await call('stop', { session: JOBS, taskId: 'not a task id' });
    expect((await final(malformed)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });

    fm.crashAfterEffect();
    const stop = await call('stop', { session: JOBS, taskId: 'bsleep001' });
    await b.next((f) => f.t === 'rpc-state' && f.nonce === stop.nonce && f.state === 'uncertain', 'uncertain', 0, 10_000);
    const again = make();
    await again.connect();
    const from = b.frames.length;
    b.send({ t: 'rpc', rpc: stop });
    expect((await final(stop, from)).outcome).toEqual({ state: 'done', result: { taskId: 'bsleep001' } });
    expect(again.rpcs).toMatchObject([{ nonce: stop.nonce, executed: false }]);
    // The machine that came back replays its session with the stop's rows still in it: the job stays stopped, once.
    await again.play({ speed: 0 });
    expect(jobsOf(again).find((j) => j.taskId === 'bsleep001')?.status).toBe('stopped');
    expect(again.sessions.get(JOBS)!.rows.get('main')!.filter((r) => JSON.stringify(r).includes(stopNote('bsleep001')))).toHaveLength(1);
    b.close();
    await again.close();
  });

  it('is unsupported without the bridge and refused on a read-only machine, the job left running', async () => {
    for (const [options, code] of [[{ bridge: false }, 'unsupported'], [{ readOnly: true }, 'read-only']] as const) {
      const { fm, b, call, final } = await setUp({ recordings: [jobs], ...options });
      const stop = await call('stop', { session: JOBS, taskId: 'bsleep001' });
      expect((await final(stop)).outcome, code).toMatchObject({ state: 'failed', error: { code } });
      expect(jobsOf(fm).find((j) => j.taskId === 'bsleep001')?.status).toBe('running');
      b.close();
      await fm.close();
    }
  });

  it("fails with the engine's message when TaskStop errs, the job keeping its status", async () => {
    const engine = 'Task bsleep001 could not be stopped: the process ignored the signal';
    const { fm, b, call, final } = await setUp({ recordings: [jobs], script: { stop: () => ({ state: 'failed', error: { code: 'failed', message: engine } }) } });
    const stop = await call('stop', { session: JOBS, taskId: 'bsleep001' });
    expect((await final(stop)).outcome).toEqual({ state: 'failed', error: { code: 'failed', message: engine } });
    expect(jobsOf(fm).find((j) => j.taskId === 'bsleep001')?.status).toBe('running');
    b.close();
    await fm.close();
  });
});

// The sminos plugin (doperpowers' sminos plugin design, §11): the bridge and the ask move out of doperpowers into a
// plugin of their own, so a rolled machine raises the ask as `mcp__sminos__AskUserQuestion` and appends its rows under
// origin `sminos`. The fake machine plays either: doperpowers by default, as a machine not yet rolled.
describe('a machine whose bridge runs in the sminos plugin', () => {
  const ROLLED = '2a3b4c5d-6e7f-4081-9a2b-3c4d5e6f7a8b';
  const TURN = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
  const rolled: Recording = {
    ...requests,
    name: 'rolled',
    session: ROLLED,
    steps: [
      { at: 0, k: 'turn-start', turnId: TURN, agentId: null },
      // Recorded on a machine not yet rolled; a rolled machine raises the same ask under its new name.
      { at: 1, k: 'raised', draft: { request: 'toolu_plugin_block', tool: 'mcp__doperpowers__AskUserQuestion', input: { questions: [{ question: 'Now?', options: [{ label: 'yes' }, { label: 'no' }] }] } } },
    ],
  };

  it('raises the ask under the sminos name, a question that takes an answer and no allow; a machine not yet rolled keeps the old name', async () => {
    const { fm, b, raised, call, final, digest } = await setUp({ recordings: [rolled], plugin: 'sminos' });
    const ask = raised('toolu_plugin_block');
    expect(ask.tool).toBe('mcp__sminos__AskUserQuestion');
    const allow = await call('decide', { session: ROLLED, decision: 'allow', digest: await digest(ask) });
    expect((await final(allow)).outcome).toMatchObject({ state: 'failed', error: { code: 'bad-shape' } });
    const answer = await call('answer', { session: ROLLED, digest: await digest(ask), answers: { 'Now?': 'yes' } });
    expect((await final(answer)).outcome).toEqual({ state: 'done', result: {} });
    b.close();
    await fm.close();
    const before = await setUp({ recordings: [rolled] });
    expect(before.raised('toolu_plugin_block').tool).toBe('mcp__doperpowers__AskUserQuestion');
    before.b.close();
    await before.fm.close();
  });

  it('appends a steer and a stop note under the sminos origin', async () => {
    const { fm, b, call, final } = await setUp({ recordings: [rolled, jobs], plugin: 'sminos' });
    const steer = await call('steer', { session: ROLLED, text: 'keep it short' });
    const { row } = ((await final(steer)).outcome as { result: { row: string } }).result;
    expect(fm.sessions.get(ROLLED)!.rows.get('main')!.find((r) => r.uuid === row)).toMatchObject({ isMeta: true, origin: { kind: 'plugin', name: 'sminos' } });
    const stop = await call('stop', { session: JOBS, taskId: 'bsleep001' });
    expect((await final(stop)).outcome).toEqual({ state: 'done', result: { taskId: 'bsleep001' } });
    const note = fm.sessions.get(JOBS)!.rows.get('main')!.find((r) => JSON.stringify(r).includes(stopNote('bsleep001')));
    expect(note).toMatchObject({ isMeta: true, origin: { kind: 'plugin', name: 'sminos' } });
    b.close();
    await fm.close();
  });
});
