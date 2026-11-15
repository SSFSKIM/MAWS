import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestAnswer } from '@shared/engine/answers';
import type { AttentionItem } from '@shared/graph/attention';
import type { CommandResult } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { item, record, remoteRow } from '../../../../test/support/builders';
import { ev } from '../../../../test/support/events';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { swapOf } from '../composer/docked/swap';
import { connectAnswers, createAttentionStore, NOT_PENDING_MS, REQUEST_RETRY_MS, selectGreyedNeedsYou, selectNeedsYou, selectPendingOf, selectWaitingAgents, selectWaitingByCall, selectWaitingForms, selectWaitingRequests } from './attention';

const M = TEST_MACHINE; // the store reads no machine from ids, so the one-machine cases keep bare ids

const S = 's1' as AppSessionId;
const older = item('s1', 'permission', '2026-09-28T09:00:00Z');
const newer = item('s1', 'question', '2026-09-28T10:00:00Z');

describe('attention snapshot and changes in both orders', () => {
  it('a change buffered while the snapshot is outstanding wins over the snapshot’s older items', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applyChanged({ appSessionId: S, items: [newer] }, M);
    expect(store.getState().bySession.get(S)).toBeUndefined(); // buffered, not applied
    store.getState().applySnapshot([older], M);
    expect(store.getState()).toMatchObject({ loaded: true, pendingReplacements: null });
    expect(store.getState().bySession.get(S)).toEqual([newer]);
  });

  it('an empty change buffered before the snapshot leaves the session empty', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applyChanged({ appSessionId: S, items: [] }, M);
    store.getState().applySnapshot([older], M);
    expect(store.getState().bySession.get(S)).toEqual([]);
  });

  it('keeps the last buffered change per session', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applyChanged({ appSessionId: S, items: [older] }, M);
    store.getState().applyChanged({ appSessionId: S, items: [newer] }, M);
    store.getState().applySnapshot([], M);
    expect(store.getState().bySession.get(S)).toEqual([newer]);
  });

  it('a change arriving after the snapshot replaces that session’s list directly', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applySnapshot([older, item('s2', 'plan', '2026-09-28T08:00:00Z')], M);
    store.getState().applyChanged({ appSessionId: S, items: [newer] }, M);
    expect(store.getState().bySession.get(S)).toEqual([newer]);
    expect(store.getState().bySession.get('s2' as AppSessionId)).toHaveLength(1);
  });

  it('records the notification delivery main reports', () => {
    const store = createAttentionStore();
    store.getState().applyNotified({ appSessionId: S, attentionId: older.id, delivery: 'fallback', at: '2026-09-28T10:00:00Z' });
    expect(store.getState().notificationDelivery).toBe('fallback');
  });

  it('selects a session’s open items and the Needs-you rows', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applySnapshot([older, item('s1', 'plan', '2026-09-28T08:00:00Z', { state: 'retired' })], M);
    expect(selectPendingOf(store.getState(), S)).toEqual([older]);
    const sessions = { records: new Map([[S, record('s1')]]), recordsVersion: 1 };
    const rows = selectNeedsYou(store.getState(), sessions);
    expect(rows.map((r) => r.appSessionId)).toEqual([S]);
    expect(selectNeedsYou(store.getState(), sessions)).toBe(rows); // memoised while the versions stand
    store.getState().applyChanged({ appSessionId: S, items: [] }, M);
    expect(selectNeedsYou(store.getState(), sessions)).toEqual([]);
  });
});

// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "The feed"; M6b's `remote.attention`): another
// machine's feed, its snapshot replacing that machine's partition whole, greyed from its link's `down` until its next
// snapshot, `up` or not; a greyed partition's rows are drawn (`selectGreyedNeedsYou`) and never counted.
describe('another machine’s attention feed', () => {
  const onB = (id: string) => addressOf(OTHER_MACHINE, id as AppSessionId);
  const bItem = (id: string, createdAt: string) => item(onB(id), 'permission', createdAt);
  const listed = new Map([onB('b1'), onB('b2')].map((appId) => [appId, { ...remoteRow(OTHER_MACHINE, appId), appId }]));
  const sessions = { records: new Map([[S, record('s1')]]), recordsVersion: 1, listed };
  const live = (store: ReturnType<typeof createAttentionStore>) => selectNeedsYou(store.getState(), sessions).map((r) => r.appSessionId);
  const greyed = (store: ReturnType<typeof createAttentionStore>) => selectGreyedNeedsYou(store.getState(), sessions).map((r) => r.appSessionId);
  const b1 = bItem('b1', '2026-09-28T08:00:00Z');
  const b2 = bItem('b2', '2026-09-28T07:00:00Z');

  it('a snapshot replaces that machine’s sessions only, and a listed row stands in for the record', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applySnapshot([older], M);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1, b2], greyed: false });
    expect(live(store)).toEqual([onB('b2'), onB('b1'), S]);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b2], greyed: false });
    expect(store.getState().bySession.has(onB('b1'))).toBe(false);
    expect(live(store)).toEqual([onB('b2'), S]);
  });

  it('greyed at the link’s down: drawn, out of the count; the next snapshot restores them', () => {
    const store = createAttentionStore();
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1, b2], greyed: false });
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1, b2], greyed: true });
    expect(live(store)).toEqual([]);
    expect(greyed(store)).toEqual([onB('b2'), onB('b1')]);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1], greyed: false }); // b2 answered while it was down
    expect(live(store)).toEqual([onB('b1')]);
    expect(greyed(store)).toEqual([]);
    expect(store.getState().greyed.size).toBe(0);
  });

  it('a change heard while greyed (the pane’s stream after up) stays greyed until the snapshot', () => {
    const store = createAttentionStore();
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1], greyed: true });
    store.getState().applyChanged({ appSessionId: onB('b2'), items: [b2] }, OTHER_MACHINE);
    expect(live(store)).toEqual([]);
    expect(greyed(store)).toEqual([onB('b2'), onB('b1')]);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1, b2], greyed: false });
    expect(live(store)).toEqual([onB('b2'), onB('b1')]);
  });

  it('a session leaving the feed (`items: []`) leaves Needs you; the feed gone (`items: []`, not greyed) empties the machine', () => {
    const store = createAttentionStore();
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1, b2], greyed: false });
    store.getState().applyChanged({ appSessionId: onB('b2'), items: [] }, OTHER_MACHINE);
    expect(live(store)).toEqual([onB('b1')]);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1], greyed: true });
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false });
    expect([...store.getState().bySession.keys()]).toEqual([]);
    expect([live(store), greyed(store)]).toEqual([[], []]);
  });

  // M6c fix wave 1: an RL2 machine the roster brought up before the org rows named it was snapshotted as a socket
  // machine; once main's feed speaks for it, that list's late answer (or its failure) changes nothing, either way
  it('a late attention.list does not resurrect an item the feed answered', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applyChanged({ appSessionId: onB('b1'), items: [] }, OTHER_MACHINE); // buffered
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false });
    expect(store.getState().pendingReplacements).toBeNull();
    store.getState().applySnapshot([b1], OTHER_MACHINE); // read before the answer
    expect(store.getState().bySession.has(onB('b1'))).toBe(false);
    expect([live(store), greyed(store)]).toEqual([[], []]);
  });

  it('a late attention.list does not erase a current feed item, nor does its failure replay anything', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [b1], greyed: false });
    store.getState().applySnapshot([], OTHER_MACHINE);
    expect(live(store)).toEqual([onB('b1')]);
    store.getState().beginSnapshot(OTHER_MACHINE); // a new generation of its link: the feed still speaks for it
    store.getState().applyChanged({ appSessionId: onB('b2'), items: [b2] }, OTHER_MACHINE); // applied, not buffered
    expect(live(store)).toEqual([onB('b2'), onB('b1')]);
    store.getState().cancelSnapshot(OTHER_MACHINE);
    expect(live(store)).toEqual([onB('b2'), onB('b1')]);
    expect(store.getState().pendingReplacements).toBeNull();
  });

  it('memoises on the listed rows too: a session listed later gains its row', () => {
    const store = createAttentionStore();
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [bItem('b3', '2026-09-28T08:00:00Z')], greyed: false });
    expect(live(store)).toEqual([]);
    const later = new Map([...listed, [onB('b3'), { ...remoteRow(OTHER_MACHINE, 'b3'), appId: onB('b3') }]]);
    expect(selectNeedsYou(store.getState(), { ...sessions, listed: later }).map((r) => r.appSessionId)).toEqual([onB('b3')]);
  });
});

