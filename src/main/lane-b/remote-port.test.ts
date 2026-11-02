// The client port across the channel, the device's half (P5 O7 M5c, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Consent and the client port"): the port's answers per kind, and a consent's callback listener on this Mac's loopback,
// its life on each ending path, its relays and their bounds. The listener is a real one on 127.0.0.1; the link is the
// suites' fake, its acts and its `connectors.callback` answered by each test.
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI, type FakeAct } from '../../../test/lane-b/fake-link';
import { OWNER_ACTION_DEADLINE_MS, OWNER_ACTION_LIMIT } from '../../services/connectors/owner';
import { CALLBACK_MS, CONFIG_MS } from '../../services/connectors/sign-in';
import { RTT_MARGIN_MS } from '../machines/budgets';
import { REMOTE_LANE_B_TIMING } from './remote';
import { createRemotePort, LISTENERS_PER_MACHINE, RELAYS_PER_LISTENER, type CallbackServer, type RemotePort, type RemotePortDeps, type RemotePortTiming } from './remote-port';

const ART = '11111111-1111-4111-8111-111111111111';
const CONNECT = { artifactId: ART, sourceHandle: 'source-1' };
const SIGN_IN = { name: 'linear', scope: 'user', cwd: null, path: '/Users/o/.claude.json', appSessionId: 'app-1' };

const ports: RemotePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.stop();
});

async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function lab(options: { timing?: Partial<RemotePortTiming>; listen?: RemotePortDeps['listen'] } = {}) {
  const link = new FakeLink();
  link.peers = ['rl2.executor.machine', 'rl2.client-port'];
  const links = new Map<MachineRef, FakeLink>([[MINI, link]]);
  const rosterListeners = new Set<(machines: readonly MachineRef[]) => void>();
  const opened: Array<[string, MachineRef]> = [];
  const logs: string[] = [];
  const port = createRemotePort({
    remote: (machine) => links.get(machine) ?? null,
    onRemote: (listener) => (rosterListeners.add(listener), () => void rosterListeners.delete(listener)),
    openUrl: (url, machine) => (opened.push([url, machine]), { opened: true }),
    ...(options.listen !== undefined && { listen: options.listen }),
    timing: { consentConnectMs: 5_000, consentSignInMs: 5_000, consentActMs: 5_000, ...options.timing },
    log: (line) => void logs.push(line),
  });
  ports.push(port);
  /** A consent asked: its act (made once the listener bound) and the command's answer, which the act's outcome gives. */
  async function consent(name: 'connectors.connect' | 'connectors.reconnect' | 'connectors.signIn', fields: Record<string, unknown>) {
    const before = link.acts.length;
    const answer = port.consent(link, name, fields, (withCallback, onHandle) => {
      const handle = link.act({ action: name, args: withCallback, executor: 'machine' });
      onHandle(handle);
      return handle.outcome.then((outcome) => (outcome.state === 'done' ? { ok: true, value: outcome.result } : { ok: false, error: { code: 'internal', message: outcome.state } }) as never);
    });
    await until(() => link.acts.length > before, 'act');
    const act = link.acts.at(-1)! as FakeAct;
    return { act, answer, port: (act.request.args as { callback: { port: number } }).callback.port };
  }
  return {
    link,
    links,
    port,
    opened,
    logs,
    consent,
    roster: () => rosterListeners.forEach((listener) => listener([...links.keys()])),
    alive: () => port.listening().map((l) => l.port),
  };
}

async function get(port: number, path: string, method = 'GET'): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { status: response.status, body: await response.text(), headers: response.headers };
}
const refused = async (port: number) => (await get(port, '/callback').then(() => 'answered', () => 'refused')) === 'refused';

