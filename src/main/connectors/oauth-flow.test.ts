// P3-HD M3a: MAWS's own OAuth flow, refresh and revocation (src/main/connectors/oauth-flow.ts), over the pinned SDK's
// lower-level helpers. An injected fetch plays the protected MCP server and its authorization server (shaped like the
// spike's toy servers, spikes/p3-connectors/auth-server.mjs and e2e/support/connector-direct-server.mjs); an injected
// listener and browser stand in for the 127.0.0.1 socket and the system browser. Nothing is sent or bound.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoopbackReply, LoopbackRequest } from './oauth-callback';
import { CONNECT_CALLBACK_TIMEOUT_MS, createConnectorOAuthFlow, untilEnded, type ConnectorOAuthFlowDeps } from './oauth-flow';
import type { ConnectorOAuthGrant } from './oauth-types';

const MCP = 'https://mcp.example.com';
const AS = 'https://auth.example.com';
const REQUEST_URL = `${MCP}/mcp`; // query-free: a pathless resource indicator covers it (P3-HD Decision Log 46)
const NOW = 1_700_000_000_000;
const SECRET_BODY = 'raw-body-sentinel-3c9e';

type Seen = { method: string; url: URL; body: string; headers: Headers };
interface Script {
  prm?: object | number | 'network';
  metadata?: object | number;
  register?: object | number;
  token?: object | number | 'hang';
  revoke?: number | 'network';
  oidc?: object; // served as OpenID discovery metadata, the RFC 8414 document then answering 404
  foreign?: object; // P3-HD panel correction: what another origin, FOREIGN, serves at its OpenID discovery path
  redirect?: string; // P3-HD panel correction: the first authorization-server discovery candidate answers 302 there
}
const FOREIGN = 'https://foreign.example.net';
// what an OpenID discovery document needs beyond RFC 8414's members to parse
const OIDC_REQUIRED = { jwks_uri: `${FOREIGN}/jwks`, subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] };
const metadataFor = (as: string) => ({
  issuer: as, authorization_endpoint: `${as}/authorize`, token_endpoint: `${as}/token`, registration_endpoint: `${as}/register`,
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
});
const METADATA = metadataFor(AS);
const PRM = { resource: MCP, authorization_servers: [AS], scopes_supported: ['metrics:read', 'metrics:list'] };
const TOKENS = { access_token: 'at-1', token_type: 'bearer', expires_in: 60, refresh_token: 'rt-1', scope: 'metrics:read' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class Harness {
  constructor(readonly mcp = MCP, readonly as = AS) {}
  readonly seen: Seen[] = [];
  readonly events: string[] = [];
  script: Script = {};
  handle: ((request: LoopbackRequest) => LoopbackReply) | null = null;
  closed = 0;
  opened: string[] = [];
  openedFor: unknown[] = []; // P5 O1 M3: the client each browser hand-off named
  openFails = false;
  openHangs = false; // the opener never answers
  listenGate: Promise<void> | null = null; // binding answers only once this settles
  private openedWaiters: Array<() => void> = [];
  readonly fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = init?.body === undefined || init.body === null ? '' : String(init.body);
    this.seen.push({ method: init?.method ?? 'GET', url, body, headers: new Headers(init?.headers) });
    this.events.push(`${init?.method ?? 'GET'} ${url.origin}${url.pathname}`);
    const s = this.script;
    const answer = async (value: object | number | 'network' | 'hang' | undefined, fallback: object): Promise<Response> => {
      if (value === 'network') throw new TypeError('fetch failed');
      if (value === 'hang') return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      if (typeof value === 'number') return new Response(`${SECRET_BODY} <html>`, { status: value });
      return json(200, value ?? fallback);
    };
    const { mcp, as } = this;
    if (url.origin === mcp && url.pathname.startsWith('/.well-known/oauth-protected-resource')) return answer(s.prm, { ...PRM, resource: mcp, authorization_servers: [as] });
    if (s.redirect !== undefined && url.origin === as && url.pathname.startsWith('/.well-known/oauth-authorization-server')) return new Response(null, { status: 302, headers: { location: s.redirect } });
    if (url.origin === FOREIGN && url.pathname === '/.well-known/openid-configuration' && s.foreign) return answer(s.foreign, {});
    if (url.origin === as && url.pathname === '/.well-known/oauth-authorization-server') return s.oidc ? new Response('not found', { status: 404 }) : answer(s.metadata, metadataFor(as));
    if (url.origin === as && url.pathname === '/.well-known/openid-configuration' && s.oidc) return answer(s.oidc, {});
    if (url.origin === as && url.pathname === '/register') {
      const sent = JSON.parse(body) as { redirect_uris: string[] };
      return answer(s.register, { client_id: 'client-1', client_id_issued_at: 1, redirect_uris: sent.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS' });
    }
    if (url.origin === as && url.pathname === '/token') return answer(s.token, TOKENS);
    if (url.origin === as && url.pathname === '/revoke') return answer(s.revoke, {});
    return new Response('not found', { status: 404 });
  });
  readonly deps: ConnectorOAuthFlowDeps = {
    fetch: this.fetch,
    listen: async (handle) => {
      this.events.push('listen');
      if (this.listenGate) await this.listenGate;
      this.handle = handle;
      return { port: 53_100, close: async () => { this.closed += 1; this.events.push('close'); this.handle = null; } };
    },
    openBrowser: async (url, client) => {
      this.events.push('browser');
      this.openedFor.push(client);
      if (this.openFails) throw new Error('no browser');
      if (this.openHangs) return new Promise<void>(() => {});
      this.opened.push(url);
      for (const wake of this.openedWaiters.splice(0)) wake();
    },
    now: () => NOW,
    randomState: () => 'state-abc',
  };
  readonly flow = createConnectorOAuthFlow(this.deps);
  browserOpened(): Promise<URL> {
    if (this.opened.length > 0) return Promise.resolve(new URL(this.opened[0]!));
    return new Promise((resolve) => this.openedWaiters.push(() => resolve(new URL(this.opened[0]!))));
  }
  deliver(path: string, method = 'GET'): LoopbackReply {
    if (!this.handle) throw new Error('no listener');
    return this.handle({ method, url: path });
  }
  posts(path: string): Seen[] { return this.seen.filter((s) => s.method === 'POST' && s.url.pathname === path); }
  form(seen: Seen): Record<string, string> { return Object.fromEntries(new URLSearchParams(seen.body)); }
}

afterEach(() => { vi.useRealTimers(); });

const connect = (h: Harness, signal = new AbortController().signal) => h.flow.connect({ requestUrl: REQUEST_URL, signal });
const failureOf = (promise: Promise<unknown>) => promise.then(() => { throw new Error('resolved'); }, (error: unknown) => error as Error & { code?: string });

describe('connect', () => {
  it('discovers, binds the loopback first, registers, authorizes in the browser and exchanges the code once, binding the exact resource', async () => {
    const h = new Harness();
    const pending = connect(h);
    const authorization = await h.browserOpened();
    expect(authorization.origin + authorization.pathname).toBe(`${AS}/authorize`);
    const q = authorization.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('client-1');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:53100/callback');
    expect(q.get('state')).toBe('state-abc');
    expect(q.get('resource')).toBe(MCP); // verbatim: no trailing slash added to a pathless indicator
    expect(q.get('scope')).toBe('metrics:read metrics:list');

    expect(h.deliver('/callback?code=code-1&state=state-abc')).toMatchObject({ status: 200 });
    const grant = await pending;

    expect(h.events).toEqual([
      `GET ${MCP}/.well-known/oauth-protected-resource/mcp`, `GET ${AS}/.well-known/oauth-authorization-server`,
      'listen', `POST ${AS}/register`, 'browser', `POST ${AS}/token`, 'close',
    ]);
    const registration = JSON.parse(h.posts('/register')[0]!.body) as Record<string, unknown>;
    expect(registration).toMatchObject({ redirect_uris: ['http://127.0.0.1:53100/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS', scope: 'metrics:read metrics:list' });
    const exchange = h.form(h.posts('/token')[0]!);
    expect(exchange).toMatchObject({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: 'http://127.0.0.1:53100/callback', resource: MCP, client_id: 'client-1' });
    expect(exchange.code_verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);

    expect(grant).toMatchObject({
      issuer: AS, resource: MCP, redirectUri: 'http://127.0.0.1:53100/callback',
      client: { client_id: 'client-1' }, authorizationServer: { token_endpoint: `${AS}/token` },
      tokens: { accessToken: 'at-1', refreshToken: 'rt-1', tokenType: 'Bearer', grantedScope: 'metrics:read', expiresAt: NOW + 60_000, obtainedAt: NOW },
    });
    expect(JSON.stringify(grant)).not.toContain('mcp.example.com/mcp'); // the request URL is the identity's, never the grant's resource
    expect(h.openedFor).toEqual([null]); // no client named: none asked
  });

  // P5 O1 M3: the consent opens on the client whose Connect started the flow
  it('hands the browser the client that asked', async () => {
    const h = new Harness();
    const asker = { id: 'page:1.1', onGone: () => () => {} } as never;
    const pending = h.flow.connect({ requestUrl: REQUEST_URL, signal: new AbortController().signal, client: asker });
    await h.browserOpened();
    expect(h.openedFor).toEqual([asker]);
    h.deliver('/callback?code=code-1&state=state-abc');
    await pending;
  });

  it('compares the issuer as an exact string: a pathless PRM issuer is not the slash-suffixed metadata issuer', async () => {
    const h = new Harness();
    h.script.metadata = { ...METADATA, issuer: `${AS}/` }; // PRM names `${AS}`; URL parsing would call these equal
    expect(await failureOf(connect(h))).toMatchObject({ code: 'issuer' });
    expect(h.events).not.toContain('listen');

    const toy = new Harness(); // the spike toy names `<origin>/` in both its PRM and its metadata
    toy.script.prm = { ...PRM, authorization_servers: [`${AS}/`] };
    toy.script.metadata = { ...METADATA, issuer: `${AS}/` };
    const pending = connect(toy);
    await toy.browserOpened();
    toy.deliver(`/callback?code=c&state=state-abc&iss=${encodeURIComponent(`${AS}/`)}`);
    expect((await pending).issuer).toBe(`${AS}/`);
  });

  it('a pathless resource indicator travels verbatim through authorization, exchange and refresh (URL.href would add a slash)', async () => {
    const h = new Harness();
    expect(PRM.resource).toBe('https://mcp.example.com');
    const pending = connect(h);
    expect((await h.browserOpened()).searchParams.get('resource')).toBe('https://mcp.example.com');
    h.deliver('/callback?code=c&state=state-abc');
    const grant = await pending;
    expect(grant.resource).toBe('https://mcp.example.com');
    expect(h.form(h.posts('/token')[0]!).resource).toBe('https://mcp.example.com');
    await h.flow.refresh(grant, new AbortController().signal);
    expect(h.form(h.posts('/token')[1]!).resource).toBe('https://mcp.example.com');
  });

  it('refuses metadata whose issuer is another server before registering anywhere', async () => {
    const h = new Harness();
    h.script.metadata = { ...METADATA, issuer: 'https://evil.example.com' };
    expect(await failureOf(connect(h))).toMatchObject({ code: 'issuer' });
    expect(h.posts('/register')).toEqual([]);
    expect(h.events).not.toContain('listen');
  });

  it('refuses a protected resource that does not cover the request URL', async () => {
    for (const resource of ['https://other.example.com', `${MCP}/admin`, 'http://mcp.example.com']) {
      const h = new Harness();
      h.script.prm = { ...PRM, resource };
      expect(await failureOf(connect(h)), resource).toMatchObject({ code: 'resource' });
      expect(h.events).toEqual([`GET ${MCP}/.well-known/oauth-protected-resource/mcp`]);
    }
  });

  // P3-HD panel correction (Decision Log 45, refined by 46): the advertised resource stays on the requested origin; a
  // query on either side makes it the requested resource exactly (origin, path and query); query-free, it covers the
  // request by path. Refused before any listener, registration or authorization.
  it('binds a query-bearing resource exactly to the requested one, before registering or authorizing anything', async () => {
    const tenant = (name: string) => `${MCP}/mcp?tenant=${name}`;
    const refused: [string, string][] = [
      [tenant('alpha'), tenant('beta')], // another tenant's resource
      [tenant('alpha'), `${MCP}/mcp`], // the query on the request only
      [tenant('alpha'), MCP],
      [`${MCP}/mcp`, tenant('alpha')], // the query on the advertisement only
      [tenant('alpha'), `${MCP}/other?tenant=alpha`],
      [tenant('alpha'), `https://other.example.com/mcp?tenant=alpha`],
    ];
    for (const [requestUrl, resource] of refused) {
      const h = new Harness();
      h.script.prm = { ...PRM, resource };
      expect(await failureOf(h.flow.connect({ requestUrl, signal: new AbortController().signal })), `${requestUrl} ← ${resource}`).toMatchObject({ code: 'resource' });
      expect(h.events, `${requestUrl} ← ${resource}`).toEqual([`GET ${MCP}/.well-known/oauth-protected-resource/mcp`]);
      expect(h.opened).toEqual([]);
    }
    const exact = new Harness();
    exact.script.prm = { ...PRM, resource: tenant('alpha') };
    const pending = exact.flow.connect({ requestUrl: tenant('alpha'), signal: new AbortController().signal });
    expect((await exact.browserOpened()).searchParams.get('resource')).toBe(tenant('alpha'));
    exact.deliver('/callback?code=c&state=state-abc');
    expect((await pending).resource).toBe(tenant('alpha'));
    expect(exact.form(exact.posts('/token')[0]!).resource).toBe(tenant('alpha'));
  });

  it('keeps every authorization-server discovery request on the advertised issuer’s origin', async () => {
    // an issuer whose path starts with `//`: the SDK's last OpenID candidate would resolve to another origin, which would
    // answer metadata naming that issuer string after the issuer origin's own candidates answered 404
    const issuer = `${AS}//foreign.example.net`;
    const h = new Harness();
    h.script.prm = { ...PRM, authorization_servers: [issuer] };
    h.script.foreign = { ...metadataFor(FOREIGN), ...OIDC_REQUIRED, issuer };
    expect(await failureOf(connect(h))).toMatchObject({ code: 'issuer' });
    expect(h.seen.filter((seen) => seen.url.origin !== MCP && seen.url.origin !== AS), 'nothing left the issuer’s origin').toEqual([]);
    expect(h.seen.filter((seen) => seen.url.origin === AS).length, 'its own candidates were asked').toBeGreaterThan(0);
    expect(h.events).not.toContain('listen');
    expect(h.posts('/register')).toEqual([]);

    const redirected = new Harness();
    redirected.script.redirect = `${FOREIGN}/.well-known/openid-configuration`;
    redirected.script.foreign = { ...metadataFor(FOREIGN), ...OIDC_REQUIRED, issuer: AS };
    await failureOf(connect(redirected));
    expect(redirected.seen.filter((seen) => seen.url.origin === FOREIGN), 'a redirect is not followed off the issuer’s origin').toEqual([]);
    expect(redirected.posts('/register')).toEqual([]);
  });

  it('never guesses an authorization server: missing or unreachable protected-resource metadata stops the flow', async () => {
    for (const [prm, code] of [[404, 'discovery'], ['network', 'network'], [{ resource: MCP }, 'discovery']] as const) {
      const h = new Harness();
      h.script.prm = prm;
      expect(await failureOf(connect(h)), String(prm)).toMatchObject({ code });
      expect(h.seen.filter((s) => s.url.origin === AS || s.url.pathname.includes('oauth-authorization-server'))).toEqual([]);
    }
  });

  it('refuses a server without dynamic registration or S256 PKCE as unsupported', async () => {
    const noDcr = { ...METADATA, registration_endpoint: undefined };
    for (const metadata of [noDcr, { ...METADATA, code_challenge_methods_supported: ['plain'] }, { ...METADATA, code_challenge_methods_supported: undefined }]) {
      const h = new Harness();
      h.script.metadata = metadata;
      expect(await failureOf(connect(h))).toMatchObject({ code: 'unsupported' });
      expect(h.posts('/register')).toEqual([]);
    }
  });

  it('refuses a plain-HTTP endpoint or request URL other than the literal 127.0.0.1', async () => {
    const h = new Harness();
    h.script.metadata = { ...METADATA, token_endpoint: 'http://auth.example.com/token' };
    expect(await failureOf(connect(h))).toMatchObject({ code: 'insecure' });
    expect(h.posts('/register')).toEqual([]);

    const local = new Harness();
    expect(await failureOf(local.flow.connect({ requestUrl: 'http://localhost:4100/mcp', signal: new AbortController().signal }))).toMatchObject({ code: 'insecure' });
    expect(local.fetch).not.toHaveBeenCalled();

    const browser = new Harness();
    browser.script.metadata = { ...METADATA, authorization_endpoint: 'http://auth.example.com/authorize' };
    expect(await failureOf(connect(browser))).toMatchObject({ code: 'insecure' });
    expect(browser.events).not.toContain('browser');
  });

  it('admits the 127.0.0.1 fixture over plain HTTP', async () => {
    const fixture = 'http://127.0.0.1:4100';
    const h = new Harness(fixture, fixture);
    h.script.prm = { resource: `${fixture}/mcp`, authorization_servers: [`${fixture}/`] }; // as the spike toy advertises it
    h.script.metadata = { ...metadataFor(fixture), issuer: `${fixture}/` };
    const pending = h.flow.connect({ requestUrl: `${fixture}/mcp`, signal: new AbortController().signal });
    await h.browserOpened();
    h.deliver('/callback?code=c&state=state-abc');
    expect(await pending).toMatchObject({ issuer: `${fixture}/`, resource: `${fixture}/mcp` });
  });

  it('a wrong state fails the flow without exchanging, and the listener closes', async () => {
    const h = new Harness();
    const pending = connect(h);
    await h.browserOpened();
    expect(h.deliver('/callback?code=c&state=forged').status).toBe(400);
    expect(await failureOf(pending)).toMatchObject({ code: 'state' });
    expect(h.posts('/token')).toEqual([]);
    expect(h.closed).toBe(1);
  });

  it('a repeated parameter, a missing code or an authorization error fails without exchanging', async () => {
    for (const [query, code] of [['code=c&state=state-abc&state=state-abc', 'state'], ['state=state-abc', 'state'], ['error=access_denied&state=state-abc', 'denied'], ['code=c&code=d&state=state-abc', 'state']] as const) {
      const h = new Harness();
      const pending = connect(h);
      await h.browserOpened();
      h.deliver(`/callback?${query}`);
      expect(await failureOf(pending), query).toMatchObject({ code });
      expect(h.posts('/token')).toEqual([]);
      expect(h.closed).toBe(1);
    }
  });

  it('a duplicate callback is refused and the code is exchanged exactly once', async () => {
    const h = new Harness();
    const pending = connect(h);
    await h.browserOpened();
    expect(h.deliver('/callback?code=c&state=state-abc').status).toBe(200);
    expect(h.deliver('/callback?code=c&state=state-abc').status).toBe(400);
    await pending;
    expect(h.posts('/token')).toHaveLength(1);
  });

  it('ignores other paths and methods while waiting for the callback', async () => {
    const h = new Harness();
    const pending = connect(h);
    await h.browserOpened();
    expect(h.deliver('/favicon.ico').status).toBe(404);
    expect(h.deliver('/callback?code=c&state=state-abc', 'POST').status).toBe(405);
    expect(h.deliver('/callback/extra?code=c&state=state-abc').status).toBe(404);
    expect(h.posts('/token')).toEqual([]);
    h.deliver('/callback?code=c&state=state-abc');
    await pending;
  });

  it('checks the callback issuer: required when advertised, matched whenever present', async () => {
    const cases: Array<[boolean, string, string | null]> = [[true, '', 'state'], [true, `&iss=${encodeURIComponent('https://evil.example.com')}`, 'state'], [true, `&iss=${encodeURIComponent(AS)}`, null], [false, `&iss=${encodeURIComponent('https://evil.example.com')}`, 'state'], [false, '', null]];
    for (const [advertised, iss, code] of cases) {
      const h = new Harness();
      h.script.metadata = { ...METADATA, authorization_response_iss_parameter_supported: advertised };
      const pending = connect(h);
      await h.browserOpened();
      h.deliver(`/callback?code=c&state=state-abc${iss}`);
      if (code === null) await expect(pending).resolves.toMatchObject({ issuer: AS });
      else expect(await failureOf(pending), `${advertised} ${iss}`).toMatchObject({ code });
      expect(h.posts('/token')).toHaveLength(code === null ? 1 : 0);
    }
  });

  it('times out waiting for the callback, closing the listener, never exchanging', async () => {
    vi.useFakeTimers();
    const h = new Harness();
    const pending = failureOf(connect(h));
    await vi.waitFor(() => expect(h.opened).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(CONNECT_CALLBACK_TIMEOUT_MS);
    expect(await pending).toMatchObject({ code: 'timeout' });
    expect(h.closed).toBe(1);
    expect(h.handle).toBeNull();
    expect(h.posts('/token')).toEqual([]);
  });

  it('cancelling while the callback is awaited closes the listener and sends nothing more', async () => {
    const h = new Harness();
    const owner = new AbortController();
    const pending = connect(h, owner.signal);
    await h.browserOpened();
    owner.abort();
    expect(await failureOf(pending)).toMatchObject({ code: 'cancelled' });
    expect(h.closed).toBe(1);
    expect(h.posts('/token')).toEqual([]);
  });

  it('cancelling during registration opens no browser', async () => {
    const h = new Harness();
    const owner = new AbortController();
    const base = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/register')) owner.abort(); // the owner cancels while registration is answered
      return base(input, init);
    });
    expect(await failureOf(connect(h, owner.signal))).toMatchObject({ code: 'cancelled' });
    expect(h.events).not.toContain('browser');
    expect(h.closed).toBe(1);
  });

  it('a callback arriving after cancellation exchanges nothing; tokens answered after cancellation are not returned', async () => {
    const h = new Harness();
    const owner = new AbortController();
    const base = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (input, init) => {
      const response = await base(input, init);
      if (String(input).endsWith('/token')) owner.abort(); // the token response lands as the owner disconnects
      return response;
    });
    const pending = connect(h, owner.signal);
    await h.browserOpened();
    h.deliver('/callback?code=c&state=state-abc');
    expect(await failureOf(pending)).toMatchObject({ code: 'cancelled' });
    expect(h.closed).toBe(1);
  });

  it('a failed exchange never surfaces the response body', async () => {
    for (const token of [400, 500, { error: 'invalid_grant', error_description: SECRET_BODY }]) {
      const h = new Harness();
      h.script.token = typeof token === 'number' ? token : undefined;
      if (typeof token === 'object') {
        const base = h.fetch.getMockImplementation()!;
        h.fetch.mockImplementation(async (input, init) => String(input).endsWith('/token') ? json(400, token) : base(input, init));
      }
      const pending = connect(h);
      await h.browserOpened();
      h.deliver('/callback?code=c&state=state-abc');
      const error = await failureOf(pending);
      expect(error).toMatchObject({ code: 'exchange' });
      expect(`${error.message} ${String(error.stack)} ${JSON.stringify(error)} ${String((error as { cause?: unknown }).cause)}`).not.toContain(SECRET_BODY);
      expect(h.closed).toBe(1);
    }
  });

  it('refuses a non-Bearer or malformed token answer', async () => {
    for (const token of [{ ...TOKENS, token_type: 'mac' }, { ...TOKENS, expires_in: -5 }, { ...TOKENS, access_token: 'x'.repeat(20_000) }]) {
      const h = new Harness();
      h.script.token = token;
      const pending = connect(h);
      await h.browserOpened();
      h.deliver('/callback?code=c&state=state-abc');
      expect(await failureOf(pending)).toMatchObject({ code: 'token' });
    }
  });

  it('a registration that fails or already expired stops before the browser', async () => {
    for (const register of [400, { client_id: 'c', client_secret: 's', client_secret_expires_at: Math.floor(NOW / 1000) - 1, redirect_uris: ['http://127.0.0.1:53100/callback'] }]) {
      const h = new Harness();
      h.script.register = register;
      expect(await failureOf(connect(h))).toMatchObject({ code: 'registration' });
      expect(h.events).not.toContain('browser');
      expect(h.closed).toBe(1);
    }
  });

  it('a listener bound only after cancellation is closed exactly once, and nothing is registered or opened', async () => {
    const h = new Harness();
    let bind!: () => void;
    h.listenGate = new Promise<void>((resolve) => { bind = resolve; });
    const owner = new AbortController();
    const pending = failureOf(connect(h, owner.signal));
    await vi.waitFor(() => expect(h.events).toContain('listen'));
    owner.abort();
    bind();
    expect(await pending).toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(h.closed).toBe(1));
    expect(h.posts('/register')).toEqual([]);
    expect(h.events).not.toContain('browser');
  });

  it('a binding that never answers still settles on cancellation and on the deadline, and a late binding is closed', async () => {
    vi.useFakeTimers();
    for (const end of ['cancel', 'deadline'] as const) {
      const h = new Harness();
      let bind!: () => void;
      h.listenGate = new Promise<void>((resolve) => { bind = resolve; });
      const owner = new AbortController();
      let outcome: unknown;
      void failureOf(connect(h, owner.signal)).then((error) => { outcome = error; });
      await vi.waitFor(() => expect(h.events).toContain('listen'));
      if (end === 'cancel') owner.abort();
      else await vi.advanceTimersByTimeAsync(CONNECT_CALLBACK_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome, end).toMatchObject({ code: end === 'cancel' ? 'cancelled' : 'timeout' });
      bind();
      await vi.waitFor(() => expect(h.closed).toBe(1));
      expect(h.posts('/register')).toEqual([]);
    }
  });

  it('a browser opener that never answers is bounded: cancellation and the callback deadline both settle and close the listener', async () => {
    vi.useFakeTimers();
    for (const end of ['cancel', 'deadline'] as const) {
      const h = new Harness();
      h.openHangs = true;
      const owner = new AbortController();
      let outcome: unknown;
      void failureOf(connect(h, owner.signal)).then((error) => { outcome = error; });
      await vi.waitFor(() => expect(h.events).toContain('browser'));
      if (end === 'cancel') owner.abort();
      else await vi.advanceTimersByTimeAsync(CONNECT_CALLBACK_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome, end).toMatchObject({ code: end === 'cancel' ? 'cancelled' : 'timeout' });
      expect(h.closed, end).toBe(1);
      expect(h.posts('/token')).toEqual([]);
    }
  });

  it('keeps the callback-issuer and revocation policy an OpenID discovery document advertises (the SDK schema strips them)', async () => {
    const oidc = {
      issuer: AS, authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, registration_endpoint: `${AS}/register`, jwks_uri: `${AS}/jwks`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true, revocation_endpoint: `${AS}/revoke`, revocation_endpoint_auth_methods_supported: ['none'],
    };
    const refused = new Harness();
    refused.script.oidc = oidc;
    const missingIss = connect(refused);
    await refused.browserOpened();
    refused.deliver('/callback?code=c&state=state-abc');
    expect(await failureOf(missingIss)).toMatchObject({ code: 'state' });
    expect(refused.posts('/token')).toEqual([]);

    const h = new Harness();
    h.script.oidc = oidc;
    const pending = connect(h);
    await h.browserOpened();
    h.deliver(`/callback?code=c&state=state-abc&iss=${encodeURIComponent(AS)}`);
    const grant = await pending;
    expect(await h.flow.revoke(grant, new AbortController().signal)).toBe('revoked');
    expect(h.posts('/revoke')).toHaveLength(2);
  });

  it('refuses an OpenID discovery document whose revocation endpoint breaks the endpoint policy', async () => {
    const h = new Harness();
    h.script.oidc = {
      issuer: AS, authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, registration_endpoint: `${AS}/register`, jwks_uri: `${AS}/jwks`,
      response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      revocation_endpoint: 'http://auth.example.com/revoke',
    };
    expect(await failureOf(connect(h))).toMatchObject({ code: 'insecure' });
    expect(h.posts('/register')).toEqual([]);
  });

  it('a browser that cannot open fails the flow and closes the listener', async () => {
    const h = new Harness();
    h.openFails = true;
    expect(await failureOf(connect(h))).toMatchObject({ code: 'browser' });
    expect(h.closed).toBe(1);
  });
});