describe('the originating request of an item, fetched once', () => {
  const event = ev('permission.requested', { requestId: older.request.requestId, toolName: 'Read', input: { file_path: '/r/a.md' } });

  it('asks attention.request once per item, sharing a fetch in flight, and caches the answer', async () => {
    const store = createAttentionStore();
    const fake = fakeClient();
    const a = store.getState().loadRequest(fake.client, older);
    const b = store.getState().loadRequest(fake.client, older);
    expect(fake.pending('attention.request')).toBe(1);
    await fake.reply('attention.request', { event });
    await Promise.all([a, b]);
    expect(store.getState().requests.get(older.id)).toBe(event);
    await store.getState().loadRequest(fake.client, older);
    expect(fake.invoked('attention.request')).toEqual([{ appSessionId: S, requestId: older.request.requestId }]);
  });

  it('an item with no request id has no originating request and asks nothing', async () => {
    const store = createAttentionStore();
    const fake = fakeClient();
    const bare = item('s1', 'error', '2026-09-28T09:00:00Z', { request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    await store.getState().loadRequest(fake.client, bare);
    expect(store.getState().requests.get(bare.id)).toBeNull();
    expect(fake.invoked('attention.request')).toEqual([]);
  });

  it('retries a failed read once, after REQUEST_RETRY_MS, and caches what the retry reads', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAttentionStore();
    const fake = fakeClient();
    const load = store.getState().loadRequest(fake.client, older);
    void fake.fail('attention.request', 'no host'); // its settle is a timer, run below
    await vi.advanceTimersByTimeAsync(REQUEST_RETRY_MS - 1);
    expect(fake.pending('attention.request')).toBe(0);
    void store.getState().loadRequest(fake.client, older); // shares the read under way, retry included
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.pending('attention.request')).toBe(1);
    void fake.reply('attention.request', { event });
    await vi.advanceTimersByTimeAsync(0);
    await load;
    expect(store.getState().requests.get(older.id)).toBe(event);
    expect(store.getState().unreadable.size).toBe(0);
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('a read that fails twice is cached as unreadable, so the docked swap shows it as a notice instead of waiting', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAttentionStore();
    const fake = fakeClient();
    const load = store.getState().loadRequest(fake.client, older);
    void fake.fail('attention.request', 'no host'); // its settle is a timer, run below
    await vi.advanceTimersByTimeAsync(REQUEST_RETRY_MS);
    void fake.fail('attention.request', 'still no host');
    await vi.advanceTimersByTimeAsync(0);
    await load;
    expect(store.getState().requests.get(older.id)).toBeNull();
    expect(store.getState().unreadable.get(older.id)).toBe('still no host');
    expect(swapOf([older], store.getState().requests)).toMatchObject({ item: null, notice: older, unread: [] });
    await store.getState().loadRequest(fake.client, older); // asks nothing more
    expect(fake.invoked('attention.request')).toHaveLength(2);
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('Retry forgets an unreadable read and asks again; an answered or retired item’s failure is forgotten', async () => {
    const store = createAttentionStore();
    const fake = fakeClient();
    store.getState().applySnapshot([older, newer], M);
    store.setState({ requests: new Map([[older.id, null], [newer.id, null]]), unreadable: new Map([[older.id, 'no host'], [newer.id, 'no host']]) });
    const retry = store.getState().retryRequest(fake.client, older);
    expect(store.getState().requests.has(older.id)).toBe(false); // unread again: the docked swap waits for it
    expect(store.getState().unreadable.has(older.id)).toBe(false);
    await fake.reply('attention.request', { event });
    await retry;
    expect(store.getState().requests.get(older.id)).toBe(event);
    store.getState().applyChanged({ appSessionId: S, items: [older, { ...newer, state: 'delivered' }] }, M); // newer answered
    expect(store.getState().unreadable.size).toBe(0);
    expect(store.getState().requests.has(newer.id)).toBe(false);
    expect(store.getState().requests.get(older.id)).toBe(event); // a read request stays cached
  });
});

// W4: the question stepper's draft lives beside the request until the item is no longer open.
describe('a question card’s draft', () => {
  it('is kept while its item waits and dropped once it is answered, retires or leaves (UC-1)', () => {
    const store = createAttentionStore();
    store.getState().applySnapshot([older, newer], M);
    const draft = { step: 1, reached: 1, selected: { q: ['Red'] }, other: {} };
    store.getState().setDraft(newer.id, draft);
    store.getState().setDraft(older.id, draft);
    store.getState().applyChanged({ appSessionId: S, items: [older, newer] }, M);
    expect(store.getState().drafts.get(newer.id)).toBe(draft);
    store.getState().applyChanged({ appSessionId: S, items: [older, { ...newer, state: 'retired' }] }, M);
    expect(store.getState().drafts.has(newer.id)).toBe(false);
    expect(store.getState().drafts.get(older.id)).toBe(draft);
    store.getState().beginSnapshot(M);
    store.getState().applySnapshot([], M);
    expect(store.getState().drafts.size).toBe(0);
  });
});

// UC-1 (A17): the session's list every in-session surface reads holds what waits, and a form's draft goes at the answer.
describe('an answered request in the store', () => {
  it('is not in the session’s list, and its question’s draft is dropped', () => {
    const store = createAttentionStore();
    store.getState().applySnapshot([older, newer], M);
    store.getState().setDraft(newer.id, { step: 1, reached: 1, selected: { q: ['Red'] }, other: {} });
    store.getState().applyChanged({ appSessionId: S, items: [older, { ...newer, state: 'delivered' }] }, M);
    expect(selectPendingOf(store.getState(), S)).toEqual([older]);
    expect(store.getState().drafts.has(newer.id)).toBe(false);
  });

  it('is in neither the waiting calls nor the waiting agents, each the same object until the session’s list changes', () => {
    const store = createAttentionStore();
    const call = item('s1', 'permission', '2026-09-28T09:00:00Z', { id: 'att-call' as never, request: { requestId: 'req-c' as never, toolUseId: 'toolu_c' as never, taskId: 'task-c' as never, agentId: 'agent-c' as never } });
    const answered = item('s1', 'permission', '2026-09-28T09:01:00Z', { id: 'att-answered' as never, state: 'delivered', request: { requestId: 'req-d' as never, toolUseId: 'toolu_d' as never, taskId: null, agentId: 'agent-d' as never } });
    store.getState().applySnapshot([call, answered], M);
    const calls = selectWaitingByCall(store.getState(), S);
    expect([...calls.keys()]).toEqual(['toolu_c']);
    expect([...selectWaitingAgents(store.getState(), S)].sort()).toEqual(['agent-c', 'task-c']);
    expect(selectWaitingByCall(store.getState(), S)).toBe(calls);
    expect(selectWaitingAgents(store.getState(), S)).toBe(selectWaitingAgents(store.getState(), S));
    store.getState().applyChanged({ appSessionId: S, items: [call] }, M);
    expect(selectWaitingByCall(store.getState(), S)).not.toBe(calls);
  });
});

// UX wave U1a (Interfaces §B, Reported 9): a list the machine's feed and lists never carry (lane A's mirror of a remote
// terminal session) stands through that machine's snapshots, its question's draft with it.
describe('a mirrored session of another machine', () => {
  const T = addressOf(OTHER_MACHINE, 'eng-t' as AppSessionId);
  const fed = item(addressOf(OTHER_MACHINE, 'b1' as AppSessionId), 'permission', '2026-09-28T08:00:00Z');
  const asked = item(T, 'question', '2026-09-28T09:00:00Z', { id: addressOf(OTHER_MACHINE, 'lane-a:eng-t:toolu_q') as never });
  const draft = { step: 1, reached: 1, selected: { q: ['Red'] }, other: { q: 'made-up text' } };

  it('stands, with its draft, through the machine’s feed snapshot, which replaces the rest of its partition', () => {
    const store = createAttentionStore();
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [fed], greyed: false });
    store.getState().applyMirrored({ appSessionId: T, items: [asked] }, OTHER_MACHINE);
    store.getState().setDraft(asked.id, draft);
    const list = store.getState().bySession.get(T);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false });
    expect(store.getState().bySession.get(T)).toBe(list);
    expect(store.getState().bySession.has(fed.appSessionId)).toBe(false);
    expect(store.getState().drafts.get(asked.id)).toBe(draft);
  });

  it('stands through the machine’s listed snapshot, written at once while that snapshot is outstanding', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applyMirrored({ appSessionId: T, items: [asked] }, OTHER_MACHINE);
    expect(store.getState().bySession.get(T)).toEqual([asked]);
    store.getState().setDraft(asked.id, draft);
    store.getState().applySnapshot([], OTHER_MACHINE);
    expect(store.getState().bySession.get(T)).toEqual([asked]);
    expect(store.getState().drafts.get(asked.id)).toBe(draft);
  });

  it('is the machine’s again once the mirror empties it: the next snapshot removes it, and its draft went at the empty write', () => {
    const store = createAttentionStore();
    store.getState().applyMirrored({ appSessionId: T, items: [asked] }, OTHER_MACHINE);
    store.getState().setDraft(asked.id, draft);
    store.getState().applyMirrored({ appSessionId: T, items: [] }, OTHER_MACHINE);
    expect(store.getState().bySession.get(T)).toEqual([]);
    expect(store.getState().drafts.has(asked.id)).toBe(false);
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false });
    expect(store.getState().bySession.has(T)).toBe(false);
  });
});

