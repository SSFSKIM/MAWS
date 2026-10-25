// P4-AGG M4: main's sign-in operation over the engine's own MCP sign-in (docs/doperpowers/specs/2026-10-24-plugin-
// aggregator-design.md, Design "Signing in" and Decision Log 12 and 14). The engine host is a fake answering the three
// bounded calls and the reconnect as the spike measured them (spikes/p4-aggregator/findings-m4.txt); the loopback listener
// is the real one on 127.0.0.1, which the test's own request reaches as the person's browser would. No engine runs here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { listenLoopback } from './oauth-callback';
import { ALREADY_CONNECTED, createSignIn, startSignIn, type SignInDeps, type SignInHost } from './sign-in';

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
    const handlers = new Map<string, (input: unknown) => unknown>();
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
      register: ((name: string, handler: (input: unknown) => unknown) => handlers.set(name, handler)) as never,
      emit: (_name, event) => events.push(event),
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      open: () => true,
      listen: listenLoopback,
    });
    stop = () => service.stop();
    statuses.forEach((l) => l({ appSessionId: SESSION, status: { process: 'ready', cwd: '/p' } }));
    const { opId } = handlers.get('connectors.signIn')!({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }) as { opId: string };
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
    open: (url) => (opened.push(url), true),
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
  it('custom scheme: MAWS listens, opens the engine\'s URL, takes the one matching callback, submits it, reconnects, and ends connected here', async () => {
    const t = make();
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
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
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'done', where: 'new_sessions' });
  });

  it('localhost scheme (the engine\'s own listener): watches the status until connected', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: true, answer: { authUrl: AUTH(null), requiresUserAction: true, callbackExpected: true, redirectScheme: 'localhost', state: 's', callbackPort: 5555 } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
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
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
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
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'token refused' });
  });

  it('a server that needs no sign-in ends done at once', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: true, answer: { requiresUserAction: false, callbackExpected: false } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.ended(opId);
    expect(t.states(opId)).toEqual(['starting', 'done']);
    expect(t.opened).toEqual([]);
  });

  it('the engine refusing the authentication ends failed (engine) with its words, the listener closed', async () => {
    const t = make();
    t.host.authenticate = () => ({ ok: false, message: 'MCP server linear is blocked by enterprise managed policy' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'MCP server linear is blocked by enterprise managed policy' });
    expect(t.host.asked.filter((a) => a.name === 'session.mcpAuthenticate')).toHaveLength(1); // asked once: only "not found" is asked again
  });

  it('a callback carrying an error is submitted, and the engine\'s refusal reads denied', async () => {
    const t = make();
    t.host.callback = () => ({ ok: false, message: 'OAuth authentication failed: access_denied' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    await fetch(`${t.redirectOf().origin}/callback?error=access_denied&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'denied', message: 'OAuth authentication failed: access_denied' });
  });

  it('a callback the engine refuses otherwise reads engine', async () => {
    const t = make();
    t.host.callback = () => ({ ok: false, message: 'Callback URL not accepted: it belongs to a different sign-in attempt (OAuth state mismatch)' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine' });
  });

  it('a server the engine has not read yet (Server not found just after an add) is asked again while its config poll catches up, then signs in', async () => {
    const t = make({ configMs: 200, configPollMs: 10 });
    let refusals = 3; // the engine re-reads its global config file about once a second (2.1.309: fs.watchFile, 1000 ms)
    t.host.authenticate = (i) => (refusals-- > 0 ? { ok: false, message: 'Server not found: linear' } : { ok: true, answer: { authUrl: AUTH(i.redirectUri), requiresUserAction: true, callbackExpected: true, redirectScheme: 'custom', state: 'engine-state' } });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.until(() => t.last(opId)?.state === 'waiting_callback', 'waiting_callback');
    expect(t.host.asked.filter((a) => a.name === 'session.mcpAuthenticate')).toHaveLength(4);
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'done', where: 'here' });
  });

  it('a server the engine still does not know after the config window fails with the engine’s words', async () => {
    const t = make({ configMs: 50, configPollMs: 10 });
    t.host.authenticate = () => ({ ok: false, message: 'Server not found: linear' });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'engine', message: 'Server not found: linear' });
    expect(t.opened).toEqual([]);
  });

  it('Cancel closes the listener and ends cancelled; a retry starts a new operation that completes', async () => {
    const t = make();
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }).opId;
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'waiting_callback');
    const abandoned = t.redirectOf();
    expect(t.signIn.cancel(first)).toBe(true);
    expect(t.last(first)).toMatchObject({ state: 'cancelled', reason: null });
    await expect(fetch(`${abandoned.origin}/callback?code=c&state=engine-state`)).rejects.toThrow();
    expect(t.signIn.cancel(first)).toBe(false);
    const retry = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }).opId;
    expect(retry).not.toBe(first);
    await t.until(() => t.last(retry)?.state === 'waiting_callback', 'retry waiting');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(retry);
    expect(t.last(retry).state).toBe('done');
  });

  it('a second press for the same server cancels the first operation', async () => {
    const t = make();
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }).opId;
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'first waiting');
    const second = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }).opId;
    expect(t.last(first).state).toBe('cancelled');
    await t.until(() => t.last(second)?.state === 'waiting_callback', 'second waiting');
    await fetch(`${t.redirectOf().origin}/callback?code=c&state=engine-state`);
    await t.ended(second);
    expect(t.last(second).state).toBe('done');
  });

  it('one sign-in per configured connector: a press from another session cancels the first; one that only shares the name, in another session, is its own', async () => {
    const t = make({ ready: () => true });
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: '/a', path: GLOBAL, appSessionId: SESSION }).opId;
    await t.until(() => t.last(first)?.state === 'waiting_callback', 'first waiting');
    const second = t.signIn.start({ name: 'linear', scope: 'user', cwd: '/b', path: GLOBAL, appSessionId: 'app-session-2' }).opId; // user scope: the directory is not part of it
    expect(t.last(first).state).toBe('cancelled');
    await t.until(() => t.last(second)?.state === 'waiting_callback', 'second waiting');
    // project servers of one name in two projects, signed in from two sessions: two configurations on two engine flows
    const inA = t.signIn.start({ name: 'linear', scope: 'project', cwd: '/a', path: `/a/.mcp.json`, appSessionId: 'app-session-3' }).opId;
    const inB = t.signIn.start({ name: 'linear', scope: 'project', cwd: '/b', path: `/b/.mcp.json`, appSessionId: 'app-session-4' }).opId;
    await t.until(() => t.last(inA)?.state === 'waiting_callback' && t.last(inB)?.state === 'waiting_callback', 'both waiting');
    expect(t.last(second).state).toBe('waiting_callback');
    for (const opId of [second, inA, inB]) expect(t.signIn.cancel(opId)).toBe(true);
  });

  it('one engine flow per session and server name: configurations of one name in one session cancel each other, since the engine knows only the name', async () => {
    const t = make({ ready: () => true });
    const user = t.signIn.start({ name: 'linear', scope: 'user', cwd: '/a', path: GLOBAL, appSessionId: SESSION }).opId;
    await t.until(() => t.last(user)?.state === 'waiting_callback', 'user waiting');
    const project = t.signIn.start({ name: 'linear', scope: 'project', cwd: '/a', path: `/a/.mcp.json`, appSessionId: SESSION }).opId;
    expect(t.last(user).state).toBe('cancelled');
    await t.until(() => t.last(project)?.state === 'waiting_callback', 'project waiting');
    const local = t.signIn.start({ name: 'linear', scope: 'local', cwd: '/a', path: GLOBAL, appSessionId: SESSION }).opId;
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
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: 's1' }).opId;
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last(first).state).toBe('waiting_callback');
    t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: 's2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last(first).state).toBe('cancelled');
  });

  it('the session exiting mid-flow ends failed (session_exited)', async () => {
    const t = make();
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
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
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
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
    const first = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }).opId;
    await t.until(() => release !== null, 'the first authenticate in flight');
    const second = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }).opId;
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
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: 'not-ready' });
    await t.ended(opId);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'no_session' });
    expect(t.host.asked).toEqual([]);
  });

  it('times out after five minutes without the callback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = make({ callbackMs: 300_000 });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
    await vi.waitFor(() => expect(t.last(opId)?.state).toBe('waiting_callback'));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(t.last(opId)).toMatchObject({ state: 'failed', reason: 'timeout' });
  });

  it('a callback accepted just before the five minutes are up still finishes: the deadline ends with the wait', async () => {
    vi.useFakeTimers();
    let handle: ((request: { method: string; url: string }) => { status: number }) | null = null;
    const t = make({ callbackMs: 300_000, listen: async (h) => ((handle = h), { port: 54321, close: async () => {} }) });
    const { opId } = t.signIn.start({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION });
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
    const handlers = new Map<string, (input: unknown) => unknown>();
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
      register: ((name: string, handler: (input: unknown) => unknown) => handlers.set(name, handler)) as never,
      emit: (_name, event) => events.push(event),
      host,
      onSessionStatus: (listener) => (statuses.add(listener), () => statuses.delete(listener)),
      onHostLost: () => () => {},
      open: () => true,
      listen: listenLoopback,
    });
    stop = () => service.stop();
    statuses.forEach((l) => l({ appSessionId: SESSION, status: { process: 'ready', cwd: '/p' } }));
    const { opId } = handlers.get('connectors.signIn')!({ name: 'linear', scope: 'user', cwd: null, path: GLOBAL, appSessionId: SESSION }) as { opId: string };
    await vi.waitFor(() => expect(events.filter((e) => e.opId === opId).at(-1)?.state).toBe('failed'));
    expect(events.filter((e) => e.opId === opId).at(-1)).toMatchObject({ reason: 'other_entry', message: `that session uses the local entry in ${GLOBAL}` });
    expect(reads).toEqual([{ cwd: '/p' }]);
    expect(host.asked.map((a) => a.name)).not.toContain('session.mcpAuthenticate');
  });
});
