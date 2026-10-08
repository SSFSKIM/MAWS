// E1 (M3): the `maws` server's rows on screen. The capsule (an `ask` call) reads its title, how many questions it
// asked and its state, and hands its own data to `openAsk` (residue 14); the delivery row names the delivered files
// with the caption and offers Open externally and Reveal in Finder, a refusal shown inline for 4 s; the question row of
// a call the engine refused says so (A-17). Rows come from the recorded fixtures through the store, as the app draws
// them.
import type { AppSessionId } from '@shared/graph/ids';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadJournal } from '../../../../../../test/support/fixtures';
import { useTranscriptStore } from '../../../stores/transcript';
import { journalToEvents } from '../../dev/journal';
import type { Row } from '../../model/rows';
import { renderRow, rowOf, spyActions, storeWith } from './test-support';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;

async function fixtureRows(name: string) {
  const store = await storeWith(journalToEvents(loadJournal('pass3', name)));
  useTranscriptStore.getState().expandAll(store.key);
  return store;
}

const APP = 'app-maws' as AppSessionId;

describe('the ask capsule', () => {
  it('p1-maws-ask-blocking at its opened event: "Questions", "Asked 5 questions", Waiting for you, and Open hands the row’s own data to openAsk', async () => {
    const events = journalToEvents(loadJournal('pass3', 'p1-maws-ask-blocking'));
    const store = await storeWith(events.slice(0, events.findIndex((event) => event.kind === 'maws.ask.opened') + 1));
    const ask = rowOf(store.rows(), 'ask');
    const { actions, container } = renderRow(ask, { storeKey: APP });
    const capsule = container.querySelector<HTMLElement>('[data-ask-id]')!;
    expect(capsule.dataset.askId).toBe('toolu_012dCG4TE89gS8BSqhFFZnjS');
    expect(capsule.dataset.askState).toBe('pending');
    expect(capsule.textContent).toContain('Questions');
    expect(capsule.textContent).toContain('Asked 5 questions');
    expect(capsule.textContent).toContain('Waiting for you');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const data = Object.fromEntries(Object.entries(ask).filter(([key]) => !['id', 'turnId', 'at', 'kind'].includes(key)));
    expect(actions.openAsk).toHaveBeenCalledExactlyOnceWith(APP, data);
  });

  it('answered: Answered, a line per question reading header (or question) → answer, and View answers', async () => {
    const store = await fixtureRows('p1-maws-ask-blocking');
    const ask = rowOf(store.rows(), 'ask');
    const { actions, container } = renderRow(ask, { storeKey: APP });
    expect(container.querySelector<HTMLElement>('[data-ask-state]')!.dataset.askState).toBe('answered');
    expect(container.textContent).toContain('Answered');
    expect([...container.querySelectorAll('[data-ask-answer]')].map((line) => line.textContent)).toEqual([
      'Which colour?→Blue',
      'Which days?→Mon, Wed · Other: Fri',
      'What should the title be?→Skipped',
      'Which folder holds the assets?→/private/tmp/maws-e1-repo-ogdPFU/assets',
      'Which repository is this for?→Decide for me',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'View answers' }));
    expect(actions.openAsk).toHaveBeenCalledWith(APP, expect.objectContaining({ askId: 'toolu_012dCG4TE89gS8BSqhFFZnjS', state: 'answered' }));
  });

  it('asked, cancelled and error read their chips; a child transcript’s capsule opens its parent session’s sheet', () => {
    const base: RowOf<'ask'> = {
      id: 'ask:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'ask', toolUseId: 't1' as never, askId: 't1', title: 'Setup', context: null, blocking: false,
      questions: [{ id: 'q1', question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }] }], state: 'asked', answers: null, error: null, cancelReason: null,
    };
    const chip = (row: RowOf<'ask'>) => {
      const view = renderRow(row, { storeKey: APP });
      const text = view.container.querySelector('[data-ask-chip]')!.textContent;
      view.unmount();
      return text;
    };
    expect(chip(base)).toBe('Asked, answer when ready');
    expect(chip({ ...base, state: 'cancelled' })).toBe('Cancelled, the session ended'); // the disk path: no reason known
    expect(chip({ ...base, state: 'cancelled', cancelReason: 'exit' })).toBe('Cancelled, the session ended');
    expect(chip({ ...base, state: 'cancelled', cancelReason: 'withdrawn' })).toBe('Cancelled, the turn was interrupted');
    expect(chip({ ...base, state: 'error', error: 'ask: invalid arguments: questions: Too small' })).toBe('ask: invalid arguments: questions: Too small');
    const { actions } = renderRow(base, { storeKey: `${APP}:agent-1` });
    expect(screen.getByText('Setup')).toBeTruthy();
    expect(screen.getByText('Asked 1 question')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(actions.openAsk).toHaveBeenCalledWith(APP, expect.objectContaining({ askId: 't1' }));
  });
});