// P5 O6 M4 (OX2): a machine's snapshot answers for that machine's sessions only, and buffers that machine's changes.
describe('attention partitions its snapshots by machine', () => {
  const onB = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;
  const onBItem = item(onB('s9'), 'permission', '2026-09-28T09:30:00Z');

  it('B’s snapshot replaces B’s sessions and none of A’s', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(M);
    store.getState().applySnapshot([older], M);
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applySnapshot([onBItem], OTHER_MACHINE);
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applySnapshot([], OTHER_MACHINE);
    expect(store.getState().bySession.get(S)).toEqual([older]);
    expect(store.getState().bySession.has(onB('s9'))).toBe(false);
  });

  it('while B’s snapshot is outstanding, A’s changes apply and B’s wait for it', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applyChanged({ appSessionId: S, items: [newer] }, M);
    store.getState().applyChanged({ appSessionId: onB('s9'), items: [onBItem] }, OTHER_MACHINE);
    expect(store.getState().bySession.get(S)).toEqual([newer]);
    expect(store.getState().bySession.has(onB('s9'))).toBe(false);
    expect([...(store.getState().pendingReplacements?.keys() ?? [])]).toEqual([onB('s9')]);
    store.getState().applySnapshot([], OTHER_MACHINE);
    expect(store.getState().bySession.get(onB('s9'))).toEqual([onBItem]);
    expect(store.getState().pendingReplacements).toBeNull();
  });

  it('a cancelled snapshot replays its buffer and removes nothing', () => {
    const store = createAttentionStore();
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applySnapshot([onBItem], OTHER_MACHINE);
    store.getState().beginSnapshot(OTHER_MACHINE);
    store.getState().applyChanged({ appSessionId: onB('s8'), items: [] }, OTHER_MACHINE);
    store.getState().cancelSnapshot(OTHER_MACHINE);
    expect(store.getState().bySession.get(onB('s9'))).toEqual([onBItem]);
    expect(store.getState().bySession.get(onB('s8'))).toEqual([]);
    expect(store.getState().pendingReplacements).toBeNull();
  });
});

