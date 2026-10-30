// The client port's own rules (P5 O3-D M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §E, D43(1),
// D44(1)): an ended ref is answered `noClient` for every effect and nothing is posted for it; a notification shown for a
// ref that ends is released; the interactive kinds wait while their asker lives, the others settle at the deadline. The
// same port behind the front and over a client's connection is src/mawsd/front-streams.test.ts's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef } from '@shared/ipc/client';
import { createClientPort, type ClientPortRequest, type FrontClientPort, type PortTarget } from './client-port';

const ports: FrontClientPort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
  vi.useRealTimers();
});

function lab(deadlineMs = 10_000) {
  const posted: ClientPortRequest[] = [];
  const target: PortTarget = { post: (request) => (posted.push(request), true) };
  const port = createClientPort({ route: (ref) => (ref === null ? null : { target, client: 'page' }), deadlineMs, log: () => {} });
  ports.push(port);
  return { port, target, posted };
}

const CONFIRM = { kind: 'warning', message: 'm', confirm: 'OK', cancel: 'No' } as const;

describe('the client port', () => {
  it('answers an ended ref noClient for every effect, posting nothing, while its connection lives', async () => {
    const { port, posted } = lab();
    const ref = endableClientRef('1/page');
    ref.end();
    expect(port.badge(ref, 2)).toEqual({ noClient: true });
    expect(port.focus(ref, 'bring')).toEqual({ noClient: true });
    expect(port.notify(ref, { title: 't', body: 'b', silent: false }, () => {})).toEqual({ noClient: true });
    expect(await port.reveal(ref, '/tmp/x')).toEqual({ noClient: true });
    expect(await port.pick(ref, { kind: 'file', multiple: false })).toEqual({ noClient: true });
    expect(posted).toEqual([]);
  });

  it('releases a notification whose ref ends: its later answers are refused and its close posts nothing', () => {
    const { port, target, posted } = lab();
    const ref = endableClientRef('1/page');
    const events: unknown[] = [];
    const handle = port.notify(ref, { title: 't', body: 'b', silent: false }, (event) => void events.push(event));
    expect(handle).toHaveProperty('close');
    const { id } = posted[0];
    ref.end();
    expect(() => port.answer(target, { id, answer: { kind: 'clicked' } })).toThrow(/no client port request/);
    (handle as { close(): void }).close();
    expect(posted).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it('keeps pick, save and confirm waiting past the deadline while their asker lives; reveal and openExternal settle noClient at it', async () => {
    vi.useFakeTimers();
    const { port, target, posted } = lab(10_000);
    const ref = endableClientRef('1/page');
    const pick = port.pick(ref, { kind: 'file', multiple: false });
    const save = port.save(ref, { defaultPath: '/tmp/y' });
    const confirm = port.confirm(ref, CONFIRM);
    const reveal = port.reveal(ref, '/tmp/x');
    const open = port.openExternal(ref, { url: 'https://example.com' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await reveal).toEqual({ noClient: true });
    expect(await open).toEqual({ noClient: true });
    const settled: unknown[] = [];
    for (const asked of [pick, save, confirm]) void asked.then((answer) => settled.push(answer));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual([]);
    port.answer(target, { id: posted[0].id, answer: { paths: ['/tmp/a'] } });
    expect(await pick).toEqual({ paths: ['/tmp/a'] });
    ref.end(); // the page that asked ends: what it still waits for settles
    expect(await save).toEqual({ noClient: true });
    expect(await confirm).toEqual({ noClient: true });
  });

  it('settles a waiting dialog noClient at its connection’s end', async () => {
    const { port, target } = lab();
    const confirm = port.confirm(endableClientRef('1/page'), CONFIRM);
    port.gone(target);
    expect(await confirm).toEqual({ noClient: true });
  });
});
