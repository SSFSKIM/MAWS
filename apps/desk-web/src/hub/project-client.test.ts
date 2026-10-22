// The project socket's client against the DX3 double: resume after the offset held, parts joined, reconnection with
// backoff and a fresh resume after every discontinuity, nothing assumed delivered that the hub did not acknowledge, and
// the session plane's subscriptions (DX8) kept whole across gaps and dropped sockets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_SET_LIMIT, newNonce, seal, importOrgKey, type HumanDraft, type LogEvent, type SessionBodies, type SessionMessage } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { ProjectClient, type ConnectionStatus, type RpcStateFrame } from './project-client';
import type { SubscriptionListener } from '../shell/session-plane';
import { catalogs, catalogKey } from '../state/catalog';
import type { Catalog } from 'desk-hub/protocol';
import { latency } from '../latency/latency';

const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const say = (text: string) => ({ writer: 'mini/9b2e4c6d-1a3f-4e5b-8c7d-0f1e2d3c4b5a', kind: 'say', from: 'maws-45', to: '*', text });

let double: HubDouble;
let clients: ProjectClient[] = [];

beforeEach(async () => {
  double = await HubDouble.start({ orgKey: VECTOR_KEY });
});
afterEach(async () => {
  for (const c of clients) c.stop();
  clients = [];
  await double.close();
});

function client(options: { beforeFrame?: () => boolean; held?: () => number; frameLimit?: number; resubscribeDelay?: (attempt: number) => number; readTimeoutMs?: number } = {}) {
  const got: Array<{ offset: number; event: LogEvent }> = [];
  const statuses: ConnectionStatus[] = [];
  const caughtUp: number[] = [];
  const sessions: SessionMessage[] = [];
  const refusals: string[] = [];
  const held = options.held ?? (() => got.at(-1)?.offset ?? 0);
  const c = new ProjectClient({
    base: double.url.replace(/^http/, 'ws'),
    project: PROJECT,
    delay: () => 20,
    frameLimit: options.frameLimit,
    resubscribeDelay: options.resubscribeDelay,
    readTimeoutMs: options.readTimeoutMs,
    handlers: {
      beforeFrame: options.beforeFrame,
      held,
      log: (entries) => got.push(...entries),
      caughtUp: (offset) => caughtUp.push(offset),
      session: (message) => sessions.push(message),
      status: (s) => statuses.push(s),
      refused: (r) => refusals.push(r.message),
    },
  });
  clients.push(c);
  c.start();
  return { c, got, statuses, caughtUp, sessions, refusals };
}

