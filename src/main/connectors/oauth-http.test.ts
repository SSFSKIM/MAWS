// P3-HD M3a: the bounded fetch every OAuth request of main's goes through (src/main/connectors/oauth-http.ts). An
// injected fetch stands in for the network; nothing is sent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedOAuthFetch, isPermittedOAuthUrl, OAuthTransportError } from './oauth-http';

const ok = (body = '{}', init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });

afterEach(() => { vi.useRealTimers(); });

describe('isPermittedOAuthUrl', () => {
  it('admits HTTPS anywhere and plain HTTP only on the literal 127.0.0.1', () => {
    expect(isPermittedOAuthUrl('https://auth.example.com/token')).toBe(true);
    expect(isPermittedOAuthUrl('http://127.0.0.1:4100/token')).toBe(true);
    expect(isPermittedOAuthUrl(new URL('http://127.0.0.1/.well-known/oauth-authorization-server'))).toBe(true);
    for (const refused of ['http://auth.example.com/token', 'http://localhost:4100/', 'http://[::1]:4100/', 'http://127.0.0.2/', 'http://127.0.0.1.example.com/',
      'https://user:pw@auth.example.com/', 'http://a@127.0.0.1/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,x', 'not a url'])
      expect(isPermittedOAuthUrl(refused), refused).toBe(false);
  });

  // P3-F L271: WHATWG URL parsing rewrites every one of these to 127.0.0.1; the exception is for the literal spelling.
  it('refuses another spelling of the IPv4 loopback that URL normalization would turn into 127.0.0.1', () => {
    for (const spelling of ['2130706433', '0x7f000001', '127.1', '127.0.1', '0x7f.0.0.1', '0177.0.0.1', '127.000.000.001', '127.0.0.1.', '%31%32%37.0.0.1'])
      expect(isPermittedOAuthUrl(`http://${spelling}:4100/token`), spelling).toBe(false);
    for (const refused of ['http:/127.0.0.1/token', 'http:\\\\127.0.0.1/token', ' http://127.0.0.1/token', 'http://127.0.0.\t1/token'])
      expect(isPermittedOAuthUrl(refused), JSON.stringify(refused)).toBe(false);
    for (const admitted of ['http://127.0.0.1', 'http://127.0.0.1:4100', 'http://127.0.0.1?q=1', 'http://127.0.0.1#f', 'HTTP://127.0.0.1:4100/token'])
      expect(isPermittedOAuthUrl(admitted), admitted).toBe(true);
  });
});

describe('boundedOAuthFetch', () => {
  it('refuses a non-permitted URL before any request', async () => {
    const base = vi.fn(async () => ok());
    const f = boundedOAuthFetch(base, new AbortController().signal);
    await expect(f('http://auth.example.com/token')).rejects.toMatchObject({ code: 'insecure' });
    await expect(f('http://2130706433:4100/token')).rejects.toMatchObject({ code: 'insecure' }); // P3-F L271
    expect(base).not.toHaveBeenCalled();
  });

  it('never lets the base fetch follow a redirect and returns a cross-origin redirect as the response', async () => {
    const base = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }));
    const f = boundedOAuthFetch(base, new AbortController().signal);
    const response = await f('https://auth.example.com/token', { method: 'POST', redirect: 'follow' });
    expect(base.mock.calls[0]![1]!.redirect).toBe('manual');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://elsewhere.example/');
  });

  it('turns a network failure into a typed error that is not a TypeError (the SDK treats TypeError as CORS and retries or gives up silently)', async () => {
    const base = vi.fn(async () => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND auth.example.com'); });
    const f = boundedOAuthFetch(base, new AbortController().signal);
    const error = await f('https://auth.example.com/.well-known/oauth-authorization-server').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthTransportError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ code: 'network' });
    expect(String((error as Error).message)).not.toContain('ENOTFOUND');
  });

  it('caps a response body: an over-long body fails, a body within the bound is readable', async () => {
    const big = 'x'.repeat(2_048);
    const f = boundedOAuthFetch(async () => ok(big), new AbortController().signal, { limitBytes: 1_024 });
    await expect(f('https://auth.example.com/token')).rejects.toMatchObject({ code: 'tooLarge' });
    const small = boundedOAuthFetch(async () => ok('{"a":1}', { headers: { 'content-type': 'application/json', 'x-k': 'v' } }), new AbortController().signal, { limitBytes: 1_024 });
    const response = await small('https://auth.example.com/token');
    expect(await response.json()).toEqual({ a: 1 });
    expect(response.headers.get('x-k')).toBe('v');
  });

  it('refuses a declared over-long body without reading it', async () => {
    let pulled = 0;
    const stream = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(10)); } });
    const f = boundedOAuthFetch(async () => new Response(stream, { status: 200, headers: { 'content-length': '999999' } }), new AbortController().signal, { limitBytes: 1_024 });
    await expect(f('https://auth.example.com/token')).rejects.toMatchObject({ code: 'tooLarge' });
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it('aborts with the owner signal as cancelled and with its own deadline as timeout', async () => {
    const hanging = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const owner = new AbortController();
    const cancelled = boundedOAuthFetch(hanging, owner.signal)('https://auth.example.com/token');
    owner.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });

    vi.useFakeTimers();
    const timed = boundedOAuthFetch(hanging, new AbortController().signal, { timeoutMs: 5_000 })('https://auth.example.com/token');
    const settled = timed.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await settled).toMatchObject({ code: 'timeout' });
  });

  it('a signal already aborted sends nothing', async () => {
    const base = vi.fn(async () => ok());
    const owner = new AbortController();
    owner.abort();
    await expect(boundedOAuthFetch(base, owner.signal)('https://auth.example.com/token')).rejects.toMatchObject({ code: 'cancelled' });
    expect(base).not.toHaveBeenCalled();
  });
});
