// UX wave U1b (the U1b document, Interfaces §D "A question's receipt", §G; decisions 8, 10 and 21): a question's row
// says, per line, the first that applies: its own answer; "Dismissed" for a question dismissed or declined whole; what
// the attention store knows of the call's answer under the row's own session (the answer this window gave, a dismissal,
// a settlement's words); "Not answered". And MAWS's ask dismissed whole reads Dismissed on its capsule, its lines
// Skipped. Rows are written by hand in the model's shapes; every question and word is invented.
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE } from '../../../../../../test/support/machine';
import { useAttention, type Receipt } from '../../../stores/attention';
import { serializeRows } from '../../model/serialize';
import type { Row } from '../../model/rows';
import { renderRow } from './test-support';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

const HERE = at('app-receipts' as AppSessionId);
const THERE = addressOf(OTHER_MACHINE, 'app-receipts' as AppSessionId); // one engine session and call id on another machine
const CALL = 'toolu_receipt' as ToolUseId;
const QUESTIONS = [
  { question: 'Which colour do you prefer?', header: 'Colour', multiSelect: false, options: [{ label: 'Blue', description: null, preview: null }, { label: 'Red', description: null, preview: null }] },
  { question: 'Which season do you prefer?', header: 'Season', multiSelect: false, options: [{ label: 'Summer', description: null, preview: null }] },
];
const question = (over: Partial<RowOf<'question'>> = {}): RowOf<'question'> => ({ id: 'question:toolu_receipt' as never, turnId: null, at: '2026-11-15T10:00:00.000Z', kind: 'question', toolUseId: CALL, questions: QUESTIONS, answers: null, error: null, ...over });
// A line's drawn words: the question's tip description and its touch fact are no part of them (ticket 815)
const drawnWords = (line: Element) => {
  const copy = line.cloneNode(true) as Element;
  copy.querySelectorAll('[hidden], [data-touch-fact]').forEach((element) => element.remove());
  return copy.textContent;
};
const lines = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-question]')].map(drawnWords);
const receipt = (value: Receipt, session = HERE) => useAttention.getState().recordReceipt(session, CALL, value);
const shown = (row: RowOf<'question'>, storeKey: string = HERE) => {
  const view = renderRow(row, { storeKey });
  const said = lines(view.container);
  view.unmount();
  return said;
};

beforeEach(() => useAttention.setState({ receipts: new Map() }));
afterEach(cleanup);

describe('a question’s receipt, the first source that applies', () => {
  it('with no source: Not answered', () => {
    expect(shown(question())).toEqual(['Colour→Not answered', 'Season→Not answered']);
  });

  it('each source alone', () => {
    expect(shown(question({ answers: { 'Which colour do you prefer?': 'Blue' } }))).toEqual(['Colour→Blue', 'Season→Not answered']);
    expect(shown(question({ dismissed: true }))).toEqual(['Colour→Dismissed', 'Season→Dismissed']);
    expect(shown(question({ answers: {} }))).toEqual(['Colour→Dismissed', 'Season→Dismissed']); // a blocking question declined whole
    receipt({ answers: { 'Which colour do you prefer?': 'Red', 'Which season do you prefer?': 'Summer' } });
    expect(shown(question())).toEqual(['Colour→Red', 'Season→Summer']);
    receipt({ dismissed: true });
    expect(shown(question())).toEqual(['Colour→Dismissed', 'Season→Dismissed']);
    useAttention.setState({ receipts: new Map() });
    receipt({ settled: 'Answered in the terminal' });
    expect(shown(question())).toEqual(['Colour→Answered in the terminal', 'Season→Answered in the terminal']);
  });

  it('the earlier wins: the row’s own answer over the receipt, the row’s dismissal over the receipt’s answer', () => {
    receipt({ answers: { 'Which colour do you prefer?': 'Red', 'Which season do you prefer?': 'Summer' } });
    expect(shown(question({ answers: { 'Which colour do you prefer?': 'Blue', 'Which season do you prefer?': 'Summer' } }))).toEqual(['Colour→Blue', 'Season→Summer']);
    expect(shown(question({ dismissed: true }))).toEqual(['Colour→Dismissed', 'Season→Dismissed']);
    expect(shown(question({ answers: {} }))).toEqual(['Colour→Dismissed', 'Season→Dismissed']);
  });

  it('is read under the row’s own session: an answer on one machine never shows on the other’s row, a child transcript reads its parent’s', () => {
    receipt({ answers: { 'Which colour do you prefer?': 'Red' } }, THERE);
    expect(shown(question())).toEqual(['Colour→Not answered', 'Season→Not answered']);
    expect(shown(question(), THERE)).toEqual(['Colour→Red', 'Season→Not answered']);
    expect(shown(question(), `${THERE}:agent-1`)).toEqual(['Colour→Red', 'Season→Not answered']);
    expect(shown(question(), '')).toEqual(['Colour→Not answered', 'Season→Not answered']); // outside a transcript: no session
  });

  it('the export says Dismissed where the row does', () => {
    expect(serializeRows([question({ dismissed: true })])).toBe('**Colour** Which colour do you prefer?: Dismissed\n**Season** Which season do you prefer?: Dismissed');
    expect(serializeRows([question({ answers: {} })])).toBe('**Colour** Which colour do you prefer?: Dismissed\n**Season** Which season do you prefer?: Dismissed');
  });
});

describe('MAWS’s ask dismissed whole', () => {
  const ask = (answers: RowOf<'ask'>['answers']): RowOf<'ask'> => ({
    id: 'ask:toolu_ask' as never, turnId: null, at: '2026-11-15T10:00:00.000Z', kind: 'ask', toolUseId: 'toolu_ask' as never, askId: 'toolu_ask', title: 'Setup', context: null, blocking: true,
    questions: [{ id: 'q1', question: 'Which colour?', modality: 'choice', options: [{ label: 'Red' }] }, { id: 'q2', question: 'What title?', header: 'Title', modality: 'text' }],
    state: 'answered', answers, error: null, cancelReason: null,
  });
  const chip = (row: RowOf<'ask'>) => {
    const view = renderRow(row, { storeKey: HERE });
    const said = { chip: view.container.querySelector('[data-ask-chip]')!.textContent, lines: [...view.container.querySelectorAll('[data-ask-answer]')].map(drawnWords) };
    view.unmount();
    return said;
  };

  it('reads Dismissed on its capsule with its lines Skipped; an ask with one answer given reads Answered', () => {
    expect(chip(ask([{ id: 'q1', question: 'Which colour?', status: 'skipped' }, { id: 'q2', question: 'What title?', status: 'skipped' }]))).toEqual({ chip: 'Dismissed', lines: ['Which colour?→Skipped', 'Title→Skipped'] });
    expect(chip(ask([{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Red'] }, { id: 'q2', question: 'What title?', status: 'skipped' }]))).toEqual({ chip: 'Answered', lines: ['Which colour?→Red', 'Title→Skipped'] });
    expect(serializeRows([ask([{ id: 'q1', question: 'Which colour?', status: 'skipped' }, { id: 'q2', question: 'What title?', status: 'skipped' }])]).split('\n')[0]).toBe('**Setup** · 2 questions · Dismissed'); // the word cut (T94)
  });
});
