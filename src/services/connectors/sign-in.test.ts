// P4-AGG M4: main's sign-in operation over the engine's own MCP sign-in (docs/doperpowers/specs/2026-10-24-plugin-
// aggregator-design.md, Design "Signing in" and Decision Log 12 and 14). The engine host is a fake answering the three
// bounded calls and the reconnect as the spike measured them (spikes/p4-aggregator/findings-m4.txt); the loopback listener
// is the real one on 127.0.0.1, which the test's own request reaches as the person's browser would. No engine runs here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { listenLoopback } from './oauth-callback';
import { ALREADY_CONNECTED, createSignIn, startSignIn, type SignInDeps, type SignInHost } from './sign-in';
import { endableClientRef } from '@shared/ipc/client'; // P5 O7 M5c
import { createRelayedCallbacks } from './relayed-callback'; // P5 O7 M5c
import { validateCommandInput, validateEventPayload } from '@shared/ipc/validate'; // P5 O7 M8; U11a M8: the event

const SESSION = 'app-session-1';
const GLOBAL = '/cfg/.claude.json';
const AUTH = (redirectUri: string | null) => `http://127.0.0.1:9/authorize?state=engine-state&redirect_uri=${encodeURIComponent(redirectUri ?? 'http://localhost:5555/callback')}`;

interface FakeHost extends SignInHost {
  status: Map<string, string>; // name → status the session's mcp_status reports (absent: not listed)
  asked: { name: string; input: unknown }[];
  authenticate?: (input: { serverName: string; redirectUri: string | null }) => unknown;
  callback?: (input: { serverName: string; callbackUrl: string }) => unknown;
}

describe('the sign-in service against the running engine (fix-D#4)', () => {
  it('refuses when the session holds another server of the name than the row, and neither signs in nor reports it connected', async () => {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    const events: ConnectorSignInChanged[] = [];
    const statuses = new Set<(payload: { appSessionId: string; status: { process: string; cwd: string } }) => void>();
    const host = fakeHost();
    const call = host.call.bind(host);
    // MAWS gave the session an app-level linear at launch (--mcp-config: scope dynamic), since removed; a user linear is on disk
    host.call = (async (name: string, input: unknown) => {
      if (name === 'customization.serverEndpoints') return { ok: true, value: { servers: [{ name: 'linear', scope: 'user', path: GLOBAL, transport: 'http', url: 'https://u.example/mcp' }] } };
      if (name === 'session.mcpStatus') return { ok: true, value: { mcpServers: [{ name: 'linear', status: 'connected', scope: 'dynamic', transport: 'http', config: { type: 'http', url: 'https://app.example/mcp' } }] } };
      return call(name as never, input as never);
    }) as never;
    const service = startSignIn({
      bus: { register: ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => handlers.set(name, handler)) as never, emit: ((_name: string, event: ConnectorSignInChanged) => events.push(event)) as never },
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      sessions: async () => [],
      hostStreaming: () => true,
      onHostStreaming: () => () => {},
      port: { openExternal: async () => ({ opened: true }) },
      listen: listenLoopback,
      relayed: createRelayedCallbacks(), // P5 O7 M5c
      machine: 'this-mac',
    });
    stop = () => service.stop();
    statuses.forEach((l) => l({ appSessionId: SESSION, status: { process: 'ready', cwd: '/p' } }));
    const { opId } = handlers.get('connectors.signIn')!({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, { client: null }) as { opId: string };
    await vi.waitFor(() => expect(['failed', 'done']).toContain(events.filter((e) => e.opId === opId).at(-1)?.state));
    expect(events.filter((e) => e.opId === opId).at(-1)).toMatchObject({ state: 'failed', reason: 'other_entry', message: 'this session uses a different linear; start a new session to sign in' });
    expect(host.asked.map((a) => a.name)).not.toContain('session.mcpAuthenticate');
  });
});

