// The question sheet's row as drawn (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §I; the composite's
// §8.1; the look's frame 3 and frame 2's row line): a head line saying what the call did, whose chevron folds the lines;
// a line per entry, its id, header, sentence and Open, or its receipt; over the row's own model the store's, for what the
// transcript does not hold yet. Rows are written in the model's shapes; every question and word is invented.
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { SheetModel, SheetQuestion, SheetSummary } from '@shared/sheet/model';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { at } from '../../../../../../test/support/machine';
import { resetSheetStore, useSheets } from '../../../stores/sheet';
import type { Row, SheetRowLine } from '../../model/rows';
import { NO_ACTIONS } from '../context';
import { renderRow, spyActions } from './test-support';

type SheetRowData = Extract<Row, { kind: 'sheet' }>;
const APP = at('app-sheet' as AppSessionId);
const SESSION = '5eed0000-0000-4000-8000-0000000000aa';

const line = (id: string | null, header: string | null, sentence: string, over: Partial<SheetRowLine> = {}): SheetRowLine => ({ id, entry: 1, header, sentence, revises: false, place: 'here', outcome: null, ...over });
const row = (lines: SheetRowLine[], over: Partial<SheetRowData> = {}): SheetRowData => ({
  id: 'sheet:toolu_sheet' as never, turnId: null, at: '2026-11-23T09:00:00.000Z', kind: 'sheet', toolUseId: 'toolu_sheet' as ToolUseId, state: 'done', lines, withdrew: [], notDone: null, error: null, ...over,
});
const THREE = [line('q4', 'Clash rule', 'Which one should the import keep?'), line('q5', 'Notices', 'Which notices should the printed sheet carry?', { entry: 2 }), line('q6', 'Season dates', 'What are the first and last days of the winter season?', { entry: 3 })];

const question = (id: string, over: Partial<SheetQuestion> = {}): SheetQuestion => ({
  id, revision: 1, asker: 'main', question: `Question ${id}?`, options: [{ label: 'Keep the earlier sailing' }, { label: 'Keep the longer route' }], multiSelect: false, references: [], askedAt: '2026-11-23T09:00:00.000Z', callId: 'toolu_sheet', handle: id, ...over,
});
const model = (over: Partial<SheetModel> = {}): SheetModel => ({ v: 1, session: SESSION, seq: 1, open: [], hidden: [], sent: [], pending: [], closed: {}, ...over });
const summary: SheetSummary = { session: SESSION, appSessionId: APP, title: null, live: true, seq: 1, open: 0, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false };
const withRecord = (m: SheetModel) => useSheets.setState({ summaries: new Map([[SESSION, summary]]), models: new Map([[SESSION, m]]) });

const draw = (data: SheetRowData, options: Parameters<typeof renderRow>[1] = {}) => renderRow(data, { storeKey: APP, ...options });
const lineTexts = () => [...document.querySelectorAll<HTMLElement>('[data-sheet-line]')].map((el) => [...el.children].map((cell) => cell.textContent).filter((text) => text !== '').join(' | '));
const head = () => document.querySelector<HTMLElement>('[data-sheet-call] .transcript-run-line')!;

beforeEach(resetSheetStore);
afterEach(cleanup);

