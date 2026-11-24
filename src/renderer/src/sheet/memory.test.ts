// The surface's memory meeting a new model (S13 to S15; the C3 plan's §G, `reconcile`), and the acts that change it.
import { describe, expect, it } from 'vitest';
import type { SheetModel, SheetQuestion } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, attach, closeNote, editDraft, reconcile, settle, startSend, type SheetMemory } from './memory';
import { pinModel } from './test-support/pin';
import { CLASH, CLASH_REVISED, sheetOf } from './test-support/questions';

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

  const line = { v: 1 as const, key: 'maws-k-0001', kind: 'answer' as const, id: 'q1', revision: 2, picks: ['OAuth'], by: 'maws' as const };
  const lines = [line];

  it('holds the exact lines of a Send from the press until the door answers, under its attempt, and records an act per line', () => {
    const typed = draft(2, { picks: ['OAuth'] });
    const held = startSend(withDrafts([['q1', typed]]), lines, 5, 'attempt-1', { drafts: new Map([['q1', typed]]) });
    expect(held.sending).toEqual({ attempt: 'attempt-1', lines, state: 'sending', note: null });
    expect(held.acts).toEqual([{ key: 'maws-k-0001', kind: 'answer', id: 'q1', draft: typed, sentAt: 5, state: 'sending', note: null }]);

    const failed = settle(held, 'attempt-1', { ok: false, why: 'failed', message: 'timed out' });
    expect(failed.sending).toEqual({ attempt: 'attempt-1', lines, state: 'failed', note: 'timed out' });
    expect(failed.drafts.get('q1')).toBe(typed);
    expect(failed.acts[0].state).toBe('failed');
    expect(settle(failed, 'attempt-1', { ok: true, results: [] })).toBe(failed); // settled once: a failed hold waits for Send again

    const again = startSend(failed, failed.sending!.lines, 9, 'attempt-2', { drafts: failed.drafts });
    expect(again.acts).toHaveLength(1);
    expect(again.acts[0]).toMatchObject({ key: 'maws-k-0001', state: 'sending', sentAt: 9 });

    const done = settle(again, 'attempt-2', { ok: true, results: [{ key: 'maws-k-0001', state: 'queued' }] });
    expect(done.sending).toBeNull();
    expect(done.drafts.get('q1')).toBe(typed); // until the model knows the act
  });

  it('settles only the attempt it answers: a late answer of an earlier attempt changes nothing', () => {
    const typed = draft(2, { picks: ['OAuth'] });
    const held = startSend(withDrafts([['q1', typed]]), lines, 0, 'attempt-2', { drafts: new Map([['q1', typed]]) });
    expect(settle(held, 'attempt-1', { ok: true, results: [] })).toBe(held);
    expect(settle(held, 'attempt-1', { ok: false, why: 'failed', message: 'late' })).toBe(held);
    expect(settle(EMPTY_MEMORY, 'attempt-1', { ok: true, results: [] })).toBe(EMPTY_MEMORY);
  });

  it.each(['refused', 'no-sheet', 'unavailable'] as const)('releases a Send the door answered %s, keeps every draft and says why', (why) => {
    const typed = draft(2, { picks: ['OAuth'] });
    const released = settle(startSend(withDrafts([['q1', typed]]), lines, 0, 'attempt-1', { drafts: new Map([['q1', typed]]) }), 'attempt-1', { ok: false, why, message: 'The door said no.' });
    expect(released.sending).toBeNull();
    expect(released.drafts.get('q1')).toBe(typed);
    expect(released.acts.map((act) => [act.state, act.note])).toEqual([['failed', 'Not sent: The door said no.']]);
  });

  it("names the question of every act of a Send, a retract's by the answer it travels with or the key it targets", () => {
    const edit = [
      { v: 1 as const, key: 'maws-k-0002', kind: 'retract' as const, target: 'page-1601a001', by: 'maws' as const },
      { v: 1 as const, key: 'maws-k-0003', kind: 'answer' as const, id: 'q1', revision: 1, picks: ['B'], by: 'maws' as const },
    ];
    expect(startSend(EMPTY_MEMORY, edit, 0, 'a', { drafts: new Map() }).acts.map((act) => [act.kind, act.id])).toEqual([['retract', 'q1'], ['answer', 'q1']]);
    const takeBack = [{ v: 1 as const, key: 'maws-k-0004', kind: 'retract' as const, target: 'page-1601d002', by: 'maws' as const }];
    expect(startSend(EMPTY_MEMORY, takeBack, 0, 'b', { drafts: new Map(), targets: { 'page-1601d002': 'q2' } }).acts[0]).toMatchObject({ kind: 'retract', id: 'q2', draft: null });
  });
});

