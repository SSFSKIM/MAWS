// The window's store of the machine's question sheets (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md
// §F, M2): the summaries, connected in lane A's order (subscribe, list, then what raced the list), and the models of the
// sessions something shows, each read applied only when no later read of that session was.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { hostStatus } from '../test-support/host-status';
import { EMPTY_MEMORY } from '../sheet/memory';
import { connectSheets, resetSheetStore, selectSheetHeld, selectSheetMemory, selectSheetModel, selectSheetSession, updateSheetMemory, useSheets, watchSheet } from './sheet';

const A = '5eed0000-0000-4000-8000-0000000000a1';
const B = '5eed0000-0000-4000-8000-0000000000b2';
const APP = at('app-a') as AppSessionId;
const summary = (session: string, extra: Partial<SheetSummary> = {}): SheetSummary => ({
  session, appSessionId: null, title: null, live: null, seq: 1, open: 1, queued: 0, pending: 0, hidden: 0, oldestAskedAt: '2026-11-23T09:59:00.000Z', unreadable: false, ...extra,
});
const model = (session: string, seq: number): SheetModel => ({ v: 1, session, seq, open: [], hidden: [], sent: [], pending: [], closed: {} });
const KNOWN = { known: true, available: true } as const;

beforeEach(() => resetSheetStore());

describe('connectSheets', () => {
  it('subscribes before it lists, and applies a change that raced the list after it', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    expect(fake.calls.slice(0, 3)).toEqual(['on sheet.changed', 'on host.status', 'invoke sheet.list']);
    fake.event('sheet.changed', { session: A, summary: summary(A, { seq: 2, queued: 1 }) }); // a record changed while the list was out
    fake.event('sheet.changed', { session: B, summary: summary(B) }); // and one appeared
    await fake.reply('sheet.list', { sessions: [summary(A)], door: { known: false } });
    expect(useSheets.getState().summaries.get(A)).toMatchObject({ seq: 2, queued: 1 }); // the change that raced it wins
    expect(useSheets.getState().summaries.has(B)).toBe(true);
    expect(useSheets.getState().door).toEqual({ known: false });
    fake.event('sheet.changed', { session: B, summary: null });
    expect(useSheets.getState().summaries.has(B)).toBe(false);
    off();
  });

  it('lists again when the machine’s host is heard after a refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    await fake.fail('sheet.list', 'machine is restarting', 'host_unavailable');
    expect(useSheets.getState().summaries.size).toBe(0);
    fake.event('host.status', hostStatus());
    await fake.reply('sheet.list', { sessions: [summary(A)], door: { known: false } });
    expect(useSheets.getState().summaries.has(A)).toBe(true);
    off();
    warn.mockRestore();
  });

  it('lists again at every new connection to the machine’s host, so a record that went while it was down goes, and reads every watched session again', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    await fake.reply('sheet.list', { sessions: [summary(A), summary(B)], door: { known: false } });
    const unwatch = watchSheet(A);
    await fake.reply('sheet.read', { model: model(A, 1), door: KNOWN });
    fake.event('host.status', hostStatus(), OTHER_MACHINE); // another machine's host: not this store's
    expect(fake.invoked('sheet.list')).toHaveLength(1);
    fake.event('host.status', hostStatus()); // mawsd restarted; B's record was removed while it was down
    expect(fake.invoked('sheet.list')).toHaveLength(2);
    fake.event('sheet.changed', { session: A, summary: summary(A, { seq: 3 }) }); // raced the list: held, applied after it
    await fake.reply('sheet.read', { model: model(A, 3), door: KNOWN }); // the change's own read
    await fake.reply('sheet.list', { sessions: [summary(A, { seq: 2 })], door: KNOWN });
    expect([...useSheets.getState().summaries.keys()]).toEqual([A]);
    expect(useSheets.getState().summaries.get(A)?.seq).toBe(3);
    expect(fake.invoked('sheet.read')).toHaveLength(3); // and the watched session is read again after the list
    await fake.reply('sheet.read', { model: model(A, 3), door: KNOWN });
    expect(selectSheetModel(useSheets.getState(), A)?.seq).toBe(3);
    unwatch();
    off();
  });

  it('lists once more when the host is heard while a list is out, whose answer may be older than the host’s return', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    fake.event('host.status', hostStatus());
    fake.event('host.status', hostStatus());
    expect(fake.invoked('sheet.list')).toHaveLength(1);
    await fake.reply('sheet.list', { sessions: [summary(A)], door: { known: false } });
    expect(fake.invoked('sheet.list')).toHaveLength(2);
    await fake.reply('sheet.list', { sessions: [], door: { known: false } });
    expect(useSheets.getState().summaries.size).toBe(0);
    expect(fake.invoked('sheet.list')).toHaveLength(2);
    off();
    fake.event('host.status', hostStatus()); // disconnected: no list
    expect(fake.invoked('sheet.list')).toHaveLength(2);
  });

  it('finds an app session’s record by its summary', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    await fake.reply('sheet.list', { sessions: [summary(A, { appSessionId: APP })], door: { known: false } });
    expect(selectSheetSession(useSheets.getState(), APP)).toBe(A);
    expect(selectSheetSession(useSheets.getState(), at('app-b') as AppSessionId)).toBeNull();
    off();
  });
});

