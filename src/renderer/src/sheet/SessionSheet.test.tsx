// One session's sheet (the composite's §8, "The sheet", and §4.3; the C3 plan's §G and M3's proofs): G1.b's card states
// from the pin and a memory, and the Send: its count, one call of the host with exactly the confirmed drafts' lines, the
// same lines again after a failure or a lost answer, and nothing for a draft the person has not confirmed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { forgetAttempts } from './attempts';
import type { SheetModel, SheetPutResult, SheetQuestion } from '@shared/sheet/model';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, type SheetMemory } from './memory';
import { SessionSheet, type SessionSheetProps } from './SessionSheet';
import { fixtureHost, type RecordingHost } from './test-support/fixture-host';
import { pinModel } from './test-support/pin';
import { CLASH, CLASH_REVISED, FIXTURE, NOTICES, SEASON, sheetOf } from './test-support/questions';

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
    forgetAttempts(); // the window that made the call is gone: a reload
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

// A host whose answers the test gives, one call at a time.
function heldHost() {
  const calls: { lines: string[]; answer(result: SheetPutResult): Promise<void> }[] = [];
  const host = fixtureHost({ send: (_session, lines) => new Promise((resolve) => calls.push({ lines: lines.map((line) => line.key), answer: (result) => act(async () => resolve(result)) })) });
  return { host, calls };
}
const OK: SheetPutResult = { ok: true, results: [] };

