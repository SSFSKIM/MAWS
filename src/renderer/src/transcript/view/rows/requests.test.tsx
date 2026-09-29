// Requests, boundaries, errors and spills (C6 M5): historical plan and question rows, the request slot with C7's card
// or the placeholder, boundary rows (the rewind reveal), error rows, and the spilled-result loader over fs.readSpill.
import type { EventId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEventFixture, loadJournal, loadSyntheticJournal } from '../../../../../../test/support/fixtures';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/replay-stub';
import { rowId } from '../../model/keys';
import type { Row } from '../../model/rows';
import { api, builder, request, tool, uuid } from '../../model/test-events';
import { DEFAULT_ACTIONS } from '../context';
import { renderRow, rowOf, spyActions, storeWith } from './test-support';

afterEach(cleanup);

const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind);

async function expanded(events: Parameters<typeof storeWith>[0]) {
  const store = await storeWith(events);
  useTranscriptStore.getState().expandAll(store.key);
  return store;
}

describe('plan row', () => {
  it('transcript/plan-outcomes: the plan through markdown and each outcome badge', async () => {
    const store = await expanded(journalToEvents(loadSyntheticJournal('plan-outcomes')));
    const plans = ofKind(store.rows(), 'plan');
    const badges = plans.map((plan) => {
      const view = renderRow(plan, { storeKey: store.key });
      const badge = view.container.querySelector('[data-outcome]')!.textContent;
      view.unmount();
      return badge;
    });
    expect(badges).toEqual(['Implemented', 'Cleared context and implemented', 'Kept planning: Add the delta-batch measurement before I approve.']);

    renderRow(plans[0], { storeKey: store.key });
    const region = screen.getByRole('region', { name: 'Plan' });
    expect(within(region).getByRole('heading', { name: 'Plan 1' })).toBeTruthy(); // the plan's own markdown heading
    expect(within(region).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Read the reducer.', 'Add the retraction case.', 'Extend the snapshot suite.']);
  });

  it('a long plan is bounded and opens with Show more', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('p1', 'ExitPlanMode', { plan: ['# Plan', '', ...Array.from({ length: 12 }, (_, i) => `${i + 1}. Step ${i + 1}.`)].join('\n') });
    b.result('p1', 'approved');
    b.end(['u1']);
    const store = await expanded(b.events);
    renderRow(rowOf(store.rows(), 'plan'), { storeKey: store.key });
    const region = screen.getByRole('region', { name: 'Plan' });
    const body = region.querySelector<HTMLElement>('[data-plan-body]')!;
    expect(body.dataset.open).toBeUndefined();
    fireEvent.click(within(region).getByRole('button', { name: 'Show more' }));
    expect(body.dataset.open).toBe('');
    expect(within(region).getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('a plan with no outcome reads Pending, and a short plan has nothing to show more of', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('p1', 'ExitPlanMode', { plan: 'Just one step.' });
    b.end(['u1'], { terminalReason: 'aborted_streaming' });
    const store = await expanded(b.events);
    renderRow(rowOf(store.rows(), 'plan'), { storeKey: store.key });
    expect(document.querySelector('[data-outcome]')?.textContent).toBe('Pending');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

describe('question row', () => {
  it('pass1/question-roundtrip: both questions with their options, the chosen ones marked, no previews and no controls', async () => {
    const store = await expanded(journalToEvents(loadJournal('pass1', 'question-roundtrip')));
    const question = rowOf(store.rows(), 'question');
    const view = renderRow(question, { storeKey: store.key });
    const region = screen.getByRole('region', { name: 'Question' });
    const items = [...region.querySelectorAll<HTMLElement>('[data-question]')];
    expect(items.map((item) => item.querySelector('[data-question-header]')?.textContent)).toEqual(['Color', 'Fruits']);
    const chosen = items.map((item) => [...item.querySelectorAll('[data-chosen] [data-option-label]')].map((label) => label.textContent));
    expect(chosen).toEqual([['Red'], ['Apple', 'Pear']]);
    expect(items[0].querySelector('[data-chosen]')?.textContent).toContain('Chosen');
    expect(region.textContent).toContain('A warm, bold color'); // option descriptions render
    expect(region.textContent).not.toContain('This is a red preview'); // previews are C7's live form concern
    expect(view.container.querySelectorAll('button, input, textarea, select')).toHaveLength(0);
  });

  it('an answer that is no option reads as the answer; an unanswered question says so', async () => {
    const questions = (answered: boolean) => {
      const b = builder();
      b.turn('u1');
      b.toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] });
      if (answered) b.result('q1', 'answered', { structured: { answers: { 'Which colour?': 'Teal, actually' } } });
      b.end(['u1']);
      return b.events;
    };
    const answered = await expanded(questions(true));
    let view = renderRow(rowOf(answered.rows(), 'question'), { storeKey: answered.key });
    expect(view.container.querySelectorAll('[data-chosen]')).toHaveLength(0);
    expect(view.container.textContent).toContain('Answer: Teal, actually');
    view.unmount();
    const unanswered = await expanded(questions(false));
    view = renderRow(rowOf(unanswered.rows(), 'question'), { storeKey: unanswered.key });
    expect(view.container.textContent).toContain('Not answered');
  });
});

describe('request slot', () => {
  function pendingQuestion() {
    const b = builder();
    b.turn('u1');
    b.toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }] }] });
    b.emit('question.requested', { requestId: request('r1'), toolUseId: tool('q1'), questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: null, preview: null }] }] });
    return b;
  }

  it('without renderRequest: a status line saying what waits and where to answer', async () => {
    const store = await storeWith(pendingQuestion().events);
    renderRow(rowOf(store.rows(), 'request_slot'), { storeKey: store.key });
    expect(screen.getByRole('status').textContent).toBe('Waiting for you · AskUserQuestion · answer in the composer');
  });

  it('with renderRequest: the supplied node and no placeholder', async () => {
    const store = await storeWith(pendingQuestion().events);
    const slot = rowOf(store.rows(), 'request_slot');
    const renderRequest = vi.fn((row: Extract<Row, { kind: 'request_slot' }>) => <div data-card="">Card for {row.requestId}</div>);
    const view = renderRow(slot, { storeKey: store.key, renderRequest });
    expect(renderRequest).toHaveBeenCalledWith(slot);
    expect(view.container.querySelector('[data-card]')?.textContent).toBe('Card for r1');
    expect(view.container.textContent).not.toContain('Waiting for you');
  });

  it('a question.answered for the pending slot puts the question row at the slot’s position in its turn', async () => {
    const b = pendingQuestion();
    const store = await storeWith(b.events);
    const before = store.rows();
    const at = before.findIndex((row) => row.kind === 'request_slot');
    expect(before[at]).toMatchObject({ id: rowId.slot(request('r1')), requestKind: 'question' });
    const answered = builder('2026-09-28T10:00:05.000Z');
    answered.emit('question.answered', { requestId: request('r1'), toolUseId: tool('q1'), answers: { 'Which colour?': 'Red' } }, { id: 'answer' });
    act(() => store.push(answered.events));
    const after = store.rows();
    expect(after[at]).toMatchObject({ kind: 'question', id: rowId.question(tool('q1')), turnId: before[at].turnId, answers: { 'Which colour?': 'Red' } });
    expect(ofKind(after, 'request_slot')).toEqual([]);
    expect(after.map((row) => row.id).filter((id) => id !== after[at].id)).toEqual(before.map((row) => row.id).filter((id) => id !== before[at].id));
  });
});