describe('the port’s answers', () => {
  it('opens a URL here, says a path is the machine’s, and answers noClient for `reveal` and every other kind', async () => {
    const l = lab();
    l.roster();
    expect(await l.link.ask('openExternal', { url: 'https://auth.example/consent?x=1' })).toEqual({ opened: true });
    expect(l.opened).toEqual([['https://auth.example/consent?x=1', MINI]]);
    expect(await l.link.ask('openExternal', { path: '/Users/o/notes.md' })).toEqual({ opened: false, reason: 'a path on mini' });
    expect(await l.link.ask('reveal', '/Users/o/notes.md')).toEqual({ noClient: true });
    expect(await l.link.ask('pick', { kind: 'file', multiple: false })).toEqual({ noClient: true });
    expect(await l.link.ask('openExternal', { neither: true })).toEqual({ noClient: true });
    expect(l.opened).toHaveLength(1);
  });

  it('answers through a link the roster holds, and stops answering one it dropped', async () => {
    const l = lab();
    l.roster();
    l.links.delete(MINI);
    l.roster();
    expect(await l.link.ask('openExternal', { url: 'https://auth.example/consent' })).toEqual({ noClient: true }); // nobody listens: the link's own answer
    expect(l.opened).toEqual([]);
  });
});

describe('the callback listener', () => {
  it('binds before the act goes, which carries its port, and relays each request whole, writing the machine’s answer', async () => {
    const l = lab();
    const relayed: unknown[] = [];
    l.link.answers.set('connectors.callback', (input) => (relayed.push(input), { ok: true, output: { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': 'x=1' }, body: 'MAWS is connected. You can close this window.' } }));
    const c = await l.consent('connectors.connect', CONNECT);
    expect(c.act.request.args).toEqual({ ...CONNECT, callback: { port: c.port } });
    expect(l.alive()).toEqual([c.port]);
    const page = await get(c.port, '/callback?code=abc&state=s1&iss=https%3A%2F%2Fauth.example');
    expect(page).toMatchObject({ status: 200, body: 'MAWS is connected. You can close this window.' });
    expect(page.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('set-cookie')).toBeNull(); // 127.0.0.1's cookies are every loopback port's
    expect(relayed).toEqual([{ port: c.port, method: 'GET', url: '/callback?code=abc&state=s1&iss=https%3A%2F%2Fauth.example' }]);
  });

  it('keeps listening through a request no flow takes (404) and one the flow refuses without settling (405)', async () => {
    const l = lab();
    const answers = [{ status: 404, body: '' }, { status: 405, body: 'Not a MAWS sign-in request.' }, { status: 200, body: 'connected' }];
    l.link.answers.set('connectors.callback', () => ({ ok: true, output: answers.shift()! }));
    const c = await l.consent('connectors.connect', CONNECT);
    c.act.move('accepted');
    c.act.settle({ state: 'done', result: { accepted: true } });
    expect(await get(c.port, '/favicon.ico')).toMatchObject({ status: 404, body: '' });
    l.port.heard(MINI, 'connectors.serversChanged', { artifactId: ART }); // another row's action, or this one's start
    expect(await get(c.port, '/callback?state=s1', 'POST')).toMatchObject({ status: 405 });
    l.port.heard(MINI, 'connectors.serversChanged', { artifactId: ART });
    expect(l.alive()).toEqual([c.port]);
    expect(await get(c.port, '/callback?code=c&state=s1')).toMatchObject({ status: 200, body: 'connected' });
    expect(l.alive()).toEqual([c.port]); // an answered request never ends it
    l.port.heard(MINI, 'connectors.serversChanged', { artifactId: '22222222-2222-4222-8222-222222222222' });
    expect(l.alive()).toEqual([c.port]);
    l.port.heard(MINI, 'connectors.serversChanged', { artifactId: ART }); // the flow's end, its callback settled
    expect(l.alive()).toEqual([]);
    expect(await refused(c.port)).toBe(true);
    expect(await c.answer).toEqual({ ok: true, value: { accepted: true } });
  });

  it('ends at the act’s refusal: the machine’s `busy`, and an act that never ran', async () => {
    const l = lab();
    const busy = await l.consent('connectors.connect', CONNECT);
    busy.act.settle({ state: 'done', result: { accepted: false, why: 'busy' } });
    expect(await busy.answer).toEqual({ ok: true, value: { accepted: false, why: 'busy' } });
    expect(l.alive()).toEqual([]);
    expect(await refused(busy.port)).toBe(true);

    const cancelled = await l.consent('connectors.reconnect', CONNECT);
    cancelled.act.settle({ state: 'refused', reason: 'step-up-cancelled' });
    await cancelled.answer;
    expect(l.alive()).toEqual([]);
    expect(await refused(cancelled.port)).toBe(true);
  });

  it('ends a sign-in’s at its operation’s terminal change, heard before or after the receipt', async () => {
    const l = lab();
    const first = await l.consent('connectors.signIn', SIGN_IN);
    first.act.settle({ state: 'done', result: { opId: 'op-1' } });
    await first.answer;
    l.port.heard(MINI, 'connectors.signInChanged', { opId: 'op-1', name: 'linear', state: 'waiting_callback', reason: null, message: null, where: null });
    l.port.heard(MINI, 'connectors.signInChanged', { opId: 'op-9', name: 'linear', state: 'failed', reason: 'engine', message: null, where: null });
    expect(l.alive()).toEqual([first.port]);
    l.port.heard(MINI, 'connectors.signInChanged', { opId: 'op-1', name: 'linear', state: 'done', reason: null, message: null, where: 'here' });
    expect(l.alive()).toEqual([]);

    // a sign-in that can't be relayed fails at once, its change on the feed ahead of the act's answer
    const second = await l.consent('connectors.signIn', SIGN_IN);
    l.port.heard(MINI, 'connectors.signInChanged', { opId: 'op-2', name: 'linear', state: 'failed', reason: 'engine', message: 'sign in on mini', where: null });
    expect(l.alive()).toEqual([second.port]);
    second.act.settle({ state: 'done', result: { opId: 'op-2' } });
    await second.answer;
    expect(l.alive()).toEqual([]);
    expect(await refused(second.port)).toBe(true);
  });

  it('ends at its time from the act’s acceptance, and at the act’s own window when it is never accepted', async () => {
    const l = lab({ timing: { consentConnectMs: 60, consentSignInMs: 60, consentActMs: 120 } });
    const accepted = await l.consent('connectors.connect', CONNECT);
    accepted.act.move('accepted');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(l.alive()).toEqual([accepted.port]);
    await until(() => !l.alive().includes(accepted.port), 'the end of its time', 1000);
    expect(l.logs.some((line) => line.includes('its time passed'))).toBe(true);

    const waiting = await l.consent('connectors.connect', CONNECT); // at the sheet, then lost: never accepted
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(l.alive()).toEqual([waiting.port]);
    await until(() => l.alive().length === 0, 'the end of the act’s window and its time', 1000);
    expect(await refused(waiting.port)).toBe(true);
  });

  it('ends when the channel that accepted the act ends, or the link closes, or leaves the roster', async () => {
    const l = lab();
    const relinked = await l.consent('connectors.connect', CONNECT);
    l.link.relink(); // a channel before the act's acceptance is no matter: the act goes on the next
    expect(l.alive()).toEqual([relinked.port]);
    relinked.act.move('accepted');
    l.link.lose();
    l.link.relink();
    expect(l.alive()).toEqual([]);
    expect(await refused(relinked.port)).toBe(true);

    const closed = await l.consent('connectors.connect', CONNECT);
    l.link.end('closed');
    expect(l.alive()).toEqual([]);
    expect(await refused(closed.port)).toBe(true);

    const dropped = lab();
    const c = await dropped.consent('connectors.connect', CONNECT);
    dropped.links.delete(MINI);
    dropped.roster();
    expect(dropped.alive()).toEqual([]);
    expect(await refused(c.port)).toBe(true);
  });

  it('holds one listener per flow, each its own port, never rebound while it lives, and all ended at stop', async () => {
    const l = lab();
    const a = await l.consent('connectors.connect', CONNECT);
    const b = await l.consent('connectors.connect', { ...CONNECT, sourceHandle: 'source-2' });
    expect(a.port).not.toBe(b.port);
    expect(l.alive()).toEqual([a.port, b.port]);
    b.act.settle({ state: 'done', result: { accepted: false, why: 'busy' } });
    await b.answer;
    expect(l.alive()).toEqual([a.port]);
    l.port.stop();
    expect(l.alive()).toEqual([]);
    expect(await refused(a.port)).toBe(true);
  });

  it('bounds the listeners per machine at the machine’s own bound on owner actions', async () => {
    expect(LISTENERS_PER_MACHINE).toBe(OWNER_ACTION_LIMIT);
    let next = 40_000;
    const closed: number[] = [];
    const l = lab({ listen: async () => ({ port: next++, close() { closed.push(this.port); } }) as CallbackServer });
    for (let i = 0; i < LISTENERS_PER_MACHINE; i++) await l.consent('connectors.connect', CONNECT);
    const over = await l.port.consent(l.link, 'connectors.connect', CONNECT, () => Promise.reject(new Error('never sent')));
    expect(over).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'busy' } } });
    expect(l.link.acts).toHaveLength(LISTENERS_PER_MACHINE);
    l.port.stop();
    expect(closed).toHaveLength(LISTENERS_PER_MACHINE);
  });
});

