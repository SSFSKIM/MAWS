// The page's lane A watches (P5 O9 M5): one `laneA.watch` per session per page, shared by its consumers, opened while a
// consumer holds it and the session's bridge is live or starting, a late consumer replayed the snapshot and what
// followed, and its `op` and `compact` messages kept by id for a caller that learns an op's id after it ended.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { laneAState } from './test-support/lane-a-state';
import { opMessagesOf, resetLaneAWatches, watchLaneA, type PlaneEvent } from './watches';

const A = at('app-a') as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const msg = (kind: string, body: unknown, n: number | null = 1) => ({ project: '', machine: 'm', session: 'eng-1', kind, sub: 'w-1', n, body });
const snapshot = msg('snapshot', { streaming: [], usage: null }, 0);

beforeEach(() => {
  resetLaneAStore();
  resetLaneAWatches();
});

describe('watchLaneA', () => {
  it('opens one watch for the session once its bridge is live, shares it, and lets it go with the last consumer', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    const heard: PlaneEvent[] = [];
    const off = watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    await settle();
    expect(fake.invoked('laneA.watch')).toEqual([]); // no bridge yet
    applyLaneAState(A, laneAState(A, { bridge: 'starting', reason: 'starting' }));
    await settle();
    expect(fake.invoked('laneA.watch')).toEqual([{ appSessionId: A }]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    fake.event('laneA.plane', { appSessionId: A, watch: 'other', messages: [msg('chunk', {})] }); // another page's
    const second: PlaneEvent[] = [];
    const offSecond = watchLaneA(A, (e) => second.push(e), { client: fake.client, replay: true });
    expect(second).toEqual([{ kind: 'messages', messages: [snapshot] }]); // replayed from the snapshot on
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('chunk', { x: 1 })] });
    expect(heard).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(fake.invoked('laneA.watch')).toHaveLength(1);
    off();
    offSecond();
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: A, watch: 'w-1' }]);
  });

  it('gives a consumer that comes after the replay bound a fresh snapshot: the watch opens again', async () => {
    let n = 0;
    const fake = fakeClient({ 'laneA.watch': () => ({ watch: `w-${++n}` }), 'laneA.unwatch': undefined });
    applyLaneAState(A, laneAState(A));
    const first: PlaneEvent[] = [];
    watchLaneA(A, (e) => first.push(e), { client: fake.client });
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: Array.from({ length: 20_001 }, (_, i) => msg('chunk', { i }, i + 1)) });
    const late: PlaneEvent[] = [];
    watchLaneA(A, (e) => late.push(e), { client: fake.client, replay: true });
    await settle();
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: A, watch: 'w-1' }]);
    expect(fake.invoked('laneA.watch')).toHaveLength(2);
    expect(first.at(-1)).toEqual({ kind: 'reset' }); // what the first drew no longer follows
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('chunk', { stale: true })] }); // the old watch's, ignored
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-2', messages: [snapshot] });
    expect(late).toEqual([{ kind: 'messages', messages: [snapshot] }]);
    expect(first.at(-1)).toEqual({ kind: 'messages', messages: [snapshot] });
  });

  it('holds what arrived for its watch before the watch’s id came back', async () => {
    const fake = fakeClient({ 'laneA.unwatch': undefined });
    applyLaneAState(A, laneAState(A));
    const heard: PlaneEvent[] = [];
    watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot] });
    expect(heard).toEqual([]);
    await fake.reply('laneA.watch', { watch: 'w-1' });
    expect(heard).toEqual([{ kind: 'messages', messages: [snapshot] }]);
  });

  it('passes a reset and an end on, and watches again once the bridge is live again', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    applyLaneAState(A, laneAState(A));
    const heard: PlaneEvent[] = [];
    watchLaneA(A, (e) => heard.push(e), { client: fake.client });
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', reset: true });
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', ended: 'the session’s bridge went away' });
    expect(heard).toEqual([{ kind: 'reset' }, { kind: 'ended', reason: 'the session’s bridge went away' }]);
    applyLaneAState(A, null);
    applyLaneAState(A, laneAState(A));
    await settle();
    expect(fake.invoked('laneA.watch')).toHaveLength(2);
  });

  it('keeps each op’s messages by id', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' } });
    applyLaneAState(A, laneAState(A));
    watchLaneA(A, () => {}, { client: fake.client });
    await settle();
    const end = msg('op', { rpc: 'cmd-2', op: 'btw', phase: 'end', id: 'cmd-2', text: 'because' }, null);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot, msg('op', { rpc: 'cmd-2', op: 'btw', phase: 'start', id: 'cmd-2' }, null), end] });
    expect(opMessagesOf(A, 'cmd-2').map((m) => m.body)).toEqual([{ rpc: 'cmd-2', op: 'btw', phase: 'start', id: 'cmd-2' }, end.body]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [msg('compact', { rpc: 'cmd-3', phase: 'end', tokensBefore: 9, tokensAfter: 2 }, null)] });
    expect(opMessagesOf(A, 'cmd-3')).toHaveLength(1);
  });
});