describe('boundary row', () => {
  it('transcript/boundaries: compaction and retraction read as boundaries, and the retracted text row is gone from where the boundary stands', async () => {
    const store = await expanded(journalToEvents(loadSyntheticJournal('boundaries')));
    const boundaries = ofKind(store.rows(), 'boundary');
    expect(boundaries.map((row) => row.boundaryKind)).toEqual(['retraction', 'compaction']);
    const view = renderRow(boundaries[0], { storeKey: store.key });
    expect(view.container.querySelector('[data-boundary-kind="retraction"]')?.textContent).toBe('Response retracted · refusal · switched to claude-sonnet-5');
    expect(view.container.querySelector('button')).toBeNull();
  });

  it('a retraction naming a message removes its text row and leaves the boundary at its index', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 0);
    b.result('t1', 'a');
    b.text('m2', 0, 'A refused answer');
    b.text('m3', 0, 'The fallback answer');
    b.end(['u1']);
    const store = await expanded(b.events);
    const before = store.rows();
    const at = before.findIndex((row) => row.id === rowId.text(api('m2'), 0));
    expect(before[at]).toMatchObject({ kind: 'assistant_text', markdown: 'A refused answer' });
    const later = builder('2026-09-28T10:00:05.000Z');
    later.emit('boundary.retraction', { retractedMessageUuids: [uuid('m2-u0')], reason: 'refusal', fallbackModel: 'claude-sonnet-5' }, { id: 'retract' });
    act(() => store.push(later.events));
    const after = store.rows();
    expect(after[at]).toMatchObject({ kind: 'boundary', boundaryKind: 'retraction', id: rowId.boundary('retract' as EventId) });
    expect(after.some((row) => row.kind === 'assistant_text' && row.markdown === 'A refused answer')).toBe(false);
    expect(after).toHaveLength(before.length);
  });
});