describe('a sheet call’s row', () => {
  it('reads its head line and one line per question at rest, the head’s chevron folding them', () => {
    draw(row(THREE));
    expect(head().textContent).toBe('Asked 3 questions');
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(lineTexts()).toEqual([
      'q4 | Clash rule | Which one should the import keep?',
      'q5 | Notices | Which notices should the printed sheet carry?',
      'q6 | Season dates | What are the first and last days of the winter season?',
    ]);
    fireEvent.click(head());
    expect(head().getAttribute('aria-expanded')).toBe('false');
  });

  it('Open shows the side sheet at the line’s question, only where the host has a side column and the record lists it open', () => {
    withRecord(model({ open: [question('q4'), question('q5')] }));
    const { actions } = draw(row(THREE));
    expect(screen.getAllByRole('button', { name: /^Open q/ }).map((button) => button.getAttribute('aria-label'))).toEqual(['Open q4', 'Open q5']);
    fireEvent.click(screen.getByRole('button', { name: 'Open q5' }));
    expect(actions.openSheet).toHaveBeenCalledWith(APP, 'q5');
    cleanup();
    draw(row(THREE), { actions: { ...spyActions(), openSheet: NO_ACTIONS.openSheet } }); // desk-web's rows: no side column
    expect(screen.queryAllByRole('button', { name: /^Open q/ })).toEqual([]);
    cleanup();
    resetSheetStore();
    draw(row(THREE)); // no record: the transcript's lines alone, no Open
    expect(screen.queryAllByRole('button', { name: /^Open q/ })).toEqual([]);
  });

  it('reads each receipt in the receipt’s shape: an answer, a dismissal, a withdrawal; a moved line reads revised below', () => {
    draw(row([
      line('q4', 'Clash rule', 'Which one?', { outcome: { how: 'answered', receipt: 'Keep the earlier sailing' } }),
      line('q5', 'Notices', 'Which notices?', { entry: 2, place: 'revised_below' }),
      line('q6', 'Season dates', 'Which days?', { entry: 3, outcome: { how: 'withdrawn' } }),
      line('q7', 'Paper', 'Which size?', { entry: 4, outcome: { how: 'dismissed' } }),
    ]));
    expect(lineTexts()).toEqual(['q4 | Clash rule | → Keep the earlier sailing', 'q5 | Notices | Revised below', 'q6 | Season dates | → Withdrawn', 'q7 | Paper | → Dismissed']);
  });

  it('lays the record over what the transcript does not hold yet; the transcript’s own outcome wins', () => {
    const queued = { key: 'maws-00000001', kind: 'answer' as const, picks: ['Keep the earlier sailing'], text: '', images: [], revision: 1, by: 'maws' as const };
    withRecord(model({
      open: [question('q4', { queued })],
      hidden: [{ id: 'q5', key: 'maws-00000002' }],
      closed: { q6: { how: 'withdrawn', at: '2026-11-23T09:05:00.000Z', revision: 1, asker: 'main' }, q8: { how: 'answered', receipt: 'A5', places: [2], at: '2026-11-23T09:05:00.000Z', revision: 1, asker: 'main' } },
    }));
    draw(row([...THREE, line('q8', 'Paper size', 'Should the sheet print at A4 or A5?', { entry: 4, outcome: { how: 'answered', receipt: 'A4' } })]));
    expect(lineTexts()).toEqual(['q4 | Clash rule | → Keep the earlier sailing queued | Open', 'q5 | Notices | → Dismissed queued', 'q6 | Season dates | → Withdrawn', 'q8 | Paper size | → A4']);
  });

  // The writer's fork ruling (2026-11-27): a record whose floor could not be read restarts at q1, so a row copied from
  // the parent can name an id the fork's record holds for another call. An entry is laid over a line only when it names
  // the row's call, wherever the record gives one.
  it('lays an entry over a line only when the entry names the row’s call, wherever the record gives one', () => {
    const queued = { key: 'maws-00000001', kind: 'answer' as const, picks: ['Keep the earlier sailing'], text: '', images: [], revision: 1, by: 'maws' as const };
    const closed = { how: 'answered' as const, receipt: 'Tides', places: [1], at: '2026-11-23T09:05:00.000Z', revision: 1, asker: 'main' as const };
    const record = model({ open: [question('q4', { callId: 'toolu_fork', queued })], closed: { q5: { ...closed, callId: 'toolu_fork' } as never, q6: { ...closed, receipt: 'March' } } });
    withRecord(record);
    draw(row(THREE)); // a copied row: its call is not the record's
    expect(lineTexts()).toEqual(['q4 | Clash rule | Which one should the import keep?', 'q5 | Notices | Which notices should the printed sheet carry?', 'q6 | Season dates | → March']);
    cleanup(); // the last row unmounted forgets the model
    withRecord(record);
    draw(row(THREE, { id: 'sheet:toolu_fork' as never, toolUseId: 'toolu_fork' as ToolUseId })); // the record's own call
    expect(lineTexts()).toEqual(['q4 | Clash rule | → Keep the earlier sailing queued | Open', 'q5 | Notices | → Tides', 'q6 | Season dates | → March']);
  });

  it('reads an accepted outcome not yet delivered as its receipt', () => {
    const outcome = { key: 'maws-00000003', kind: 'answer' as const, id: 'q4', revision: 1, by: 'maws' as const, at: '2026-11-23T09:05:00.000Z', acceptedAt: '2026-11-23T09:05:01.000Z', recipient: 'main' as const, taken: false, acrossStop: false, images: [], picks: ['Keep the longer route'], text: 'the island route', places: [2],
      question: { multiSelect: false, askedAt: '2026-11-23T09:00:00.000Z', asker: 'main' as const, question: 'Which one?', header: 'Clash rule', options: ['Keep the earlier sailing', 'Keep the longer route'] } };
    withRecord(model({ pending: [outcome as never] }));
    draw(row(THREE.slice(0, 1)));
    expect(lineTexts()).toEqual(['q4 | Clash rule | → Keep the longer route']);
  });

  it('shows eight lines and “N more” of a call of eleven; a refused entry by its number, “Not asked” and the reasons; a call that only withdrew is its head alone', () => {
    const eleven = Array.from({ length: 11 }, (_, n) => line(`q${n + 10}`, `Header ${n + 1}`, `Question ${n + 1}?`, { entry: n + 1 }));
    draw(row(eleven));
    expect(lineTexts()).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: '3 more' }));
    expect(lineTexts()).toHaveLength(11);
    cleanup();
    draw(row([line('q8', 'Paper size', 'Should the sheet print at A4 or A5?'), line(null, 'Berth map', 'Should the berth map go on the back?', { entry: 3, place: 'refused' })], { notDone: 'Not done: entry 3, two options share the label "Back page".' }));
    expect(lineTexts()).toEqual(['q8 | Paper size | Should the sheet print at A4 or A5?', '3 | Berth map | Should the berth map go on the back? | Not asked']);
    expect(screen.getByText('Not done: entry 3, two options share the label "Back page".')).toBeTruthy();
    cleanup();
    draw(row([], { withdrew: ['q6'] }));
    expect(head().textContent).toBe('Withdrew q6');
    expect(head().tagName).not.toBe('BUTTON');
    expect(head().querySelector('.transcript-chevron')).toBeNull();
  });

  it('draws no id and no Open for a call whose outcome is not known, and says a call the engine refused', () => {
    withRecord(model({ open: [question('q4')] }));
    draw(row([line(null, 'Clash rule', 'Which one?')], { state: 'unknown' }));
    expect(lineTexts()).toEqual(['Clash rule | Which one?']);
    expect(screen.queryAllByRole('button', { name: /^Open/ })).toEqual([]);
    cleanup();
    draw(row([line(null, 'Clash rule', 'Which one?')], { state: 'error', error: 'InputValidationError: ask[0].options is too long' }));
    expect(head().textContent).toBe('Did not change the sheet');
    expect(within(document.querySelector<HTMLElement>('[data-sheet-call]')!).getByText('InputValidationError: ask[0].options is too long')).toBeTruthy();
  });
});
