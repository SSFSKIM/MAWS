import { afterEach, describe, expect, it } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { attachQueue, EMPTY_QUEUE, resetQueueStore, useQueueStore } from './queue';

const APP = 'app-1' as AppSessionId;
const OTHER = 'app-2' as AppSessionId;
const entry = (queueId: string, state: QueueEntry['state'] = 'queued'): QueueEntry => ({
  queueId, appSessionId: APP, content: queueId, createdAt: '2026-09-29T10:00:00.000Z', state, messageUuid: null, submittedAt: null, uncertain: false, steer: false,
});
const held = () => useQueueStore.getState().bySession.get(APP);

afterEach(resetQueueStore);

describe('the queue store holds each session’s app queue from its snapshot and its events', () => {
  it('subscribes before it reads the snapshot, then follows the events for its session only', async () => {
    const f = fakeClient();
    const off = attachQueue(APP, f.client);
    expect(f.calls).toEqual(['on session.queue', 'invoke session.queue.list']);
    await f.reply('session.queue.list', { entries: [entry('q-1')], paused: true, pauseReason: 'interrupt' });
    expect(held()).toEqual({ entries: [entry('q-1')], paused: true, pauseReason: 'interrupt', steers: [], withdrawn: [], loaded: true });
    f.event('session.queue', { appSessionId: OTHER, entries: [entry('elsewhere')], paused: false, pauseReason: null });
    f.event('session.queue', { appSessionId: APP, entries: [], paused: false, pauseReason: null });
    expect(held()).toEqual({ ...EMPTY_QUEUE, loaded: true });
    expect(useQueueStore.getState().bySession.has(OTHER)).toBe(false);
    off();
  });

  it('keeps an event that raced the snapshot: the event is the newer fact', async () => {
    const f = fakeClient();
    attachQueue(APP, f.client);
    f.event('session.queue', { appSessionId: APP, entries: [entry('q-2', 'submitting')], paused: false });
    await f.reply('session.queue.list', { entries: [entry('q-1')], paused: false, pauseReason: null });
    expect(held()).toEqual({ entries: [entry('q-2', 'submitting')], paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true });
  });

  it('carries the pending steers and the withdrawn uuids the host publishes (W1)', async () => {
    const f = fakeClient();
    attachQueue(APP, f.client);
    const steer = { messageUuid: 'm-1' as never, content: 'look at b', createdAt: '2026-09-29T10:00:00.000Z' };
    f.event('session.queue', { appSessionId: APP, entries: [], paused: false, pauseReason: null, steers: [steer], withdrawn: ['m-0' as never] });
    expect(held()).toMatchObject({ steers: [steer], withdrawn: ['m-0'] });
  });

  it('reads an unanswered snapshot (no process, no state file) as the empty queue', async () => {
    const f = fakeClient();
    attachQueue(APP, f.client);
    await f.fail('session.queue.list', 'unknown session');
    expect(held()).toEqual({ ...EMPTY_QUEUE, loaded: true });
  });

  it('shares one subscription among attachments and drops it with the last', async () => {
    const f = fakeClient();
    const a = attachQueue(APP, f.client);
    const b = attachQueue(APP, f.client);
    expect(f.pending('session.queue.list')).toBe(1);
    a();
    a(); // a disposer releases once
    f.event('session.queue', { appSessionId: APP, entries: [entry('q-3')], paused: false, pauseReason: null });
    expect(held()?.entries.map((e) => e.queueId)).toEqual(['q-3']);
    b();
    f.event('session.queue', { appSessionId: APP, entries: [], paused: false, pauseReason: null });
    expect(held()?.entries.map((e) => e.queueId)).toEqual(['q-3']); // no longer listening
  });
});