// UX wave U1b (Interfaces §A): the session's waiting requests and the calls its transcript marks, each by the shared
// rule and the same object until the session's list changes.
describe('the list a transcript draws', () => {
  const form = item('s1', 'question', '2026-09-28T09:00:00Z', { id: 'att-form' as never, request: { requestId: 'req-f' as never, toolUseId: 'toolu_f' as never, taskId: null, agentId: null } });
  const prompt = item('s1', 'permission', '2026-09-28T08:00:00Z', { id: 'att-prompt' as never, request: { requestId: 'req-p' as never, toolUseId: 'toolu_p' as never, taskId: null, agentId: null } });
  const answered = item('s1', 'question', '2026-09-28T07:00:00Z', { id: 'att-done' as never, state: 'delivered', request: { requestId: 'req-d' as never, toolUseId: 'toolu_d' as never, taskId: null, agentId: null } });

  it('selects the waiting requests oldest first and the calls of the forms among them, memoised per list', () => {
    const store = createAttentionStore();
    store.getState().applySnapshot([form, prompt, answered], M);
    const requests = selectWaitingRequests(store.getState(), S);
    const forms = selectWaitingForms(store.getState(), S);
    expect(requests.map((i) => i.id)).toEqual(['att-prompt', 'att-form']);
    expect([...forms]).toEqual(['toolu_f']);
    expect(selectWaitingRequests(store.getState(), S)).toBe(requests);
    expect(selectWaitingForms(store.getState(), S)).toBe(forms);
    store.getState().applyChanged({ appSessionId: S, items: [prompt] }, M);
    expect(selectWaitingForms(store.getState(), S).size).toBe(0);
    expect(selectWaitingRequests(store.getState(), 'nobody' as AppSessionId)).toEqual([]);
  });
});