describe('the delivery row', () => {
  it('p1-maws-send-file: "Delivered hello.txt · the greeting", the file by name with its path as title, and the two buttons calling the actions with the session and path', async () => {
    const store = await fixtureRows('p1-maws-send-file');
    const delivery = rowOf(store.rows(), 'delivery');
    const actions = spyActions();
    const { container } = renderRow(delivery, { storeKey: APP, actions });
    const path = '/private/tmp/maws-e1-repo-G8SYJD/hello.txt';
    expect(container.querySelector('[data-delivery-heading]')!.textContent).toBe('Delivered hello.txt · the greeting');
    const file = container.querySelector<HTMLElement>('[data-path]')!;
    expect(file.dataset.path).toBe(path);
    expect(file.querySelector('[title]')!.getAttribute('title')).toBe(path);
    expect(file.textContent).toContain('hello.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Open externally: hello.txt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder: hello.txt' }));
    expect(actions.openDelivered).toHaveBeenCalledExactlyOnceWith(APP, path);
    expect(actions.revealDelivered).toHaveBeenCalledExactlyOnceWith(APP, path);
  });

  it('a refusal shows inline for 4 s', async () => {
    vi.useFakeTimers();
    const actions = { ...spyActions(), revealDelivered: vi.fn(async () => 'Refused: outside the session’s directories') };
    const row: RowOf<'delivery'> = { id: 'delivery:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'delivery', toolUseId: 't1' as never, files: [{ path: '/repo/a.txt', name: 'a.txt', id: 'd-1' }], caption: null, urgency: 'normal', error: null };
    renderRow(row, { storeKey: APP, actions });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder: a.txt' })));
    expect(screen.getByRole('alert').textContent).toBe('Refused: outside the session’s directories');
    await act(async () => vi.advanceTimersByTime(3_900));
    expect(screen.queryByRole('alert')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('several files read "Delivered N files"; high urgency is marked; a file MAWS never opens outside offers Reveal alone; a refused call reads its error and offers nothing', () => {
    const row: RowOf<'delivery'> = {
      id: 'delivery:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'delivery', toolUseId: 't1' as never,
      files: [{ path: '/repo/report.pdf', name: 'report.pdf', id: 'd-1' }, { path: '/repo/build.py', name: 'build.py', id: 'd-2' }], caption: null, urgency: 'high', error: null,
    };
    const view = renderRow(row, { storeKey: APP });
    expect(view.container.querySelector('[data-delivery-heading]')!.textContent).toBe('Delivered 2 files');
    expect(view.container.querySelector<HTMLElement>('[data-delivery]')!.dataset.urgency).toBe('high');
    const [pdf, script] = [...view.container.querySelectorAll<HTMLElement>('[data-path]')];
    expect([...pdf!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['report.pdf', 'Open externally', 'Reveal in Finder']); // E2: the name opens the viewer
    expect([...script!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['build.py', 'Reveal in Finder']);
    // scale-review C scalpel-5#5: each file's actions are named for it, so a list of the row's buttons tells them apart
    expect(view.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['report.pdf', 'Open externally: report.pdf', 'Reveal in Finder: report.pdf', 'build.py', 'Reveal in Finder: build.py']);
    view.unmount();

    const refused = renderRow({ ...row, files: [{ path: 'missing.txt', name: 'missing.txt', id: null }], urgency: 'normal', error: 'send_file: not a file: /repo/missing.txt' }, { storeKey: APP });
    expect(refused.container.querySelector('[data-delivery-heading]')!.textContent).toBe('Could not deliver missing.txt');
    expect(refused.container.textContent).toContain('send_file: not a file: /repo/missing.txt');
    expect(refused.container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('the delivery row before its result', () => {
  it('a call that names one path twice renders both lines without a console warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const row: RowOf<'delivery'> = {
        id: 'delivery:t1' as never, turnId: null, at: '2026-10-06T00:00:00.000Z', kind: 'delivery', toolUseId: 't1' as never,
        files: [{ path: 'a.txt', name: 'a.txt', id: null }, { path: 'a.txt', name: 'a.txt', id: null }], caption: null, urgency: 'normal', error: null,
      };
      const { container } = renderRow(row, { storeKey: APP });
      expect(container.querySelector('[data-delivery-heading]')!.textContent).toBe('Delivering 2 files');
      expect(container.querySelectorAll('[data-path="a.txt"]')).toHaveLength(2);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('the question row’s refusal (A-17)', () => {
  it('p1-question-preview-html: one last line saying the engine refused the question, tags stripped', async () => {
    const store = await fixtureRows('p1-question-preview-html');
    const question = rowOf(store.rows(), 'question');
    const { container } = renderRow(question, { storeKey: store.key });
    expect(container.querySelector('[data-question-refused]')!.textContent).toBe(
      'The engine refused this question: Option "A" in question "Which layout?": preview must contain HTML (previewFormat is set to "html"). Wrap content in a tag like <div> or <pre>.',
    );
  });

  it('an answered question has no refusal line', async () => {
    const store = await fixtureRows('question-deny');
    const { container } = renderRow(rowOf(store.rows(), 'question'), { storeKey: store.key });
    expect(container.querySelector('[data-question-refused]')).toBeNull();
  });
});