describe('watchSheet', () => {
  it('reads a model when a session is first watched and at each change of it while watched, and forgets it at the last unwatch', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    await fake.reply('sheet.list', { sessions: [summary(A)], door: { known: false } });
    const first = watchSheet(A);
    const second = watchSheet(A); // counted: one read
    expect(fake.invoked('sheet.read')).toEqual([{ session: A }]);
    await fake.reply('sheet.read', { model: model(A, 1), door: KNOWN });
    expect(selectSheetModel(useSheets.getState(), A)).toEqual(model(A, 1));
    expect(useSheets.getState().door).toEqual(KNOWN);
    fake.event('sheet.changed', { session: A, summary: summary(A, { seq: 2 }) });
    fake.event('sheet.changed', { session: B, summary: summary(B) }); // not watched: no read
    expect(fake.invoked('sheet.read')).toHaveLength(2);
    await fake.reply('sheet.read', { model: model(A, 2), door: KNOWN });
    expect(selectSheetModel(useSheets.getState(), A)?.seq).toBe(2);
    first();
    expect(selectSheetModel(useSheets.getState(), A)).not.toBeNull();
    second();
    expect(selectSheetModel(useSheets.getState(), A)).toBeNull();
    fake.event('sheet.changed', { session: A, summary: summary(A, { seq: 3 }) });
    expect(fake.invoked('sheet.read')).toHaveLength(2);
    off();
  });

  it('takes the door’s move from the read an unchanged summary’s announcement starts', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    await fake.reply('sheet.list', { sessions: [summary(A)], door: { known: false } });
    const unwatch = watchSheet(A);
    await fake.reply('sheet.read', { model: model(A, 1), door: { known: false } });
    fake.event('sheet.changed', { session: A, summary: summary(A) }); // the service's probe ended: the record as it was
    expect(useSheets.getState().summaries.get(A)).toEqual(summary(A));
    await fake.reply('sheet.read', { model: model(A, 1), door: { known: true, available: false, reason: 'No sminos is installed.' } });
    expect(useSheets.getState().door).toEqual({ known: true, available: false, reason: 'No sminos is installed.' });
    unwatch();
    off();
  });

  it('keeps the later read’s model when two reads of one session finish in the other order', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    const unwatch = watchSheet(A);
    fake.event('sheet.changed', { session: A, summary: summary(A, { seq: 2 }) });
    expect(fake.pending('sheet.read')).toBe(2);
    await fake.reply('sheet.read', { model: model(A, 2), door: KNOWN }, 1); // the later read lands first
    await fake.reply('sheet.read', { model: model(A, 1), door: KNOWN }); // then the earlier one
    expect(selectSheetModel(useSheets.getState(), A)?.seq).toBe(2);
    unwatch();
    off();
  });

  it('drops the model of a record that went', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    const unwatch = watchSheet(A);
    await fake.reply('sheet.read', { model: model(A, 1), door: KNOWN });
    fake.event('sheet.changed', { session: A, summary: null });
    await fake.reply('sheet.read', { model: null, door: KNOWN });
    expect(selectSheetModel(useSheets.getState(), A)).toBeNull();
    unwatch();
    off();
  });
});