describe("the hidden line's header", () => {
  it('is kept from the card the surface drew, while its question is listed or hidden, and dropped after', () => {
    const drawn = reconcile(EMPTY_MEMORY, sheetOf([CLASH]));
    expect(drawn.headers.get('q4')).toBe('Clash rule');
    const hidden = reconcile(drawn, sheetOf([], { hidden: [{ id: 'q4', key: 'maws-k-0009' }] }));
    expect(hidden.headers.get('q4')).toBe('Clash rule');
    expect(reconcile(hidden, sheetOf([])).headers.has('q4')).toBe(false);
  });

  it('is forgotten when a revision of its question has no header', () => {
    const drawn = reconcile(EMPTY_MEMORY, sheetOf([CLASH]));
    expect(reconcile(drawn, sheetOf([{ ...CLASH_REVISED, header: undefined }])).headers.has('q4')).toBe(false);
  });
});

describe('a late image', () => {
  const path = 'uploads/maws-late.png';

  it('joins the draft as it is now, at the revision it was typed against, without confirming it', () => {
    const carried = draft(1, { text: 'typed against revision 1' });
    const next = attach(withDrafts([['q4', carried]], { marked: new Set(['q4']) }), CLASH_REVISED, path);
    expect(next.drafts.get('q4')).toEqual({ ...carried, images: [path] });
    expect(next.marked.has('q4')).toBe(true);
  });

  it('starts a draft of its own when the card has none, and never holds more than eight', () => {
    expect(attach(EMPTY_MEMORY, CLASH, path).drafts.get('q4')).toEqual(draft(1, { images: [path] }));
    const full = draft(1, { text: 'x', images: Array.from({ length: 8 }, (_, i) => `uploads/maws-${i}.png`) });
    const memory = withDrafts([['q4', full]]);
    expect(attach(memory, CLASH, path)).toBe(memory);
  });

  it('waits in a draft of its own when the draft it was pasted into was already sent, and joins it again if that comes back', () => {
    const sent = draft(1, { text: 'sent words' });
    const held = startSend(withDrafts([['q4', sent]]), [{ v: 1, key: 'maws-k-0005', kind: 'answer', id: 'q4', revision: 1, text: 'sent words', by: 'maws' }], 0, 'a', { drafts: new Map([['q4', sent]]) });
    const late = attach(held, CLASH, path);
    expect(late.drafts.get('q4')).toEqual(draft(1, { images: [path] }));
    expect(late.acts[0].draft).toBe(sent);
    const refused = settle(late, 'a', { ok: false, why: 'refused', message: 'no' });
    expect(refused.drafts.get('q4')).toEqual({ ...sent, images: [path] });
  });

  it('stays a draft when it landed between the Send drawn and the Send applied, and the answer is then queued', () => {
    const typed = draft(1, { text: 'Earlier.' });
    const seen = withDrafts([['q4', typed]]); // the memory Send was drawn from
    const line = { v: 1 as const, key: 'maws-k-0007', kind: 'answer' as const, id: 'q4', revision: 1, text: 'Earlier.', by: 'maws' as const };
    const landed = attach(seen, CLASH, path); // the image's update, applied first
    const held = startSend(landed, [line], 0, 'a', { drafts: seen.drafts });
    expect(held.acts[0].draft).toBe(typed);
    const sent = settle(held, 'a', { ok: true, results: [{ key: line.key, state: 'queued' }] });
    const queued = reconcile(sent, sheetOf([CLASH], { sent: [{ key: line.key, state: 'queued', kind: 'answer', id: 'q4' }] }));
    expect(queued.drafts.get('q4')).toEqual({ ...typed, images: [path] });
  });

  it('joins the draft itself once the door released the Send that carried it', () => {
    const kept = draft(1, { text: 'kept words' });
    const held = startSend(withDrafts([['q4', kept]]), [{ v: 1, key: 'maws-k-0006', kind: 'answer', id: 'q4', revision: 1, text: 'kept words', by: 'maws' }], 0, 'a', { drafts: new Map([['q4', kept]]) });
    const released = settle(held, 'a', { ok: false, why: 'no-sheet', message: 'no' });
    expect(attach(released, CLASH, path).drafts.get('q4')).toEqual({ ...kept, images: [path] });
  });
});
