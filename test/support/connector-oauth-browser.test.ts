// P3-HD M4a: the fixture-only fake browser (e2e/support/connector-oauth-browser.ts). Production opens the owner's
// browser through the scheme-checked openExternalUrl, which under MAWS_E2E appends `openExternal <url>` to the scratch
// MAWS_E2E_OPEN_LOG instead (src/main/open-external.ts). The fake browser follows only the next such line, only when it
// is the toy fixture's exact /authorize, and then only the exact validated 127.0.0.1 callback it redirects to, with
// manual redirects; it never opens a system browser. Driven here with an injected fetch, log reader and clock.
import { describe, expect, it } from 'vitest';
import { countAuthorizationOpens, FakeBrowserRefusal, followAuthorization, openExternalUrls, type FakeBrowserDeps } from '../../e2e/support/connector-oauth-browser';

const ORIGIN = 'http://127.0.0.1:41000';
const REDIRECT = 'http://127.0.0.1:52000/callback';
const authorizeUrl = (overrides: Record<string, string> = {}) => `${ORIGIN}/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'c1', redirect_uri: REDIRECT, state: 'secret-state', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: `${ORIGIN}/mcp`, ...overrides }).toString()}`;

interface Fetched {
  url: string;
  redirect: RequestInit['redirect'];
  signal: AbortSignal | null | undefined;
}
type Respond = (url: string, init: RequestInit) => Promise<Response>;

// A fake clock whose one deadline fires when the clock reaches it or when a case calls `expire`.
function harness(options: { lines?: string[]; location?: string | null; authorizeStatus?: number; callbackStatus?: number; authorize?: Respond; callback?: Respond; readOpenLog?: (log: string) => string } = {}) {
  let log = (options.lines ?? []).map((line) => `${line}\n`).join('');
  let clock = 0;
  let end = Infinity;
  const timer = new AbortController();
  const state = { cleared: false };
  const fetched: Fetched[] = [];
  const expire = () => timer.abort();
  const deps: FakeBrowserDeps = {
    readOpenLog: () => (options.readOpenLog ?? ((text) => text))(log),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
      if (clock >= end) expire();
    },
    deadline: (ms) => {
      end = clock + ms;
      return { signal: timer.signal, clear: () => { state.cleared = true; } };
    },
    fetch: async (url, init) => {
      fetched.push({ url, redirect: init.redirect, signal: init.signal });
      if (url.startsWith(`${ORIGIN}/authorize`)) {
        if (options.authorize) return options.authorize(url, init);
        const location = options.location === undefined ? `${REDIRECT}?code=secret-code&state=secret-state&iss=${encodeURIComponent(ORIGIN)}` : options.location;
        return new Response(null, { status: options.authorizeStatus ?? 302, headers: location === null ? {} : { location } });
      }
      if (options.callback) return options.callback(url, init);
      return new Response('MAWS is connected. You can close this window.', { status: options.callbackStatus ?? 200 });
    },
  };
  return {
    deps, fetched, state, expire,
    advance: (ms: number) => { clock += ms; },
    append: (line: string) => { log += `${line}\n`; },
  };
}
const follow = (deps: FakeBrowserDeps, afterOpens = 0) => followAuthorization({ openLog: '/scratch/open.log', afterOpens, origin: ORIGIN, timeoutMs: 1_000 }, deps);
// A request that never answers until its signal aborts.
const stalled = (onStart: () => void): Respond => (_url, init) => new Promise<Response>((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  queueMicrotask(onStart);
});
// A body that yields `first`, then (on the next pull) calls `onStall` and never yields again; or, unbounded, yields forever.
function body(first: string, then: { onStall?: () => void; unbounded?: boolean }) {
  const seen = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1;
      if (seen.pulls === 1 || then.unbounded) controller.enqueue(new TextEncoder().encode(first));
      else {
        then.onStall?.();
        return new Promise<void>(() => {});
      }
      return undefined;
    },
    cancel() { seen.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, seen };
}

async function refusal(promise: Promise<unknown>): Promise<FakeBrowserRefusal> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(FakeBrowserRefusal);
  return error as FakeBrowserRefusal;
}

describe('the open log', () => {
  it('reads only openExternal lines, in order', () => {
    const text = `browser-blocked-navigation https://x.test/\nopenExternal ${ORIGIN}/authorize?a=1\nreveal /tmp/x\nopenExternal https://example.test/\n`;
    expect(openExternalUrls(text)).toEqual([`${ORIGIN}/authorize?a=1`, 'https://example.test/']);
  });

  it('counts the browser opens that targeted the fixture’s authorization endpoint', () => {
    const text = [`openExternal ${authorizeUrl()}`, `openExternal ${ORIGIN}/authorize/x`, 'openExternal https://example.test/authorize', `openExternal ${authorizeUrl({ state: 'other' })}`].map((line) => `${line}\n`).join('');
    expect(countAuthorizationOpens(text, ORIGIN)).toBe(2);
  });
});

