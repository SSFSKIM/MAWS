// DC3.G5 on the local runtime: the fake machine replays the committed recording through the stand-in, a browser
// subscribed as DC5 and DC6 will be. It reproduces the transcript's rows, both subagents', the requests and their
// settlements, the log, and delivery outcomes; a snapshot raced by the replay ends with no gap and no duplicated text;
// a crash after an RPC's effect and before its outcome is recorded, then a retry with the same nonce, produces no second
// effect.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine, loadRecording, TWO_SUBAGENTS, emptyMemory, type Recording } from '../../fake-machine';
import type { ProjectDown } from '../../src/protocol/browser';
import { importOrgKey, inputSha256, newNonce, seal, sealRpc, verify } from '../../src/protocol/codes';
import type { HumanDraft } from '../../src/protocol/log';
import type { Rpc, RpcDraft } from '../../src/protocol/rpc';
import type { Delivery, SessionMessage } from '../../src/protocol/session';
import { BrowserClient, enroll } from '../support/clients';
import { Dx4Reader } from '../support/dx4-reader';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

let hub: LocalHub;
let member: string;
beforeAll(async () => {
  hub = await startLocalHub();
  member = ((await (await hub.fetchAs(ADMIN, '/api/me')).json()) as { member: { id: string } }).member.id;
});
afterAll(() => hub?.close());

const RAW_KEY = new Uint8Array(32).fill(7);
const KEY = importOrgKey(RAW_KEY);
let count = 0;
const newProject = () => `8b2d0a8e-3b2d-4c5e-9f70-${(++count).toString(16).padStart(12, '0')}`;

async function fakeMachine(project: string, options: { timing?: boolean; recording?: Recording } & Partial<ConstructorParameters<typeof FakeMachine>[0]> = {}) {
  const name = `fm-${count}-${Math.random().toString(36).slice(2, 6)}`;
  const credentials = await enroll(hub, ADMIN, name);
  // Miniflare sees a stream's close only when a write to it fails, so a test that drops one beats often.
  if (options.timing) await hub.timing(name, { heartbeatMs: 250, leaseMs: 45_000 });
  const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: RAW_KEY, project, recordings: [options.recording ?? loadRecording(TWO_SUBAGENTS)], member, ...options });
  await fm.connect();
  return fm;
}

/** A browser with a reader per subscription it opens. */
async function browser(project: string) {
  const b = await BrowserClient.open(hub, ADMIN, project);
  const readers = new Map<string, Dx4Reader>();
  let seen = 0;
  const pump = () => {
    for (; seen < b.frames.length; seen++) {
      const f = b.frames[seen];
      if (f.t === 'session' && f.message.sub) readers.get(f.message.sub)?.read(f.message);
    }
  };
  const timer = setInterval(pump, 5);
  return {
    b,
    readers,
    pump,
    async subscribe(machine: string, session: string, agentId: string | null) {
      const sub = newNonce();
      const reader = new Dx4Reader(agentId);
      readers.set(sub, reader);
      b.send({ t: 'subscribe', machine, session, agentId, sub });
      await until(() => (pump(), reader.kinds.length > 0), 'a snapshot');
      return { sub, reader };
    },
    close() {
      clearInterval(timer);
      b.close();
    },
  };
}