const savedGrant = (patch: Partial<ConnectorOAuthGrant> = {}): ConnectorOAuthGrant => ({
  issuer: AS, resource: MCP, redirectUri: 'http://127.0.0.1:53100/callback',
  authorizationServer: { ...METADATA, revocation_endpoint: `${AS}/revoke` },
  client: { client_id: 'client-1', redirect_uris: ['http://127.0.0.1:53100/callback'], token_endpoint_auth_method: 'none' },
  tokens: { accessToken: 'at-0', refreshToken: 'rt-0', tokenType: 'Bearer', obtainedAt: NOW - 1_000 },
  ...patch,
});

describe('refresh', () => {
  it('posts exactly one refresh to the stored token endpoint with the exact resource, and returns the rotation', async () => {
    const h = new Harness();
    const tokens = await h.flow.refresh(savedGrant(), new AbortController().signal);
    expect(h.events).toEqual([`POST ${AS}/token`]); // no discovery, no registration, no browser
    expect(h.form(h.posts('/token')[0]!)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-0', resource: MCP, client_id: 'client-1' });
    expect(tokens).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', tokenType: 'Bearer', grantedScope: 'metrics:read', expiresAt: NOW + 60_000, obtainedAt: NOW });
  });

  // P3-F F-connectors 3 sibling: the SDK's token requests (Connect's code exchange and the refresh) carry the same
  // form-encoded Basic authentication as the revocation, never the SDK's own unencoded one
  it('form-encodes Basic authentication on the code exchange and on the refresh', async () => {
    const basic = `Basic ${btoa('client+1:se%2Bc%2Fr%3Dt%25')}`;
    const h = new Harness();
    h.script.metadata = { ...METADATA, token_endpoint_auth_methods_supported: ['client_secret_basic'] };
    h.script.register = { client_id: 'client 1', client_secret: 'se+c/r=t%', client_id_issued_at: 1, redirect_uris: ['http://127.0.0.1:53100/callback'], token_endpoint_auth_method: 'client_secret_basic', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS' };
    const pending = connect(h);
    await h.browserOpened();
    h.deliver('/callback?code=code-1&state=state-abc');
    const grant = await pending;
    await h.flow.refresh(grant, new AbortController().signal);
    expect(h.posts('/token').map((post) => post.headers.get('authorization'))).toEqual([basic, basic]);
  });

  it('keeps the old refresh token when the server does not rotate it', async () => {
    const h = new Harness();
    const noRotation = { ...TOKENS, refresh_token: undefined };
    h.script.token = noRotation;
    expect(await h.flow.refresh(savedGrant(), new AbortController().signal)).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-0' });
  });

  it('a grant the server rejects needs reconnecting; a server or network failure is transient; neither leaks the body', async () => {
    const cases: Array<[number | object | 'network', string]> = [
      [{ error: 'invalid_grant', error_description: SECRET_BODY }, 'rejected'], [{ error: 'invalid_client' }, 'rejected'], [{ error: 'unauthorized_client' }, 'rejected'],
      [{ error: 'invalid_target' }, 'rejected'], [{ error: 'temporarily_unavailable' }, 'transient'], [503, 'transient'], ['network', 'transient'],
    ];
    for (const [answer, code] of cases) {
      const h = new Harness();
      h.fetch.mockImplementation(async () => {
        if (answer === 'network') throw new TypeError('fetch failed');
        return typeof answer === 'number' ? new Response(SECRET_BODY, { status: answer }) : json(400, answer);
      });
      const error = await failureOf(h.flow.refresh(savedGrant(), new AbortController().signal));
      expect(error, JSON.stringify(answer)).toMatchObject({ code });
      expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(SECRET_BODY);
      expect(h.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('without a refresh token, or with an expired client secret, needs reconnecting and sends nothing', async () => {
    const h = new Harness();
    expect(await failureOf(h.flow.refresh(savedGrant({ tokens: { accessToken: 'a', tokenType: 'Bearer', obtainedAt: 1 } }), new AbortController().signal))).toMatchObject({ code: 'rejected' });
    expect(await failureOf(h.flow.refresh(savedGrant({ client: { client_id: 'c', client_secret: 's', client_secret_expires_at: Math.floor(NOW / 1000) - 1, redirect_uris: [] } }), new AbortController().signal))).toMatchObject({ code: 'rejected' });
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('cancellation aborts the refresh as cancelled, and no tokens are returned', async () => {
    const h = new Harness();
    h.script.token = 'hang';
    const owner = new AbortController();
    const pending = failureOf(h.flow.refresh(savedGrant(), owner.signal));
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    owner.abort();
    expect(await pending).toMatchObject({ code: 'cancelled' });
  });
});

describe('revoke', () => {
  it('posts each token to the stored revocation endpoint, refresh token first', async () => {
    const h = new Harness();
    expect(await h.flow.revoke(savedGrant(), new AbortController().signal)).toBe('revoked');
    expect(h.events).toEqual([`POST ${AS}/revoke`, `POST ${AS}/revoke`]);
    expect(h.posts('/revoke').map((s) => h.form(s))).toEqual([
      { token: 'rt-0', token_type_hint: 'refresh_token', client_id: 'client-1' },
      { token: 'at-0', token_type_hint: 'access_token', client_id: 'client-1' },
    ]);
  });

  it('authenticates a confidential client as its registration says', async () => {
    const h = new Harness();
    await h.flow.revoke(savedGrant({ client: { client_id: 'client-1', client_secret: 'sec', redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic' }, authorizationServer: { ...METADATA, revocation_endpoint: `${AS}/revoke`, token_endpoint_auth_methods_supported: ['client_secret_basic'] } }), new AbortController().signal);
    const first = h.posts('/revoke')[0]!;
    expect(first.headers.get('authorization')).toBe(`Basic ${btoa('client-1:sec')}`);
    expect(h.form(first)).toEqual({ token: 'rt-0', token_type_hint: 'refresh_token' });
  });

  // P3-F F-connectors 3: RFC 6749 §2.3.1: each Basic component is form-encoded before Base64, so a secret's '+', '/', '='
  // or '%' reaches a conforming endpoint as itself
  it('form-encodes the client id and secret before Basic authentication', async () => {
    const h = new Harness();
    await h.flow.revoke(savedGrant({ client: { client_id: 'client 1', client_secret: 'se+c/r=t%', redirect_uris: [], token_endpoint_auth_method: 'client_secret_basic' }, authorizationServer: { ...METADATA, revocation_endpoint: `${AS}/revoke`, token_endpoint_auth_methods_supported: ['client_secret_basic'] } }), new AbortController().signal);
    expect(h.posts('/revoke').map((post) => post.headers.get('authorization'))).toEqual([`Basic ${btoa('client+1:se%2Bc%2Fr%3Dt%25')}`, `Basic ${btoa('client+1:se%2Bc%2Fr%3Dt%25')}`]);
  });

  it('is unsupported without an advertised endpoint, and a failing endpoint is reported, never thrown', async () => {
    const none = new Harness();
    expect(await none.flow.revoke(savedGrant({ authorizationServer: METADATA }), new AbortController().signal)).toBe('unsupported');
    expect(none.fetch).not.toHaveBeenCalled();
    for (const revoke of [503, 'network'] as const) {
      const h = new Harness();
      h.script.revoke = revoke;
      expect(await h.flow.revoke(savedGrant(), new AbortController().signal)).toBe('failed');
    }
    const insecure = new Harness();
    expect(await insecure.flow.revoke(savedGrant({ authorizationServer: { ...METADATA, revocation_endpoint: 'http://auth.example.com/revoke' } }), new AbortController().signal)).toBe('failed');
    expect(insecure.fetch).not.toHaveBeenCalled();
  });

  it('after cancellation nothing more is posted', async () => {
    const h = new Harness();
    const owner = new AbortController();
    owner.abort();
    expect(await h.flow.revoke(savedGrant(), owner.signal)).toBe('failed');
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

// P3-F L270: the browser opener (and the binding) is called a microtask after the flow decided to call it; an abort
// queued into that gap must still keep the call from being made.
describe('untilEnded', () => {
  it('an abort landing after the decision and before the deferred call never makes the call', async () => {
    const owner = new AbortController();
    const opener = vi.fn(async () => {});
    const pending = untilEnded(opener, owner.signal);
    owner.abort(); // queued before the deferred call's microtask runs
    expect(await failureOf(pending)).toMatchObject({ code: 'cancelled' });
    expect(opener).not.toHaveBeenCalled();
  });

  it('without an abort the deferred call is made once and answers', async () => {
    const opener = vi.fn(async () => 'opened');
    expect(await untilEnded(opener, new AbortController().signal)).toBe('opened');
    expect(opener).toHaveBeenCalledTimes(1);
  });
});