describe('following an authorization', () => {
  it('follows the exact authorize URL, then the exact callback, never auto-following a redirect', async () => {
    const h = harness({ lines: ['openExternal https://earlier.test/'] });
    const pending = follow(h.deps, 1);
    h.append(`openExternal ${authorizeUrl()}`);
    const followed = await pending;
    expect(h.fetched).toEqual([
      { url: authorizeUrl(), redirect: 'manual', signal: expect.any(AbortSignal) },
      { url: `${REDIRECT}?code=secret-code&state=secret-state&iss=${encodeURIComponent(ORIGIN)}`, redirect: 'manual', signal: expect.any(AbortSignal) },
    ]);
    expect(h.state.cleared).toBe(true); // the shared deadline's timer does not outlive the follow
    expect(followed).toEqual({ authorizeStatus: 302, outcome: 'code', callbackPort: 52000, callbackStatus: 200, callbackBody: 'MAWS is connected. You can close this window.' });
    expect(JSON.stringify(followed)).not.toMatch(/secret/);
  });

  it('reports an error redirect as such, still delivering it to the callback', async () => {
    const h = harness({ lines: [`openExternal ${authorizeUrl()}`], location: `${REDIRECT}?error=access_denied&state=secret-state`, callbackStatus: 400 });
    expect(await follow(h.deps)).toMatchObject({ outcome: 'error', callbackStatus: 400 });
  });

  it.each([
    ['another origin', 'openExternal https://127.0.0.1:41000/authorize?redirect_uri=x'],
    ['another port', `openExternal http://127.0.0.1:41001/authorize?redirect_uri=${encodeURIComponent(REDIRECT)}`],
    ['localhost', `openExternal http://localhost:41000/authorize?redirect_uri=${encodeURIComponent(REDIRECT)}`],
    ['another path', `openExternal ${ORIGIN}/authorize/?redirect_uri=${encodeURIComponent(REDIRECT)}`],
    ['userinfo', `openExternal http://u@127.0.0.1:41000/authorize?redirect_uri=${encodeURIComponent(REDIRECT)}`],
    ['not a URL', 'openExternal not a url'],
    ['a real site', 'openExternal https://accounts.example.test/authorize'],
  ])('fetches nothing when the next open is %s', async (_name, line) => {
    const h = harness({ lines: [line] });
    expect((await refusal(follow(h.deps))).reason).toBe('notFixtureAuthorization');
    expect(h.fetched).toEqual([]);
  });

  it.each([
    ['localhost', 'http://localhost:52000/callback'],
    ['another loopback spelling', 'http://127.1:52000/callback'],
    ['https', 'https://127.0.0.1:52000/callback'],
    ['no port', 'http://127.0.0.1/callback'],
    ['another path', 'http://127.0.0.1:52000/other'],
    ['a query', 'http://127.0.0.1:52000/callback?next=x'],
    ['a fragment', 'http://127.0.0.1:52000/callback#x'],
    ['userinfo', 'http://u@127.0.0.1:52000/callback'],
    ['the fixture itself', 'http://127.0.0.1:41000/callback'],
  ])('fetches nothing when the redirect_uri is %s', async (_name, redirectUri) => {
    const h = harness({ lines: [`openExternal ${authorizeUrl({ redirect_uri: redirectUri })}`] });
    expect((await refusal(follow(h.deps))).reason).toBe('redirectUri');
    expect(h.fetched).toEqual([]);
  });

  it('fetches nothing when redirect_uri is repeated or absent', async () => {
    const twice = harness({ lines: [`openExternal ${authorizeUrl()}&redirect_uri=${encodeURIComponent(REDIRECT)}`] });
    expect((await refusal(follow(twice.deps))).reason).toBe('redirectUri');
    const absent = harness({ lines: [`openExternal ${ORIGIN}/authorize?client_id=c1`] });
    expect((await refusal(follow(absent.deps))).reason).toBe('redirectUri');
    expect([...twice.fetched, ...absent.fetched]).toEqual([]);
  });

  it.each([
    ['another port', 'http://127.0.0.1:52001/callback?code=c'],
    ['another host', 'http://localhost:52000/callback?code=c'],
    ['another path', 'http://127.0.0.1:52000/elsewhere?code=c'],
    ['an external site', 'https://evil.test/callback?code=c'],
    ['a relative path on the fixture', '/callback?code=c'],
    ['a fragment', `${REDIRECT}?code=c#frag`],
    ['nothing', null],
  ])('follows no redirect to %s', async (_name, location) => {
    const h = harness({ lines: [`openExternal ${authorizeUrl()}`], location });
    expect((await refusal(follow(h.deps))).reason).toBe('location');
    expect(h.fetched.map((f) => f.url)).toEqual([authorizeUrl()]);
  });

  it('follows nothing when the authorization endpoint does not redirect', async () => {
    const h = harness({ lines: [`openExternal ${authorizeUrl()}`], authorizeStatus: 400 });
    expect((await refusal(follow(h.deps))).reason).toBe('authorizeStatus');
    expect(h.fetched).toHaveLength(1);
  });

  it('gives up when no browser open arrives in time', async () => {
    const h = harness({ lines: [`openExternal ${authorizeUrl()}`] });
    expect((await refusal(follow(h.deps, 1))).reason).toBe('timeout');
    expect(h.fetched).toEqual([]);
  });

  it.each(['authorize', 'callback'] as const)('gives up on a %s request that stalls before its headers, aborting it', async (which) => {
    const h: ReturnType<typeof harness> = harness({ lines: [`openExternal ${authorizeUrl()}`], [which]: stalled(() => h.expire()) });
    expect((await refusal(follow(h.deps))).reason).toBe('timeout');
    expect(h.fetched).toHaveLength(which === 'authorize' ? 1 : 2);
    expect(h.fetched.at(-1)!.signal!.aborted).toBe(true);
  });

  it('gives up on a callback body that stalls mid-stream, cancelling it and the request', async () => {
    const stalling = body('MAWS is', { onStall: () => h.expire() });
    const h: ReturnType<typeof harness> = harness({ lines: [`openExternal ${authorizeUrl()}`], callback: async () => new Response(stalling.stream, { status: 200 }) });
    expect((await refusal(follow(h.deps))).reason).toBe('timeout');
    expect(stalling.seen.cancelled).toBe(true);
    expect(h.fetched[1]!.signal!.aborted).toBe(true);
  });

  it('gives up on an authorize body whose cancellation stalls', async () => {
    const stream = new ReadableStream<Uint8Array>({ cancel: () => { h.expire(); return new Promise<void>(() => {}); } });
    const h: ReturnType<typeof harness> = harness({ lines: [`openExternal ${authorizeUrl()}`], authorize: async () => new Response(stream, { status: 302, headers: { location: `${REDIRECT}?code=c&state=s` } }) });
    expect((await refusal(follow(h.deps))).reason).toBe('timeout');
    expect(h.fetched).toHaveLength(1);
  });

  it('fetches nothing when the budget is already spent once the open arrives', async () => {
    const h: ReturnType<typeof harness> = harness({ lines: [`openExternal ${authorizeUrl()}`], readOpenLog: (text) => { h.advance(1_000); return text; } });
    expect((await refusal(follow(h.deps))).reason).toBe('timeout');
    expect(h.fetched).toEqual([]);
  });

  it('shares one budget across both requests: a slow authorization leaves no time for the callback', async () => {
    const h: ReturnType<typeof harness> = harness({ lines: [`openExternal ${authorizeUrl()}`], authorize: async () => { h.advance(1_000); return new Response(null, { status: 302, headers: { location: `${REDIRECT}?code=c&state=s` } }); } });
    expect((await refusal(follow(h.deps))).reason).toBe('timeout');
    expect(h.fetched).toHaveLength(1);
  });

  it('reads at most 512 bytes of the callback body and cancels the rest', async () => {
    const endless = body('x'.repeat(100), { unbounded: true });
    const h = harness({ lines: [`openExternal ${authorizeUrl()}`], callback: async () => new Response(endless.stream, { status: 200 }) });
    const followed = await follow(h.deps);
    expect(followed.callbackBody).toBe('x'.repeat(512));
    expect(endless.seen.cancelled).toBe(true);
    expect(endless.seen.pulls).toBeLessThanOrEqual(7);
  });

  it('never puts a URL, state or code in its refusal', async () => {
    const h = harness({ lines: [`openExternal ${authorizeUrl({ redirect_uri: 'http://localhost:52000/callback' })}`] });
    const error = await refusal(follow(h.deps));
    expect(error.message).not.toMatch(/secret|127\.0\.0\.1|localhost|http/);
  });
});
