import { describe, expect, it, vi } from 'vitest';
import type { SheetLine } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, reconcile, type SentAct, type SheetMemory } from '../../../src/renderer/src/sheet';
import { CLASH, NOTICES, SEASON, sheetOf } from '../../../src/renderer/src/sheet/test-support/questions';
import { CREDENTIAL_KEY } from './credential';
import { madeElsewhere, onMemory, readMemory, sendingSince, sweepMemory, updateMemory, writeMemory } from './memory';
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

  it('lands an update in its own session’s entries, read from the store as it is when applied', () => {
    const store = testStorage();
    writeMemory(S, EMPTY_MEMORY, withDraft(EMPTY_MEMORY, 'q4', draft('there already')), 1, store);
    const seen: string[] = [];
    const target = new EventTarget();
    const off = onMemory(S, () => void seen.push(S), target);
    const offOther = onMemory(OTHER, () => void seen.push(OTHER), target);
    // as a Send's late answer lands after the sheet that made it unmounted: the update is the session's, not the view's
    updateMemory(S, (current) => withDraft(current, 'q5', draft('late')), store, 2, target);
    expect([...readMemory(S, store).drafts.keys()].sort()).toEqual(['q4', 'q5']);
    expect(readMemory(OTHER, store)).toEqual(EMPTY_MEMORY);
    expect(seen).toEqual([S]);
    updateMemory(S, (current) => current, store, 3, target); // no change: nothing written, nobody told
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