describe('the relays’ bounds', () => {
  it('answers a URL past the relayed request’s 4 KiB here, never relaying it', async () => {
    const l = lab();
    l.link.answers.set('connectors.callback', () => ({ ok: true, output: { status: 200, body: 'ok' } }));
    const c = await l.consent('connectors.connect', CONNECT);
    expect(await get(c.port, `/callback?state=${'x'.repeat(4_100)}`)).toMatchObject({ status: 414 });
    expect(l.link.calls.filter((call) => call.name === 'connectors.callback')).toEqual([]);
  });

  it('relays at most a few at once, answers the rest 503, and answers every relay still out at the listener’s end', async () => {
    const l = lab();
    const held: Array<() => void> = [];
    l.link.answers.set('connectors.callback', () => new Promise((resolve) => held.push(() => resolve({ ok: true, output: { status: 200, body: 'late' } }))));
    const c = await l.consent('connectors.connect', CONNECT);
    const out = Array.from({ length: RELAYS_PER_LISTENER }, (_, i) => get(c.port, `/callback?n=${i}`).catch(() => ({ status: 0, body: '' })));
    await until(() => held.length === RELAYS_PER_LISTENER, 'the relays out');
    expect(await get(c.port, '/callback?n=over')).toMatchObject({ status: 503 });
    c.act.settle({ state: 'refused', reason: 'offline' });
    await c.answer;
    for (const release of held) release(); // their answers come after the end: written nowhere
    const answered = await Promise.all(out);
    expect(answered.every((page) => page.status !== 200)).toBe(true);
    expect(l.link.calls.filter((call) => call.name === 'connectors.callback')).toHaveLength(RELAYS_PER_LISTENER);
  });

  it('answers a machine it can’t reach, or an answer it can’t read, 502', async () => {
    const l = lab();
    const answers = [{ ok: false as const, error: { code: 'timeout' } }, { ok: true as const, output: { status: 200 } }];
    l.link.answers.set('connectors.callback', () => answers.shift()!);
    const c = await l.consent('connectors.connect', CONNECT);
    expect(await get(c.port, '/callback?state=s')).toMatchObject({ status: 502 });
    expect(await get(c.port, '/callback?state=s')).toMatchObject({ status: 502 });
    expect(l.alive()).toEqual([c.port]);
  });
});

describe('the listener’s time', () => {
  it('is the machine’s own bound on the flow and a round trip', () => {
    expect(REMOTE_LANE_B_TIMING.consentConnectMs).toBe(OWNER_ACTION_DEADLINE_MS + RTT_MARGIN_MS);
    expect(REMOTE_LANE_B_TIMING.consentSignInMs).toBe(CONFIG_MS + CALLBACK_MS + RTT_MARGIN_MS);
  });
});