describe('shared memory', () => {
  // One memory shown by two mounts at once, as the side sheet and an Overview card show one session's.
  function Two({ model, host, both }: { model: SheetModel; host: RecordingHost; both: boolean }) {
    const [memory, setMemory] = useState(EMPTY_MEMORY);
    useEffect(() => {
      kept = memory;
    });
    return (
      <>
        {both && (
          <div data-mount="first">
            <SessionSheet model={model} memory={memory} onMemory={setMemory} host={host} />
          </div>
        )}
        <div data-mount="second">
          <SessionSheet model={model} memory={memory} onMemory={setMemory} host={host} density="compact" />
        </div>
      </>
    );
  }

  it("does not take a live sibling's Send for a lost one, and settles it in the mount still shown", async () => {
    const { host, calls } = heldHost();
    const view = render(<Two model={sheetOf([SEASON])} host={host} both />);
    const first = document.querySelector<HTMLElement>('[data-mount="first"]')!;
    fireEvent.change(within(first).getByRole('textbox'), { target: { value: 'From 1 November.' } });
    fireEvent.click(within(first).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(kept.sending?.state).toBe('sending'));
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    view.rerender(<Two model={sheetOf([SEASON])} host={host} both={false} />);
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    await calls[0].answer(OK);
    await waitFor(() => expect(kept.sending).toBeNull());
    expect(host.sent).toHaveLength(1);
  });

  it('lets a late answer of an earlier attempt change nothing after a newer Send', async () => {
    const { host, calls } = heldHost();
    const first = sheet(sheetOf([CLASH, SEASON]), { host });
    typeIn('q4', 'Earlier.');
    fireEvent.click(send());
    await waitFor(() => expect(calls).toHaveLength(1));
    const memory = kept;
    first.unmount();
    forgetAttempts(); // a reload: the first call's answer will come to no one
    sheet(sheetOf([CLASH, SEASON]), { host, memory });
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await calls[1].answer(OK);
    await waitFor(() => expect(kept.sending).toBeNull());
    typeIn('q6', 'From 1 November.');
    fireEvent.click(send());
    await waitFor(() => expect(calls).toHaveLength(3));
    const held = kept.sending;
    await calls[0].answer({ ok: false, why: 'failed', message: 'late' }); // the first attempt's answer, at last
    expect(kept.sending).toBe(held);
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    await calls[2].answer({ ok: false, why: 'busy', message: 'The record is busy.' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy());
  });

  it('releases a Send the door refused: every draft kept, its reason as a note, and a new Send possible', async () => {
    const { host, calls } = heldHost();
    sheet(sheetOf([CLASH]), { host });
    typeIn('q4', 'Earlier.');
    fireEvent.click(send());
    await waitFor(() => expect(calls).toHaveLength(1));
    await calls[0].answer({ ok: false, why: 'no-sheet', message: 'The session has no sheet.' });
    await waitFor(() => expect(kept.sending).toBeNull());
    expect(screen.getByText('Not sent: The session has no sheet.')).toBeTruthy();
    expect((within(cardOf('q4')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Earlier.');
    expect(send().textContent).toBe('Send 1 answer');
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
  });
});

describe('the hidden line', () => {
  it("reads its question's header when the surface drew the card, and the bare id when it did not", async () => {
    const { redraw } = sheet(sheetOf([CLASH]));
    redraw(sheetOf([], { hidden: [{ id: 'q4', key: 'maws-k-0009' }] }));
    await waitFor(() => expect(document.querySelector('[data-sheet-hidden="q4"]')?.textContent).toMatch(/^q4Clash rule→Dismissed/));
    cleanup();
    sheet(sheetOf([], { hidden: [{ id: 'q4', key: 'maws-k-0009' }] }));
    expect(document.querySelector('[data-sheet-hidden="q4"]')?.textContent).toMatch(/^q4→Dismissed/);
  });
});

describe('a focus request', () => {
  it('waits for its question to be in the model, and is used once', async () => {
    const { rerender, host } = sheet(sheetOf([CLASH]), { focus: { id: 'q5', request: 1 } });
    rerender(<Consumer model={sheetOf([CLASH, NOTICES])} initial={EMPTY_MEMORY} host={host} focus={{ id: 'q5', request: 1 }} />);
    await waitFor(() => expect(document.activeElement?.getAttribute('data-sheet-question')).toBe('q5'));
    (document.activeElement as HTMLElement).blur();
    rerender(<Consumer model={sheetOf([CLASH, NOTICES, SEASON])} initial={EMPTY_MEMORY} host={host} focus={{ id: 'q5', request: 1 }} />);
    await act(async () => {});
    expect(document.activeElement?.getAttribute('data-sheet-question')).toBeNull();
  });
});

describe('a late image', () => {
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  function slowSaves() {
    const saves: ((path: string) => Promise<void>)[] = [];
    const host = fixtureHost({ saveImage: true });
    host.saveImage = () => new Promise((resolve) => saves.push((path) => act(async () => resolve({ ok: true, path }))));
    return { host, saves };
  }
  const paste = (id: string) => fireEvent.paste(within(cardOf(id)).getByRole('textbox'), { clipboardData: { files: [image], types: ['Files'] } });

  it('joins the draft as it is after a rewrite, still carried at the revision it was typed against', async () => {
    const { host, saves } = slowSaves();
    const { redraw } = sheet(sheetOf([CLASH]), { host });
    typeIn('q4', 'Earlier.');
    paste('q4');
    await waitFor(() => expect(saves).toHaveLength(1));
    redraw(sheetOf([CLASH_REVISED]));
    await waitFor(() => expect(within(cardOf('q4')).getByText('Updated')).toBeTruthy());
    await saves[0]('uploads/maws-late.png');
    await waitFor(() => expect(kept.drafts.get('q4')).toEqual(draft(1, { text: 'Earlier.', images: ['uploads/maws-late.png'] })));
    expect(within(cardOf('q4')).getByText('You wrote this before the question changed.')).toBeTruthy();
    expect(send().textContent).toBe('Send');
  });

  it('waits beside an answer already sent, in a draft of its own that counts for nothing', async () => {
    const { host, saves } = slowSaves();
    const { calls, host: sender } = heldHost();
    host.send = sender.send;
    sheet(sheetOf([CLASH]), { host });
    typeIn('q4', 'Earlier.');
    paste('q4');
    await waitFor(() => expect(saves).toHaveLength(1));
    fireEvent.click(send());
    await waitFor(() => expect(calls).toHaveLength(1));
    await saves[0]('uploads/maws-late.png');
    await waitFor(() => expect(kept.drafts.get('q4')).toEqual(draft(1, { images: ['uploads/maws-late.png'] })));
    expect(calls[0].lines).toHaveLength(1);
    expect(kept.acts[0].draft).toEqual(draft(1, { text: 'Earlier.' }));
  });

  it('says on the card when the image could not be saved', async () => {
    const host = fixtureHost({ saveImage: true });
    host.saveImage = () => Promise.reject(new Error('disk full'));
    sheet(sheetOf([CLASH]), { host });
    paste('q4');
    await waitFor(() => expect(within(cardOf('q4')).getByText('The image could not be saved.')).toBeTruthy());
  });
});

describe('what Send may take', () => {
  const queued = { key: 'cli-1901a001', kind: 'answer' as const, picks: ['Keep the earlier sailing'], text: '', images: [], revision: 1, by: 'cli' as const };

  it('keeps a draft another surface answered over in view, out of the count, until the person chooses', async () => {
    const { host } = sheet(sheetOf([{ ...CLASH, queued }, SEASON]), { memory: { ...EMPTY_MEMORY, drafts: new Map([['q4', draft(1, { text: 'Mine.' })]]) } });
    expect(within(cardOf('q4')).getByText('Another answer was queued here while you wrote yours.')).toBeTruthy();
    expect((within(cardOf('q4')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Mine.');
    expect(send().textContent).toBe('Send');
    fireEvent.click(within(cardOf('q4')).getByRole('button', { name: 'Keep mine' }));
    expect(send().textContent).toBe('Send 1 answer');
    fireEvent.click(send());
    await waitFor(() => expect(host.sent).toHaveLength(1));
    expect(host.sent[0].lines.map((line) => [line.kind, line.target ?? line.id])).toEqual([['retract', 'cli-1901a001'], ['answer', 'q4']]);
    expect(kept.acts.map((act) => [act.kind, act.id])).toEqual([['retract', 'q4'], ['answer', 'q4']]);
  });

  it('holds an edit whose queued answer is gone the same way, and drops it when the person discards it', () => {
    sheet(sheetOf([CLASH]), { memory: { ...EMPTY_MEMORY, drafts: new Map([['q4', { ...draft(1, { text: 'Mine.' }), replaces: 'cli-1901a001' }]]) } });
    expect(within(cardOf('q4')).getByText('The queued answer you were editing is no longer there.')).toBeTruthy();
    expect(send().textContent).toBe('Send');
    fireEvent.click(within(cardOf('q4')).getByRole('button', { name: 'Discard mine' }));
    expect(kept.drafts.has('q4')).toBe(false);
  });

  it('keeps a text past 20,000 characters editable, marked on its card, and out of the count', () => {
    sheet(sheetOf([CLASH, FIXTURE]));
    typeIn('q7', 'Yes.');
    typeIn('q4', 'x'.repeat(20001));
    expect(within(cardOf('q4')).getByText('An answer holds at most 20,000 characters.')).toBeTruthy();
    expect(within(cardOf('q4')).getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
    expect(send().textContent).toBe('Send 1 answer');
  });
});