// UX wave U1b (Interfaces §G, decisions 8 and 21): what is known of a question's answer before the transcript's own row
// carries it, by the addressed session together with the call.
describe('a question’s receipt', () => {
  const call = 'toolu_r' as never;

  it('is kept per session and call; a settlement never replaces an answer or a dismissal, an answer replaces a settlement', () => {
    const store = createAttentionStore();
    const receipt = () => store.getState().receipts.get(S)?.get(call);
    store.getState().recordReceipt(S, call, { settled: 'Answered in the terminal' });
    expect(receipt()).toEqual({ settled: 'Answered in the terminal' });
    store.getState().recordReceipt(S, call, { answers: { 'Which file?': 'a.ts' } });
    expect(receipt()).toEqual({ answers: { 'Which file?': 'a.ts' } });
    store.getState().recordReceipt(S, call, { settled: 'Answered elsewhere' });
    expect(receipt()).toEqual({ answers: { 'Which file?': 'a.ts' } });
    store.getState().recordReceipt(S, 'toolu_x' as never, { dismissed: true });
    store.getState().recordReceipt(S, 'toolu_x' as never, { settled: 'Answered in the terminal' });
    expect(store.getState().receipts.get(S)?.get('toolu_x' as never)).toEqual({ dismissed: true });
  });

  it('writing what is held already changes nothing', () => {
    const store = createAttentionStore();
    store.getState().recordReceipt(S, call, { settled: 'Answered in the terminal' });
    const held = store.getState().receipts;
    store.getState().recordReceipt(S, call, { settled: 'Answered in the terminal' });
    expect(store.getState().receipts).toBe(held);
  });

  // The ruling of 2026-11-15 on M1's D-2: a receipt lasts until the row carries its own answers or the session leaves,
  // so a machine's feed snapshot that drops a session's emptied list leaves its receipts; the session's leaving drops them
  it('stands through a snapshot that drops its session’s list; the session’s leaving drops its own alone', () => {
    const store = createAttentionStore();
    const T = addressOf(OTHER_MACHINE, 'eng-t' as AppSessionId);
    const kept = addressOf(TEST_MACHINE, 'eng-t' as AppSessionId);
    const asked = item(T, 'question', '2026-09-28T09:00:00Z', { id: addressOf(OTHER_MACHINE, 'lane-a:eng-t:toolu_r') as never });
    store.getState().applyMirrored({ appSessionId: T, items: [asked] }, OTHER_MACHINE);
    store.getState().recordReceipt(T, call, { answers: { q: 'a' } });
    store.getState().recordReceipt(kept, call, { answers: { q: 'b' } }); // one engine session and call id on another machine
    store.getState().applyMirrored({ appSessionId: T, items: [] }, OTHER_MACHINE); // answered: the list is empty
    store.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false }); // the machine's snapshot drops it
    expect(store.getState().bySession.has(T)).toBe(false);
    expect(store.getState().receipts.get(T)?.get(call)).toEqual({ answers: { q: 'a' } });
    store.getState().forgetReceipts(T); // the session left
    expect(store.getState().receipts.has(T)).toBe(false);
    expect(store.getState().receipts.get(kept)?.get(call)).toEqual({ answers: { q: 'b' } });
    const held = store.getState().receipts;
    store.getState().forgetReceipts(T);
    expect(store.getState().receipts).toBe(held);
  });
});

