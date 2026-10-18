// Telling a lapsed sign-in from a dead network, from the browser alone: what `/api/me` answers, read as Access and the
// Worker answer it (against the DX3 double standing in for Access, too), and the sockets' failed connects driving the
// probe. That a socket refused by Access reports its failures is the browser suite's (e2e/access.spec.ts): Node's
// WebSocket raises no close after a refused handshake, where a browser always does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubDouble } from '../../test/double/hub-double';
import { VECTOR_KEY } from '../../test/vectors';
import { admissionOf, connectFailed, connectOpened, probeAdmission, useAccess, watchAccess, type Admission } from './access';
import { hubJson } from './http';

const answer = (init: { type?: ResponseType; status: number; body?: unknown }): Response =>
  ({ type: init.type ?? 'basic', status: init.status, ok: init.status >= 200 && init.status < 300, json: async () => init.body }) as Response;

it("reads Access's redirect, a 401, and a refused assertion as a lapsed sign-in, and the Worker's not-a-member as such", async () => {
  expect(await admissionOf(answer({ type: 'opaqueredirect', status: 0 }))).toBe('signed-out');
  expect(await admissionOf(answer({ type: 'opaque', status: 0 }))).toBe('signed-out');
  expect(await admissionOf(answer({ status: 302 }))).toBe('signed-out');
  expect(await admissionOf(answer({ status: 401 }))).toBe('signed-out');
  expect(await admissionOf(answer({ status: 403, body: { error: 'expired' } }))).toBe('signed-out');
  expect(await admissionOf(answer({ status: 403, body: undefined }))).toBe('signed-out');
  expect(await admissionOf(answer({ status: 403, body: { error: 'not-a-member' } }))).toBe('not-a-member');
  expect(await admissionOf(answer({ status: 200, body: {} }))).toBe('admitted');
  expect(await admissionOf(answer({ status: 503, body: { error: 'not-configured' } }))).toBe('unreachable');
});

it('asks without following the redirect, and in no-cors mode when the engine refuses that', async () => {
  const asked: RequestInit[] = [];
  const fetcher = (answers: Array<Response | Error>) =>
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(init ?? {});
      const next = answers.shift();
      if (!next || next instanceof Error) throw next ?? new TypeError('Failed to fetch');
      return next;
    }) as typeof fetch;

  expect(await probeAdmission(fetcher([answer({ type: 'opaqueredirect', status: 0 })]))).toBe('signed-out');
  expect(asked).toEqual([expect.objectContaining({ redirect: 'manual', credentials: 'same-origin' })]);

  // An engine that throws on a manual redirect: the no-cors request follows it to Access's origin, an opaque answer.
  asked.length = 0;
  expect(await probeAdmission(fetcher([new TypeError('Load failed'), answer({ type: 'opaque', status: 0 })]))).toBe('signed-out');
  expect(asked[1]).toEqual(expect.objectContaining({ mode: 'no-cors' }));
  expect(asked[1].redirect).toBeUndefined();
  // ... and the hub's own answer when nothing redirected.
  expect(await probeAdmission(fetcher([new TypeError('Load failed'), answer({ status: 200, body: {} })]))).toBe('admitted');

  // A dead network throws both times.
  expect(await probeAdmission(fetcher([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]))).toBe('unreachable');
});

it('gives up on a request that never answers, and does not ask again in no-cors mode', async () => {
  let asked = 0;
  const hung = ((_input: RequestInfo | URL, init?: RequestInit) => {
    asked++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
  }) as typeof fetch;
  expect(await probeAdmission(hung, 20)).toBe('unreachable');
  expect(asked).toBe(1);
});

it('tells the four apart against the double standing in for Access', async () => {
  const double = await HubDouble.start({ orgKey: VECTOR_KEY });
  try {
    // Node's fetch exposes the 302 a browser makes opaque; the request is the browser's otherwise.
    const probe = () => probeAdmission((input, init) => fetch(`${double.url}${String(input)}`, init));
    expect(await probe()).toBe('admitted');
    double.admit = 'signed-out';
    expect(await probe()).toBe('signed-out');
    double.admit = 'not-a-member';
    expect(await probe()).toBe('not-a-member');
    double.admit = 'unreachable';
    expect(await probe()).toBe('unreachable');
  } finally {
    await double.close();
  }
});

describe('the watch over the sockets', () => {
  let answers: Array<{ resolve: (admission: Admission) => void }> = [];
  let stop: () => void = () => {};
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const answerNext = async (admission: Admission) => {
    answers.shift()!.resolve(admission);
    await settle();
  };
  beforeEach(() => {
    useAccess.setState({ lapsed: null });
    answers = [];
    stop = watchAccess(() => new Promise<Admission>((resolve) => answers.push({ resolve })));
  });
  afterEach(async () => {
    while (answers.length > 0) await answerNext('unreachable');
    stop();
  });

  it('probes from the second failed connect in a row, one probe at a time', async () => {
    connectFailed(1);
    expect(answers).toHaveLength(0); // one failure alone is a blip a reconnect usually mends
    connectFailed(2);
    connectFailed(3);
    expect(answers).toHaveLength(1);
    await answerNext('signed-out');
    expect(useAccess.getState().lapsed).toBe('signed-out');
    connectFailed(4);
    await answerNext('not-a-member');
    expect(useAccess.getState().lapsed).toBe('not-a-member');
  });

  it('leaves a dead network, or a hub that admits the browser, as connecting', async () => {
    useAccess.setState({ lapsed: 'signed-out' });
    connectFailed(2);
    await answerNext('unreachable');
    expect(useAccess.getState().lapsed).toBeNull();
    connectFailed(3);
    await answerNext('admitted');
    expect(useAccess.getState().lapsed).toBeNull();
  });

  it('clears on an open, and drops a probe that began before it', async () => {
    connectFailed(2);
    await answerNext('signed-out');
    connectFailed(3);
    connectOpened(); // signed in again (in another tab, say) while the probe was out
    expect(useAccess.getState().lapsed).toBeNull();
    await answerNext('signed-out');
    expect(useAccess.getState().lapsed).toBeNull();
  });

  it('does nothing until the app watches', async () => {
    stop();
    connectFailed(5);
    expect(answers).toHaveLength(0);
  });

  it('probes again after a probe that hung was cut off', async () => {
    stop();
    let asked = 0;
    stop = watchAccess(() => {
      asked++;
      return probeAdmission(
        ((_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch,
        20,
      );
    });
    connectFailed(2);
    connectFailed(3);
    expect(asked).toBe(1); // the first is still out
    await new Promise((r) => setTimeout(r, 60));
    expect(useAccess.getState().lapsed).toBeNull();
    connectFailed(4);
    expect(asked).toBe(2);
    await new Promise((r) => setTimeout(r, 60));
  });

  it("ignores a request's redirect that arrives after a socket opened", async () => {
    let arrive: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => (arrive = resolve)));
    try {
      const request = hubJson('/api/projects').catch((e: unknown) => e);
      connectOpened(); // signed in again elsewhere while the request, made under the expired cookie, was out
      arrive(answer({ type: 'opaqueredirect', status: 0 }));
      expect(await request).toMatchObject({ code: 'signed-out' }); // the caller still gets its error
      expect(useAccess.getState().lapsed).toBeNull();

      // A redirect to a request begun since the open is a lapse as ever.
      const next = hubJson('/api/projects').catch((e: unknown) => e);
      arrive(answer({ type: 'opaqueredirect', status: 0 }));
      await next;
      expect(useAccess.getState().lapsed).toBe('signed-out');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