describe('the log', () => {
  it('resumes after the offset it holds, then tails live', async () => {
    await double.append(PROJECT, say('one'));
    await double.append(PROJECT, say('two'));
    await double.append(PROJECT, say('three'));
    const { got, caughtUp } = client({ held: () => 1 });
    await until(() => caughtUp.length === 1);
    expect(double.resumes(PROJECT)).toEqual([1]);
    expect(got.map((e) => e.offset)).toEqual([2, 3]);
    await double.append(PROJECT, say('four'));
    await until(() => got.length === 3);
    expect(got.map((e) => e.event.text)).toEqual(['two', 'three', 'four']);
  });

  it('joins a frame the hub sent in parts', async () => {
    await double.close();
    double = await HubDouble.start({ orgKey: VECTOR_KEY, frameLimit: 300 });
    const long = 'x'.repeat(2000);
    await double.append(PROJECT, say(long));
    const { got } = client();
    await until(() => got.length === 1);
    expect(got[0].event.text).toBe(long);
  });

  it('reconnects after the hub drops it and resumes after the last offset it now holds', async () => {
    await double.append(PROJECT, say('one'));
    const { got, statuses, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    double.dropConnections();
    await until(() => statuses.at(-1) === 'connecting');
    await double.append(PROJECT, say('two')); // stored while no socket is open
    await until(() => caughtUp.length === 2);
    expect(double.resumes(PROJECT)).toEqual([0, 1]);
    expect(got.map((e) => e.event.text)).toEqual(['one', 'two']);
    expect(statuses.filter((s) => s === 'open')).toHaveLength(2);
  });

  it('drops what it already holds when the hub sends it again', async () => {
    await double.append(PROJECT, say('one'));
    await double.append(PROJECT, say('two'));
    const { got, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    double.sendLogAgain(PROJECT);
    await double.append(PROJECT, say('three'));
    await until(() => got.length >= 3);
    expect(got.map((e) => e.offset)).toEqual([1, 2, 3]);
  });

  it('pages a backlog: each `more` resumed from its offset, every event once and in order, caught up only at the end', async () => {
    double.pageBytes = 2000; // a few events a page
    for (let i = 1; i <= 40; i++) await double.append(PROJECT, say(`event ${i}`));
    // Stored between the second and third pages: a later page carries it, once.
    let pages = 0;
    double.beforePage = async () => {
      if (++pages === 3) await double.append(PROJECT, say('stored mid-backlog'));
    };
    const { got, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    expect(got.length).toBe(41); // caught up only once every page was in
    await double.append(PROJECT, say('live'));
    await until(() => got.length === 42);
    expect(got.map((e) => e.offset)).toEqual(Array.from({ length: 42 }, (_, i) => i + 1));
    expect(got[40].event.text).toBe('stored mid-backlog');
    expect(caughtUp).toEqual([41]);
    const resumes = double.resumes(PROJECT);
    expect(resumes.length).toBeGreaterThan(3);
    expect(resumes[0]).toBe(0);
    for (let i = 1; i < resumes.length; i++) expect(resumes[i]).toBeGreaterThan(resumes[i - 1]); // each from the page's last offset
  });
});

describe('what goes up', () => {
  const draft = (text: string): HumanDraft => ({ kind: 'human', from: 'human', member: DOUBLE_MEMBER.id, to: '*', text, created: new Date().toISOString() });

  it('resolves a human send on its acknowledgement', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const { c, got } = client();
    const event = await seal(key, 'log', PROJECT, draft('keep user_id'));
    const ack = await c.sendHuman(event);
    expect(ack).toMatchObject({ offset: 1, writer: `hub/${DOUBLE_MEMBER.id}`, seq: 1 });
    await until(() => got.length === 1);
  });

  it('sends a human again after a reconnect until the hub acknowledges it', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    double.ackHumans = false;
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const event = await seal(key, 'log', PROJECT, draft('again'));
    let acked = false;
    void c.sendHuman(event).then(() => (acked = true));
    await until(() => double.up.some((u) => u.frame.t === 'human'));
    double.ackHumans = true;
    double.dropConnections();
    await until(() => acked);
    const sent = double.up.filter((u) => u.frame.t === 'human');
    expect(sent).toHaveLength(2);
    expect(double.head(PROJECT)).toBe(1); // the double stores a nonce once, as the hub must
  });

  it('ends a human send the hub refused, and never sends it again', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const event = await seal(key, 'log', PROJECT, { ...draft('as someone else'), member: '0'.repeat(32) });
    await expect(c.sendHuman(event)).rejects.toMatchObject({ refusal: { reason: 'writer-not-yours', nonce: event.mac.nonce } });
    double.dropConnections();
    await until(() => caughtUp.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(double.up.filter((u) => u.frame.t === 'human')).toHaveLength(1);
  });

  const rpcTo = (nonce = newNonce()) => ({ rpc: 'interrupt' as const, project: PROJECT, machine: 'mini', member: DOUBLE_MEMBER.id, created: new Date().toISOString(), nonce, args: { session: 's' }, mac: 'x' });

  /** Drops the socket and holds the client off until `release()`. */
  async function disconnect(statuses: ConnectionStatus[]) {
    double.admit = 'not-a-member';
    double.dropConnections();
    await until(() => statuses.at(-1) === 'connecting');
    return { release: () => (double.admit = 'member') };
  }

  it('refuses an RPC first issued while the socket is not welcomed, and never sends it after the reconnect', async () => {
    const { c, caughtUp, statuses } = client();
    await until(() => caughtUp.length === 1);
    const { release } = await disconnect(statuses);
    // The hub queues nothing for an absent party: an Interrupt held until a later welcome could stop a later turn.
    expect(c.sendRpc(rpcTo())).toBe(false);
    release();
    await until(() => caughtUp.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(double.up.filter((u) => u.frame.t === 'rpc')).toHaveLength(0);
  });

  it('refuses an RPC the socket would not take though the welcome still stands (a connection already closing)', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    // The connection is closing; its close callback, which ends the welcome, has not run yet.
    (c as unknown as { socket: { ws: WebSocket } }).socket.ws.close();
    expect(c.sendRpc(rpcTo())).toBe(false);
    await until(() => caughtUp.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(double.up.filter((u) => u.frame.t === 'rpc')).toHaveLength(0);
  });

  it('ends a human or an RPC the hub would refuse unread, its frame joining past the bound, as the hub ends one too large, sending nothing', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const text = 'y'.repeat(BROWSER_SET_LIMIT);
    await expect(c.sendHuman(await seal(key, 'log', PROJECT, draft(text)))).rejects.toMatchObject({ refusal: { reason: 'too-large' } });
    expect(c.holdsHumans()).toBe(false);
    const states: RpcStateFrame[] = [];
    c.onRpcState((frame) => states.push(frame));
    const rpc = { ...rpcTo(), rpc: 'steer' as const, args: { session: 's', text } };
    expect(c.sendRpc(rpc)).toBe(true);
    expect(states).toMatchObject([{ nonce: rpc.nonce, state: 'failed', outcome: { state: 'failed', error: { code: 'bad-shape' } } }]);
    double.dropConnections(); // neither is kept to be sent again
    await until(() => caughtUp.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(double.up.filter((u) => u.frame.t === 'human' || u.frame.t === 'rpc')).toHaveLength(0);
  });

  it('holds a retry of an RPC it already sent while disconnected, and sends it on the next welcome', async () => {
    const { c, caughtUp, statuses } = client();
    await until(() => caughtUp.length === 1);
    const rpc = rpcTo();
    expect(c.sendRpc(rpc)).toBe(true);
    await until(() => double.up.filter((u) => u.frame.t === 'rpc').length === 1);
    double.answerRpc(PROJECT, rpc.nonce, 'uncertain');
    const { release } = await disconnect(statuses);
    c.resendRpc(rpc); // the uncertain one's Retry: the same nonce, already transmitted
    release();
    await until(() => double.up.filter((u) => u.frame.t === 'rpc').length === 2);
  });

  it('keeps an RPC through `forwarded` and `uncertain`, sending it again after each reconnect, until done or failed', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const states: string[] = [];
    c.onRpcState((frame) => states.push(frame.state));
    const nonce = newNonce();
    const sent = () => double.up.filter((u) => u.frame.t === 'rpc').length;
    c.sendRpc({ rpc: 'interrupt', project: PROJECT, machine: 'mini', member: DOUBLE_MEMBER.id, created: new Date().toISOString(), nonce, args: { session: 's' }, mac: 'x' });
    await until(() => states.includes('forwarded'));
    double.dropConnections(); // forwarded is interim: it goes again
    await until(() => caughtUp.length === 2 && sent() === 2);
    double.answerRpc(PROJECT, nonce, 'uncertain');
    await until(() => states.includes('uncertain'));
    double.dropConnections(); // uncertain is not final either
    await until(() => caughtUp.length === 3 && sent() === 3);
    double.answerRpc(PROJECT, nonce, { state: 'done', result: { turnId: null, stopped: [], running: [] } });
    await until(() => states.includes('done'));
    double.dropConnections(); // done is final: never sent again
    await until(() => caughtUp.length === 4);
    await new Promise((r) => setTimeout(r, 50));
    expect(sent()).toBe(3);
  });

  it('cuts a large frame into parts on the way up', async () => {
    const key = await importOrgKey(VECTOR_KEY);
    const { c } = client({ frameLimit: 300 });
    const text = 'y'.repeat(3000);
    const ack = await c.sendHuman(await seal(key, 'log', PROJECT, draft(text)));
    expect(ack.offset).toBe(1);
    expect(double.up.find((u) => u.frame.t === 'human')?.frame).toMatchObject({ event: { text } });
  });
});

describe('the session plane', () => {
  const MACHINE = 'mini';
  const SESSION = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
  const snapshot = (sub: string): SessionMessage => ({
    project: PROJECT,
    machine: MACHINE,
    session: SESSION,
    kind: 'snapshot',
    sub,
    n: 0,
    body: { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [] },
  });
  const diff = (sub: string, n: number): SessionMessage => ({ project: PROJECT, machine: MACHINE, session: SESSION, kind: 'diff', sub, n, body: { base: 'main', text: `#${n}` } });

  function recorder() {
    const log: string[] = [];
    const listener: SubscriptionListener = {
      message: (m) => log.push(m.kind === 'snapshot' ? 'snapshot' : `${m.kind}:${m.n}`),
      interrupted: () => log.push('interrupted'),
      end: (body) => log.push(`end:${body.reason}`),
    };
    return { log, listener };
  }

  it('uses only this session’s cache until its snapshot confirms it, then consumes catalog pushes without a read', async () => {
    const cached: Catalog = { fingerprint: 'cached', commands: [], models: { options: ['default'], aliases: {} }, measured: '2.1.307' };
    const key = catalogKey(PROJECT, SESSION);
    catalogs.accept(key, cached, 10);
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, recorder().listener);
    expect(catalogs.get(key)).toMatchObject({ stale: true, asOf: 10 });
    await until(() => double.subscriptions(PROJECT).length === 1);
    const { sub } = double.subscriptions(PROJECT)[0];
    double.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], catalog: cached });
    await until(() => !catalogs.get(key).stale);
    double.sendSub(PROJECT, sub, 'catalog', { ...cached, fingerprint: 'changed' });
    await until(() => catalogs.get(key).catalog?.fingerprint === 'changed');
    expect(catalogs.get(catalogKey(PROJECT, 'another-session')).catalog).toBeNull();
    expect(double.up.some(({ frame }) => frame.t === 'read')).toBe(false);
  });

  it('delivers a subscription in order and routes the rest to the project', async () => {
    const { c, caughtUp, sessions } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const { sub } = double.subscriptions(PROJECT)[0];
    double.sendSession(PROJECT, snapshot(sub));
    double.sendSession(PROJECT, diff(sub, 1));
    double.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: SESSION, kind: 'presence', sub: null, n: null, body: { record: { status: 'idle' }, bridge: true } });
    await until(() => log.length === 2 && sessions.length === 1);
    expect(log).toEqual(['snapshot', 'diff:1']);
    expect(sessions[0].kind).toBe('presence');
  });

  it("asks a main transcript's diff and passes usage through; an agent's subscription sends no diff", async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    const main = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    const agent = c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a1' }, recorder().listener);
    await until(() => double.subscriptions(PROJECT).length === 2);
    const { sub } = double.subscriptions(PROJECT).find((s) => s.agentId === null)!;
    double.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], usage: null });
    double.diffs.set(SESSION, { base: 'main', text: 'diff --git a/x b/x' });
    main.diff();
    agent.diff();
    await until(() => log.length === 2);
    double.sendSub(PROJECT, sub, 'usage', { context: { tokens: 1000, window: 200000, percent: 0.5 }, cost: { usd: 0.12 } });
    await until(() => log.length === 3);
    expect(log).toEqual(['snapshot', 'diff:1', 'usage:2']);
    expect(double.up.filter((u) => u.frame.t === 'diff')).toEqual([{ project: PROJECT, frame: { t: 'diff', sub } }]);
  });

  it("asks older rows within the hub's limit of 1 to 1000, so a request out of range is never refused", async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const subscription = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, recorder().listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const { sub } = double.subscriptions(PROJECT)[0];
    double.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: true, subagents: [], presence: { record: null, bridge: true }, streaming: [], usage: null });
    subscription.rows('u9', 5000);
    subscription.rows('u9', 0);
    subscription.rows('u9', 2.5);
    subscription.rows('u9', 200);
    await until(() => double.up.filter((u) => u.frame.t === 'rows').length === 4);
    expect(double.up.filter((u) => u.frame.t === 'rows').map((u) => (u.frame as { limit: number }).limit)).toEqual([1000, 1, 2, 200]);
  });

  it("asks a task's output on a main or an agent subscription within the hub's bounds, and passes the answer through", async () => {
    const { c, caughtUp, refusals } = client();
    await until(() => caughtUp.length === 1);
    const answers: SessionMessage[] = [];
    const main = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, { ...recorder().listener, message: (m) => answers.push(m) });
    const agent = c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a1' }, recorder().listener);
    await until(() => double.subscriptions(PROJECT).length === 2);
    const { sub } = double.subscriptions(PROJECT).find((s) => s.agentId === null)!;
    const { sub: agentSub } = double.subscriptions(PROJECT).find((s) => s.agentId === 'a1')!;
    main.output('b7k2m9q4x', 65536);
    agent.output('a_B-9', 1);
    // A task id the engine never spells is not asked for (the hub would refuse it into the audit record); a tail out of
    // range is brought within 1 to 524288 bytes.
    main.output('../tasks/b7k2m9q4x', 1024);
    main.output('b7k2m9q4x', 10_000_000);
    main.output('b7k2m9q4x', 0);
    main.output('b7k2m9q4x', 2.5);
    const asked = () => double.up.filter((u) => u.frame.t === 'output').map((u) => u.frame);
    await until(() => asked().length === 5);
    expect(asked()).toEqual([
      { t: 'output', sub, taskId: 'b7k2m9q4x', tail: 65536 },
      { t: 'output', sub: agentSub, taskId: 'a_B-9', tail: 1 },
      { t: 'output', sub, taskId: 'b7k2m9q4x', tail: 524288 },
      { t: 'output', sub, taskId: 'b7k2m9q4x', tail: 1 },
      { t: 'output', sub, taskId: 'b7k2m9q4x', tail: 2 },
    ]);

    double.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], usage: null });
    const answer = { taskId: 'b7k2m9q4x', result: 'missing', path: null } as const;
    double.sendSub(PROJECT, sub, 'output', answer);
    await until(() => answers.length === 2);
    expect(answers[1]).toMatchObject({ kind: 'output', sub, n: 1, body: answer });
    expect(refusals).toEqual([]);
  });

  // The desk control surface's reads (its spec, §5): one frame each way on the sub, correlated by id.
  describe('read', () => {
    const answered = (sub: string) => double.up.filter((u) => u.frame.t === 'read' && u.frame.sub === sub).map((u) => u.frame as { id: string; what: string; args?: object });

    it('sends a read on its sub and resolves with the answer carrying its id, the rest of the sub flowing on', async () => {
      const { c, caughtUp, refusals } = client();
      await until(() => caughtUp.length === 1);
      const { log, listener } = recorder();
      const main = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
      await until(() => double.subscriptions(PROJECT).length === 1);
      const { sub } = double.subscriptions(PROJECT)[0];
      double.sendSub(PROJECT, sub, 'snapshot', snapshot(sub).body as SessionBodies['snapshot']);
      await until(() => log.length === 1);
      const before = latency.report().paths['read.status']?.n ?? 0;
      const first = main.read('status');
      const second = main.read('usage', { breakdown: 'full' });
      await until(() => answered(sub).length === 2);
      const [a, b] = answered(sub);
      expect(a).toEqual({ t: 'read', sub, id: a.id, what: 'status' });
      expect(b).toEqual({ t: 'read', sub, id: b.id, what: 'usage', args: { breakdown: 'full' } });
      expect(a.id).not.toBe(b.id);
      // Answered out of order, each to its own read; a diff between is the listener's as ever.
      double.sendSub(PROJECT, sub, 'read', { id: b.id, what: 'usage', error: { code: 'unsupported', message: 'no read usage' } });
      double.sendSub(PROJECT, sub, 'diff', { base: 'main', text: '' });
      double.sendSub(PROJECT, sub, 'read', { id: a.id, what: 'status', result: { surfaces: ['cli'] } });
      await expect(first).resolves.toEqual({ surfaces: ['cli'] });
      await expect(second).rejects.toMatchObject({ name: 'ReadError', code: 'unsupported', message: 'no read usage' });
      expect(log).toEqual(['snapshot', 'diff:2']);
      expect(latency.report().paths['read.status']?.n).toBe(before + 1);
      expect(refusals).toEqual([]);
    });

    it('rejects a read nobody answers within its time, one the socket dropped, one on a closed sub, and one on an agent sub before sending', async () => {
      const { c, caughtUp } = client({ readTimeoutMs: 100 });
      await until(() => caughtUp.length === 1);
      const main = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, recorder().listener);
      const agent = c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a1' }, recorder().listener);
      await until(() => double.subscriptions(PROJECT).length === 2);
      const { sub } = double.subscriptions(PROJECT).find((s) => s.agentId === null)!;
      await expect(main.read('status')).rejects.toMatchObject({ code: 'timeout' });
      // A late answer to a read that timed out is dropped quietly.
      double.sendSub(PROJECT, sub, 'read', { id: answered(sub)[0].id, what: 'status', result: {} });
      await expect(agent.read('status')).rejects.toMatchObject({ code: 'unsupported', message: "status is the main transcript's" });
      expect(double.up.filter((u) => u.frame.t === 'read')).toHaveLength(1);

      const lost = main.read('status');
      await until(() => answered(sub).length === 2);
      double.dropConnections();
      await expect(lost).rejects.toMatchObject({ code: 'interrupted' });

      await until(() => double.subscriptions(PROJECT).length === 2);
      const closing = main.read('status');
      main.close();
      await expect(closing).rejects.toMatchObject({ code: 'interrupted' });
      await expect(main.read('status')).rejects.toMatchObject({ code: 'interrupted' });
    });
  });

  it('subscribes again after a gap in n, under a fresh sub', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const first = double.subscriptions(PROJECT)[0].sub;
    double.sendSession(PROJECT, snapshot(first));
    double.sendSession(PROJECT, diff(first, 2)); // n 1 never came
    await until(() => double.subscriptions(PROJECT).some((s) => s.sub !== first));
    const second = double.subscriptions(PROJECT).find((s) => s.sub !== first)!.sub;
    expect(double.subscriptions(PROJECT).map((s) => s.sub)).toEqual([second]); // the broken one was given up
    double.sendSession(PROJECT, diff(first, 3)); // a late message of the old sub is not delivered
    double.sendSession(PROJECT, snapshot(second));
    await until(() => log.length === 3);
    expect(log).toEqual(['snapshot', 'interrupted', 'snapshot']);
  });

  it('subscribes again after the socket drops', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const first = double.subscriptions(PROJECT)[0].sub;
    double.sendSession(PROJECT, snapshot(first));
    await until(() => log.length === 1);
    double.dropConnections();
    await until(() => double.up.filter((u) => u.frame.t === 'subscribe').length === 2);
    const second = (double.up.filter((u) => u.frame.t === 'subscribe').at(-1)!.frame as { sub: string }).sub;
    double.sendSession(PROJECT, snapshot(second));
    await until(() => log.length === 3);
    expect(log).toEqual(['snapshot', 'interrupted', 'snapshot']);
  });

  it('ends a subscription the hub ended, and closes one the consumer closed', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const sub = double.subscriptions(PROJECT)[0].sub;
    double.sendSession(PROJECT, snapshot(sub));
    double.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: SESSION, kind: 'end', sub, n: 1, body: { reason: 'machine-offline' } });
    await until(() => log.length === 2);
    expect(log).toEqual(['snapshot', 'end:machine-offline']);

    const other = recorder();
    const handle = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, other.listener);
    await until(() => double.up.filter((u) => u.frame.t === 'subscribe').length === 2);
    handle.close();
    await until(() => double.up.some((u) => u.frame.t === 'unsubscribe'));
    double.dropConnections();
    await until(() => caughtUp.length === 2);
    expect(double.up.filter((u) => u.frame.t === 'subscribe')).toHaveLength(2); // neither is subscribed again
    expect(other.log).toEqual([]);
  });

  it("scopes a subscription to one subagent's transcript", async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a1' }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    expect(double.subscriptions(PROJECT)[0]).toMatchObject({ machine: MACHINE, session: SESSION, agentId: 'a1' });
  });

  it('passes a step-end through like any subscription kind, and waits for nothing after close()', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    const handle = c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const { sub } = double.subscriptions(PROJECT)[0];
    double.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], usage: null });
    double.sendSub(PROJECT, sub, 'step-end', { turnId: 't1', agentId: null, step: 1 });
    await until(() => log.length === 2);
    expect(log).toEqual(['snapshot', 'step-end:1']);
    handle.close(); // a machine's `end {unsubscribed}` never reaches a browser (composite 0e7da91e): the sub is gone at once
    await until(() => double.subscriptions(PROJECT).length === 0);
    expect(log).toEqual(['snapshot', 'step-end:1']);
  });

  it('takes an end that comes first, at n 0, before any snapshot, as the end of the subscription', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const sub = double.subscriptions(PROJECT)[0].sub;
    double.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: SESSION, kind: 'end', sub, n: 0, body: { reason: 'session-ended' } } as SessionMessage);
    await until(() => log.length === 1);
    expect(log).toEqual(['end:session-ended']);
  });

  it("ends a subscription the hub cannot take on (a socket's 33rd, a machine offline) at n 0, and never asks it again", async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const held = Array.from({ length: 32 }, (_, i) => c.subscribe({ machine: MACHINE, session: SESSION, agentId: `a${i}` }, recorder().listener));
    const over = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a32' }, over.listener);
    await until(() => over.log.length === 1);
    expect(over.log).toEqual(['end:error']);
    held[0].close();
    double.dropMachine(PROJECT, 'elsewhere');
    const offline = recorder();
    c.subscribe({ machine: 'elsewhere', session: SESSION, agentId: null }, offline.listener);
    await until(() => offline.log.length === 1);
    expect(offline.log).toEqual(['end:machine-offline']);
    await new Promise((r) => setTimeout(r, 100));
    expect(double.up.filter((u) => u.frame.t === 'subscribe')).toHaveLength(34);
  });

  it('takes a replacement on the same socket once the hub ended one of its 32 subscriptions', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    for (let i = 0; i < 32; i++) c.subscribe({ machine: MACHINE, session: SESSION, agentId: `a${i}` }, recorder().listener);
    await until(() => double.subscriptions(PROJECT).length === 32);
    double.sendSub(PROJECT, double.subscriptions(PROJECT)[0].sub, 'end', { reason: 'session-ended' });
    const replacement = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a32' }, replacement.listener);
    await until(() => double.subscriptions(PROJECT).some((s) => s.agentId === 'a32'));
    const { sub } = double.subscriptions(PROJECT).find((s) => s.agentId === 'a32')!;
    double.sendSub(PROJECT, sub, 'snapshot', { rows: [], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [] });
    await until(() => replacement.log.length === 1);
    expect(replacement.log).toEqual(['snapshot']);
  });

  it('subscribes again after a discontinuity at n 0 only after a backoff, so a bridge still starting cannot loop it', async () => {
    const delays: number[] = [];
    const { c, caughtUp } = client({ resubscribeDelay: (attempt) => (delays.push(attempt), 150) });
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const subscribes = () => double.up.filter((u) => u.frame.t === 'subscribe').length;
    const endFirst = (sub: string) => double.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: SESSION, kind: 'end', sub, n: 0, body: { reason: 'discontinuity' } } as SessionMessage);
    endFirst(double.subscriptions(PROJECT)[0].sub);
    await new Promise((r) => setTimeout(r, 60));
    expect(subscribes()).toBe(1); // not at once
    await until(() => subscribes() === 2);
    endFirst((double.up.filter((u) => u.frame.t === 'subscribe').at(-1)!.frame as { sub: string }).sub);
    await until(() => subscribes() === 3);
    expect(delays).toEqual([0, 1]); // each consecutive one backs off further
    const third = (double.up.filter((u) => u.frame.t === 'subscribe').at(-1)!.frame as { sub: string }).sub;
    double.sendSession(PROJECT, snapshot(third));
    await until(() => log.includes('snapshot'));
    expect(log).toEqual(['interrupted', 'interrupted', 'snapshot']);
  });

  it('recovers from the hub ending a subscription for a discontinuity, under a fresh sub', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: null }, listener);
    await until(() => double.subscriptions(PROJECT).length === 1);
    const first = double.subscriptions(PROJECT)[0].sub;
    double.sendSession(PROJECT, snapshot(first));
    double.sendSession(PROJECT, { project: PROJECT, machine: MACHINE, session: SESSION, kind: 'end', sub: first, n: 1, body: { reason: 'discontinuity' } });
    await until(() => double.up.filter((u) => u.frame.t === 'subscribe').length === 2);
    const second = (double.up.filter((u) => u.frame.t === 'subscribe').at(-1)!.frame as { sub: string }).sub;
    expect(second).not.toBe(first);
    double.sendSession(PROJECT, snapshot(second));
    await until(() => log.length === 3);
    expect(log).toEqual(['snapshot', 'interrupted', 'snapshot']);
  });
});