// UX wave U1b (Interfaces §G "The delivery"; decision 17): a card's delivery is held by the request, under the item's id,
// so every mounted card of the item reads one state and a card mounted again finds the one it left; the entry goes with
// its item. The session's port is given by the card's module (`connectAnswers`); here a test's, whose writes it holds open.
describe('a card’s delivery', () => {
  const asked = item('s1', 'question', '2026-09-28T09:00:00Z', { id: 'att-asked' as never, request: { requestId: 'req-a' as never, toolUseId: 'toolu_a' as never, taskId: null, agentId: null } });
  const prompt = item('s1', 'permission', '2026-09-28T09:01:00Z', { id: 'att-prompt' as never, request: { requestId: 'req-p' as never, toolUseId: 'toolu_p' as never, taskId: null, agentId: null } });
  const ANSWERS: RequestAnswer = { kind: 'question', answers: { 'Which file?': 'a.ts' } };
  const DENY: RequestAnswer = { kind: 'permission', decision: 'deny', message: '' };
  type Sent = { item: AttentionItem; answer: RequestAnswer; settle: (result: CommandResult<'session.answer'>) => void };
  let sent: Sent[] = [];
  let terminalOnly = false;
  let off: () => void = () => {};
  const connect = () => {
    sent = [];
    terminalOnly = false;
    off = connectAnswers({
      send: (item, answer) => new Promise((settle) => sent.push({ item, answer, settle })),
      terminalOnly: () => terminalOnly,
    });
  };
  const outcome = (value: 'delivered' | 'not_pending' | 'write_failed', nth = 0) => sent[nth]!.settle({ ok: true, value: { outcome: value } });
  afterEach(() => {
    off();
    vi.useRealTimers();
  });
  const listed = (...items: AttentionItem[]) => {
    const store = createAttentionStore();
    store.getState().applySnapshot(items, M);
    return store;
  };

  it('is answering while the write is out, then sent until the item leaves the list, when it goes', async () => {
    connect();
    const store = listed(asked);
    const answered = store.getState().deliver(asked, ANSWERS);
    expect(store.getState().deliveries.get(asked.id)).toEqual({ phase: 'answering' });
    outcome('delivered');
    expect(await answered).toBe('delivered');
    expect(store.getState().deliveries.get(asked.id)).toEqual({ phase: 'sent' });
    store.getState().applyChanged({ appSessionId: S, items: [asked] }, M);
    expect(store.getState().deliveries.get(asked.id)).toEqual({ phase: 'sent' }); // still listed
    store.getState().applyChanged({ appSessionId: S, items: [] }, M);
    expect(store.getState().deliveries.has(asked.id)).toBe(false);
  });

  it('held open: the item leaves the list while the write is out, and the entry goes with it, the receipt still written at the outcome', async () => {
    connect();
    const store = listed(asked);
    const answered = store.getState().deliver(asked, ANSWERS);
    store.getState().applyChanged({ appSessionId: S, items: [] }, M);
    expect(store.getState().deliveries.has(asked.id)).toBe(false);
    outcome('delivered');
    expect(await answered).toBe('delivered');
    expect(store.getState().deliveries.has(asked.id)).toBe(false);
    expect(store.getState().receipts.get(S)?.get('toolu_a' as never)).toEqual({ answers: { 'Which file?': 'a.ts' } });
  });

  it('held open: a second call for the item while one is out sends nothing, and both callers get the one outcome', async () => {
    connect();
    const store = listed(asked);
    const first = store.getState().deliver(asked, ANSWERS);
    const second = store.getState().deliver(asked, DENY);
    expect(sent).toHaveLength(1);
    outcome('delivered');
    expect(await Promise.all([first, second])).toEqual(['delivered', 'delivered']);
    expect(await store.getState().deliver(asked, DENY)).toBe('delivered'); // sent: one answer per request
    expect(sent).toHaveLength(1);
  });

  it('a failed write keeps its answer and its detail, and the next call sends again', async () => {
    connect();
    const store = listed(prompt);
    const failed = store.getState().deliver(prompt, DENY);
    sent[0]!.settle({ ok: false, error: { code: 'internal', message: 'the link is down' } });
    expect(await failed).toBe('write_failed');
    expect(store.getState().deliveries.get(prompt.id)).toEqual({ phase: 'failed', detail: 'the link is down', answer: DENY });
    const retried = store.getState().deliver(prompt, DENY);
    expect(store.getState().deliveries.get(prompt.id)).toEqual({ phase: 'answering' });
    outcome('write_failed', 1);
    expect(await retried).toBe('write_failed');
    expect(store.getState().deliveries.get(prompt.id)).toEqual({ phase: 'failed', detail: null, answer: DENY });
    expect(sent.map((s) => s.answer)).toEqual([DENY, DENY]);
  });

  it('answered elsewhere says so for NOT_PENDING_MS, by a timer of its own, then the card closes; one the terminal alone answers goes back to pending', async () => {
    vi.useFakeTimers();
    connect();
    const store = listed(prompt);
    const answered = store.getState().deliver(prompt, DENY);
    outcome('not_pending');
    expect(await answered).toBe('not_pending');
    expect(store.getState().deliveries.get(prompt.id)).toEqual({ phase: 'not_pending' });
    vi.advanceTimersByTime(NOT_PENDING_MS - 1);
    expect(store.getState().deliveries.get(prompt.id)).toEqual({ phase: 'not_pending' });
    vi.advanceTimersByTime(1);
    expect(store.getState().deliveries.get(prompt.id)).toEqual({ phase: 'closed' });
    store.getState().applyChanged({ appSessionId: S, items: [] }, M);
    expect(store.getState().deliveries.has(prompt.id)).toBe(false);

    const again = listed(prompt);
    terminalOnly = true;
    const refused = again.getState().deliver(prompt, DENY);
    outcome('not_pending', 1);
    expect(await refused).toBe('not_pending');
    expect(again.getState().deliveries.has(prompt.id)).toBe(false);
  });

  it('writes a question’s receipt at a delivered answer, a dismissal for its decline, and nothing for another kind or another outcome', async () => {
    connect();
    const store = listed(asked, prompt);
    const call = 'toolu_a' as never;
    void store.getState().deliver(asked, DENY);
    outcome('write_failed');
    await vi.waitFor(() => expect(store.getState().deliveries.get(asked.id)?.phase).toBe('failed'));
    expect(store.getState().receipts.size).toBe(0);
    const dismissed = store.getState().deliver(asked, DENY);
    outcome('delivered', 1);
    await dismissed;
    expect(store.getState().receipts.get(S)?.get(call)).toEqual({ dismissed: true });
    const allowed = store.getState().deliver(prompt, DENY);
    outcome('delivered', 2);
    await allowed;
    expect(store.getState().receipts.get(S)?.has('toolu_p' as never)).toBe(false);
  });
});
