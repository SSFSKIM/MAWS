import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../test/support/fake-client';
import { builder, uuid } from '../../transcript/model/test-events';
import { waitForHumanPromptDelivery } from './human-prompt-delivery';

const APP = 'app-delivery' as AppSessionId;
const UUID = uuid('human-prompt');
const message = () => {
  const b = builder();
  return b.emit('user.message', { messageUuid: UUID, content: 'answer', isReplay: true, isSynthetic: false, origin: 'human', bash: null });
};

describe('delivered human prompt observation', () => {
  it('waits for the matching user row, not a different uuid, assistant row or another session’s batch, then unsubscribes', async () => {
    const fake = fakeClient({ 'session.events': { events: [], lastSeq: 0, complete: true } });
    const off = vi.fn();
    const on = fake.client.on.bind(fake.client);
    vi.spyOn(fake.client, 'on').mockImplementation((name, listener) => {
      const unsubscribe = on(name, listener);
      return () => { off(); unsubscribe(); };
    });
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    let delivered = false;
    void observed.then(() => { delivered = true; });
    fake.event('session.eventBatch', { appSessionId: 'other-session', events: [message()] });
    fake.event('session.eventBatch', { appSessionId: APP, events: [{ ...message(), messageUuid: uuid('other') }] });
    const b = builder();
    b.text('answer', 0, 'not a delivery');
    fake.event('session.eventBatch', { appSessionId: APP, events: b.events });
    await Promise.resolve();
    expect(delivered).toBe(false);
    expect(off).not.toHaveBeenCalled();
    fake.event('session.eventBatch', { appSessionId: APP, events: [message()] });
    expect(await observed).toEqual(message());
    expect(off).toHaveBeenCalledOnce();
  });

  it('recognizes a delivery that happened before the caller began waiting from the existing events read', async () => {
    const fake = fakeClient({ 'session.events': { events: [message()], lastSeq: 1, complete: true } });
    expect(await waitForHumanPromptDelivery(APP, UUID, {}, fake.client)).toEqual(message());
    expect(fake.calls.slice(0, 2)).toEqual(['on session.eventBatch', 'invoke session.events']);
  });

  it('does not miss a user row arriving while the snapshot is in flight, even if that snapshot later fails', async () => {
    const fake = fakeClient();
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    fake.event('session.eventBatch', { appSessionId: APP, events: [message()] });
    expect(await observed).toEqual(message());
    await fake.fail('session.events', 'host departed');
  });

  it('allows the caller to cancel an undelivered observation and unsubscribes', async () => {
    const fake = fakeClient({ 'session.events': { events: [], lastSeq: 0, complete: true } });
    const abort = new AbortController();
    const observed = waitForHumanPromptDelivery(APP, UUID, { signal: abort.signal }, fake.client);
    const rejection = expect(observed).rejects.toThrow('cancelled');
    abort.abort(new Error('cancelled'));
    await rejection;
  });

  it('reports a failed events read instead of waiting forever', async () => {
    const fake = fakeClient();
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    const rejection = expect(observed).rejects.toThrow('cannot read events');
    await fake.fail('session.events', 'cannot read events');
    await rejection;
  });
});