function fakeHost(): FakeHost {
  const host: FakeHost = {
    status: new Map([['linear', 'needs-auth']]),
    asked: [],
    async call(name, input) {
      host.asked.push({ name, input });
      const i = input as unknown as { serverName: string; redirectUri: string | null; callbackUrl: string };
      switch (name) {
        case 'session.mcpAuthenticate':
          return { ok: true, value: host.authenticate?.(i) ?? { ok: true, answer: { authUrl: AUTH(i.redirectUri), requiresUserAction: true, callbackExpected: true, redirectScheme: i.redirectUri === null ? 'localhost' : 'custom', state: 'engine-state', ...(i.redirectUri === null && { callbackPort: 5555 }) } } };
        case 'session.mcpOAuthCallback':
          return { ok: true, value: host.callback?.(i) ?? { ok: true } };
        case 'session.mcpReconnect':
          if (host.status.has(i.serverName)) host.status.set(i.serverName, 'connected');
          return { ok: true, value: { opId: 'reconnect-1' } };
        case 'session.mcpStatus':
          return { ok: true, value: { mcpServers: [...host.status].map(([n, status]) => ({ name: n, status })) } };
      }
      throw new Error(`unexpected ${name}`);
    },
  } as FakeHost;
  return host;
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

function make(overrides: Partial<SignInDeps> = {}) {
  const host = fakeHost();
  const events: ConnectorSignInChanged[] = [];
  const opened: string[] = [];
  const exits = new Set<(appSessionId: string) => void>();
  const signIn = createSignIn({
    host,
    listen: listenLoopback,
    port: { openExternal: async (_client, target) => (opened.push((target as { url: string }).url), { opened: true }) },
    emit: (event) => events.push(event),
    ready: (appSessionId) => appSessionId === SESSION,
    onSessionGone: (listener) => (exits.add(listener), () => exits.delete(listener)),
    check: async () => null,
    pollMs: 5,
    settleMs: 60,
    ...overrides,
  });
  stop = () => signIn.stop();
  const states = (opId: string) => events.filter((e) => e.opId === opId).map((e) => e.state);
  const until = async (check: () => boolean, what: string) => {
    for (let i = 0; i < 400 && !check(); i += 1) await new Promise((r) => setTimeout(r, 5));
    if (!check()) throw new Error(`timed out waiting for ${what}`);
  };
  const last = (opId: string) => events.filter((e) => e.opId === opId).at(-1)!;
  const ended = (opId: string) => until(() => ['done', 'failed', 'cancelled'].includes(last(opId)?.state ?? ''), `${opId} to end`);
  const redirectOf = () => new URL(new URL(opened.at(-1)!).searchParams.get('redirect_uri')!);
  return { signIn, host, events, opened, states, until, last, ended, redirectOf, exit: (id: string) => exits.forEach((l) => l(id)) };
}

describe('the sign-in operation', () => {
  // P5 O4 M2 (D17): a release of the spine waits for a sign-in in flight; its end, whichever, settles it
  it('is busy from a sign-in’s start until it ends, and settles then', async () => {
    const t = make();
    expect(t.signIn.busy()).toBe(false);
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    expect(t.signIn.busy()).toBe(true);
    let settled = false;
    const settling = t.signIn.settled().then(() => void (settled = true));
    await t.until(() => t.opened.length > 0, 'the browser');
    expect(settled).toBe(false);
    expect(t.signIn.cancel(opId)).toBe(true);
    await settling;
    expect(t.signIn.busy()).toBe(false);
  });

  it('opens the engine’s URL through the asking client’s port, and fails when the port did not open it', async () => {
    const asked: unknown[] = [];
    const t = make({ port: { openExternal: async (client) => (asked.push(client), { opened: false, reason: 'only http, https and mailto links open outside MAWS' }) } });
    const client = { id: 'page:1.1', onGone: () => () => {} } as never;
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, client);
    await t.ended(opId);
    expect(asked).toEqual([client]);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'the authorization URL was not opened: only http, https and mailto links open outside MAWS' });
  });

  it('fails as not opened when the hand-off throws while it still waits on that browser', async () => {
    const t = make({ port: { openExternal: async () => Promise.reject(new Error('the client went away')) } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'the authorization URL was not opened: the client went away' });
  });

  // A port that answers late (mawsd's asks a remote client): the browser's return can come before its answer, and the
  // answer, whatever it says or a rejection, does not undo what the callback already advanced.
  type Late = { opened: true } | { opened: false; reason: string };
  it.each<{ late: string; settle: (answer: (value: Late) => void, reject: (error: Error) => void) => void }>([
    { late: 'opened', settle: (answer) => answer({ opened: true }) },
    { late: 'not opened', settle: (answer) => answer({ opened: false, reason: 'the client answered late' }) },
    { late: 'a rejection', settle: (_answer, reject) => reject(new Error('the client went away')) },
  ])('takes a callback that comes back before a slow port answers $late, and keeps it', async ({ settle }) => {
    let answer: (value: Late) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const opened: string[] = [];
    const t = make({ port: { openExternal: (_client, target) => (opened.push((target as { url: string }).url), new Promise((resolve, rejected) => ((answer = resolve), (reject = rejected)))) } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => opened.length === 1, 'the hand-off');
    expect(t.last(opId).state).toBe('waiting_callback'); // ready before the port has answered
    const redirect = new URL(new URL(opened[0]!).searchParams.get('redirect_uri')!);
    const page = await fetch(`${redirect.origin}/callback?code=the-code&state=engine-state`);
    expect(page.status).toBe(200);
    settle(answer, reject);
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'waiting_browser', 'waiting_callback', 'submitting', 'watching_status', 'done']);
  });

  it('a cancel while the port has not answered stands when it answers', async () => {
    let answer: (value: { opened: false; reason: string }) => void = () => {};
    const t = make({ port: { openExternal: () => new Promise((resolve) => (answer = resolve)) } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    t.signIn.cancel(opId);
    answer({ opened: false, reason: 'late' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.states(opId)).toEqual(['starting', 'waiting_browser', 'waiting_callback', 'cancelled']);
  });

  it('custom scheme: MAWS listens, opens the engine\'s URL, takes the one matching callback, submits it, reconnects, and ends connected here', async () => {
    const t = make();
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    const redirect = t.redirectOf();
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe('/callback');
    // another request: refused, still waiting
    const stray = await fetch(`${redirect.origin}/callback?code=x&state=someone-else`);
    expect(stray.status).toBe(400);
    expect(t.last(opId).state).toBe('waiting_callback');
    const page = await fetch(`${redirect.origin}/callback?code=the-code&state=engine-state`);
    expect(page.status).toBe(200);
    expect(await page.text()).toMatch(/return to MAWS/);
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'waiting_browser', 'waiting_callback', 'submitting', 'watching_status', 'done']);
    expect(t.last(opId)).toEqual({ opId, name: 'linear', state: 'done', reason: null, message: null, where: 'here' });
    const callback = t.host.asked.find((a) => a.name === 'session.mcpOAuthCallback')!.input as { callbackUrl: string };
    expect(callback).toEqual({ appSessionId: SESSION, serverName: 'linear', callbackUrl: `${redirect.origin}/callback?code=the-code&state=engine-state` });
    expect(t.host.asked.map((a) => a.name)).toContain('session.mcpReconnect');
    expect(t.opened).toHaveLength(1);
    // the listener closed after its one request
    await expect(fetch(`${redirect.origin}/callback?code=again&state=engine-state`)).rejects.toThrow();
    // no event carries the authorization URL, a code or a state
    expect(JSON.stringify(t.events)).not.toMatch(/engine-state|the-code|authorize/);
  });

  it('a server the signing session does not list (added after it started) ends signed in for new sessions', async () => {
    const t = make();
    t.host.status.clear();
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'done', where: 'new_sessions' });
  });

  it('localhost scheme (the engine\'s own listener): watches the status until connected', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: true, answer: { authUrl: AUTH(null), requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state: 's', callbackPort: 5555 } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'watching_status', 'watching_status');
    t.host.status.set('linear', 'connected');
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'waiting_browser', 'watching_status', 'done']);
    expect(t.last(opId).where).toBe('here');
    expect(t.host.asked.map((a) => a.name)).not.toContain('session.mcpOAuthCallback');
  });

  it('a connection that was already there is not this flow’s success: no consent is opened, and the end says it was already connected (scalpel-2#3)', async () => {
    const t = make();
    t.host.status.set('linear', 'connected'); // connected before the press
    t.host.authenticate = () => ({ ok: true, answer: { authUrl: AUTH(null), requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state: 's', callbackPort: 5555 } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'done']);
    expect(t.last(opId)).toMatchObject({ state: 'done', where: 'here', message: ALREADY_CONNECTED });
    expect(t.opened).toEqual([]);
    expect(t.host.asked.map((a) => a.name)).not.toContain('session.mcpAuthenticate');
  });

  it('localhost scheme: a server the status reports failed ends failed with the engine\'s words', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: true, answer: { authUrl: AUTH(null), requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state: 's', callbackPort: 5555 } });
    const host = t.host;
    const call = host.call.bind(host);
    host.call = (async (name: string, input: unknown) => (name === 'session.mcpStatus' ? { ok: true, value: { mcpServers: [{ name: 'linear', status: 'failed', error: 'token refused' }] } } : call(name as never, input as never))) as never;
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'token refused' });
  });

  it('a server that needs no sign-in ends done at once', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: true, answer: { requiresUserAction: false, callbackExpected: false } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'done']);
    expect(t.opened).toEqual([]);
  });

  it('the engine refusing the authentication ends failed (engine) with its words, the listener closed', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: false, message: 'MCP server linear is blocked by enterprise managed policy' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'MCP server linear is blocked by enterprise managed policy' });
    expect(t.host.asked.filter((a) => a.name === 'session.mcpAuthenticate')).toHaveLength(1); // asked once: only "not found" is asked again
  });

  it('a callback carrying an error is submitted, and the engine\'s refusal reads denied', async () => {
    const t = make();
    t.host.callback = () => ({ ok: false, message: 'OAuth authentication failed: access_denied' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    await fetch(`${t.redirectOf().origin}/callback?error=access_denied&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'denied', message: 'OAuth authentication failed: access_denied' });
  });

  it('a callback the engine refuses otherwise reads engine', async () => {
    const t = make();
    t.host.callback = () => ({ ok: false, message: 'Callback URL not accepted: it belongs to a different sign-in attempt (OAuth state mismatch)' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine' });
  });

  it('a server the engine has not read yet (Server not found just after an add) is asked again while its config poll catches up, then signs in', async () => {
    const t = make({ configMs: 200, configPollMs: 10 });
    let refusals = 3; // the engine re-reads its global config file about once a second (2.1.309: fs.watchFile, 1000 ms)
    t.host.authenticate = (i) => (refusals-- > 0 ? { ok: false, message: 'Server not found: linear' } : { ok: true, answer: { authUrl: AUTH(i.redirectUri), requiresUserAction: true, callbackExpected: true, redirectScheme: 'custom', state: 'engine-state' } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    expect(t.host.asked.filter((a) => a.name === 'session.mcpAuthenticate')).toHaveLength(4);
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'done', where: 'here' });
  });

  it('a server the engine still does not know after the config window fails with the engine’s words', async () => {
    const t = make({ configMs: 50, configPollMs: 10 });
    t.host.authenticate = () => ({ ok: false, message: 'Server not found: linear' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'Server not found: linear' });
    expect(t.opened).toEqual([]);
  });

  it('Cancel closes the listener and ends cancelled; a retry starts a new operation that completes', async () => {
    const t = make();
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null).opId;
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'waiting_callback');
    const abandoned = t.redirectOf();
    expect(t.signIn.cancel(first)).toBe(true);
    expect(t.last(first)).toMatchObject({ state: 'cancelled', reason: null });
    await expect(fetch(`${abandoned.origin}/callback?code=c&state=engine-state`)).rejects.toThrow();
    expect(t.signIn.cancel(first)).toBe(false);
    const retry = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null).opId;
    expect(retry).not.toBe(first);
    await t.until(() => t.last(retry)?.state === 'waiting_callback', 'retry waiting');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(retry);
    expect(t.last(retry).state).toBe('done');
  });

  it('a second press for the same server cancels the first operation', async () => {
    const t = make();
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null).opId;
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'first waiting');
    const second = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null).opId;
    expect(t.last(first).state).toBe('cancelled');
    await t.until(() => t.last(second)?.state === 'waiting_callback', 'second waiting');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(second);
    expect(t.last(second).state).toBe('done');
  });

  it('one sign-in per configured connector: a press from another session cancels the first; one that only shares the name, in another session, is its own', async () => {
    const t = make({ ready: () => true });
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: '/a', path: GLOBAL, appSessionId: SESSION }, null).opId;
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'first waiting');
    const second = t.signIn.start({ name: 'linear', scope: 'user', cwd: '/b', path: GLOBAL, appSessionId: 'app-session-2' }, null).opId; // user scope: the directory is not part of it
    expect(t.last(first).state).toBe('cancelled');
    await t.until(() => t.last(second)?.state === 'waiting_callback', 'second waiting');
    // project servers of one name in two projects, signed in from two sessions: two configurations on two engine flows
    const inA = t.signIn.start({ name: 'linear', scope: 'project', cwd: '/a', path: `/a/.mcp.json`, appSessionId: 'app-session-3' }, null).opId;
    const inB = t.signIn.start({ name: 'linear', scope: 'project', cwd: '/b', path: `/b/.mcp.json`, appSessionId: 'app-session-4' }, null).opId;
    await t.until(() => t.last(inA)?.state === 'waiting_callback' && t.last(inB)?.state === 'waiting_callback', 'both waiting');
    expect(t.last(second).state).toBe('waiting_callback');
    for (const opId of [second, inA, inB]) expect(t.signIn.cancel(opId)).toBe(true);
  });

  it('one engine flow per session and server name: configurations of one name in one session cancel each other, since the engine knows only the name', async () => {
    const t = make({ ready: () => true });
    const user = t.signIn.start({ name: 'linear', scope: 'user', cwd: '/a', path: GLOBAL, appSessionId: SESSION }, null).opId;
    await t.until(() => t.last(user)?.state === 'waiting_callback', 'user waiting');
    const project = t.signIn.start({ name: 'linear', scope: 'project', cwd: '/a', path: `/a/.mcp.json`, appSessionId: SESSION }, null).opId;
    expect(t.last(user).state).toBe('cancelled');
    await t.until(() => t.last(project)?.state === 'waiting_callback', 'project waiting');
    const local = t.signIn.start({ name: 'linear', scope: 'local', cwd: '/a', path: GLOBAL, appSessionId: SESSION }, null).opId;
    expect(t.last(project).state).toBe('cancelled');
    await t.until(() => t.last(local)?.state === 'waiting_callback', 'local waiting');
    // the one left is the session's flow: its callback completes
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(local);
    expect(t.last(local).state).toBe('done');
    expect(t.events.filter((e) => e.state === 'cancelled').map((e) => e.opId)).toEqual([user, project]);
  });

  it('the same configured connector keeps one sign-in when the signing session changes (fake timers)', async () => {
    vi.useFakeTimers();
    const t = make({ ready: () => true, listen: async () => ({ port: 54321, close: async () => {} }) });
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: 's1' }, null).opId;
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last(first).state).toBe('waiting_callback');
    t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: 's2' }, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last(first).state).toBe('cancelled');
  });

  it('the session exiting mid-flow ends failed (session_exited)', async () => {
    const t = make();
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    const redirect = t.redirectOf();
    t.exit('another-session');
    expect(t.last(opId).state).toBe('waiting_callback');
    t.exit(SESSION);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'session_exited' });
    await expect(fetch(`${redirect.origin}/callback?code=c&state=engine-state`)).rejects.toThrow();
  });

  it('a session whose engine uses another entry of the name is refused before the engine is asked (scalpel-2#1)', async () => {
    const asked: unknown[] = [];
    const t = make({ check: async (entry) => (asked.push(entry), 'that session uses the local entry in /cfg/.claude.json') });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: 'that session uses the local entry in /cfg/.claude.json' });
    expect(asked).toEqual([{ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }]);
    expect(t.host.asked).toEqual([]);
    expect(t.opened).toEqual([]);
  });

  it('a replacement’s mcp_authenticate waits for the one still in flight, so the old answer cannot overtake the new flow (scalpel-2#2)', async () => {
    const t = make();
    let release: (() => void) | null = null;
    let sent = 0; // mcp_authenticate requests sent to the engine host
    const call = t.host.call.bind(t.host);
    t.host.call = (async (name: string, input: unknown) => {
      if (name === 'session.mcpAuthenticate' && ++sent === 1) await new Promise<void>((resolve) => (release = resolve)); // the first flow's setup is slow
      return call(name as never, input as never);
    }) as never;
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null).opId;
    await t.until(() => release !== null, 'the first authenticate in flight');
    const second = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null).opId;
    expect(t.last(first).state).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toBe(1); // the replacement waits
    release!();
    await t.until(() => t.last(second)?.state === 'waiting_callback', 'the replacement waiting');
    expect(sent).toBe(2);
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(second);
    expect(t.last(second).state).toBe('done');
  });

  it('no ready session: failed (no_session) without asking the engine', async () => {
    const t = make();
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: 'not-ready' }, null);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'no_session' });
    expect(t.host.asked).toEqual([]);
  });

  it('times out after five minutes without the callback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = make({ callbackMs: 300_000 });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await vi.waitFor(() => expect(t.last(opId)?.state).toBe('waiting_callback'));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'timeout' });
  });

  it('a callback accepted just before the five minutes are up still finishes: the deadline ends with the wait', async () => {
    vi.useFakeTimers();
    let handle: ((request: { method: string; url: string }) => { status: number }) | null = null;
    const t = make({ callbackMs: 300_000, listen: async (h) => ((handle = h), { port: 54321, close: async () => {} }) });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last(opId).state).toBe('waiting_callback');
    await vi.advanceTimersByTimeAsync(299_990);
    expect(handle!({ method: 'GET', url: '/callback?code=accepted&state=engine-state' }).status).toBe(200);
    await vi.advanceTimersByTimeAsync(100);
    expect(t.states(opId)).not.toContain('failed');
    expect(t.last(opId)).toMatchObject({ state: 'done', where: 'here' });
  });
});

// main's wiring: the session's own directory is read for its entries before the engine is asked (scalpel-2#1)
describe('the sign-in service', () => {
  it('refuses a user entry in a session whose directory overrides it locally, reading that directory’s entries', async () => {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    const events: ConnectorSignInChanged[] = [];
    const statuses = new Set<(payload: { appSessionId: string; status: { process: string; cwd: string } }) => void>();
    const reads: unknown[] = [];
    const host = fakeHost();
    const call = host.call.bind(host);
    host.call = (async (name: string, input: unknown) => {
      if (name !== 'customization.serverEndpoints') return call(name as never, input as never);
      reads.push(input);
      return { ok: true, value: { servers: [{ name: 'linear', scope: 'user', path: GLOBAL, transport: 'http', url: 'https://u.example/mcp' }, { name: 'linear', scope: 'local', path: GLOBAL, transport: 'http', url: 'https://l.example/mcp' }] } };
    }) as never;
    const service = startSignIn({
      bus: { register: ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => handlers.set(name, handler)) as never, emit: ((_name: string, event: ConnectorSignInChanged) => events.push(event)) as never },
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      sessions: async () => [],
      hostStreaming: () => true,
      onHostStreaming: () => () => {},
      port: { openExternal: async () => ({ opened: true }) },
      listen: listenLoopback,
      relayed: createRelayedCallbacks(), // P5 O7 M5c
      machine: 'this-mac',
    });
    stop = () => service.stop();
    statuses.forEach((l) => l({ appSessionId: SESSION, status: { process: 'ready', cwd: '/p' } }));
    const { opId } = handlers.get('connectors.signIn')!({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, { client: null }) as { opId: string };
    await vi.waitFor(() => expect(events.filter((e) => e.opId === opId).at(-1)?.state).toBe('failed'));
    expect(events.filter((e) => e.opId === opId).at(-1)).toMatchObject({ reason: 'other_entry', message: `that session uses the local entry in ${GLOBAL}` });
    expect(reads).toEqual([{ cwd: '/p' }]);
    expect(host.asked.map((a) => a.name)).not.toContain('session.mcpAuthenticate');
  });
});

// P5 O7 M8 ("Sign in from the session's MCP widget"): the widget knows a server's name and scope and the session's
// directory, but not the file its entry is in, which only the session's machine reads (`customization.serverEndpoints`,
// main-only there). `connectors.signInServer` signs in the entry the session's engine uses for the name, when it is of
// the scope asked; any other is refused as a row's would be.
describe('a sign-in of a server by its name and scope (the session’s MCP widget)', () => {
  function service(servers: unknown[]) {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    const events: ConnectorSignInChanged[] = [];
    const statuses = new Set<(payload: { appSessionId: string; status: { process: string; cwd: string } }) => void>();
    const reads: unknown[] = [];
    const host = fakeHost();
    const call = host.call.bind(host);
    // the session's engine holds the entry its files say it uses, waiting for its sign-in
    host.call = (async (name: string, input: unknown) => {
      if (name === 'session.mcpStatus') return { ok: true, value: { mcpServers: held.map(({ name: n, scope, transport, url }) => ({ name: n, status: 'needs-auth', scope, transport, config: { type: transport, url } })) } };
      if (name !== 'customization.serverEndpoints') return call(name as never, input as never);
      reads.push(input);
      return { ok: true, value: { servers } };
    }) as never;
    const held = (servers as Array<{ name: string; scope: string; transport: string; url: string }>).slice(-1);
    const started = startSignIn({
      bus: { register: ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => handlers.set(name, handler)) as never, emit: ((_name: string, event: ConnectorSignInChanged) => events.push(event)) as never },
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      sessions: async () => [],
      hostStreaming: () => true,
      onHostStreaming: () => () => {},
      port: { openExternal: async () => ({ opened: true }) },
      listen: listenLoopback,
      relayed: createRelayedCallbacks(),
      machine: 'this-mac',
    });
    stop = () => started.stop();
    statuses.forEach((l) => l({ appSessionId: SESSION, status: { process: 'ready', cwd: '/p' } }));
    const signIn = (input: Record<string, unknown>) => (handlers.get('connectors.signInServer')!({ appSessionId: SESSION, ...input }, { client: null }) as { opId: string }).opId;
    const last = (opId: string) => events.filter((e) => e.opId === opId).at(-1);
    return { host, reads, signIn, last };
  }

  it('takes no entry file, which `connectors.signIn` still requires', () => {
    expect(validateCommandInput('connectors.signInServer', { name: 'linear', scope: 'user', cwd: '/p', appSessionId: SESSION }).ok).toBe(true);
    expect(validateCommandInput('connectors.signInServer', { name: 'linear', scope: 'user', cwd: '/p', path: GLOBAL, appSessionId: SESSION }).ok).toBe(false);
    expect(validateCommandInput('connectors.signIn', { name: 'linear', scope: 'user', cwd: '/p', appSessionId: SESSION }).ok).toBe(false);
  });

  it('signs in the entry the session’s engine uses for the name, read on its machine for its directory', async () => {
    const t = service([{ name: 'linear', scope: 'project', path: '/p/.mcp.json', transport: 'http', url: 'https://p.example/mcp' }]);
    const opId = t.signIn({ name: 'linear', scope: 'project', cwd: '/p' });
    await vi.waitFor(() => expect(t.host.asked.map((a) => a.name)).toContain('session.mcpAuthenticate'));
    expect(t.last(opId)?.state).not.toBe('failed');
    expect(t.reads).toEqual([{ cwd: '/p' }]);
  });

  it('refuses when the entry the session uses is of another scope than the one asked, saying which it uses', async () => {
    const t = service([{ name: 'linear', scope: 'user', path: GLOBAL, transport: 'http', url: 'https://u.example/mcp' }, { name: 'linear', scope: 'local', path: GLOBAL, transport: 'http', url: 'https://l.example/mcp' }]);
    const opId = t.signIn({ name: 'linear', scope: 'user', cwd: '/p' });
    await vi.waitFor(() => expect(t.last(opId)?.state).toBe('failed'));
    expect(t.last(opId)).toMatchObject({ reason: 'other_entry', message: `that session uses the local entry in ${GLOBAL}` });
    expect(t.host.asked.map((a) => a.name)).not.toContain('session.mcpAuthenticate');
  });

  it('refuses when the session has no entry of the name', async () => {
    const t = service([]);
    const opId = t.signIn({ name: 'linear', scope: 'user', cwd: '/p' });
    await vi.waitFor(() => expect(t.last(opId)?.state).toBe('failed'));
    expect(t.last(opId)).toMatchObject({ reason: 'other_entry', message: 'that session has no linear entry' });
  });
});

// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D30): the service loads with the spine, which may load
// long after a session became ready; the engine host's listing tells it the sessions no status announced
describe('the sign-in service loaded after its sessions', () => {
  type Status = { appSessionId: string; status: { process: string; cwd: string } };
  function serve(sessions: () => Promise<{ appSessionId: string; process: string; cwd: string }[]>, streams = true) {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    const events: ConnectorSignInChanged[] = [];
    const statuses = new Set<(payload: Status) => void>();
    const streaming = new Set<() => void>();
    const host = fakeHost();
    const call = host.call.bind(host);
    host.call = (async (name: string, input: unknown) => {
      if (name === 'customization.serverEndpoints') return { ok: true, value: { servers: [{ name: 'linear', scope: 'user', path: GLOBAL, transport: 'http', url: null }] } };
      if (name === 'session.mcpStatus') return (host.asked.push({ name, input }), { ok: true, value: { mcpServers: [{ name: 'linear', status: 'needs-auth', scope: 'user', transport: 'http' }] } });
      return call(name as never, input as never);
    }) as never;
    const service = startSignIn({
      bus: { register: ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => handlers.set(name, handler)) as never, emit: ((_name: string, event: ConnectorSignInChanged) => events.push(event)) as never },
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      sessions,
      hostStreaming: () => streams,
      onHostStreaming: (listener) => (streaming.add(listener), () => streaming.delete(listener)),
      port: { openExternal: async () => ({ opened: true }) },
      listen: listenLoopback,
      relayed: createRelayedCallbacks(), // P5 O7 M5c
      machine: 'this-mac',
    });
    stop = () => service.stop();
    const start = () => (handlers.get('connectors.signIn')!({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, { client: null }) as { opId: string }).opId;
    const reasonOf = async (opId: string) => {
      await vi.waitFor(() => expect(events.filter((e) => e.opId === opId).at(-1)?.state).not.toBe('starting'));
      return events.filter((e) => e.opId === opId).at(-1);
    };
    return { host, start, reasonOf, status: (payload: Status) => statuses.forEach((l) => l(payload)), streamed: () => streaming.forEach((l) => l()) };
  }

  it('signs in a session the engine host lists ready, with no status heard', async () => {
    const t = serve(async () => [{ appSessionId: SESSION, process: 'ready', cwd: '/p' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const opId = t.start();
    await vi.waitFor(() => expect(t.host.asked.map((a) => a.name)).toContain('session.mcpAuthenticate'));
    expect((await t.reasonOf(opId))?.reason).not.toBe('no_session');
  });

  it('never revives a session whose status said it left while the listing was answering', async () => {
    let answer!: (sessions: { appSessionId: string; process: string; cwd: string }[]) => void;
    const t = serve(() => new Promise((resolve) => (answer = resolve)));
    t.status({ appSessionId: SESSION, status: { process: 'exited', cwd: '/p' } });
    answer([{ appSessionId: SESSION, process: 'ready', cwd: '/p' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await t.reasonOf(t.start())).toMatchObject({ state: 'failed', reason: 'no_session' });
  });

  it('reads the listing again when the engine host streams again', async () => {
    let listed: { appSessionId: string; process: string; cwd: string }[] = [];
    const t = serve(async () => listed);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await t.reasonOf(t.start())).toMatchObject({ state: 'failed', reason: 'no_session' });
    listed = [{ appSessionId: SESSION, process: 'ready', cwd: '/p' }];
    t.streamed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const opId = t.start();
    await vi.waitFor(() => expect(t.host.asked.map((a) => a.name)).toContain('session.mcpAuthenticate'));
    expect((await t.reasonOf(opId))?.reason).not.toBe('no_session');
  });

  it('asks for the listing only once the engine host streams', async () => {
    const sessions = vi.fn(async () => [{ appSessionId: SESSION, process: 'ready', cwd: '/p' }]);
    const t = serve(sessions, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessions).not.toHaveBeenCalled();
    t.streamed();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sessions).toHaveBeenCalledOnce();
  });
});

// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"; A15): a remote
// asker's sign-in names its device's loopback port (`callback`). Nothing binds here: the engine is given the device's
// redirect, the device relays the browser's return as `connectors.callback`, answered through this operation's own
// handler. An engine that keeps its own listener on this machine cannot be relayed, and the sign-in ends saying where to
// sign in.
describe('a remote asker’s sign-in through the relayed callback (P5 O7 M5c)', () => {
  const PORT = 61_234;
  const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
  const noBind: SignInDeps['listen'] = async () => {
    throw new Error('a remote asker’s sign-in bound this machine’s loopback');
  };
  const remote = () => {
    const relayed = createRelayedCallbacks();
    const asked: unknown[] = [];
    const opened: string[] = [];
    const t = make({ listen: noBind, relayed, machine: 'mini', port: { openExternal: async (client, target) => (asked.push(client), opened.push((target as { url: string }).url), { opened: true }) } });
    const device = endableClientRef('remote:device-a');
    const relay = (url: string, client = device) => relayed.answer(client, { port: PORT, method: 'GET', url });
    const begin = (name = 'linear') => t.signIn.start({ name, scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }, device, { port: PORT }).opId;
    return { ...t, opened, relayed, device, relay, begin, asked };
  };

  it('gives the engine the device’s redirect, opens consent on the device, and submits the relayed return', async () => {
    const t = remote();
    const opId = t.begin();
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    expect(t.host.asked.find((a) => a.name === 'session.mcpAuthenticate')!.input).toMatchObject({ redirectUri: REDIRECT });
    expect(t.asked).toEqual([t.device]);
    expect(t.relay('/callback?code=x&state=someone-else')).toEqual({ status: 404, body: '' }); // another flow's: never handed to this one
    expect(t.last(opId).state).toBe('waiting_callback');
    expect(t.relay('/callback?code=the-code&state=engine-state')).toMatchObject({ status: 200, body: 'MAWS received the sign-in. You can close this tab and return to MAWS.' });
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'waiting_browser', 'waiting_callback', 'submitting', 'watching_status', 'done']);
    expect(t.host.asked.find((a) => a.name === 'session.mcpOAuthCallback')!.input).toEqual({ appSessionId: SESSION, serverName: 'linear', callbackUrl: `${REDIRECT}?code=the-code&state=engine-state` });
    expect(t.relayed.armed()).toBe(0);
    expect(t.relay('/callback?code=the-code&state=engine-state')).toEqual({ status: 404, body: '' });
  });

  it('answers a second sign-in naming a port this client has armed with its receipt, then a failure, leaving the first as it was', async () => {
    const t = remote();
    const first = t.begin('linear');
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'waiting_callback');
    const second = t.begin('notion');
    expect(typeof second).toBe('string');
    await t.ended(second);
    expect(t.states(second)).toEqual(['starting', 'failed']);
    expect(t.last(second)).toMatchObject({ reason: 'engine', message: 'another sign-in from this device is waiting on the same callback port' });
    expect(t.host.asked.filter((a) => a.name === 'session.mcpAuthenticate')).toHaveLength(1);
    expect(t.last(first).state).toBe('waiting_callback');
    expect(t.relay('/callback?code=c&state=engine-state')).toMatchObject({ status: 200 }); // the first's, still armed
    await t.ended(first);
    expect(t.last(first)).toMatchObject({ state: 'done' });
  });

  it('ends at once after its receipt, saying where to sign in, when the engine keeps its own listener on this machine', async () => {
    const t = remote();
    t.host.authenticate = () => ({ ok: true, answer: { authUrl: AUTH(null), requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state: 's', callbackPort: 5555 } });
    const opId = t.begin();
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'waiting_browser', 'failed']);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'sign in on mini' });
    expect(t.opened).toEqual([]); // no consent opened on a device whose browser could never return to it
    expect(t.relayed.armed()).toBe(0);
  });

  it('fails a sign-in whose asker’s channel ended before the return, and leaves one past its return to finish', async () => {
    const t = remote();
    const opId = t.begin();
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    t.device.end();
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'the connection to mini ended before the sign-in returned' });
    expect(t.relayed.armed()).toBe(0);

    const later = remote();
    const past = later.begin();
    await later.until(() => later.last(past)?.state === 'waiting_callback', 'waiting_callback');
    expect(later.relay('/callback?code=c&state=engine-state')).toMatchObject({ status: 200 });
    later.device.end();
    await later.ended(past);
    expect(later.last(past)).toMatchObject({ state: 'done' });
  });
});

// UX wave U11a M8 (§A): a dynamic connector's sign-in, `connectors.signInDynamicServer`. A plugin's server
// (`plugin:<plugin>:<server>`) and a server of MAWS's own list (passed with --mcp-config) are both listed by the
// session's mcp_status with scope `dynamic` (P1's second run); both take MAWS's redirect (P1's verdict). The check runs
// in the operation, on the status of the session it drives, and for a press from a row of MAWS's own list on one read of
// the entries the engine host answers now, whose revision must be the press's. The servers and addresses are invented.
describe('a dynamic connector’s sign-in (UX wave U11a, §A)', () => {
  const PLUGIN = 'plugin:fx-plugin:fx-oauth';
  const OWN = 'fx-own';
  const OWN_URL = 'https://own.example.test/mcp';
  const NEW_URL = 'https://own-moved.example.test/mcp';
  const SECOND = 'app-session-2';
  const CHANGED = 'MAWS’s fx-own server changed since this page read it; refresh the page, then sign in';
  type Held = { name: string; scope: string; transport: string; config: { type: string; url: string } };
  const dynamic = (name: string, url = OWN_URL): Held => ({ name, scope: 'dynamic', transport: 'http', config: { type: 'http', url } });
  const entry = (revision: string | null, url = OWN_URL) => ({ name: OWN, scope: 'app', path: '/maws/machine-settings.json', transport: 'http', url, revision });
  type Status = { appSessionId: string; status: { process: string; cwd: string } };

  function serve(setup: { held?: Held[]; own?: unknown[] } = {}) {
    const handlers = new Map<string, (input: unknown, ctx: unknown) => unknown>();
    const events: ConnectorSignInChanged[] = [];
    const statuses = new Set<(payload: Status) => void>();
    const opened: string[] = [];
    const host = fakeHost();
    const t = {
      held: setup.held ?? [dynamic(PLUGIN), dynamic(OWN)], // what the sessions' engines hold
      own: setup.own ?? [], // MAWS's own entries, as the engine host answers them now
      endpoints: null as null | (() => Promise<unknown[]>), // a read held open
    };
    host.status = new Map(t.held.map((server) => [server.name, 'needs-auth']));
    const call = host.call.bind(host);
    host.call = (async (name: string, input: unknown) => {
      if (name === 'session.mcpStatus') {
        host.asked.push({ name, input });
        return { ok: true, value: { mcpServers: t.held.map((server) => ({ ...server, status: host.status.get(server.name) ?? 'needs-auth' })) } };
      }
      if (name === 'customization.serverEndpoints') {
        host.asked.push({ name, input });
        return { ok: true, value: { servers: t.endpoints ? await t.endpoints() : t.own } };
      }
      return call(name as never, input as never);
    }) as never;
    const service = startSignIn({
      bus: { register: ((name: string, handler: (input: unknown, ctx: unknown) => unknown) => handlers.set(name, handler)) as never, emit: ((_name: string, event: ConnectorSignInChanged) => events.push(event)) as never },
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      sessions: async () => [],
      hostStreaming: () => true,
      onHostStreaming: () => () => {},
      port: { openExternal: async (_client, target) => (opened.push((target as { url: string }).url), { opened: true }) },
      listen: listenLoopback,
      relayed: createRelayedCallbacks(),
      machine: 'this-mac',
    });
    stop = () => service.stop();
    const status = (payload: Status) => statuses.forEach((listener) => listener(payload));
    status({ appSessionId: SESSION, status: { process: 'ready', cwd: '/p' } });
    status({ appSessionId: SECOND, status: { process: 'ready', cwd: '/q' } });
    const signIn = (input: Record<string, unknown>, appSessionId = SESSION) => (handlers.get('connectors.signInDynamicServer')!({ appSessionId, ...input }, { client: null }) as { opId: string }).opId;
    const cancel = (opId: string) => handlers.get('connectors.signInCancel')!({ opId }, { client: null });
    const of = (opId: string) => events.filter((e) => e.opId === opId);
    const last = (opId: string) => of(opId).at(-1);
    const until = async (check: () => boolean, what: string) => {
      for (let i = 0; i < 400 && !check(); i += 1) await new Promise((r) => setTimeout(r, 5));
      if (!check()) throw new Error(`timed out waiting for ${what}`);
    };
    const ended = (opId: string) => until(() => ['done', 'failed', 'cancelled'].includes(last(opId)?.state ?? ''), `${opId} to end`);
    const authenticated = () => host.asked.filter((a) => a.name === 'session.mcpAuthenticate').map((a) => a.input as { appSessionId: string; serverName: string; redirectUri: string | null });
    const reads = () => host.asked.filter((a) => a.name === 'customization.serverEndpoints');
    const redirect = () => new URL(new URL(opened.at(-1)!).searchParams.get('redirect_uri')!);
    const holdEndpoints = () => {
      let answer!: (servers: unknown[]) => void;
      const asked = new Promise<void>((noticed) => (t.endpoints = () => (noticed(), new Promise((resolve) => (answer = resolve)))));
      return { asked, answer: (servers: unknown[]) => answer(servers) };
    };
    return { t, host, events, opened, signIn, cancel, states: (opId: string) => of(opId).map((e) => e.state), last, until, ended, authenticated, reads, redirect, holdEndpoints, status };
  }

  it('takes the name as the session’s status reports it, up to 128 characters, and an entry’s revision for a press from MAWS’s own list', () => {
    expect(validateCommandInput('connectors.signInDynamicServer', { name: PLUGIN, appSessionId: SESSION }).ok).toBe(true);
    expect(validateCommandInput('connectors.signInDynamicServer', { name: OWN, appSessionId: SESSION, entry: { revision: 'rev-1' } }).ok).toBe(true);
    expect(validateCommandInput('connectors.signInDynamicServer', { name: 'x'.repeat(128), appSessionId: SESSION }).ok).toBe(true);
    expect(validateCommandInput('connectors.signInDynamicServer', { name: 'x'.repeat(129), appSessionId: SESSION }).ok).toBe(false);
    expect(validateCommandInput('connectors.signInDynamicServer', { name: '', appSessionId: SESSION }).ok).toBe(false);
    expect(validateCommandInput('connectors.signInDynamicServer', { name: OWN, appSessionId: SESSION, entry: { revision: '' } }).ok).toBe(false);
    expect(validateCommandInput('connectors.signInDynamicServer', { name: OWN, appSessionId: SESSION, scope: 'user' }).ok).toBe(false);
    // the progress event carries such a name; the two file-scope sign-ins keep the configured-name rule
    expect(validateEventPayload('connectors.signInChanged', { opId: 'op', name: PLUGIN, state: 'starting', reason: null, message: null, where: null }).ok).toBe(true);
    expect(validateEventPayload('connectors.signInChanged', { opId: 'op', name: 'x'.repeat(129), state: 'starting', reason: null, message: null, where: null }).ok).toBe(false);
    expect(validateCommandInput('connectors.signInServer', { name: PLUGIN, scope: 'user', cwd: null, appSessionId: SESSION }).ok).toBe(false);
  });

  it('signs a plugin’s connector, and one of MAWS’s own list from the dialog, through MAWS’s redirect, through every state to connected here', async () => {
    const s = serve();
    for (const name of [PLUGIN, OWN]) {
      const opId = s.signIn({ name });
      await s.until(() => s.last(opId)?.state === 'waiting_callback', `${name} waiting_callback`);
      const redirect = s.redirect();
      expect(redirect.hostname).toBe('127.0.0.1'); // MAWS's loopback listener (P1: both kinds take it)
      expect(s.authenticated().at(-1)).toEqual({ appSessionId: SESSION, serverName: name, redirectUri: `${redirect.origin}/callback` });
      expect((await fetch(`${redirect.origin}/callback?code=the-code&state=engine-state`)).status).toBe(200);
      await s.ended(opId);
      expect(s.states(opId)).toEqual(['starting', 'waiting_browser', 'waiting_callback', 'submitting', 'watching_status', 'done']);
      expect(s.last(opId)).toEqual({ opId, name, state: 'done', reason: null, message: null, where: 'here' });
      expect(s.host.asked.filter((a) => a.name === 'session.mcpReconnect').at(-1)!.input).toEqual({ appSessionId: SESSION, serverName: name });
    }
    expect(s.reads()).toEqual([]); // a press from the dialog names no entry: MAWS's list is not read
  });

  it('refuses before the engine is asked when the session does not hold the server, or holds a file-configured one of the name', async () => {
    const s = serve({ held: [{ ...dynamic(OWN), scope: 'user' }] });
    const missing = s.signIn({ name: PLUGIN });
    const file = s.signIn({ name: OWN });
    for (const opId of [missing, file]) await s.ended(opId);
    expect(s.last(missing)).toMatchObject({ state: 'failed', reason: 'other_entry', message: `that session has no ${PLUGIN} server` });
    expect(s.last(file)).toMatchObject({ state: 'failed', reason: 'other_entry', message: 'this session uses a different fx-own; start a new session to sign in' });
    expect(s.authenticated()).toEqual([]);
    expect(s.opened).toEqual([]);
  });

  // a dynamic server is never read from a file later, so the wait for a just-added one does not apply
  it('fails at once in the engine’s words when the engine answers that it does not know the server', async () => {
    const s = serve();
    s.host.authenticate = () => ({ ok: false, message: `Server not found: ${PLUGIN}` });
    const opId = s.signIn({ name: PLUGIN });
    await s.ended(opId);
    expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: `Server not found: ${PLUGIN}` });
    expect(s.authenticated()).toHaveLength(1);
  });

  it('one at a time across two sessions: a press from another session while the first waits for its callback cancels the first, and the second goes on', async () => {
    const s = serve();
    const first = s.signIn({ name: PLUGIN });
    await s.until(() => s.last(first)?.state === 'waiting_callback', 'the first waiting');
    const abandoned = s.redirect();
    const second = s.signIn({ name: PLUGIN }, SECOND);
    expect(s.last(first)?.state).toBe('cancelled');
    await s.until(() => s.last(second)?.state === 'waiting_callback', 'the second waiting');
    await expect(fetch(`${abandoned.origin}/callback?code=c&state=engine-state`)).rejects.toThrow();
    await fetch(`${s.redirect().origin}/callback?code=c&state=engine-state`);
    await s.ended(second);
    expect(s.last(second)).toMatchObject({ state: 'done', where: 'here' });
    expect(s.authenticated().map((a) => a.appSessionId)).toEqual([SESSION, SECOND]);
  });

  it('a press from MAWS’s own list whose revision is the entry’s passes and authenticates, on one read of the list', async () => {
    const s = serve({ own: [entry('rev-1')] });
    const opId = s.signIn({ name: OWN, entry: { revision: 'rev-1' } });
    await s.until(() => s.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    expect(s.authenticated()).toHaveLength(1);
    expect(s.reads()).toHaveLength(1);
  });

  it('a press whose revision is not the entry’s, the entry and the session both holding the replacement, ends other_entry and authenticates nothing', async () => {
    const s = serve({ held: [dynamic(OWN, NEW_URL)], own: [entry('rev-2', NEW_URL)] });
    const opId = s.signIn({ name: OWN, entry: { revision: 'rev-1' } });
    await s.ended(opId);
    expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: CHANGED });
    expect(s.authenticated()).toEqual([]);
    expect(s.opened).toEqual([]);
  });

  it('held open: the entry replaced under the same name while the operation reads it, the read answering the replacement, is refused', async () => {
    const s = serve({ own: [entry('rev-1')] });
    const read = s.holdEndpoints();
    const opId = s.signIn({ name: OWN, entry: { revision: 'rev-1' } });
    await read.asked;
    s.t.held = [dynamic(OWN, NEW_URL)]; // the list changed and a session started since holds the replacement
    read.answer([entry('rev-2', NEW_URL)]);
    await s.ended(opId);
    expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'other_entry', message: CHANGED });
    expect(s.authenticated()).toEqual([]);
  });

  it('held open: a cancel while the check’s read is out sends no mcp_authenticate', async () => {
    const s = serve({ own: [entry('rev-1')] });
    const read = s.holdEndpoints();
    const opId = s.signIn({ name: OWN, entry: { revision: 'rev-1' } });
    await read.asked;
    s.cancel(opId);
    expect(s.last(opId)?.state).toBe('cancelled');
    read.answer([entry('rev-1')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.states(opId)).toEqual(['starting', 'cancelled']);
    expect(s.authenticated()).toEqual([]);
  });

  it('held open: the session leaving while the entry is read ends session_exited, and nothing is sent', async () => {
    const s = serve({ own: [entry('rev-1')] });
    const read = s.holdEndpoints();
    const opId = s.signIn({ name: OWN, entry: { revision: 'rev-1' } });
    await read.asked;
    s.status({ appSessionId: SESSION, status: { process: 'exited', cwd: '/p' } });
    expect(s.last(opId)).toMatchObject({ state: 'failed', reason: 'session_exited' });
    read.answer([entry('rev-1')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.states(opId)).toEqual(['starting', 'failed']);
    expect(s.authenticated()).toEqual([]);
    expect(s.opened).toEqual([]);
  });
});