describe('the audit record', () => {
  it("hands on the hub's refusals and the daemons' rejections", async () => {
    const refusals: unknown[] = [];
    const rejections: unknown[] = [];
    const c = new ProjectClient({
      base: double.url.replace(/^http/, 'ws'),
      project: PROJECT,
      delay: () => 20,
      handlers: { held: () => 0, refused: (r) => refusals.push(r), rejected: (r) => rejections.push(r) },
    });
    clients.push(c);
    c.start();
    await until(() => double.connected(PROJECT) === 1);
    double.refuse(PROJECT, { reason: 'bad-shape', message: 'not an event' });
    double.reject(PROJECT, { machine: 'mini', event: { writer: 'hub/x', seq: 3 }, reason: 'bad-code', message: 'its code does not match' });
    await until(() => refusals.length === 1 && rejections.length === 1);
    expect(rejections[0]).toMatchObject({ machine: 'mini', reason: 'bad-code', event: { writer: 'hub/x', seq: 3 } });
  });

  it('hands on each decision, live and replayed after every caught-up', async () => {
    const decisions: Array<{ id: number; settled: { request: string } }> = [];
    const c = new ProjectClient({
      base: double.url.replace(/^http/, 'ws'),
      project: PROJECT,
      delay: () => 20,
      handlers: { held: () => 0, decided: (d) => decisions.push(d) },
    });
    clients.push(c);
    await double.raise(PROJECT, 'mini', { request: 'toolu_1', session: '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', tool: 'Bash', input: { command: 'ls' } });
    await double.settle(PROJECT, 'mini', '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal' });
    c.start();
    await until(() => decisions.length === 1); // the record's replay after caught-up
    expect(decisions[0]).toMatchObject({ machine: 'mini', settled: { request: 'toolu_1', winner: 'terminal' }, raised: { request: 'toolu_1' } });
    await double.raise(PROJECT, 'mini', { request: 'toolu_2', session: '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', tool: 'Bash', input: { command: 'ls' } });
    await double.settle(PROJECT, 'mini', '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b', { request: 'toolu_2', winner: 'terminal', outcome: 'deny', by: 'terminal' });
    await until(() => decisions.length === 2); // live
    expect(decisions.map((d) => d.settled.request)).toEqual(['toolu_1', 'toolu_2']);
  });
});

