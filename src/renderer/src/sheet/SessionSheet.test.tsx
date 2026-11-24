// One session's sheet (the composite's §8, "The sheet", and §4.3; the C3 plan's §G and M3's proofs): G1.b's card states
// from the pin and a memory, and the Send: its count, one call of the host with exactly the confirmed drafts' lines, the
// same lines again after a failure or a lost answer, and nothing for a draft the person has not confirmed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SheetModel, SheetPutResult, SheetQuestion } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, type SheetMemory } from './memory';
import { SessionSheet, type SessionSheetProps } from './SessionSheet';
import { fixtureHost, type RecordingHost } from './test-support/fixture-host';
import { pinModel } from './test-support/pin';
import { CLASH, CLASH_REVISED, NOTICES, SEASON, sheetOf } from './test-support/questions';

afterEach(cleanup);
const draft = (revision: number, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({ revision, picks: [], text: '', images: [], ...extra });

// A consumer: keeps the memory per session, as a store does, and shows the latest to the test.
let kept: SheetMemory = EMPTY_MEMORY;
function Consumer({ initial, ...props }: Omit<SessionSheetProps, 'memory' | 'onMemory'> & { initial: SheetMemory }) {
  const [memory, setMemory] = useState(initial);
  useEffect(() => {
    kept = memory;
  });
  return <SessionSheet {...props} memory={memory} onMemory={setMemory} />;
}
function sheet(model: SheetModel, { host = fixtureHost(), memory = EMPTY_MEMORY, ...rest }: Partial<Omit<SessionSheetProps, 'host' | 'memory'>> & { host?: RecordingHost; memory?: SheetMemory } = {}) {
  const view = render(<Consumer model={model} initial={memory} host={host} {...rest} />);
  const redraw = (next: SheetModel) => view.rerender(<Consumer model={next} initial={memory} host={host} {...rest} />);
  return { ...view, host, redraw };
}
const cardOf = (id: string) => document.querySelector<HTMLElement>(`[data-sheet-question="${id}"]`)!;
const ids = () => [...document.querySelectorAll('[data-sheet-question]')].map((card) => card.getAttribute('data-sheet-question'));
const send = () => screen.getByRole('button', { name: /^Send/ });
const typeIn = (id: string, text: string) => fireEvent.change(within(cardOf(id)).getByRole('textbox'), { target: { value: text } });
const pin = (name: string, side: 'before' | 'after') => pinModel(name, side)!;

describe('the card states (G1.b)', () => {
  it('open: answer-applied, before', () => {
    sheet(pin('answer-applied', 'before'));
    expect(ids()).toEqual(['q1', 'q2']);
    expect(within(cardOf('q2')).getAllByRole('radio').length).toBeGreaterThan(0);
    expect(within(cardOf('q2')).queryByText('Updated')).toBeNull();
  });

  it('updated since seen: the card reads "Updated" and the draft typed against the earlier wording stands', () => {
    sheet(pin('answer-stale', 'after'), { memory: { ...EMPTY_MEMORY, seen: new Map([['q1', 1]]), drafts: new Map([['q1', draft(1, { text: 'Shuttle times matter.' })]]) } });
    expect(within(cardOf('q1')).getByText('Updated')).toBeTruthy();
    expect((within(cardOf('q1')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Shuttle times matter.');
    expect(send().textContent).toBe('Send'); // carried: not counted
  });

  it('queued: stopped-queue, before, with its take back; the dismissal it hides, and the accepted outcome', () => {
    sheet(pin('stopped-queue', 'before'));
    expect(within(cardOf('q1')).getByText('Queued. The session is stopped and gets this when it resumes.')).toBeTruthy();
    expect(within(cardOf('q1')).getByRole('button', { name: 'Take back' })).toBeTruthy();
    const hidden = document.querySelector<HTMLElement>('[data-sheet-hidden="q2"]')!;
    expect(hidden.textContent).toContain('Dismissed');
    expect(hidden.textContent).toContain('queued');
    expect(document.querySelector('[data-sheet-outcome="q4"]')?.textContent).toContain('Accepted. Not delivered yet.');
  });

  it('accepted: answer-applied, after', () => {
    sheet(pin('answer-applied', 'after'));
    expect(ids()).toEqual(['q2']);
    const outcome = document.querySelector<HTMLElement>('[data-sheet-outcome="q1"]')!;
    expect(outcome.textContent).toContain('Accepted. Not delivered yet.');
  });

  it('refused as stale: the card is marked and the draft is back', async () => {
    const sent = draft(1, { picks: ['OAuth'], text: 'Shuttle times matter.' });
    sheet(pin('answer-stale', 'after'), { memory: { ...EMPTY_MEMORY, seen: new Map([['q1', 2]]), acts: [{ key: 'page-0301a001', kind: 'answer', id: 'q1', draft: sent, sentAt: 0, state: 'sending', note: null }] } });
    await waitFor(() => expect(within(cardOf('q1')).getByText('The question changed before your answer arrived. Your draft is kept.')).toBeTruthy());
    expect(within(cardOf('q1')).getByText('Updated')).toBeTruthy();
    expect((within(cardOf('q1')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Shuttle times matter.');
  });
});

describe('Send', () => {
  it('is labelled with the count of questions with a draft answer, and sends exactly those, once, at the revision shown', async () => {
    const { host } = sheet(sheetOf([CLASH, NOTICES, SEASON]));
    expect(send().textContent).toBe('Send');
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    typeIn('q4', 'Earlier.');
    expect(send().textContent).toBe('Send 1 answer');
    typeIn('q6', 'From 1 November.');
    expect(send().textContent).toBe('Send 2 answers');
    fireEvent.click(send());
    await waitFor(() => expect(kept.sending).toBeNull());
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0].lines.map((line) => [line.kind, line.id, line.revision, line.text])).toEqual([
      ['answer', 'q4', 1, 'Earlier.'],
      ['answer', 'q6', 1, 'From 1 November.'],
    ]);
    expect(host.sent[0].lines.every((line) => line.by === 'maws')).toBe(true);
  });

  it('keeps every draft after a failed Send and sends the same lines again, keys and all', async () => {
    let answer: SheetPutResult = { ok: false, why: 'failed', message: 'The door timed out.' };
    const host = fixtureHost({ send: () => Promise.resolve(answer) });
    sheet(sheetOf([CLASH, SEASON]), { host });
    typeIn('q4', 'Earlier.');
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy());
    expect((within(cardOf('q4')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Earlier.');
    answer = { ok: true, results: [] };
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(kept.sending).toBeNull());
    expect(host.sent).toHaveLength(2);
    expect(host.sent[1].lines).toEqual(host.sent[0].lines);
  });

  it('sends a Send whose answer never came again, as the same lines', async () => {
    const host: RecordingHost = fixtureHost({ send: () => new Promise(() => {}) });
    const first = sheet(sheetOf([CLASH]), { host });
    typeIn('q4', 'Earlier.');
    fireEvent.click(send());
    await waitFor(() => expect(kept.sending?.state).toBe('sending'));
    const memory = kept;
    first.unmount();
    sheet(sheetOf([CLASH]), { host, memory });
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    expect(host.sent).toHaveLength(2);
    expect(host.sent[1].lines).toEqual(host.sent[0].lines);
  });

  it('leaves out a question rewritten while the person edits another card, until its draft is kept', async () => {
    const { host, redraw } = sheet(sheetOf([CLASH, NOTICES]));
    fireEvent.click(within(cardOf('q4')).getByRole('radio', { name: /Keep the longer route/ }));
    fireEvent.click(within(cardOf('q5')).getByRole('checkbox', { name: /Tidal restrictions/ }));
    expect(send().textContent).toBe('Send 2 answers');
    redraw(sheetOf([CLASH_REVISED, NOTICES]));
    await waitFor(() => expect(within(cardOf('q4')).getByText('Updated')).toBeTruthy());
    expect(within(cardOf('q4')).getByText('You wrote this before the question changed.')).toBeTruthy();
    expect(send().textContent).toBe('Send 1 answer');
    fireEvent.click(within(cardOf('q4')).getByRole('button', { name: 'Keep my answer' }));
    expect(within(cardOf('q4')).queryByText('Updated')).toBeNull();
    expect(send().textContent).toBe('Send 2 answers');
    fireEvent.click(send());
    await waitFor(() => expect(host.sent).toHaveLength(1));
    expect(host.sent[0].lines.map((line) => [line.id, line.revision, line.picks])).toEqual([
      ['q4', 2, ['Keep the longer route']],
      ['q5', 1, ['Tidal restrictions']],
    ]);
  });

  it('sends nothing for a carried draft', async () => {
    const { host, redraw } = sheet(sheetOf([CLASH, NOTICES]));
    typeIn('q4', 'Earlier.');
    typeIn('q5', 'All four.');
    redraw(sheetOf([CLASH_REVISED, NOTICES]));
    await waitFor(() => expect(send().textContent).toBe('Send 1 answer'));
    fireEvent.click(send());
    await waitFor(() => expect(host.sent).toHaveLength(1));
    expect(host.sent[0].lines.map((line) => line.id)).toEqual(['q5']);
  });

  it('sends an edit of a queued answer as a retract of its key and then the answer, in one call (stopped-queue)', async () => {
    const { host } = sheet(pin('stopped-queue', 'before'));
    fireEvent.click(within(cardOf('q1')).getByRole('button', { name: 'Edit' }));
    typeIn('q1', 'On second thought.');
    fireEvent.click(send());
    await waitFor(() => expect(host.sent).toHaveLength(1));
    expect(host.sent[0].lines.map((line) => [line.kind, line.target ?? line.id])).toEqual([
      ['retract', 'page-1601a001'],
      ['answer', 'q1'],
    ]);
  });

  it('sends at most fifty inbox lines; the label is the count sent and the rest stay drafts', async () => {
    const many: SheetQuestion[] = Array.from({ length: 52 }, (_, i) => ({ ...SEASON, id: `q${i + 1}`, handle: `q${i + 1}`, references: [], context: undefined }));
    const drafts = new Map(many.map((question) => [question.id, draft(1, { text: `answer ${question.id}` })]));
    const { host } = sheet(sheetOf(many), { memory: { ...EMPTY_MEMORY, drafts } });
    expect(send().textContent).toBe('Send 50 answers');
    expect(screen.getByText('2 more after this')).toBeTruthy();
    fireEvent.click(send());
    await waitFor(() => expect(kept.sending).toBeNull());
    expect(host.sent).toHaveLength(1);
    expect(host.sent[0].lines).toHaveLength(50);
    expect([...kept.drafts.keys()].slice(-2)).toEqual(['q51', 'q52']);
  });

  it('sends a dismissal as one line, and a take back as a retract of the queued key', async () => {
    const { host } = sheet(pin('stopped-queue', 'before'));
    fireEvent.click(within(cardOf('q3')).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(kept.sending).toBeNull());
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-sheet-hidden="q2"]')!).getByRole('button', { name: 'Take back' }));
    await waitFor(() => expect(host.sent).toHaveLength(2));
    expect(host.sent.map((call) => call.lines.map((line) => [line.kind, line.id ?? line.target]))).toEqual([[['dismiss', 'q3']], [['retract', 'page-1601d002']]]);
  });

  it('draws the reason in place of Send when the surface cannot send', () => {
    sheet(sheetOf([CLASH]), { unavailable: 'Answers cannot be sent from here: sminos was not found on this Mac.' });
    expect(screen.queryByRole('button', { name: /^Send/ })).toBeNull();
    expect(screen.getByText('Answers cannot be sent from here: sminos was not found on this Mac.')).toBeTruthy();
  });
});

describe('the sheet', () => {
  it('says an answer that came second at its head until the person closes the note (two-surfaces)', async () => {
    sheet(pin('two-surfaces', 'after'), { memory: { ...EMPTY_MEMORY, acts: [{ key: 'cli-0401b002', kind: 'answer', id: 'q1', draft: null, sentAt: 0, state: 'sending', note: null }] } });
    await waitFor(() => expect(screen.getByText('q1 was already answered')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('q1 was already answered')).toBeNull();
  });

  it('says it has no open questions when it has none', () => {
    sheet(pin('empty', 'after') ?? sheetOf([]));
    expect(screen.getByText('No open questions')).toBeTruthy();
  });

  it('brings the asked question into view and puts the keyboard on it, at each ask', async () => {
    const { rerender, host } = sheet(sheetOf([CLASH, NOTICES, SEASON]), { focus: { id: 'q5', request: 1 } });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5'));
    rerender(<Consumer model={sheetOf([CLASH, NOTICES, SEASON])} initial={EMPTY_MEMORY} host={host} focus={{ id: 'q6', request: 2 }} />);
    await waitFor(() => expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q6'));
  });

  it('folds each question to its line in compact form, with one Send, and opens the asked one', async () => {
    sheet(sheetOf([CLASH, NOTICES]), { density: 'compact', focus: { id: 'q5', request: 1 } });
    expect(screen.getAllByRole('button', { name: /^Send/ })).toHaveLength(1);
    await waitFor(() => expect(within(cardOf('q5')).getAllByRole('checkbox')).toHaveLength(4));
    expect(within(cardOf('q4')).queryByRole('radio')).toBeNull();
  });

  it('takes nothing while a Send is held', async () => {
    let release: (result: SheetPutResult) => void = () => {};
    const host = fixtureHost({ send: () => new Promise((resolve) => (release = resolve)) });
    sheet(sheetOf([CLASH, SEASON]), { host });
    typeIn('q4', 'Earlier.');
    fireEvent.click(send());
    await waitFor(() => expect((within(cardOf('q6')).getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true));
    await act(async () => release({ ok: true, results: [] }));
    expect((within(cardOf('q6')).getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