describe('error row', () => {
  it('reads by severity: a retry updated in place, a failed reconnect, a process exit with its lost approvals', async () => {
    const retry = rowOf(ofKind((await expanded(journalToEvents(loadSyntheticJournal('boundaries')))).rows(), 'error').filter((row) => row.scope === 'api'), 'error');
    let view = renderRow(retry);
    expect(view.container.querySelector('[data-severity="transient"][data-scope="api"]')?.textContent).toBe('Retrying (2/10) · 529 Overloaded');
    view.unmount();
    const reconnect = ofKind((await storeWith(loadEventFixture('reconnect'))).rows(), 'error').find((row) => row.scope === 'reconnect')!;
    view = renderRow(reconnect);
    expect(view.container.querySelector('[data-severity="error"]')?.textContent).toBe('Could not reconnect · engine binary missing');
    view.unmount();
    const exit = ofKind((await storeWith(loadEventFixture('process-exit'))).rows(), 'error').find((row) => row.scope === 'exit')!;
    view = renderRow(exit);
    expect(view.container.querySelector('[data-scope="exit"]')?.textContent).toBe('Session process exited (crash) · 1 approval lost');
  });
});

describe('spilled result', () => {
  afterEach(() => {
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('events/spill: Load full result (184 KB), then the content from fs.readSpill, capped with the omitted marker over 64 KB', async () => {
    const content = `${'line of the build log\n'.repeat(5000)}BUILD OK`; // about 107 KB
    const invoke = vi.fn(() => Promise.resolve({ ok: true, value: { content, bytes: content.length, offset: 0, truncated: false } }));
    (window as { maws?: MawsBridge }).maws = { invoke, on: vi.fn(() => () => {}) } as unknown as MawsBridge;
    const store = await storeWith(loadEventFixture('spill'));
    useTranscriptStore.getState().expandAll(store.key, { cells: true });
    const cellRow = () => store.rows().find((row) => row.kind === 'cell' || row.kind === 'group')!;
    const view = renderRow(cellRow(), { storeKey: store.key, actions: { ...spyActions(), loadSpill: DEFAULT_ACTIONS.loadSpill } });
    const load = screen.getByRole('button', { name: 'Load full result (184 KB)' });
    expect(view.container.textContent).toContain('[3/1200] compiling src/view/List.tsx'); // the wire preview until then
    fireEvent.click(load);
    expect(invoke).toHaveBeenCalledWith('fs.readSpill', { path: '/Users/owner/.claude/projects/-tmp-demo/session/tool-results/toolu_spill_1.txt', length: 2 * 1024 * 1024 });
    await waitFor(() => expect(useTranscriptStore.getState().entries[store.key].state.ui.spills.values().next().value?.state).toBe('loaded'));
    view.rerenderRow(cellRow());
    expect(screen.queryByRole('button', { name: /Load full result/ })).toBeNull();
    const output = view.container.querySelector('.transcript-output')!;
    expect(output.textContent).toContain('BUILD OK'); // the tail
    expect(output.querySelector('[data-omitted]')?.textContent).toMatch(/\d+ KB omitted/);
  });

  it('a failed load says why and offers Retry', async () => {
    const store = await storeWith(loadEventFixture('spill'));
    useTranscriptStore.getState().expandAll(store.key, { cells: true });
    const cellRow = () => store.rows().find((row) => row.kind === 'cell' || row.kind === 'group')!;
    const loadSpill = vi.fn(() => Promise.reject(new Error('path outside the engine store')));
    const view = renderRow(cellRow(), { storeKey: store.key, actions: { ...spyActions(), loadSpill } });
    fireEvent.click(screen.getByRole('button', { name: 'Load full result (184 KB)' }));
    await waitFor(() => expect(useTranscriptStore.getState().entries[store.key].state.ui.spills.values().next().value?.state).toBe('failed'));
    view.rerenderRow(cellRow());
    expect(view.container.textContent).toContain('Could not load the full result · path outside the engine store');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(loadSpill).toHaveBeenCalledTimes(2);
  });
});