describe('visibility', () => {
  it('repeats `visible` every 30 s while the project shows, since the hub counts it only 90 s after the last, and stops when hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { c, caughtUp } = client();
      await until(() => caughtUp.length === 1);
      const frames = () => double.up.filter((u) => u.frame.t === 'visibility').map((u) => (u.frame as { visible: boolean }).visible);
      c.setVisible(true);
      await until(() => frames().length === 1);
      vi.advanceTimersByTime(29_000);
      await new Promise((r) => setTimeout(r, 50));
      expect(frames()).toEqual([true]);
      vi.advanceTimersByTime(1_000);
      await until(() => frames().length === 2);
      vi.advanceTimersByTime(30_000);
      await until(() => frames().length === 3);
      c.setVisible(false);
      await until(() => frames().length === 4);
      vi.advanceTimersByTime(120_000);
      await new Promise((r) => setTimeout(r, 50));
      expect(frames()).toEqual([true, true, true, false]);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('drops a suspended generation before dispatch and recovers its current log through the new handshake', async () => {
  let accept = true;
  const { c, got, caughtUp } = client({ beforeFrame: () => accept });
  await until(() => caughtUp.length === 1);
  accept = false;
  await double.append(PROJECT, say('buffered while suspended'));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(got).toEqual([]);
  accept = true;
  c.reconnect();
  await until(() => caughtUp.length === 2);
  expect(got.map((entry) => entry.event.text)).toEqual(['buffered while suspended']);
});
