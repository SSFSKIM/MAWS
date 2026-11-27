import { describe, expect, it, vi } from 'vitest';
import type { SheetLine } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, reconcile, type SentAct, type SheetMemory } from '../../../src/renderer/src/sheet';
import { settle, startSend } from '../../../src/renderer/src/sheet/memory';
import { CLASH, NOTICES, SEASON, sheetOf } from '../../../src/renderer/src/sheet/test-support/questions';
import { CREDENTIAL_KEY } from './credential';
import { madeElsewhere, onMemory, readMemory, sendingSince, sweepMemory, updateMemory, writeMemory, writeReconciled } from './memory';
import { testStorage } from './test-support/storage';

const S = '5eed0000-0000-4000-8000-0000000000aa';
const OTHER = '5eed0000-0000-4000-8000-0000000000bb';
const DAY = 24 * 60 * 60 * 1000;
const draft = (text: string, picks: string[] = []): QuestionDraft => ({ revision: 1, picks, text, images: [] });
const withDraft = (memory: SheetMemory, id: string, value: QuestionDraft): SheetMemory => ({ ...memory, drafts: new Map(memory.drafts).set(id, value) });
const answer = (key: string, id: string, text: string): SheetLine => ({ v: 1, key, kind: 'answer', id, revision: 1, text, by: 'page' });
const act = (key: string, id: string, sent: QuestionDraft | null, state: SentAct['state'] = 'sending'): SentAct => ({ key, kind: 'answer', id, draft: sent, sentAt: 1_000, state, note: null });
// A Send pressed: its lines held under an attempt of this window, an act for each
const pressed = (memory: SheetMemory, attempt: string, lines: SheetLine[]): SheetMemory => ({
  ...memory,
  acts: [...memory.acts, ...lines.map((line) => act(line.key, line.id!, memory.drafts.get(line.id!) ?? null))],
  sending: { attempt, lines, state: 'sending', note: null },
});
const keysOf = (store: Storage) => Object.keys((store as ReturnType<typeof testStorage>).entries()).sort();

