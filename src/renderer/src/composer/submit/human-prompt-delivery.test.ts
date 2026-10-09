import { describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../test/support/fake-client';
import { loadJournal } from '../../../../../test/support/fixtures';
import { Normalizer } from '../../../../engine-host/normalizer';
import { builder, uuid } from '../../transcript/model/test-events';
import { waitForHumanPromptDelivery } from './human-prompt-delivery';

const APP = 'app-delivery' as AppSessionId;
const UUID = uuid('human-prompt');
const message = () => {
  const b = builder();
  return b.emit('user.message', { messageUuid: UUID, content: 'answer', isReplay: true, isSynthetic: false, origin: 'human', bash: null });
};

const optimisticMessage = () => ({ ...message(), isReplay: false });
const lifecycle = (state: Extract<SessionEvent, { kind: 'command.lifecycle' }>['state'] = 'started') => builder().emit('command.lifecycle', { commandUuid: UUID, state });
const fixtureBatches = (name: string) => {
  const normalizer = new Normalizer({ appSessionId: APP, launchId: 'delivery-fixture', sessionId: null });
  return loadJournal('pass3', name).map((row) => ({ seq: row.seq, events: normalizer.push(row) }));
};

describe('delivered human prompt observation', () => {
  it('never delivers the optimistic row of a real queued then cancelled steer', async () => {
    const target = uuid('d7fade79-6f39-40b6-91f3-9998597857b4');
    const batches = fixtureBatches('steer-next-cancelled');
    const matching = batches.flatMap(({ events }) => events).filter((event) =>
      (event.kind === 'user.message' && event.messageUuid === target) || (event.kind === 'command.lifecycle' && event.commandUuid === target));
    expect(matching).toMatchObject([
      { seq: 30, kind: 'user.message', isReplay: false },
      { seq: 31, kind: 'command.lifecycle', state: 'queued' },
      { seq: 35, kind: 'command.lifecycle', state: 'cancelled' },
    ]);
    const fake = fakeClient({ 'session.events': { events: [], lastSeq: 0, complete: true } });
    const abort = new AbortController();
    const delivered = vi.fn();
    const observed = waitForHumanPromptDelivery(APP, target, { signal: abort.signal }, fake.client);
    void observed.then(delivered, () => {});
    try {
      for (const { events } of batches) fake.event('session.eventBatch', { appSessionId: APP, events });
      await Promise.resolve();
      expect(delivered).not.toHaveBeenCalled();
    } finally {
      abort.abort(new Error('cancelled'));
    }
  });

  it.each([
    { name: 'steer-next', target: '42a15931-3c9a-4267-a6b2-09fa5697735d', outSeq: 46, replaySeq: 70, startedSeq: 71 },
    { name: 'steer-now', target: 'e80149ac-ba3a-486a-8d42-b07a6f987698', outSeq: 46, replaySeq: 56, startedSeq: 51 },
  ])('delivers a real $name at started despite its suppressed replay, not at the outgoing row', async ({ name, target, outSeq, replaySeq, startedSeq }) => {
    const batches = fixtureBatches(name);
    const outgoing = batches.find(({ seq }) => seq === outSeq)!.events[0];
    expect(outgoing).toMatchObject({ kind: 'user.message', messageUuid: target, isReplay: false });
    expect(batches.find(({ seq }) => seq === replaySeq)!.events).toEqual([]);
    const fake = fakeClient({ 'session.events': { events: [], lastSeq: 0, complete: true } });
    const abort = new AbortController();
    const delivered = vi.fn();
    const observed = waitForHumanPromptDelivery(APP, uuid(target), { signal: abort.signal }, fake.client);
    void observed.then(delivered, () => {});
    try {
      for (const { seq, events } of batches) {
        if (seq >= startedSeq) break;
        fake.event('session.eventBatch', { appSessionId: APP, events });
      }
      await Promise.resolve();
      expect(delivered).not.toHaveBeenCalled();
      fake.event('session.eventBatch', { appSessionId: APP, events: batches.find(({ seq }) => seq === startedSeq)!.events });
      expect(await observed).toEqual(outgoing);
    } finally {
      abort.abort();
    }
  });

  it.each([
    { source: 'engine replay', row: message() },
    { source: 'disk user row', row: { ...message(), isReplay: false, seq: null } },
  ])('accepts a genuine $source without a lifecycle and returns it rather than the optimistic row', async ({ row }) => {
    const fake = fakeClient({ 'session.events': { events: [optimisticMessage()], lastSeq: 1, complete: true } });
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    await Promise.resolve();
    fake.event('session.eventBatch', { appSessionId: APP, events: [row] });
    expect(await observed).toEqual(row);
  });

  it.each([
    { first: 'row', firstInSnapshot: true },
    { first: 'started', firstInSnapshot: true },
    { first: 'row', firstInSnapshot: false },
    { first: 'started', firstInSnapshot: false },
  ])('correlates $first first across the snapshot/live race (snapshot first: $firstInSnapshot)', async ({ first, firstInSnapshot }) => {
    const fake = fakeClient();
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    const delivered = vi.fn();
    void observed.then(delivered);
    const row = optimisticMessage();
    const firstEvents = first === 'row' ? [row] : [lifecycle()];
    const secondEvents = first === 'row' ? [lifecycle()] : [row];
    if (firstInSnapshot) await fake.reply('session.events', { events: firstEvents, lastSeq: 1, complete: true });
    else fake.event('session.eventBatch', { appSessionId: APP, events: firstEvents });
    await Promise.resolve();
    expect(delivered).not.toHaveBeenCalled();
    if (firstInSnapshot) fake.event('session.eventBatch', { appSessionId: APP, events: secondEvents });
    else await fake.reply('session.events', { events: secondEvents, lastSeq: 1, complete: true });
    expect(await observed).toEqual(row);
  });

  it.each([false, true])('recognizes an already delivered optimistic row and started in one snapshot (reversed: %s)', async (reversed) => {
    const row = optimisticMessage();
    const events = reversed ? [lifecycle(), row] : [row, lifecycle()];
    const fake = fakeClient({ 'session.events': { events, lastSeq: 2, complete: true } });
    expect(await waitForHumanPromptDelivery(APP, UUID, {}, fake.client)).toEqual(row);
  });

  it('does not certify an optimistic row from queued, terminal, unrelated or child lifecycle events', async () => {
    const fake = fakeClient();
    const abort = new AbortController();
    const observed = waitForHumanPromptDelivery(APP, UUID, { signal: abort.signal }, fake.client);
    const delivered = vi.fn();
    void observed.then(delivered, () => {});
    try {
      await fake.reply('session.events', { events: [optimisticMessage()], lastSeq: 1, complete: true });
      fake.event('session.eventBatch', { appSessionId: 'other-session', events: [lifecycle()] });
      fake.event('session.eventBatch', { appSessionId: APP, events: [
        lifecycle('queued'), lifecycle('cancelled'), lifecycle('discarded'), lifecycle('refused'), lifecycle('completed'),
        { ...lifecycle(), commandUuid: uuid('other') },
        { ...lifecycle(), parentToolUseId: 'child-tool' },
        { ...lifecycle(), agentId: 'child' },
      ] });
      await Promise.resolve();
      expect(delivered).not.toHaveBeenCalled();
    } finally {
      abort.abort();
    }
  });

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
    fake.event('session.eventBatch', { appSessionId: APP, events: [{ ...message(), parentToolUseId: 'child-tool' }, { ...message(), agentId: 'child', seq: null }] });
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

  it.each([
    { source: 'replay', row: message(), events: [message()] },
    { source: 'suppressed replay', row: optimisticMessage(), events: [optimisticMessage(), lifecycle()] },
  ])('does not miss a $source delivery while the snapshot is in flight, even if that snapshot later fails', async ({ row, events }) => {
    const fake = fakeClient();
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    fake.event('session.eventBatch', { appSessionId: APP, events });
    expect(await observed).toEqual(row);
    await fake.fail('session.events', 'host departed');
  });

  it('cleans up when a stream adapter synchronously replays the row and started on subscribe', async () => {
    const fake = fakeClient();
    const on = fake.client.on.bind(fake.client);
    const off = vi.fn();
    const row = optimisticMessage();
    vi.spyOn(fake.client, 'on').mockImplementation((name, listener) => {
      const unsubscribe = on(name, listener);
      fake.event('session.eventBatch', { appSessionId: APP, events: [lifecycle(), row] });
      return () => { off(); unsubscribe(); };
    });
    expect(await waitForHumanPromptDelivery(APP, UUID, {}, fake.client)).toEqual(row);
    expect(off).toHaveBeenCalledOnce();
    expect(fake.calls).toEqual(['on session.eventBatch']);
  });

  it('allows the caller to cancel an undelivered observation and unsubscribes', async () => {
    const fake = fakeClient({ 'session.events': { events: [], lastSeq: 0, complete: true } });
    const abort = new AbortController();
    const observed = waitForHumanPromptDelivery(APP, UUID, { signal: abort.signal }, fake.client);
    const rejection = expect(observed).rejects.toThrow('cancelled');
    abort.abort(new Error('cancelled'));
    await rejection;
  });

  it.each([
    { evidence: 'none', events: [] },
    { evidence: 'optimistic row only', events: [optimisticMessage()] },
    { evidence: 'started only', events: [lifecycle()] },
  ])('reports a failed events read with $evidence instead of waiting forever', async ({ events }) => {
    const fake = fakeClient();
    const observed = waitForHumanPromptDelivery(APP, UUID, {}, fake.client);
    fake.event('session.eventBatch', { appSessionId: APP, events });
    const rejection = expect(observed).rejects.toThrow('cannot read events');
    await Promise.all([rejection, fake.fail('session.events', 'cannot read events')]);
  });
});