async function until(test: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sessionMessages = (b: BrowserClient, kind: SessionMessage['kind']) =>
  b.frames.flatMap((f) => (f.t === 'session' && f.message.kind === kind ? [f.message] : []));
const ofType = <T extends ProjectDown['t']>(b: BrowserClient, t: T) => b.frames.filter((f) => f.t === t) as Array<Extract<ProjectDown, { t: T }>>;

async function sealedRpc(project: string, machine: string, name: Rpc['rpc'], args: Record<string, unknown>): Promise<Rpc> {
  return sealRpc(await KEY, { rpc: name, project, machine, member, created: new Date().toISOString(), nonce: newNonce(), args } as unknown as RpcDraft);
}

describe('the fake machine replaying the recording', () => {
  it("reproduces the transcript's rows, both subagents, the requests and their settlements, the log, and delivery outcomes", async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const fm = await fakeMachine(project, { recording });
    const w = await browser(project);
    w.b.send({ t: 'resume', after: 0 });
    const main = await w.subscribe(fm.name, recording.session, null);
    const agents: Dx4Reader[] = [];
    for (const agentId of Object.keys(recording.rows.agents)) {
      await fm.play({ speed: 0, until: (s) => s.k === 'agent' && s.agentId === agentId });
      agents.push((await w.subscribe(fm.name, recording.session, agentId)).reader);
    }
    await fm.play({ speed: 0 });
    await until(() => (w.pump(), main.reader.rows.length === recording.rows.main.length), 'every main row');
    await until(() => ofType(w.b, 'decided').length === 2, 'both decisions');

    expect(main.reader.faults).toEqual([]);
    expect(main.reader.uuids).toEqual(recording.rows.main.map((r) => r.uuid));
    for (const [i, agentId] of Object.keys(recording.rows.agents).entries()) {
      await until(() => (w.pump(), agents[i].rows.length === recording.rows.agents[agentId].length), `${agentId}'s rows`);
      expect(agents[i].faults).toEqual([]);
      expect(agents[i].uuids).toEqual(recording.rows.agents[agentId].map((r) => r.uuid));
    }
    // The subagent tree, each meta.json verbatim.
    const tree = sessionMessages(w.b, 'subagents').at(-1);
    expect(tree?.body).toEqual({ subagents: Object.keys(recording.meta).map((agentId) => ({ agentId, meta: recording.meta[agentId] })) });

    // The requests, sealed with the org key, and the audit record's decisions from the settlements: the web won both.
    const raised = sessionMessages(w.b, 'raised');
    expect(raised.map((m) => m.kind === 'raised' && m.body.tool)).toEqual(['Bash', 'AskUserQuestion']);
    // The ask mod's question names its transcript call, which differs from the dialog's id it was raised under.
    expect(raised.map((m) => m.kind === 'raised' && m.body.toolUseId)).toEqual([undefined, 'toolu_01YLTbS83Smb5RvQKJwQtK2S']);
    for (const m of raised) expect(await verify(await KEY, 'raised', project, m.body as object)).toBe(true);
    const decided = ofType(w.b, 'decided').map((f) => f.decision);
    expect(decided.map((d) => [d.settled.winner, d.settled.outcome, d.settled.by])).toEqual([
      ['web', 'allow', member],
      ['web', 'answered', member],
    ]);
    for (const d of decided) expect(await verify(await KEY, 'settled', project, d.settled)).toBe(true);
    expect(ofType(w.b, 'pending').at(-1)?.requests).toEqual([]);

    // The log: the session joined, and its <message>, under the fake machine's own writer, codes intact.
    await until(() => w.b.logged.some((e) => e.event.kind === 'message'), 'the message');
    const logged = w.b.logged.filter((e) => e.event.writer === `${fm.name}/${recording.session}`).map((e) => e.event);
    expect(logged.map((e) => e.kind)).toEqual(['joined', 'message']);
    for (const e of logged) expect(await verify(await KEY, 'log', project, e)).toBe(true);
    // Presence ends idle, and usage came on the main subscription.
    expect(sessionMessages(w.b, 'presence').at(-1)?.body).toEqual({ record: { status: 'idle', waitingFor: null, needs: null }, bridge: true });
    expect(main.reader.kinds).toContain('usage');

    // The recording's delivery outcomes (synthesized: a peer session's two says to the recorded one, delivered, then
    // uncertain), each naming the say as the fake machine rewrote it, and sealed.
    await until(() => sessionMessages(w.b, 'delivery').length === 2, 'the recorded deliveries');
    const says = w.b.logged.filter((e) => e.event.kind === 'say').map((e) => e.event);
    expect(says).toHaveLength(2);
    for (const say of says) expect(say.writer.startsWith(`${fm.name}/`)).toBe(true);
    const recorded = sessionMessages(w.b, 'delivery').map((m) => m.body as Delivery);
    expect(recorded.map((d) => [d.event, d.session, d.outcome])).toEqual([
      [{ writer: says[0].writer, seq: says[0].seq }, recording.session, 'delivered'],
      [{ writer: says[1].writer, seq: says[1].seq }, recording.session, 'uncertain'],
    ]);
    for (const d of recorded) expect(await verify(await KEY, 'delivery', project, d)).toBe(true);

    // A web human to the session: delivered, and the text is in the transcript.
    const draft: HumanDraft = { kind: 'human', from: 'human', member, to: [{ session: recording.session, alias: 'fakerec' }], text: 'thanks', created: new Date().toISOString() };
    w.b.send({ t: 'human', event: await seal(await KEY, 'log', project, draft) });
    await until(() => sessionMessages(w.b, 'delivery').length === 3, 'the delivery');
    const delivery = sessionMessages(w.b, 'delivery')[2];
    expect(delivery.body).toMatchObject({ session: recording.session, outcome: 'delivered' });
    expect(await verify(await KEY, 'delivery', project, delivery.body as object)).toBe(true);
    await until(() => (w.pump(), main.reader.rows.some((r) => JSON.stringify(r).includes('"thanks"'))), "the human's prompt in the transcript");
    // A browser that connects later (a reload) gets every outcome, the recorded ones included.
    const later = await BrowserClient.open(hub, ADMIN, project);
    const kept = ((await later.next((f) => f.t === 'deliveries', 'deliveries')) as Extract<ProjectDown, { t: 'deliveries' }>).deliveries;
    expect(kept.map((d) => d.outcome).sort()).toEqual(['delivered', 'delivered', 'uncertain']);
    expect(kept).toEqual(expect.arrayContaining(recorded));
    later.close();
    w.close();
    await fm.close();
  });

  it('a subscription raced by the replay while its snapshot is built ends with no gap and no duplicated text', async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const fm = await fakeMachine(project, { recording });
    const w = await browser(project);
    const reference = await w.subscribe(fm.name, recording.session, null);
    // Mid-response in the main loop's first text, the next subscription's snapshot is raced: three more steps applied
    // while it is built, and the live part handed the newest row and each streaming message's last chunk again.
    let texts = 0;
    await fm.play({ speed: 0, until: (s) => s.k === 'chunk' && s.agentId === null && s.chunk.kind === 'text' && ++texts === 3 });
    fm.raceNextSnapshot({ advance: 3, overlap: true });
    const late = await w.subscribe(fm.name, recording.session, null);
    await fm.play({ speed: 0 });
    await until(() => (w.pump(), late.reader.rows.length === recording.rows.main.length && reference.reader.rows.length === recording.rows.main.length), 'every row twice over');
    const snapshot = w.b.frames.find((f) => f.t === 'session' && f.message.sub === late.sub && f.message.kind === 'snapshot');
    expect(snapshot?.t === 'session' && snapshot.message.kind === 'snapshot' && snapshot.message.body.streaming.length).toBe(1);
    expect(late.reader.faults).toEqual([]);
    expect(late.reader.uuids).toEqual(reference.reader.uuids);
    expect(late.reader.assembled.size).toBeGreaterThan(0);
    for (const [id, text] of late.reader.assembled) expect(text, id).toBe(reference.reader.assembled.get(id));
    w.close();
    await fm.close();
  });

  it('crashed after a steer’s effect and before recording its outcome, then retried with the same nonce: one row, never two', async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const memory = emptyMemory();
    const fm = await fakeMachine(project, { recording, memory, timing: true });
    const w = await browser(project);
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-start' && s.agentId === null });
    const steer = await sealedRpc(project, fm.name, 'steer', { session: recording.session, text: 'keep it short' });
    fm.crashAfterEffect();
    w.b.send({ t: 'rpc', rpc: steer });
    await until(() => fm.isCrashed, 'the crash');
    await w.b.next((f) => f.t === 'rpc-state' && f.nonce === steer.nonce && f.state === 'uncertain', 'uncertain', 0, 10_000);
    expect(memory.ledger[steer.nonce]).toMatchObject({ rpc: 'steer', outcome: null });
    expect(fm.rpcs).toMatchObject([{ nonce: steer.nonce, executed: true, outcome: null }]);

    // The machine comes back with what it kept; the browser retries; the hub forwards the RPC again.
    const again = new FakeMachine({ hub: hub.url, machine: fm.name, credentials: fm.credentials, orgKey: RAW_KEY, project, recordings: [recording], member, memory });
    await again.connect();
    // Back at the same point of the session, so a steer run again would land: only the ledger stands in its way.
    await again.play({ speed: 0, until: (s) => s.k === 'turn-start' && s.agentId === null });
    const from = w.b.frames.length;
    w.b.send({ t: 'rpc', rpc: steer });
    const result = (await w.b.next((f) => f.t === 'rpc-state' && f.nonce === steer.nonce && f.state === 'done', 'done', from, 10_000)) as Extract<ProjectDown, { t: 'rpc-state' }>;
    const trace = memory.trace[steer.nonce];
    if (trace?.rpc !== 'steer' || !trace.row) throw new Error('the steer left no trace');
    const row = trace.row.uuid;
    expect(result.outcome).toEqual({ state: 'done', result: { row } });
    expect(again.rpcs).toMatchObject([{ nonce: steer.nonce, executed: false, outcome: { state: 'done' } }]);
    // One row with the steer's text in the session's transcript, the whole recording played, as a fresh subscription
    // reads it.
    await again.play({ speed: 0 });
    const fresh = await w.subscribe(again.name, recording.session, null);
    const steered = fresh.reader.rows.filter((r) => JSON.stringify(r).includes('keep it short'));
    expect(steered.map((r) => r.uuid)).toEqual([row]);
    expect(fresh.reader.rows.length).toBe(recording.rows.main.length + 1);
    w.close();
    await again.close();
  });

  it('waits for the web’s decision, checks its digest, settles it as the web’s, and refuses a late one naming the winner', async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const fm = await fakeMachine(project, { recording, decisions: 'wait' });
    const w = await browser(project);
    const playing = fm.play({ speed: 0 });
    await until(() => sessionMessages(w.b, 'raised').length === 1, 'the permission prompt');
    const raised = sessionMessages(w.b, 'raised')[0];
    if (raised.kind !== 'raised') throw new Error('not raised');
    const digest = { session: raised.session, request: raised.body.request, tool: raised.body.tool, input_sha256: await inputSha256(raised.body.input) };

    const altered = await sealedRpc(project, fm.name, 'decide', { session: raised.session, decision: 'deny', digest: { ...digest, input_sha256: '0'.repeat(64) } });
    w.b.send({ t: 'rpc', rpc: altered });
    expect(await w.b.next((f) => f.t === 'rpc-state' && f.nonce === altered.nonce && f.state === 'failed', 'digest-mismatch')).toMatchObject({ outcome: { error: { code: 'digest-mismatch' } } });

    const deny = await sealedRpc(project, fm.name, 'decide', { session: raised.session, decision: 'deny', digest });
    w.b.send({ t: 'rpc', rpc: deny });
    expect(await w.b.next((f) => f.t === 'rpc-state' && f.nonce === deny.nonce && f.state === 'done', 'done')).toMatchObject({ outcome: { state: 'done', result: {} } });
    await until(() => ofType(w.b, 'decided').length === 1, 'the decision');
    expect(ofType(w.b, 'decided')[0].decision.settled).toMatchObject({ request: digest.request, winner: 'web', outcome: 'deny', by: member });

    const late = await sealedRpc(project, fm.name, 'decide', { session: raised.session, decision: 'allow', digest });
    w.b.send({ t: 'rpc', rpc: late });
    expect(await w.b.next((f) => f.t === 'rpc-state' && f.nonce === late.nonce && f.state === 'failed', 'not-pending')).toMatchObject({
      outcome: { state: 'failed', error: { code: 'not-pending', winner: 'web', by: member } },
    });

    // The question: answered from the terminal this time, which the replay then goes on past.
    await until(() => sessionMessages(w.b, 'raised').length === 2, 'the question');
    const question = sessionMessages(w.b, 'raised')[1];
    await fm.answerInTerminal((question.body as { request: string }).request, 'answered');
    await playing;
    expect(ofType(w.b, 'decided').map((f) => f.decision.settled.winner)).toEqual(['web', 'terminal']);
    w.close();
    await fm.close();
  });

  it('answers model, compact (now, or at the turn’s end), spawn, retire, and resume, and serves the diff', async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const fm = await fakeMachine(project, { recording, diffBase: (session) => (session === recording.session ? 'develop' : undefined) });
    const w = await browser(project);
    w.b.send({ t: 'resume', after: 0 });
    const main = await w.subscribe(fm.name, recording.session, null);
    const call = async (name: Rpc['rpc'], args: Record<string, unknown>) => {
      const rpc = await sealedRpc(project, fm.name, name, args);
      w.b.send({ t: 'rpc', rpc });
      return (await w.b.next((f) => f.t === 'rpc-state' && f.nonce === rpc.nonce && f.state !== 'forwarded', name)) as Extract<ProjectDown, { t: 'rpc-state' }> & { nonce: string };
    };
    const S = recording.session;
    expect((await call('model', { session: S, model: 'sonnet', effort: 'high' })).outcome).toEqual({ state: 'done', result: { model: 'sonnet', effort: 'high' } });
    expect((await call('model', { session: S, model: 'default' })).outcome).toEqual({ state: 'done', result: { model: null, effort: 'high' } });

    const idle = await call('compact', { session: S });
    expect(idle.outcome).toEqual({ state: 'done', result: { at: 'now' } });
    await until(() => sessionMessages(w.b, 'compact').length === 2, 'the compaction');
    expect(sessionMessages(w.b, 'compact').map((m) => m.body)).toMatchObject([{ rpc: idle.nonce, phase: 'start' }, { rpc: idle.nonce, phase: 'end' }]);
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-start' && s.agentId === null });
    const held = await call('compact', { session: S });
    expect(held.outcome).toEqual({ state: 'done', result: { at: 'turn-end' } });
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-end' && s.agentId === null });
    await until(() => sessionMessages(w.b, 'compact').length === 4, 'the held compaction at the turn’s end');
    await fm.play({ speed: 0 });

    w.b.send({ t: 'diff', sub: main.sub });
    await until(() => (w.pump(), main.reader.kinds.includes('diff')), 'the diff');
    const diff = w.b.frames.find((f) => f.t === 'session' && f.message.kind === 'diff');
    expect(diff?.t === 'session' && diff.message.body).toEqual({ base: 'develop', text: recording.diff });

    expect((await call('spawn', { checkout: '/nowhere', brief: 'x' })).outcome).toMatchObject({ state: 'failed', error: { code: 'unknown-checkout' } });
    const spawned = await call('spawn', { checkout: recording.cwd, brief: 'review the diff' });
    const { session: born } = (spawned.outcome as { result: { session: string; alias: string } }).result;
    await until(() => w.b.logged.some((e) => e.event.kind === 'joined' && e.event.session === born), 'the joined');
    expect(w.b.logged.find((e) => e.event.session === born)?.event).toMatchObject({ kind: 'joined', role: 'review the diff', by: member, cwd: recording.cwd });

    expect((await call('resume', { session: S })).outcome).toMatchObject({ error: { code: 'session-live' } });
    expect((await call('retire', { session: S })).outcome).toEqual({ state: 'done', result: {} });
    await until(() => w.b.logged.some((e) => e.event.kind === 'retired'), 'the retired');
    expect(w.b.logged.find((e) => e.event.kind === 'retired')?.event).toMatchObject({ session: S, by: member });
    await until(() => sessionMessages(w.b, 'presence').some((m) => m.session === S && (m.body as { record: unknown }).record === null), 'presence gone');
    expect((await call('resume', { session: S })).outcome).toEqual({ state: 'done', result: { session: S } });
    w.close();
    await fm.close();
  });

  it('without the bridge: presence says so, rows alone stream, a steer names no row, and interrupt is unsupported', async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const fm = await fakeMachine(project, { recording, bridge: false });
    const w = await browser(project);
    const main = await w.subscribe(fm.name, recording.session, null);
    await fm.play({ speed: 0, until: (s) => s.k === 'turn-start' && s.agentId === null });
    const steer = await sealedRpc(project, fm.name, 'steer', { session: recording.session, text: 'later' });
    w.b.send({ t: 'rpc', rpc: steer });
    expect(await w.b.next((f) => f.t === 'rpc-state' && f.nonce === steer.nonce && f.state === 'done', 'done')).toMatchObject({ outcome: { result: { row: null } } });
    const interrupt = await sealedRpc(project, fm.name, 'interrupt', { session: recording.session });
    w.b.send({ t: 'rpc', rpc: interrupt });
    expect(await w.b.next((f) => f.t === 'rpc-state' && f.nonce === interrupt.nonce && f.state === 'failed', 'failed')).toMatchObject({ outcome: { error: { code: 'unsupported' } } });
    await fm.play({ speed: 0 });
    await until(() => (w.pump(), main.reader.rows.length === recording.rows.main.length), 'every row');
    expect(main.reader.faults).toEqual([]);
    expect(new Set(main.reader.kinds)).toEqual(new Set(['snapshot', 'row', 'subagents']));
    expect(sessionMessages(w.b, 'presence').at(-1)?.body).toMatchObject({ bridge: false });
    w.close();
    await fm.close();
  });

  it('ends a subscription before its snapshot, and every open one at a discontinuity, at the right n', async () => {
    const project = newProject();
    const recording = loadRecording(TWO_SUBAGENTS);
    const fm = await fakeMachine(project, { recording });
    const w = await browser(project);
    fm.refuseNextSubscribe('discontinuity', 'the bridge is not ready');
    const first = await w.subscribe(fm.name, recording.session, null);
    expect(first.reader.ended).toEqual({ reason: 'discontinuity', n: 0 });
    const unknown = await w.subscribe(fm.name, '11111111-2222-4333-8444-555555555555', null);
    expect(unknown.reader.ended).toEqual({ reason: 'session-ended', n: 0 });
    const second = await w.subscribe(fm.name, recording.session, null);
    await fm.play({ speed: 0, until: (s) => s.k === 'row' });
    await until(() => (w.pump(), second.reader.kinds.length > 1), 'a live message');
    fm.discontinuity();
    await until(() => (w.pump(), second.reader.ended !== null), 'the end');
    expect(second.reader.ended).toEqual({ reason: 'discontinuity', n: second.reader.kinds.length - 1 });
    expect(second.reader.faults).toEqual([]);
    w.close();
    await fm.close();
  });
});
