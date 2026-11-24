// The surface's memory meeting a new model (S13 to S15; the C3 plan's §G, `reconcile`), and the acts that change it.
import { describe, expect, it } from 'vitest';
import type { SheetModel, SheetQuestion } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, closeNote, editDraft, reconcile, sendAnswered, startSend, type SheetMemory } from './memory';
import { pinModel } from './test-support/pin';

const model = (name: string, side: 'before' | 'after'): SheetModel => pinModel(name, side)!;
const question = (m: SheetModel, id: string): SheetQuestion => m.open.find((q) => q.id === id)!;
const draft = (revision: number, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({ revision, picks: [], text: '', images: [], ...extra });
const withDrafts = (entries: [string, QuestionDraft][], rest: Partial<SheetMemory> = {}): SheetMemory => ({ ...EMPTY_MEMORY, drafts: new Map(entries), ...rest });

describe('reconcile', () => {
  it('records the revision of a question the first time it is listed, and marks nothing', () => {
    const next = reconcile(EMPTY_MEMORY, model('answer-stale', 'after'));
    expect(next.seen.get('q1')).toBe(2);
    expect(next.marked.size).toBe(0);
  });

  it('marks a question whose revision passed the one seen, and leaves its draft at the revision it was typed against', () => {
    const typed = draft(1, { text: 'Shuttle times matter.' });
    const next = reconcile(withDrafts([['q1', typed]], { seen: new Map([['q1', 1]]) }), model('answer-stale', 'after'));
    expect(next.marked.has('q1')).toBe(true);
    expect(next.drafts.get('q1')).toEqual(typed);
    expect(next.seen.get('q1')).toBe(1);
  });

  it('answers the same memory when nothing changed, so a consumer can call it on every model', () => {
    const once = reconcile(EMPTY_MEMORY, model('answer-applied', 'before'));
    expect(reconcile(once, model('answer-applied', 'before'))).toBe(once);
  });

  it("drops the draft, the seen revision and the mark of a question the model no longer lists (closed-withdrawn)", () => {
    const m = model('closed-withdrawn', 'after');
    const memory = withDrafts([['q1', draft(1, { text: 'kept' })], ['q2', draft(1, { text: 'gone' })]], { seen: new Map([['q1', 1], ['q2', 1]]), marked: new Set(['q2']) });
    const next = reconcile(memory, m);
    expect([...next.drafts.keys()]).toEqual(['q1']);
    expect([...next.seen.keys()]).toEqual(['q1']);
    expect(next.marked.size).toBe(0);
  });

  it("reads each act's state from the model's `sent` by its key, never from the act", () => {
    const memory: SheetMemory = { ...EMPTY_MEMORY, acts: [{ key: 'page-0201a001', kind: 'answer', id: 'q1', draft: draft(1, { picks: ['OAuth'] }), sentAt: 0, state: 'sending', note: null }] };
    expect(reconcile(memory, model('answer-applied', 'before')).acts[0].state).toBe('queued');
    expect(reconcile(memory, model('answer-applied', 'after')).acts[0].state).toBe('accepted');
  });

  it('drops the draft an act carried once the model knows the act, and keeps one the person typed since', () => {
    const sent = draft(1, { picks: ['OAuth'] });
    const act = { key: 'page-0201a001', kind: 'answer' as const, id: 'q1', draft: sent, sentAt: 0, state: 'sending' as const, note: null };
    expect(reconcile(withDrafts([['q1', sent]], { acts: [act] }), model('answer-applied', 'before')).drafts.has('q1')).toBe(false);
    const typed = draft(1, { text: 'new words' });
    expect(reconcile(withDrafts([['q1', typed]], { acts: [act] }), model('answer-applied', 'before')).drafts.get('q1')).toBe(typed);
  });

  it('restores the draft of an act refused as stale, at the revision it was sent against, and marks its question; once', () => {
    const sent = draft(1, { picks: ['OAuth'], text: 'Shuttle times matter.' });
    const memory: SheetMemory = { ...EMPTY_MEMORY, seen: new Map([['q1', 2]]), acts: [{ key: 'page-0301a001', kind: 'answer', id: 'q1', draft: sent, sentAt: 0, state: 'sending', note: null }] };
    const next = reconcile(memory, model('answer-stale', 'after'));
    expect(next.drafts.get('q1')).toEqual(sent);
    expect(next.marked.has('q1')).toBe(true);
    expect(next.acts[0].state).toBe('stale');
    const edited = editDraft(next, question(model('answer-stale', 'after'), 'q1'), draft(2, { picks: ['Passkeys'] }));
    expect(reconcile(edited, model('answer-stale', 'after')).drafts.get('q1')).toEqual(draft(2, { picks: ['Passkeys'] }));
  });

  it('keeps an act that came second, with its note, until the person closes it (two-surfaces)', () => {
    const memory: SheetMemory = { ...EMPTY_MEMORY, acts: [{ key: 'cli-0401b002', kind: 'answer', id: 'q1', draft: draft(1, { picks: ['OAuth'] }), sentAt: 0, state: 'sending', note: null }] };
    const next = reconcile(memory, model('two-surfaces', 'after'));
    expect(next.acts).toMatchObject([{ key: 'cli-0401b002', state: 'closed', note: 'q1 was already answered' }]);
    expect(reconcile(next, model('two-surfaces', 'after'))).toBe(next);
    expect(closeNote(next, 'cli-0401b002').acts).toEqual([]);
  });

  it('says a withdrawn question in its note, and forgets an act once it reads delivered or retracted', () => {
    const acts = [
      { key: 'page-0501a002', kind: 'dismiss' as const, id: 'q2', draft: null, sentAt: 0, state: 'sending' as const, note: null },
      { key: 'page-0701a001', kind: 'answer' as const, id: 'q1', draft: null, sentAt: 0, state: 'queued' as const, note: null },
    ];
    expect(reconcile({ ...EMPTY_MEMORY, acts }, model('closed-withdrawn', 'after')).acts.map((act) => act.note)).toEqual(['q2 was withdrawn', null]);
    expect(reconcile({ ...EMPTY_MEMORY, acts }, model('retract-queued', 'after')).acts.map((act) => act.key)).toEqual(['page-0501a002']);
  });
});

describe('the acts', () => {
  const m = model('answer-stale', 'after');
  const q1 = question(m, 'q1');

  it("editing a card confirms what the person sees: its revision is seen, its mark and a stale act's mark clear", () => {
    const memory: SheetMemory = { ...EMPTY_MEMORY, seen: new Map([['q1', 1]]), marked: new Set(['q1']), acts: [{ key: 'page-0301a001', kind: 'answer', id: 'q1', draft: null, sentAt: 0, state: 'stale', note: null }] };
    const next = editDraft(memory, q1, draft(2, { text: 'x' }));
    expect(next.seen.get('q1')).toBe(2);
    expect(next.marked.has('q1')).toBe(false);
    expect(next.acts).toEqual([]);
    expect(editDraft(next, q1, null).drafts.has('q1')).toBe(false);
  });

  it('holds the exact lines of a Send from the press until the door answers, and records an act per line', () => {
    const lines = [{ v: 1 as const, key: 'maws-k-0001', kind: 'answer' as const, id: 'q1', revision: 2, picks: ['OAuth'], by: 'maws' as const }];
    const typed = draft(2, { picks: ['OAuth'] });
    const held = startSend(withDrafts([['q1', typed]]), lines, 5);
    expect(held.sending).toEqual({ lines, state: 'sending', note: null });
    expect(held.acts).toEqual([{ key: 'maws-k-0001', kind: 'answer', id: 'q1', draft: typed, sentAt: 5, state: 'sending', note: null }]);

    const failed = sendAnswered(held, lines, { ok: false, why: 'failed', message: 'timed out' });
    expect(failed.sending).toEqual({ lines, state: 'failed', note: 'timed out' });
    expect(failed.drafts.get('q1')).toBe(typed);
    expect(failed.acts[0].state).toBe('failed');

    const again = startSend(failed, failed.sending!.lines, 9);
    expect(again.acts).toHaveLength(1);
    expect(again.acts[0]).toMatchObject({ key: 'maws-k-0001', state: 'sending', sentAt: 9 });

    const done = sendAnswered(again, lines, { ok: true, results: [{ key: 'maws-k-0001', state: 'queued' }] });
    expect(done.sending).toBeNull();
    expect(done.drafts.get('q1')).toBe(typed); // until the model knows the act
  });

  it("names a retract's question, so a note can say which answer could not be taken back", () => {
    const lines = [{ v: 1 as const, key: 'maws-k-0002', kind: 'retract' as const, target: 'page-1601a001', by: 'maws' as const }];
    expect(startSend(EMPTY_MEMORY, lines, 0, { 'page-1601a001': 'q1' }).acts[0]).toMatchObject({ kind: 'retract', id: 'q1', draft: null });
  });
});
