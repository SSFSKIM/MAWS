// The page's requests (§P): the exchange carries no credential; every request that does is made only while the tab's
// own connection is proven at that moment (T28), and otherwise is not made and its caller is told so.
import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api';

const CREDENTIAL = Buffer.alloc(32, 7).toString('base64url');

const PAIRING = { id: '0a1b2c3d', credential: CREDENTIAL };

function harness(answer: () => Promise<Response> = async () => new Response(null, { status: 204 })) {
  let proven: typeof PAIRING | null = null;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return answer();
  });
  const api = createApi({ proven: () => proven, fetch });
  return { api, calls, prove: (value: typeof PAIRING | null) => void (proven = value) };
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
    prove(PAIRING);
    expect(await api.unpair()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/unpair');
    expect(calls[0]!.init.method).toBe('POST');
    expect(headersOf(calls[0]!.init).get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(calls[0]!.init.credentials).toBe('omit'); // never a cookie
  });

  it('sends the credential of the pairing the connection proved, and no other', async () => {
    const { api, calls, prove } = harness();
    const other = { id: 'ffffffff', credential: Buffer.alloc(32, 3).toString('base64url') };
    prove(other);
    await api.unpair();
    expect(headersOf(calls[0]!.init).get('authorization')).toBe(`Bearer ${other.credential}`);
  });

  it('asks at the moment of the request, not before', async () => {
    const { api, calls, prove } = harness();
    prove(PAIRING);
    await api.unpair();
    prove(null);
    expect(await api.unpair()).toEqual({ ok: false, why: 'unproven' });
    expect(calls).toHaveLength(1);
  });

  it('answers a refusal or a failure as not done', async () => {
    const proven = (answer: () => Promise<Response>) => {
      const made = harness(answer);
      made.prove(PAIRING);
      return made.api;
    };
    expect(await proven(json(500, { why: 'not-saved' })).unpair()).toEqual({ ok: false, why: 'not-saved' });
    expect(await proven(async () => new Response('This browser is not paired.', { status: 401 })).unpair()).toEqual({ ok: false, why: 'failed' });
    expect(await proven(async () => Promise.reject(new TypeError('Failed to fetch'))).unpair()).toEqual({ ok: false, why: 'failed' });
  });
});

