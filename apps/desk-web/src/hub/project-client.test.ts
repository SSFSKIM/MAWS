// The project socket's client against the DX3 double: resume after the offset held, parts joined, reconnection with
// backoff and a fresh resume after every discontinuity, nothing assumed delivered that the hub did not acknowledge, and
// the session plane's subscriptions (DX8) kept whole across gaps and dropped sockets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newNonce, seal, importOrgKey, type HumanDraft, type LogEvent, type SessionMessage } from 'desk-hub/protocol';
import { DOUBLE_MEMBER, HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { ProjectClient, type ConnectionStatus } from './project-client';
import type { SubscriptionListener } from '../shell/session-plane';

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

function client(options: { held?: () => number; frameLimit?: number } = {}) {
  const got: Array<{ offset: number; event: LogEvent }> = [];
  const statuses: ConnectionStatus[] = [];
  const caughtUp: number[] = [];
  const sessions: SessionMessage[] = [];
  const held = options.held ?? (() => got.at(-1)?.offset ?? 0);
  const c = new ProjectClient({
    base: double.url.replace(/^http/, 'ws'),
    project: PROJECT,
    delay: () => 20,
    frameLimit: options.frameLimit,
    handlers: {
      held,
      log: (entries) => got.push(...entries),
      caughtUp: (offset) => caughtUp.push(offset),
      session: (message) => sessions.push(message),
      status: (s) => statuses.push(s),
    },
  });
  clients.push(c);
  c.start();
  return { c, got, statuses, caughtUp, sessions };
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

  it('keeps an RPC until the hub reports a state for it', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const states: string[] = [];
    c.onRpcState((frame) => states.push(frame.state));
    const nonce = newNonce();
    c.sendRpc({ rpc: 'interrupt', project: PROJECT, machine: 'mini', member: DOUBLE_MEMBER.id, created: new Date().toISOString(), nonce, args: { session: 's' }, mac: 'x' });
    await until(() => states.includes('forwarded'));
    double.dropConnections();
    await until(() => caughtUp.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    expect(double.up.filter((u) => u.frame.t === 'rpc')).toHaveLength(1);
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
      reset: () => log.push('reset'),
      end: (body) => log.push(`end:${body.reason}`),
    };
    return { log, listener };
  }

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
    expect(log).toEqual(['snapshot', 'reset', 'snapshot']);
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
    expect(log).toEqual(['snapshot', 'reset', 'snapshot']);
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

  it('ends at once a subscription scoped to a subagent, until DX3 carries agentId', async () => {
    const { c, caughtUp } = client();
    await until(() => caughtUp.length === 1);
    const { log, listener } = recorder();
    c.subscribe({ machine: MACHINE, session: SESSION, agentId: 'a1' }, listener);
    await until(() => log.length === 1);
    expect(log).toEqual(['end:error']);
    expect(double.subscriptions(PROJECT)).toEqual([]);
  });
});
