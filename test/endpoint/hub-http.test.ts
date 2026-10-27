// The hub's requests have a deadline over their headers and body together (O10 M2's review): a hub that never answers,
// or never finishes a body, fails the request instead of holding it, and the endpoint's in-flight org read with it, so
// the next periodic read still runs.
import { generateSigningKey, keyId, NO_CERTIFICATES } from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEndpoint } from '../../src/endpoint';
import { hubRequest, REQUEST_MS, type HubDeps } from '../../src/endpoint/hub-http';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import { EndpointState } from '../../src/endpoint/state/store';
import { fakeServices, type FakeServices } from './fake-services';
import { genesis, memberId, newDevice } from './org-fixtures';

let services: FakeServices | null = null;
beforeEach(() => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
afterEach(() => {
  vi.useRealTimers();
  services?.cleanup();
  services = null;
});

/** A fetch that never answers; it rejects only when its request is aborted. */
function silent(seen: AbortSignal[] = []): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      seen.push(signal);
      signal.addEventListener('abort', () => reject(signal.reason));
    });
}

const depsWith = (fetch: typeof globalThis.fetch): HubDeps => ({ fetch, sleep: async () => {}, now: Date.now });

describe('a request to the hub', () => {
  it('fails at its deadline when no answer comes, and aborts the request', async () => {
    const seen: AbortSignal[] = [];
    const request = hubRequest(depsWith(silent(seen)), 'http://hub.test', '/machine/org/state');
    const failed = expect(request).rejects.toMatchObject({ name: 'HubError', error: 'timeout' });
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    await failed;
    expect(seen[0].aborted).toBe(true);
  });

  it('fails at its deadline when the body never ends', async () => {
    const stalled: typeof fetch = async () => new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('{"chain": [')) }), { status: 200 });
    const request = hubRequest(depsWith(stalled), 'http://hub.test', '/machine/org/state');
    const failed = expect(request).rejects.toMatchObject({ error: 'timeout' });
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    await failed;
  });

  it('takes a shorter deadline from its caller’s budget, and answers whole within it', async () => {
    const request = hubRequest(depsWith(silent()), 'http://hub.test', '/machine/enroll', { body: {}, timeoutMs: 1000 });
    const failed = expect(request).rejects.toMatchObject({ error: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    const answered = await hubRequest(depsWith(async () => Response.json({ ok: true }, { status: 201 })), 'http://hub.test', '/x');
    expect(answered.status).toBe(201);
    expect(await answered.json()).toEqual({ ok: true });
  });
});

describe('the endpoint’s org read', () => {
  it('is released when a read is stuck past its deadline, so the next read goes out', async () => {
    services = fakeServices();
    const state = EndpointState.open(services.machine.stateDir);
    const key = await generateSigningKey(true);
    const id = await keyId(key.pub);
    state.setMachineKey({ version: 1, keyId: id, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: new Date().toISOString() });
    state.setLedger({ version: 1, heldKeys: [id], grants: {}, highWater: {} });
    state.setEnrollment({ version: 1, state: 'org-listed', name: 'mini', ref: services.machine.ref, org: 'org-http', hub: 'http://hub.test', enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: new Date().toISOString() });
    const a1 = await newDevice('a1');
    const s1 = await genesis('org-http', memberId(), a1, await generateSigningKey());
    state.setOrg({ version: 1, org: 'org-http', pinned: { roots: s1.state.root.keys, recoveryPub: s1.state.root.recoveryPub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
    await new EndpointOrg(state, { log: () => {} }).adopt([s1], []);

    const seen: AbortSignal[] = [];
    const endpoint = createEndpoint({ fetch: silent(seen) });
    await endpoint.start(services);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    expect(services.lines.join('\n')).toMatch(/could not be read: .*timeout/);
    void endpoint.syncNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(2);
    await endpoint.stop();
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
  });
});
