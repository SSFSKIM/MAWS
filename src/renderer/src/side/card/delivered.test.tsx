// P2-F L121 (review fix): which of the card's replies carry "Sent to Claude". The evidence is X22's delivered rule alone
// (the engine's `started` for the uuid); a queued reply's uuid is the one the host's `queue.transition` released it under,
// read from the session's events, so a release that came before the card tracked the reply is not lost. A failed events
// read is not an abort: it is retried a bounded number of times, and the reply stays unmarked meanwhile and after.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { builder, uuid } from '../../transcript/model/test-events';
import { useDeliveredReplies, DELIVERY_RETRY_MS } from './delivered';

const CHILD = 'c5555555-5555-4555-8555-000000000121' as AppSessionId;
let snapshot: SessionEvent[];
let fake: FakeClient;

beforeEach(() => {
  snapshot = [];
  fake = fakeClient({ 'session.events': () => ({ events: snapshot, lastSeq: snapshot.length, complete: true }) });
  window.maws = fake.client;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

const push = (events: SessionEvent[]) => act(() => fake.event('session.eventBatch', { appSessionId: CHILD, events }));

describe('useDeliveredReplies', () => {
  it('marks a queued reply whose release and start came before the card tracked it', async () => {
    const b = builder();
    b.emit('queue.transition', { action: 'release', queueId: 'q1', messageUuid: uuid('u1'), reason: null });
    b.turn('u1', 'Later then');
    b.emit('command.lifecycle', { commandUuid: uuid('u1'), state: 'started' });
    snapshot = b.events;
    const { result } = renderHook(() => useDeliveredReplies(CHILD, fake.client));
    act(() => result.current.track({ disposition: 'queued', started: false, queueId: 'q1' }));
    await waitFor(() => expect([...result.current.delivered]).toEqual([uuid('u1')]));
  });

  it('marks a queued reply released after it was tracked only once the engine starts it', async () => {
    const { result } = renderHook(() => useDeliveredReplies(CHILD, fake.client));
    act(() => result.current.track({ disposition: 'queued', started: false, queueId: 'q2' }));
    await waitFor(() => expect(fake.invoked('session.events')).toHaveLength(1));
    const b = builder();
    b.emit('queue.transition', { action: 'release', queueId: 'q9', messageUuid: uuid('other'), reason: null }); // another entry
    b.emit('queue.transition', { action: 'release', queueId: 'q2', messageUuid: uuid('u2'), reason: null });
    b.turn('u2', 'Later then'); // the host's own row: not delivered yet
    push(b.events);
    b.emit('command.lifecycle', { commandUuid: uuid('other'), state: 'started' });
    push(b.events.slice(-1));
    await act(async () => {});
    expect(result.current.delivered.size).toBe(0);
    push([b.emit('command.lifecycle', { commandUuid: uuid('u2'), state: 'started' })]);
    await waitFor(() => expect([...result.current.delivered]).toEqual([uuid('u2')]));
  });

  it('marks a sent reply once the engine starts it', async () => {
    const { result } = renderHook(() => useDeliveredReplies(CHILD, fake.client));
    act(() => result.current.track({ disposition: 'sent', started: false, messageUuid: uuid('u3') }));
    const b = builder();
    b.turn('u3', 'Also the subtitle');
    push(b.events);
    await act(async () => {});
    expect(result.current.delivered.size).toBe(0);
    push([b.emit('command.lifecycle', { commandUuid: uuid('u3'), state: 'started' })]);
    await waitFor(() => expect([...result.current.delivered]).toEqual([uuid('u3')]));
  });

  describe('a failed events read', () => {
    // the events read fails `failures` times, then answers the snapshot
    function flaky(failures: number): MawsBridge {
      let failed = 0;
      return {
        ...fake.client,
        invoke: ((name: CommandName, input: unknown) => {
          if (name === 'session.events' && failed < failures) {
            failed += 1;
            return Promise.resolve({ ok: false, error: { code: 'internal', message: 'down' } });
          }
          return fake.client.invoke(name as never, input as never);
        }) as MawsBridge['invoke'],
      };
    }
    const reads = (client: MawsBridge) => vi.mocked(client.invoke).mock.calls.filter(([name]) => name === 'session.events').length;
    const spied = (client: MawsBridge) => ({ ...client, invoke: vi.fn(client.invoke) as MawsBridge['invoke'] });

    it('is retried a bounded number of times, the reply unmarked, and then given up', async () => {
      vi.useFakeTimers();
      const b = builder();
      b.turn('u4', 'Also the subtitle');
      b.emit('command.lifecycle', { commandUuid: uuid('u4'), state: 'started' });
      snapshot = b.events; // delivered, but never read
      const client = spied(flaky(Infinity));
      const { result } = renderHook(() => useDeliveredReplies(CHILD, client));
      act(() => result.current.track({ disposition: 'sent', started: false, messageUuid: uuid('u4') }));
      await act(async () => {});
      expect(reads(client)).toBe(1);
      for (const [i, ms] of DELIVERY_RETRY_MS.entries()) {
        await act(async () => vi.advanceTimersByTimeAsync(ms));
        expect(reads(client), `retry ${i + 1}`).toBe(i + 2);
      }
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(reads(client), 'given up: no further read').toBe(DELIVERY_RETRY_MS.length + 1);
      expect(result.current.delivered.size).toBe(0);
    });

    it('recovers when a retry reads the delivery', async () => {
      vi.useFakeTimers();
      const b = builder();
      b.emit('queue.transition', { action: 'release', queueId: 'q5', messageUuid: uuid('u5'), reason: null });
      b.turn('u5', 'Later then');
      b.emit('command.lifecycle', { commandUuid: uuid('u5'), state: 'started' });
      snapshot = b.events;
      const client = flaky(1);
      const { result } = renderHook(() => useDeliveredReplies(CHILD, client));
      act(() => result.current.track({ disposition: 'queued', started: false, queueId: 'q5' }));
      await act(async () => {});
      expect(result.current.delivered.size).toBe(0);
      await act(async () => vi.advanceTimersByTimeAsync(DELIVERY_RETRY_MS[0]));
      expect([...result.current.delivered]).toEqual([uuid('u5')]);
    });

    it('is not what the card closing is: an unmount aborts the watch and retries nothing', async () => {
      vi.useFakeTimers();
      fake = fakeClient(); // the events read stays pending until the card closes
      const pending = spied(fake.client);
      const { result, unmount } = renderHook(() => useDeliveredReplies(CHILD, pending));
      act(() => result.current.track({ disposition: 'sent', started: false, messageUuid: uuid('u6') }));
      await act(async () => {});
      expect(reads(pending)).toBe(1);
      unmount();
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(reads(pending)).toBe(1);
      expect(fake.calls.filter((c) => c === 'on session.eventBatch')).toHaveLength(1); // nor a second subscription
    });
  });
});
