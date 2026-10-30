// Main's answers to the client port over the services front (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §E; D15, D44(1)): each `clientPort.request` `mawsd` posts to this app is performed by the Electron port and
// answered with `clientPort.answer`; every request that awaits an answer gets one, a failure included.
import { describe, expect, it, vi } from 'vitest';
import { NO_CLIENT, type ClientPort, type NotifyEvent } from '@shared/client/port';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { startPortAnswers } from './port-answers';

function harness(port: Partial<ClientPort>, clients: Record<string, ClientRef> = {}) {
  const answered: { id: string; answer: unknown }[] = [];
  let request: (payload: unknown) => void = () => {};
  const stop = startPortAnswers({
    hosts: {
      onEvent: ((_name: string, listener: (payload: unknown) => void) => ((request = listener), () => {})) as never,
      dispatch: (async (_owner: string, name: string, input: { id: string; answer: unknown }) => {
        if (name === 'clientPort.answer') answered.push(input);
        return { ok: true, value: undefined };
      }) as never,
    },
    port: port as ClientPort,
    clientOfId: (id) => clients[id] ?? null,
    log: () => {},
  });
  const ask = (id: string, kind: string, body: unknown, client: string | null = null) => request({ id, client, kind, request: body });
  return { answered, ask, stop };
}

describe('the client port’s answers in main', () => {
  it('performs a request for the client it names and answers what the Electron port answered', async () => {
    const page = endableClientRef('page:7.1');
    const pick = vi.fn(async () => ({ paths: ['/tmp/a.md'] }));
    const { answered, ask } = harness({ pick }, { 'page:7.1': page });
    ask('cp-1', 'pick', { kind: 'file', multiple: false }, 'page:7.1');
    await vi.waitFor(() => expect(answered).toEqual([{ id: 'cp-1', answer: { paths: ['/tmp/a.md'] } }]));
    expect(pick).toHaveBeenCalledWith(page, { kind: 'file', multiple: false });
  });

  it('answers noClient when a dialog throws, never silence', async () => {
    const { answered, ask } = harness({ confirm: async () => Promise.reject(new Error('the dialog could not open')) });
    ask('cp-2', 'confirm', { kind: 'warning', message: 'Replace?', confirm: 'Replace', cancel: 'Cancel' });
    await vi.waitFor(() => expect(answered).toEqual([{ id: 'cp-2', answer: NO_CLIENT }]));
  });

  it('answers noClient for a client whose page is gone, asking no dialog', async () => {
    const save = vi.fn();
    const { answered, ask } = harness({ save });
    ask('cp-3', 'save', { defaultPath: '/tmp/x.md' }, 'page:9.2'); // ended: no live instance has the id
    await vi.waitFor(() => expect(answered).toEqual([{ id: 'cp-3', answer: NO_CLIENT }]));
    expect(save).not.toHaveBeenCalled();
  });

  it('relays a notification’s events as answers of its id, closes it on notifyClose, and answers a failure when it cannot show', async () => {
    let onEvent: (event: NotifyEvent) => void = () => {};
    const close = vi.fn();
    const notify = vi.fn((_client, _request, listener: (event: NotifyEvent) => void) => ((onEvent = listener), { close }));
    const { answered, ask } = harness({ notify });
    ask('cp-4', 'notify', { title: 'MAWS', body: 'done', silent: true });
    onEvent({ kind: 'shown' });
    onEvent({ kind: 'clicked' });
    ask('cp-5', 'notifyClose', { id: 'cp-4' });
    expect(close).toHaveBeenCalledOnce();
    onEvent({ kind: 'closed' }); // after the asker closed it: nothing more is answered
    await vi.waitFor(() => expect(answered).toEqual([{ id: 'cp-4', answer: { kind: 'shown' } }, { id: 'cp-4', answer: { kind: 'clicked' } }]));

    notify.mockImplementation(() => ({ unsupported: 'notifications are not supported' }) as never);
    ask('cp-6', 'notify', { title: 'MAWS', body: 'again', silent: true });
    await vi.waitFor(() => expect(answered.at(-1)).toEqual({ id: 'cp-6', answer: { kind: 'failed', error: 'notifications are not supported' } }));
  });

  it('applies the badge and focus with no answer', async () => {
    const badge = vi.fn();
    const focus = vi.fn(() => {
      throw new Error('no window');
    });
    const { answered, ask } = harness({ badge, focus });
    ask('cp-7', 'badge', { count: 3 });
    ask('cp-8', 'focus', { mode: 'bring' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(badge).toHaveBeenCalledWith(null, 3);
    expect(focus).toHaveBeenCalledWith(null, 'bring');
    expect(answered).toEqual([]);
  });
});
