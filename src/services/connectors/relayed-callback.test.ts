// P5 O7 M5c (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Consent and the client port"; A15): the relayed
// receiver (./relayed-callback.ts), keyed by the asking client and the port. The flows over it are ./oauth-flow.test.ts's
// and ./sign-in.test.ts's; the owner's Connect through it, ./relayed-connect.test.ts's.
import { describe, expect, it } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import type { LoopbackReply, LoopbackRequest } from './oauth-callback';
import { createRelayedCallbacks } from './relayed-callback';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const echo = (tag: string) => (request: LoopbackRequest): LoopbackReply => ({ status: 200, body: `${tag} ${request.method} ${request.url}` });

describe('the relayed receiver', () => {
  it('binds nothing, answers the device’s port, and runs the flow’s own handler over the relayed request', async () => {
    const relayed = createRelayedCallbacks();
    const device = endableClientRef('remote:a');
    const receiver = relayed.arm(device, 53_100)!;
    const listener = await receiver.listen(echo('flow'));
    expect(listener.port).toBe(53_100);
    const answer = relayed.answer(device, { port: 53_100, method: 'GET', url: '/callback?code=c&state=s' });
    expect(answer).toEqual({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: 'flow GET /callback?code=c&state=s' });
    expect(validateCommandOutput('connectors.callback', answer).ok).toBe(true);
  });

  it('answers 404 with an empty body for a port the client armed no flow for, or armed and has not listened on', () => {
    const relayed = createRelayedCallbacks();
    const device = endableClientRef('remote:a');
    expect(relayed.answer(device, { port: 53_100, method: 'GET', url: '/callback' })).toEqual({ status: 404, body: '' });
    relayed.arm(device, 53_100);
    expect(relayed.answer(device, { port: 53_100, method: 'GET', url: '/callback' })).toEqual({ status: 404, body: '' });
  });

  it('keeps two devices that arm one port number apart: each request reaches its own channel’s flow alone', async () => {
    const relayed = createRelayedCallbacks();
    const a = endableClientRef('remote:a');
    const b = endableClientRef('remote:b');
    await relayed.arm(a, 53_100)!.listen(echo('a'));
    expect(relayed.answer(b, { port: 53_100, method: 'GET', url: '/callback' })).toEqual({ status: 404, body: '' }); // b armed none
    await relayed.arm(b, 53_100)!.listen(echo('b'));
    expect(relayed.answer(a, { port: 53_100, method: 'GET', url: '/x' }).body).toBe('a GET /x');
    expect(relayed.answer(b, { port: 53_100, method: 'GET', url: '/x' }).body).toBe('b GET /x');
  });

  it('refuses a second arming of a port this client holds, changing nothing, and arms it again once released', async () => {
    const relayed = createRelayedCallbacks();
    const device = endableClientRef('remote:a');
    const first = relayed.arm(device, 53_100)!;
    await first.listen(echo('first'));
    expect(relayed.arm(device, 53_100)).toBeNull();
    expect(relayed.answer(device, { port: 53_100, method: 'GET', url: '/' }).body).toBe('first GET /'); // the first's still
    expect(relayed.arm(device, 53_101)).not.toBeNull(); // another port of the same device is its own
    first.release();
    expect(relayed.arm(device, 53_100)).not.toBeNull();
  });

  it('a flow’s cleanup removes only the registration it owns: a predecessor’s late close leaves its successor armed', async () => {
    const relayed = createRelayedCallbacks();
    const device = endableClientRef('remote:a');
    const first = relayed.arm(device, 53_100)!;
    const listener = await first.listen(echo('first'));
    first.release(); // the first flow's action ended
    await relayed.arm(device, 53_100)!.listen(echo('second'));
    await listener.close(); // the first flow's own finally, late
    first.release();
    expect(relayed.answer(device, { port: 53_100, method: 'GET', url: '/' }).body).toBe('second GET /');
    await expect(first.listen(echo('again'))).rejects.toThrow(/released/);
    expect(relayed.armed()).toBe(1);
  });

  it('answers a handler’s throw as the local listener does, 500 with its words', async () => {
    const relayed = createRelayedCallbacks();
    const device = endableClientRef('remote:a');
    await relayed.arm(device, 53_100)!.listen(() => {
      throw new Error('boom');
    });
    expect(relayed.answer(device, { port: 53_100, method: 'GET', url: '/callback' })).toMatchObject({ status: 500, body: 'MAWS could not read this request.' });
  });

  it('releases an arming at its asker’s end, orphaning the flow only while no request under it was answered 2xx', async () => {
    const relayed = createRelayedCallbacks();
    const waiting = endableClientRef('remote:a');
    const past = endableClientRef('remote:b');
    const orphaned: string[] = [];
    await relayed.arm(waiting, 53_100, () => orphaned.push('waiting'))!.listen(echo('waiting'));
    const pastReceiver = relayed.arm(past, 53_100, () => orphaned.push('past'))!;
    await pastReceiver.listen((request) => (request.url.startsWith('/callback') ? { status: 200, body: 'connected' } : { status: 404, body: 'Not found.' }));
    expect(relayed.answer(past, { port: 53_100, method: 'GET', url: '/favicon.ico' }).status).toBe(404); // not past it yet
    expect(relayed.answer(past, { port: 53_100, method: 'GET', url: '/callback?code=c' }).status).toBe(200);
    waiting.end();
    past.end();
    expect(relayed.armed()).toBe(0);
    await turn();
    expect(orphaned).toEqual(['waiting']); // the flow past its callback finishes its exchange
    const gone = endableClientRef('remote:c');
    gone.end();
    const dead = relayed.arm(gone, 53_100, () => orphaned.push('gone'))!; // an asker already gone: released at once
    await expect(dead.listen(echo('gone'))).rejects.toThrow(/released/);
    await turn();
    expect(orphaned).toEqual(['waiting', 'gone']);
    expect(relayed.armed()).toBe(0);
  });

  it('takes a relayed request’s url to 4 KiB at the command’s schema', () => {
    expect(validateCommandInput('connectors.callback', { port: 53_100, method: 'GET', url: `/callback?${'a'.repeat(4_096 - 10)}` }).ok).toBe(true);
    expect(validateCommandInput('connectors.callback', { port: 53_100, method: 'GET', url: `/callback?${'a'.repeat(4_096)}` }).ok).toBe(false);
  });
});
