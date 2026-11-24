// The page's requests (§P): the exchange carries no credential; every request that does is made only while the tab's
// own connection is proven at that moment (T28), and otherwise is not made and its caller is told so.
import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api';

const CREDENTIAL = Buffer.alloc(32, 7).toString('base64url');

function harness(answer: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  let proven = false;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  });
  const api = createApi({ proven: () => proven, pairing: () => ({ id: '0a1b2c3d', credential: CREDENTIAL }), fetch });
  return { api, calls, prove: (value: boolean) => void (proven = value) };
}

const json = (status: number, value: unknown) => async () => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const headersOf = (init: RequestInit) => new Headers(init.headers);

describe('pair', () => {
  it('posts the code as JSON to /api/pair with no credential, proven or not, and answers the id and credential', async () => {
    const { api, calls } = harness(json(200, { id: '0a1b2c3d', credential: CREDENTIAL }));
    expect(await api.pair('K7QF-2M9D')).toEqual({ ok: true, id: '0a1b2c3d', credential: CREDENTIAL });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/pair');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ code: 'K7QF-2M9D' });
    expect(headersOf(calls[0]!.init).get('authorization')).toBeNull();
    expect(headersOf(calls[0]!.init).get('content-type')).toBe('application/json');
  });

  it('answers each refusal by its reason', async () => {
    expect(await harness(json(403, { why: 'wrong', left: 3 })).api.pair('X')).toEqual({ ok: false, why: 'wrong', left: 3 });
    expect(await harness(json(403, { why: 'wrong', left: 0 })).api.pair('X')).toEqual({ ok: false, why: 'wrong', left: 0 });
    expect(await harness(json(403, { why: 'expired' })).api.pair('X')).toEqual({ ok: false, why: 'expired' });
    expect(await harness(json(403, { why: 'none' })).api.pair('X')).toEqual({ ok: false, why: 'none' });
    expect(await harness(json(429, { why: 'busy' })).api.pair('X')).toEqual({ ok: false, why: 'busy' });
    expect(await harness(json(503, { why: 'not-saved' })).api.pair('X')).toEqual({ ok: false, why: 'not-saved' });
  });

  it('answers failed for anything else: a network failure, a refusal in text, an answer not of its shape', async () => {
    expect(await harness(async () => Promise.reject(new TypeError('Failed to fetch'))).api.pair('X')).toEqual({ ok: false, why: 'failed' });
    expect(await harness(async () => new Response('This request did not come from the sheet page.', { status: 403 })).api.pair('X')).toEqual({ ok: false, why: 'failed' });
    expect(await harness(json(200, { id: 'nothex!!', credential: CREDENTIAL })).api.pair('X')).toEqual({ ok: false, why: 'failed' });
    expect(await harness(json(503, { why: 'other' })).api.pair('X')).toEqual({ ok: false, why: 'failed' });
  });
});

describe('unpair', () => {
  it('makes no request while the connection is not proven, and says so', async () => {
    const { api, calls } = harness();
    expect(await api.unpair()).toEqual({ ok: false, why: 'unproven' });
    expect(calls).toEqual([]);
  });

  it('posts to /api/unpair with the credential as a Bearer header once proven', async () => {
    const { api, calls, prove } = harness();
    prove(true);
    expect(await api.unpair()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/unpair');
    expect(calls[0]!.init.method).toBe('POST');
    expect(headersOf(calls[0]!.init).get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(calls[0]!.init.credentials).toBe('omit'); // never a cookie
  });

  it('asks at the moment of the request, not before', async () => {
    const { api, calls, prove } = harness();
    prove(true);
    await api.unpair();
    prove(false);
    expect(await api.unpair()).toEqual({ ok: false, why: 'unproven' });
    expect(calls).toHaveLength(1);
  });

  it('answers a refusal or a failure as not done', async () => {
    const proven = (answer: () => Promise<Response>) => {
      const made = harness(answer);
      made.prove(true);
      return made.api;
    };
    expect(await proven(json(500, { why: 'not-saved' })).unpair()).toEqual({ ok: false, why: 'not-saved' });
    expect(await proven(async () => new Response('This browser is not paired.', { status: 401 })).unpair()).toEqual({ ok: false, why: 'failed' });
    expect(await proven(async () => Promise.reject(new TypeError('Failed to fetch'))).unpair()).toEqual({ ok: false, why: 'failed' });
  });
});