describe('the stored memory (T19): one entry a thing', () => {
  it('writes and removes exactly the entries that differ, so two memories read from one store and changed on different cards both stand, whichever is written last', () => {
    const store = testStorage();
    const first = readMemory(S, store);
    const second = readMemory(S, store);
    writeMemory(S, second, withDraft(second, 'q5', draft('second tab')), 10, store);
    writeMemory(S, first, withDraft(first, 'q4', draft('first tab')), 20, store); // its picture of q5 is older: not a difference
    const now = readMemory(S, store);
    expect(now.drafts.get('q4')).toEqual(draft('first tab'));
    expect(now.drafts.get('q5')).toEqual(draft('second tab'));
    expect(keysOf(store)).toEqual([`maws.sheet.draft.${S}.q4`, `maws.sheet.draft.${S}.q5`]);

    const read = readMemory(S, store);
    const cleared = { ...read, drafts: new Map([...read.drafts].filter(([id]) => id !== 'q4')) };
    writeMemory(S, read, cleared, 30, store);
    expect(keysOf(store)).toEqual([`maws.sheet.draft.${S}.q5`]);
  });

  it('keeps what was seen, the mark, the header and each act as an entry of its own, and reads them back', () => {
    const store = testStorage();
    const after: SheetMemory = {
      ...EMPTY_MEMORY,
      seen: new Map([['q4', 2], ['q5', 1]]),
      marked: new Set(['q4']),
      headers: new Map([['q4', 'Clash rule']]),
      acts: [act('k-0000000001', 'q5', null, 'queued')],
    };
    writeMemory(S, EMPTY_MEMORY, after, 5, store);
    expect(keysOf(store)).toEqual([`maws.sheet.act.${S}.k-0000000001`, `maws.sheet.header.${S}.q4`, `maws.sheet.seen.${S}.q4`, `maws.sheet.seen.${S}.q5`]);
    const read = readMemory(S, store);
    expect(read.seen).toEqual(after.seen);
    expect(read.marked).toEqual(after.marked);
    expect(read.headers).toEqual(after.headers);
    expect(read.acts).toEqual(after.acts);
    expect(readMemory(OTHER, store)).toEqual(EMPTY_MEMORY); // another session's entries are its own
  });

  it('skips an entry that does not parse, and reads nothing but its own prefix', () => {
    const store = testStorage({ [`maws.sheet.draft.${S}.q4`]: '{not json', [`maws.sheet.draft.${S}.q5`]: JSON.stringify({ v: 2, touchedAt: 1, draft: draft('x') }), [CREDENTIAL_KEY]: '{}' });
    expect(readMemory(S, store)).toEqual(EMPTY_MEMORY);
  });

  it('restores a sent draft’s identity on read, so a reload with an answer queued, then a model that shows it, retires the draft', () => {
    const store = testStorage();
    const typed = draft('Keep the earlier sailing');
    const before = withDraft(EMPTY_MEMORY, 'q4', typed);
    writeMemory(S, EMPTY_MEMORY, before, 1, store);
    const sent = pressed(before, 'w-1', [answer('page-000000000000000000000000001', 'q4', typed.text)]);
    writeMemory(S, before, sent, 2, store);
    writeMemory(S, sent, { ...sent, sending: null }, 3, store); // the door answered: queued

    const reloaded = readMemory(S, store); // a new window
    expect(reloaded.acts[0]!.draft).toBe(reloaded.drafts.get('q4'));
    const model = sheetOf([CLASH], { sent: [{ key: 'page-000000000000000000000000001', state: 'queued', kind: 'answer', id: 'q4' }] });
    expect(reconcile(reloaded, model).drafts.has('q4')).toBe(false);
  });

  it('leaves a Send’s entry alone through any write but its own end, keys and all', () => {
    const store = testStorage();
    const lines = [answer('page-000000000000000000000000001', 'q4', 'a'), answer('page-000000000000000000000000002', 'q5', 'b')];
    const typed = withDraft(withDraft(EMPTY_MEMORY, 'q4', draft('a')), 'q5', draft('b'));
    writeMemory(S, EMPTY_MEMORY, typed, 1, store);
    const stale = readMemory(S, store); // a second tab's picture, from before the press
    const sent = pressed(readMemory(S, store), 'w-1', lines);
    writeMemory(S, readMemory(S, store), sent, 2, store);
    const sendKey = keysOf(store).find((key) => key.startsWith(`maws.sheet.send.${S}.`))!;
    const stored = store.getItem(sendKey);

    writeMemory(S, stale, withDraft(stale, 'q6', draft('later')), 3, store); // the other tab's own change
    expect(store.getItem(sendKey)).toBe(stored);
    expect(readMemory(S, store).sending?.lines).toEqual(lines);

    const now = readMemory(S, store);
    writeMemory(S, now, { ...now, sending: null }, 4, store); // its end
    expect(keysOf(store).some((key) => key.startsWith(`maws.sheet.send.${S}.`))).toBe(false);
  });

  it('names a Send of another window (or of this one before a reload) by an attempt no window makes, and says since when it is held', async () => {
    const store = testStorage();
    const lines = [answer('page-000000000000000000000000001', 'q4', 'a')];
    writeMemory(S, EMPTY_MEMORY, pressed(EMPTY_MEMORY, 'w-1', lines), 1_000, store);
    const here = readMemory(S, store);
    expect(here.sending?.attempt).toBe('w-1'); // this window made it
    expect(madeElsewhere(here)).toBe(false);
    expect(sendingSince(S, store)).toBe(1_000);

    vi.resetModules();
    const window2 = await import('./memory'); // another window: the same entries, read by one that made none of them
    const elsewhere = testStorage(store.entries());
    const there = window2.readMemory(S, elsewhere);
    expect(window2.madeElsewhere(there)).toBe(true);
    expect(there.sending?.lines).toEqual(lines);
    expect(window2.readMemory(S, elsewhere).sending?.attempt).toBe(there.sending?.attempt); // the same name at every read

    // sent again there, under the same keys: the same entry, held since the press
    const again = { ...there, sending: { attempt: 'w2-1', lines: there.sending!.lines, state: 'sending' as const, note: null } };
    window2.writeMemory(S, there, again, 50_000, elsewhere);
    expect(Object.keys(elsewhere.entries()).filter((key) => key.startsWith('maws.sheet.send.'))).toHaveLength(1);
    expect(window2.sendingSince(S, elsewhere)).toBe(50_000);
    expect(window2.readMemory(S, elsewhere).sending?.attempt).toBe('w2-1');
  });

  it('shows the oldest of several stored Sends, and the next when it ends', () => {
    const store = testStorage();
    const first = [answer('page-000000000000000000000000001', 'q4', 'a')];
    const second = [answer('page-000000000000000000000000002', 'q5', 'b')];
    writeMemory(S, EMPTY_MEMORY, pressed(EMPTY_MEMORY, 'w-2', second), 2_000, store);
    writeMemory(S, EMPTY_MEMORY, pressed(EMPTY_MEMORY, 'w-1', first), 1_000, store);
    const read = readMemory(S, store);
    expect(read.sending?.lines).toEqual(first);
    writeMemory(S, read, { ...read, sending: null }, 3_000, store);
    expect(readMemory(S, store).sending?.lines).toEqual(second);
  });

  it('a Send sent again from another window is that window’s: the first window reads it as another’s, and its own late answer settles nothing', async () => {
    const store = testStorage();
    const lines = [answer('page-000000000000000000000000001', 'q4', 'a')];
    const target = new EventTarget();
    updateMemory(S, (current) => pressed(current, 'wa-1', lines), { storage: store, now: 1_000, target });
    updateMemory(S, (current) => settle(current, 'wa-1', { ok: false, why: 'failed', message: 'MAWS did not answer.' }), { storage: store, now: 2_000, target });
    expect(readMemory(S, store).sending).toMatchObject({ attempt: 'wa-1', state: 'failed' });

    vi.resetModules();
    const windowB = await import('./memory');
    const there = testStorage(store.entries());
    const seen = windowB.readMemory(S, there).sending!;
    expect(seen.attempt.startsWith('elsewhere:')).toBe(true);
    windowB.updateMemory(S, (current) => startSend(current, seen.lines, 3_000, 'wb-1', { drafts: current.drafts, over: seen.attempt }), { storage: there, now: 3_000, target });
    expect(windowB.readMemory(S, there).sending).toMatchObject({ attempt: 'wb-1', state: 'sending', lines });

    // back in the first window, the same store: the press is B's, not its own finished one
    const back = testStorage(there.entries());
    const heldThere = readMemory(S, back).sending!;
    expect(heldThere.attempt).not.toBe('wa-1');
    expect(madeElsewhere(readMemory(S, back))).toBe(true);
    updateMemory(S, (current) => settle(current, 'wa-1', { ok: true, at: 'queued', results: [] } as never), { storage: back, now: 4_000, target }); // A's late answer
    expect(readMemory(S, back).sending).toMatchObject({ lines, state: 'sending' });
    expect(Object.keys(back.entries()).filter((key) => key.startsWith('maws.sheet.send.'))).toHaveLength(1);
  });

  it('a press again keeps the Send’s one stored entry, its value replaced with the new press; a replacement that cannot be written leaves the old value', async () => {
    const store = testStorage();
    const target = new EventTarget();
    const lines = [answer('page-000000000000000000000000001', 'q4', 'a')];
    const sendKeys = () => Object.keys(store.entries()).filter((key) => key.startsWith('maws.sheet.send.'));
    updateMemory(S, (current) => pressed(current, 'wa-1', lines), { storage: store, now: 1_000, target });
    updateMemory(S, (current) => settle(current, 'wa-1', { ok: false, why: 'failed', message: 'MAWS did not answer.' }), { storage: store, now: 2_000, target });
    const [key] = sendKeys();
    updateMemory(S, (current) => startSend(current, lines, 3_000, 'wa-2', { drafts: current.drafts, over: 'wa-1' }), { storage: store, now: 3_000, target });
    expect(sendKeys()).toEqual([key]);
    expect(JSON.parse(store.getItem(key!)!)).toMatchObject({ press: 'wa-2', at: 3_000, state: 'sending', lines });
    expect(readMemory(S, store).sending?.attempt).toBe('wa-2');

    // from another window, under the same keys: still the one entry
    vi.resetModules();
    const windowB = await import('./memory');
    updateMemory(S, (current) => settle(current, 'wa-2', { ok: false, why: 'failed', message: 'MAWS did not answer.' }), { storage: store, now: 4_000, target });
    const seen = windowB.readMemory(S, store).sending!;
    const before = store.getItem(key!);
    store.quota = Object.entries(store.entries()).reduce((sum, [name, value]) => sum + name.length + value.length, 0); // full: no room for a longer value
    expect(() =>
      windowB.updateMemory(S, (current) => startSend(current, seen.lines, 5_000, 'wb-1-a-press-with-a-longer-name', { drafts: current.drafts, over: seen.attempt }), { storage: store, now: 5_000, target }),
    ).toThrow();
    expect(sendKeys()).toEqual([key]);
    expect(store.getItem(key!)).toBe(before); // the only record of the Send stands
    store.quota = null;
    windowB.updateMemory(S, (current) => startSend(current, seen.lines, 6_000, 'wb-1', { drafts: current.drafts, over: seen.attempt }), { storage: store, now: 6_000, target });
    expect(sendKeys()).toEqual([key]);
    expect(JSON.parse(store.getItem(key!)!)).toMatchObject({ press: 'wb-1', at: 6_000 });
  });

  it('two Sends of two windows end in the other order, each settling its own entry whichever is shown', async () => {
    const store = testStorage();
    const target = new EventTarget();
    const first = [answer('page-000000000000000000000000001', 'q4', 'a')];
    const second = [answer('page-000000000000000000000000002', 'q5', 'b')];
    updateMemory(S, (current) => pressed(current, 'wa-1', first), { storage: store, now: 1_000, target });
    vi.resetModules();
    const windowB = await import('./memory');
    // B pressed its own a moment later (it had not yet heard A's): two entries, A's shown as the older
    windowB.writeMemory(S, EMPTY_MEMORY, pressed(EMPTY_MEMORY, 'wb-1', second), 2_000, store);
    expect(windowB.readMemory(S, store).sending?.lines).toEqual(first);
    // B's answer comes first: it settles B's entry though A's is the one shown
    windowB.updateMemory(S, (current) => settle(current, 'wb-1', { ok: true } as never), { storage: store, now: 3_000, target });
    expect(windowB.readMemory(S, store).sending?.lines).toEqual(first);
    expect(Object.keys(store.entries()).filter((key) => key.startsWith('maws.sheet.send.'))).toHaveLength(1);
    // then A's
    updateMemory(S, (current) => settle(current, 'wa-1', { ok: true } as never), { storage: store, now: 4_000, target });
    expect(readMemory(S, store).sending).toBeNull();
    expect(Object.keys(store.entries()).filter((key) => key.startsWith('maws.sheet.send.'))).toHaveLength(0);
  });

  it('removes an entry only for a question the tab’s model knows: a stale tab’s reconcile leaves a newer tab’s draft (T19)', () => {
    const store = testStorage();
    const target = new EventTarget();
    const told: number[] = [];
    const off = onMemory(S, () => void told.push(1), target);
    const old = sheetOf([NOTICES]); // tab B's model, read before the new question was asked
    const knows = (id: string) => old.open.some((question) => question.id === id) || Object.hasOwn(old.closed, id);
    updateMemory(S, (current) => reconcile(current, old), { storage: store, now: 1, target, known: knows }); // B's own state
    told.length = 0;
    // tab A drafts the new card; B adopts the entry and reconciles against its older model
    writeMemory(S, readMemory(S, store), withDraft(readMemory(S, store), 'q9', draft('a new card')), 1, store);
    updateMemory(S, (current) => reconcile(current, old), { storage: store, now: 2, target, known: knows });
    expect(readMemory(S, store).drafts.get('q9')).toEqual(draft('a new card'));
    expect(told).toEqual([]); // nothing written, nobody told: the view does not reconcile again for it
    // a question the model knows was closed is still let go
    const closed = { ...old, closed: { ...old.closed, q9: { how: 'withdrawn', at: '2026-11-24T10:00:00.000Z', revision: 1, asker: 'main' } } } as typeof old;
    const knowsClosed = (id: string) => knows(id) || Object.hasOwn(closed.closed, id);
    updateMemory(S, (current) => reconcile(current, closed), { storage: store, now: 3, target, known: knowsClosed });
    expect(readMemory(S, store).drafts.has('q9')).toBe(false);
    off();
  });

  it('writes reconcile’s own changes while settled: a sent draft retired by its verdict, a stale one restored and marked, and what was first seen, all there after a reload', () => {
    const store = testStorage();
    const k1 = 'page-000000000000000000000000001';
    const k2 = 'page-000000000000000000000000002';
    const typed = withDraft(withDraft(EMPTY_MEMORY, 'q4', draft('as the clash rule says')), 'q5', draft('the season notice'));
    writeMemory(S, EMPTY_MEMORY, typed, 1, store);
    const read = readMemory(S, store); // the stored acts' drafts are the drafts themselves (identity restored on read)
    const sent = { ...read, acts: [act(k1, 'q4', read.drafts.get('q4')!), act(k2, 'q5', read.drafts.get('q5')!)] };
    writeMemory(S, read, sent, 2, store);
    const at = '2026-11-24T10:00:00.000Z';
    const model = sheetOf([CLASH, NOTICES], {
      sent: [
        { key: k1, state: 'accepted', verdict: 'applied', kind: 'answer', at, id: 'q4' },
        { key: k2, state: 'stale', verdict: 'stale', kind: 'answer', at, id: 'q5', current: 2 },
      ],
    } as never);
    const snapshot = readMemory(S, store);
    expect(writeReconciled(S, snapshot, reconcile(snapshot, model), true, { storage: store, now: 3, target: new EventTarget() })).toEqual({ conflict: false });
    const reloaded = readMemory(S, store);
    expect(reloaded.drafts.has('q4')).toBe(false); // answered: the draft that was sent is no longer the person's to send
    expect(reloaded.drafts.get('q5')?.text).toBe('the season notice'); // stale: back on its card
    expect([...reloaded.marked]).toEqual(['q5']); // and the card says so (answer-stale)
    expect(reloaded.acts.find((entry) => entry.key === k2)?.state).toBe('stale');
    expect([...reloaded.seen.keys()].sort()).toEqual(['q4', 'q5']); // what was first seen: an "Updated" mark measures from it
    expect(reconcile(reloaded, model)).toBe(reloaded); // nothing of it left to write
  });

  it('writes none of reconcile’s changes while a write of another tab is adopted and the read after it has not been applied', async () => {
    const storage = testStorage();
    const reads: Array<(model: ReturnType<typeof sheetOf>) => Promise<void>> = [];
    const { createStore } = await import('./store');
    const sheets = createStore({ read: () => new Promise((done) => void reads.push(async (model) => done({ ok: true, model, door: { known: true, available: true } }))) });
    const model = sheetOf([CLASH], { session: S } as never);
    sheets.show(S);
    await reads[0]!(model);
    await Promise.resolve();
    sheets.adopted(S); // another tab wrote; its write is in storage, the model is not yet read again
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q4', draft('from the other tab')), 1, storage);
    const snapshot = readMemory(S, storage);
    writeReconciled(S, snapshot, reconcile(snapshot, model), sheets.state().shown!.settled, { storage, now: 2, target: new EventTarget() });
    expect(readMemory(S, storage).seen.size).toBe(0); // shown, but not written
    await reads[1]!(model);
    await Promise.resolve();
    expect(sheets.state().shown!.settled).toBe(true);
    const later = readMemory(S, storage);
    writeReconciled(S, later, reconcile(later, model), sheets.state().shown!.settled, { storage, now: 3, target: new EventTarget() });
    expect([...readMemory(S, storage).seen.keys()]).toEqual(['q4']);
    expect(readMemory(S, storage).drafts.get('q4')?.text).toBe('from the other tab');
  });

  it('writes reconcile’s changes from the memory the view was made from, each entry only where storage still holds it: another tab’s write not yet adopted is left, and said', () => {
    const store = testStorage();
    const target = new EventTarget();
    writeMemory(S, EMPTY_MEMORY, { ...EMPTY_MEMORY, headers: new Map([['q5', 'Notices']]), seen: new Map([['q5', 1]]) }, 1, store);
    const snapshot = readMemory(S, store); // what tab B's view is made from
    const modelB = sheetOf([{ ...NOTICES, revision: 2, header: 'Printed notices' }], { hidden: [{ id: 'q4', key: 'page-000000000000000000000000009' }] } as never); // q4 still hidden
    // tab A, meanwhile, took the dismissal back and drafted q4; B has not adopted it
    writeMemory(S, readMemory(S, store), withDraft(readMemory(S, store), 'q4', draft('reopened')), 2, store);
    const view = reconcile(snapshot, modelB);
    expect(writeReconciled(S, snapshot, view, true, { storage: store, now: 3, target })).toEqual({ conflict: false });
    expect(readMemory(S, store).drafts.get('q4')).toEqual(draft('reopened')); // not B's to prune: it was never in B's view
    expect(readMemory(S, store).headers.get('q5')).toBe('Printed notices');
    expect([...readMemory(S, store).marked]).toEqual(['q5']);

    // an entry another tab changed since the snapshot: left as it is, and the conflict said, so the tab reads again
    const again = readMemory(S, store);
    const revised = sheetOf([CLASH, { ...NOTICES, revision: 3, header: 'Notices for the season' }]); // read after B adopted q4's draft: q4 open again
    writeMemory(S, readMemory(S, store), { ...readMemory(S, store), headers: new Map([['q5', 'Harbour notices']]) }, 4, store); // A's newer header
    expect(writeReconciled(S, again, reconcile(again, revised), true, { storage: store, now: 5, target })).toEqual({ conflict: true });
    expect(readMemory(S, store).headers.get('q5')).toBe('Harbour notices');
    expect(readMemory(S, store).drafts.get('q4')).toEqual(draft('reopened'));

    // one storage already holds as the view has it is no conflict
    const same = readMemory(S, store);
    const sameView = { ...same, headers: new Map([['q5', 'Harbour notices']]) };
    expect(writeReconciled(S, { ...same, headers: new Map([['q5', 'Notices']]) }, sameView, true, { storage: store, now: 6, target })).toEqual({ conflict: false });
  });

  it('lands an update in its own session’s entries, read from the store as it is when applied', () => {
    const store = testStorage();
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q4', draft('there already')), 1, store);
    const seen: string[] = [];
    const target = new EventTarget();
    const off = onMemory(S, () => void seen.push(S), target);
    const offOther = onMemory(OTHER, () => void seen.push(OTHER), target);
    // as a Send's late answer lands after the sheet that made it unmounted: the update is the session's, not the view's
    updateMemory(S, (current) => withDraft(current, 'q5', draft('late')), { storage: store, now: 2, target });
    expect([...readMemory(S, store).drafts.keys()].sort()).toEqual(['q4', 'q5']);
    expect(readMemory(OTHER, store)).toEqual(EMPTY_MEMORY);
    expect(seen).toEqual([S]);
    updateMemory(S, (current) => current, { storage: store, now: 3, target }); // no change: nothing written, nobody told
    expect(seen).toEqual([S]);
    off();
    offOther();
  });

  it('hears another tab’s write of its session through the storage event, and nobody else’s', () => {
    const store = testStorage();
    const target = new EventTarget();
    const heard: string[] = [];
    const off = onMemory(S, () => void heard.push('heard'), target);
    const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key, storageArea: store });
    target.dispatchEvent(storageEvent(`maws.sheet.draft.${OTHER}.q4`));
    target.dispatchEvent(storageEvent(CREDENTIAL_KEY));
    target.dispatchEvent(storageEvent(`maws.sheet.seen.${S}.q4`));
    target.dispatchEvent(storageEvent(null)); // a clear
    expect(heard).toEqual(['heard', 'heard']);
    off();
  });

  it('sweeps every entry of the memory untouched for 30 days, and nothing else', () => {
    const store = testStorage({ [CREDENTIAL_KEY]: JSON.stringify({ v: 1, id: '0a1b2c3d', credential: 'A'.repeat(43) }), 'maws.sheet.outline': JSON.stringify({ v: 1, open: true }) });
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q4', draft('old')), 0, store);
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q5', draft('new')), 20 * DAY, store);
    sweepMemory(30 * DAY + 1, store);
    expect(keysOf(store)).toEqual([CREDENTIAL_KEY, `maws.sheet.draft.${S}.q5`, 'maws.sheet.outline']);
  });

  it('makes room in a full store by dropping the entries touched longest ago, and never a Send’s or the pairing', () => {
    const store = testStorage({ [CREDENTIAL_KEY]: JSON.stringify({ v: 1, id: '0a1b2c3d', credential: 'A'.repeat(43) }) });
    const lines = [answer('page-000000000000000000000000001', 'q4', 'x'.repeat(200))];
    writeMemory(S, EMPTY_MEMORY, pressed(EMPTY_MEMORY, 'w-1', lines), 0, store); // the oldest entry of all
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q5', draft('y'.repeat(200))), 1, store);
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q6', draft('z'.repeat(200))), 2, store);
    store.quota = Object.entries(store.entries()).reduce((sum, [key, value]) => sum + key.length + value.length, 0) + 50;
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q7', draft('w'.repeat(200))), 3, store);
    const kept = keysOf(store);
    expect(kept).toContain(CREDENTIAL_KEY);
    expect(kept.some((key) => key.startsWith(`maws.sheet.send.${S}.`))).toBe(true);
    expect(kept).toContain(`maws.sheet.draft.${S}.q7`);
    expect(kept).not.toContain(`maws.sheet.draft.${S}.q5`); // touched longest ago, a Send's aside
  });

  it('reads the drafts of the questions it holds whatever else is stored for them', () => {
    const store = testStorage();
    const memory = withDraft(withDraft(EMPTY_MEMORY, NOTICES.id, draft('', ['Tidal restrictions'])), SEASON.id, draft('21 March'));
    writeMemory(S, EMPTY_MEMORY, memory, 1, store);
    expect(readMemory(S, store).drafts).toEqual(memory.drafts);
  });
});