// M4 (§F, §G): each session's memory of its sheet, the components' through `onMemory`'s updates, which apply to the
// memory as it stands at that moment; dropped with the session's record.
describe('the memory', () => {
  const draft = { revision: 1, picks: ['Earlier'], text: '', images: [] };

  it('is empty for a session it never saw, and holds an update applied to the memory as it stands', () => {
    expect(selectSheetMemory(useSheets.getState(), A)).toBe(EMPTY_MEMORY);
    updateSheetMemory(A, (current) => ({ ...current, drafts: new Map([['q1', draft]]) }));
    updateSheetMemory(A, (current) => ({ ...current, seen: new Map([['q1', 1]]) })); // a second update keeps the first's draft
    const memory = selectSheetMemory(useSheets.getState(), A);
    expect(memory.drafts.get('q1')).toEqual(draft);
    expect(memory.seen.get('q1')).toBe(1);
    expect(selectSheetMemory(useSheets.getState(), B)).toBe(EMPTY_MEMORY);
  });

  it('leaves the store as it was for an update that changes nothing', () => {
    const before = useSheets.getState();
    updateSheetMemory(A, (current) => current);
    expect(useSheets.getState()).toBe(before);
  });

  it('is dropped when the session’s record goes, and kept while it changes', async () => {
    const fake = fakeClient();
    const off = connectSheets(fake.client);
    await fake.reply('sheet.list', { sessions: [summary(A)], door: { known: false } });
    updateSheetMemory(A, (current) => ({ ...current, drafts: new Map([['q1', draft]]) }));
    fake.event('sheet.changed', { session: A, summary: summary(A, { seq: 2 }) });
    expect(selectSheetMemory(useSheets.getState(), A).drafts.size).toBe(1);
    fake.event('sheet.changed', { session: A, summary: null });
    expect(selectSheetMemory(useSheets.getState(), A)).toBe(EMPTY_MEMORY);
    off();
  });
});

// M4's review: what keeps a compact sheet in place once none of its questions waits
describe('a sheet that holds what the person did', () => {
  const appSessionId = at('app-held' as AppSessionId);
  const held = (extra: Partial<SheetSummary>, memory = EMPTY_MEMORY, holds: 'acted' | 'unsettled' = 'acted') => {
    useSheets.setState({ summaries: new Map([[A, summary(A, { appSessionId, open: 0, ...extra })]]), memories: new Map([[A, memory]]) });
    return selectSheetHeld(useSheets.getState(), appSessionId, holds);
  };
  const act = (state: 'sending' | 'queued' | 'accepted' | 'delivered' | 'closed', note: string | null) => ({ key: 'maws-1', kind: 'answer' as const, id: 'q1', draft: null, sentAt: 0, state, note });

  it('holds a queued answer, a queued dismissal, a Send in flight, an act sending, one accepted not yet delivered and one with a note; nothing else', () => {
    expect(held({ queued: 1 })).toBe(true);
    expect(held({ hidden: 1 })).toBe(true);
    expect(held({}, { ...EMPTY_MEMORY, sending: { attempt: 'a1', lines: [], state: 'sending', note: null } })).toBe(true);
    expect(held({}, { ...EMPTY_MEMORY, acts: [act('sending', null)] })).toBe(true);
    expect(held({}, { ...EMPTY_MEMORY, acts: [act('closed', 'q1 was already answered')] })).toBe(true);
    expect(held({}, { ...EMPTY_MEMORY, acts: [act('accepted', null)] }), 'its outcome pending, not delivered').toBe(true);
    expect(held({}, { ...EMPTY_MEMORY, acts: [act('queued', null)] })).toBe(false);
    expect(held({ open: 2 })).toBe(false); // waiting questions are attention's, not this
    expect(selectSheetHeld(useSheets.getState(), at('app-none' as AppSessionId)), 'a session with no record').toBe(false);
  });

  // The composite's writer (2026-11-27): the channel's "Waiting on you" says what waits on the person, so there only a
  // Send still in the air or one whose note waits holds the card
  it('holds, for the channel, only a Send in flight, an act sending and one with a note', () => {
    const unsettled = (extra: Partial<SheetSummary>, memory = EMPTY_MEMORY) => held(extra, memory, 'unsettled');
    expect(unsettled({}, { ...EMPTY_MEMORY, sending: { attempt: 'a1', lines: [], state: 'failed', note: null } }), 'a Send that failed, held').toBe(true);
    expect(unsettled({}, { ...EMPTY_MEMORY, acts: [act('sending', null)] })).toBe(true);
    expect(unsettled({}, { ...EMPTY_MEMORY, acts: [act('closed', 'q1 was already answered')] })).toBe(true);
    expect(unsettled({ queued: 1 }), 'a queued answer').toBe(false);
    expect(unsettled({ hidden: 1 }), 'a queued dismissal').toBe(false);
    expect(unsettled({ pending: 1 }, { ...EMPTY_MEMORY, acts: [act('accepted', null)] }), 'accepted, not yet delivered').toBe(false);
    expect(unsettled({ queued: 1 }, { ...EMPTY_MEMORY, acts: [act('queued', null)] })).toBe(false);
  });
});