describe('the sheet’s requests (§N)', () => {
  const S = '5eed0000-0000-4000-8000-000000000019';
  const MODEL = { v: 1, session: S, seq: 3, open: [], hidden: [], sent: [], pending: [], closed: {} };
  const proven = (answer: () => Promise<Response>) => {
    const made = harness(answer);
    made.prove(PAIRING);
    return made;
  };

  it('makes none of them while the connection is not proven', async () => {
    const { api, calls } = harness(json(200, {}));
    expect(await api.read(S)).toEqual({ ok: false, why: 'unproven' });
    expect(await api.put(S, [])).toEqual({ ok: false, why: 'failed', message: expect.any(String) });
    await expect(api.body(S, { ref: 'a'.repeat(64) })).rejects.toThrow();
    expect(await api.upload(S, { mediaType: 'image/png', bytes: new Uint8Array([1]) })).toEqual({ ok: false, why: expect.any(String) });
    expect(calls).toEqual([]);
  });

  it('reads a session’s model and the door’s state, with the credential, the session in the path', async () => {
    const { api, calls } = proven(json(200, { model: MODEL, door: { known: false } }));
    expect(await api.read(S)).toEqual({ ok: true, model: MODEL, door: { known: false } });
    expect(calls[0]!.url).toBe(`/api/sheets/${S}`);
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
    expect(headersOf(calls[0]!.init).get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(await proven(json(200, { model: null, door: { known: true, available: true } })).api.read(S)).toEqual({ ok: true, model: null, door: { known: true, available: true } });
  });

  it('answers a read the spine could not serve, or anything not of its shape, as not read', async () => {
    expect(await proven(json(503, { why: 'refused' })).api.read(S)).toEqual({ ok: false, why: 'unavailable' });
    expect(await proven(json(200, { model: { v: 2 }, door: { known: false } })).api.read(S)).toEqual({ ok: false, why: 'failed' });
    expect(await proven(async () => Promise.reject(new TypeError('Failed to fetch'))).api.read(S)).toEqual({ ok: false, why: 'failed' });
  });

  it('puts the lines as JSON and answers the door’s result as it stands', async () => {
    const lines = [{ v: 1 as const, key: 'page-0000000000000000000000000a', kind: 'dismiss' as const, id: 'q1', by: 'page' as const }];
    const result = { ok: true, results: [{ key: lines[0]!.key, state: 'queued' }] };
    const { api, calls } = proven(json(200, result));
    expect(await api.put(S, lines)).toEqual(result);
    expect(calls[0]!.url).toBe(`/api/sheets/${S}/put`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ lines });
    expect(headersOf(calls[0]!.init).get('content-type')).toBe('application/json');
    const refused = { ok: false, why: 'refused', message: 'no such question' };
    expect(await proven(json(200, refused)).api.put(S, lines)).toEqual(refused);
  });

  it('settles nothing of a put cut off because the page is going (a reload): its stored Send stays in flight for the next', async () => {
    let leaving = false;
    const fetch = vi.fn(async () => {
      leaving = true; // the page went while the request was out
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    const api = createApi({ proven: () => PAIRING, fetch, leaving: () => leaving });
    const answer = await Promise.race([api.put(S, []), new Promise((done) => setTimeout(() => done('unsettled'), 50))]);
    expect(answer).toBe('unsettled');
  });

  it('answers a put that failed, a 5xx or a network failure, as failed, so the sheet offers the same lines again', async () => {
    expect(await proven(json(503, { why: 'refused' })).api.put(S, [])).toEqual({ ok: false, why: 'failed', message: expect.any(String) });
    expect(await proven(async () => Promise.reject(new TypeError('Failed to fetch'))).api.put(S, [])).toEqual({ ok: false, why: 'failed', message: expect.any(String) });
    expect(await proven(json(200, { ok: 'maybe' })).api.put(S, [])).toEqual({ ok: false, why: 'failed', message: expect.any(String) });
  });

  it('asks a body by one parameter, an upload by its name under uploads/, and reads it as text or an image’s bytes', async () => {
    const text = proven(async () => new Response('line one\n', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    expect(await text.api.body(S, { ref: 'a'.repeat(64) })).toEqual({ kind: 'text', text: 'line one\n' });
    expect(text.calls[0]!.url).toBe(`/api/sheets/${S}/body?ref=${'a'.repeat(64)}`);
    const image = proven(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } }));
    expect(await image.api.body(S, { upload: 'uploads/maws-0123.png' })).toEqual({ kind: 'image', mediaType: 'image/png', data: 'iVBORw==' });
    expect(image.calls[0]!.url).toBe(`/api/sheets/${S}/body?upload=maws-0123.png`);
    const gone = proven(async () => new Response('Not found.', { status: 404 }));
    expect(await gone.api.body(S, { text: 'b'.repeat(64) })).toEqual({ kind: 'gone' });
    expect(gone.calls[0]!.url).toBe(`/api/sheets/${S}/body?text=${'b'.repeat(64)}`);
    // a type that is neither text nor one of the four images is no body
    expect(await proven(async () => new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })).api.body(S, { ref: 'a'.repeat(64) })).toEqual({ kind: 'gone' });
  });

  it('posts an image’s bytes with its type, and answers the path the service wrote', async () => {
    const { api, calls } = proven(json(200, { ok: true, path: 'uploads/maws-0123.png' }));
    expect(await api.upload(S, { mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) })).toEqual({ ok: true, path: 'uploads/maws-0123.png' });
    expect(calls[0]!.url).toBe(`/api/sheets/${S}/uploads`);
    expect(headersOf(calls[0]!.init).get('content-type')).toBe('image/png');
    expect(new Uint8Array(calls[0]!.init.body as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await proven(json(200, { ok: false, why: 'not an image' })).api.upload(S, { mediaType: 'image/png', bytes: new Uint8Array([1]) })).toEqual({ ok: false, why: 'not an image' });
    expect(await proven(json(413, {})).api.upload(S, { mediaType: 'image/png', bytes: new Uint8Array([1]) })).toEqual({ ok: false, why: expect.any(String) });
  });
});
