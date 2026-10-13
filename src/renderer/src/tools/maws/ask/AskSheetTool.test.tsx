// E1 M4: the Question sheet on screen (E1 execution document, M4's "What it proves"): one section per question with the
// control its modality names; Other, Decide for me and Skip exclusive; Submit held back only by a half-answered
// question and naming how many it skips; Submit through `maws.ask.answer`, the next ask or the resting state after it;
// `write_failed` keeps the drafts and offers Retry; a restored tab reads the host's table (the reload path); an answered
// capsule reopens read-only with nothing to submit, with no read at all; a cancelled ask says the session ended.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import type { PendingAsk } from '@shared/maws/ask';
import type { AskQuestion } from '@shared/maws/tools';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { project, record } from '../../../../../../test/support/builders';
import type { PanelToolContext } from '../../../panel/tool';
import { useSessions } from '../../../stores/sessions';
import type { AskRowData } from '../../../transcript';
import type { AskSheetParams } from '../actions';
import { askSheetTool } from './AskSheetTool';
import { applyAskEvents, askSheet, resetAskSheets } from './store';

const holder: { client: FakeClient['client'] | null } = { client: null };
vi.mock('../../../ipc/client', () => ({
  ipc: {
    invoke: (...args: Parameters<FakeClient['client']['invoke']>) => holder.client!.invoke(...args),
    on: (...args: Parameters<FakeClient['client']['on']>) => holder.client!.on(...args),
  },
}));

const A = 'app-a' as AppSessionId;
const QUESTIONS: AskQuestion[] = [
  { id: 'q1', question: 'Which colour?', header: 'Colour', modality: 'choice', options: [{ label: 'Red' }, { label: 'Green', description: 'The calm one' }, { label: 'Blue' }] },
  { id: 'q2', question: 'Which days?', modality: 'choice', multi: true, options: [{ label: 'Mon' }, { label: 'Tue' }, { label: 'Wed' }] },
  { id: 'q3', question: 'What should the title be?', modality: 'text', placeholder: 'A short title' },
  { id: 'q4', question: 'Which folder holds the assets?', modality: 'folder' },
  { id: 'q5', question: 'Which repository is this for?', modality: 'repository' },
];
const ASK: PendingAsk = {
  askId: 'toolu_a', toolUseId: 'toolu_a' as ToolUseId, requestId: 'r1' as RequestId, blocking: true, title: 'Setup', context: 'I need a few details before I start.', questions: QUESTIONS, openedAt: '2026-10-06T00:00:00.000Z',
};

let fake: FakeClient;
let titles: (string | null)[];

function ctx(over: Partial<PanelToolContext> = {}): PanelToolContext {
  return {
    appSessionId: A, session: record(A, { directory: '/work/app-a' }), status: null, pinned: false, visible: true, focusRequest: 0,
    setTitle: (suffix) => titles.push(suffix), close: () => {}, openTool: (() => '') as never, editorHost: { surface: 'panel', tabId: 'ask:test' }, ...over,
  };
}

function mount(params?: AskSheetParams, over: Partial<PanelToolContext> = {}) {
  const state = askSheetTool.createState({ appSessionId: A, session: record(A), instanceId: 'ask-sheet:t', params: params as AskSheetParams });
  const Body = askSheetTool.render;
  return render(<Body state={state} ctx={ctx(over)} />);
}

const section = (id: string) => document.querySelector<HTMLElement>(`[data-question-id="${id}"]`)!;
const submitButton = () => screen.getByRole('button', { name: /^Submit/ });

async function mountWithAsk(asks: PendingAsk[] = [ASK]) {
  mount({ askId: asks[0]?.askId });
  await fake.reply('maws.asks.list', { asks });
}

beforeEach(() => {
  resetAskSheets();
  titles = [];
  fake = fakeClient();
  holder.client = fake.client;
  useSessions.setState({ projects: new Map([['p1', project('maws', 0, { directory: '/Users/me/maws' })], ['p2', project('site', 1, { directory: '/Users/me/site' })]]) as never, projectsVersion: 99 });
});
afterEach(() => {
  cleanup();
  resetAskSheets();
});

describe('the sections', () => {
  it('one section per question, with the control its modality names', async () => {
    await mountWithAsk();
    expect(screen.getByRole('heading', { name: 'Setup' })).toBeTruthy();
    expect(screen.getByText('I need a few details before I start.')).toBeTruthy();
    expect(document.querySelectorAll('[data-question-id]')).toHaveLength(5);
    expect(titles.at(-1)).toBe('Setup');

    const colour = section('q1');
    expect(within(colour).getByText('Colour')).toBeTruthy();
    expect(within(colour).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Red', 'Green', 'Blue', 'Other…']);
    expect(within(colour).getByText('The calm one')).toBeTruthy();
    expect(within(section('q2')).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual(['Mon', 'Tue', 'Wed', 'Other…']);
    expect(within(section('q3')).getByRole('textbox', { name: 'What should the title be?' }).getAttribute('placeholder')).toBe('A short title');
    expect(within(section('q4')).getByRole('button', { name: 'Choose folder…' })).toBeTruthy();
    expect(within(section('q5')).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['maws', 'site']);
    for (const id of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      expect(within(section(id)).getByRole('button', { name: 'Decide for me' }).getAttribute('aria-pressed')).toBe('false');
      expect(within(section(id)).getByRole('button', { name: 'Skip' }).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('a choice without allowOther has no Other row', async () => {
    await mountWithAsk([{ ...ASK, questions: [{ id: 'q1', question: 'Proceed?', modality: 'choice', allowOther: false, options: [{ label: 'Yes' }, { label: 'No' }] }] }]);
    expect(within(section('q1')).getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual(['Yes', 'No']);
  });

  it('Other, Decide for me and Skip exclude each other and the answer', async () => {
    await mountWithAsk();
    const colour = section('q1');
    fireEvent.click(within(colour).getByRole('radio', { name: 'Red' }));
    fireEvent.click(within(colour).getByRole('radio', { name: 'Other…' }));
    const other = within(colour).getByRole('textbox', { name: 'Other answer to Which colour?' });
    expect(within(colour).getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('false');
    fireEvent.change(other, { target: { value: 'Teal' } });

    const decide = within(colour).getByRole('button', { name: 'Decide for me' });
    const skip = within(colour).getByRole('button', { name: 'Skip' });
    fireEvent.click(decide);
    expect(decide.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(skip);
    expect(skip.getAttribute('aria-pressed')).toBe('true');
    expect(decide.getAttribute('aria-pressed')).toBe('false');
    // answering again turns the toggle off
    fireEvent.click(within(colour).getByRole('radio', { name: 'Blue' }));
    expect(skip.getAttribute('aria-pressed')).toBe('false');
    expect(within(colour).queryByRole('textbox')).toBeNull();
  });

  it('the folder question asks main’s native picker from the session’s directory and lists what came back', async () => {
    const picks = fakeClient({ 'maws.asks.list': { asks: [ASK] }, 'layout.pickFiles': { files: [{ path: '/work/app-a/assets', name: 'assets', bytes: 0, mediaType: 'inode/directory', data: null }] } });
    holder.client = picks.client;
    mount({ askId: ASK.askId });
    await screen.findByRole('heading', { name: 'Setup' });
    fireEvent.click(within(section('q4')).getByRole('button', { name: 'Choose folder…' }));
    expect(picks.invoked('layout.pickFiles')).toEqual([{ kind: 'directory', directory: '/work/app-a', multiple: false, pathsOnly: true }]); // E11: the sheet keeps paths only
    await within(section('q4')).findByText('/work/app-a/assets');
    fireEvent.click(within(section('q4')).getByRole('button', { name: 'Remove /work/app-a/assets' }));
    expect(within(section('q4')).queryByText('/work/app-a/assets')).toBeNull();
  });
});

describe('Submit', () => {
  it('names how many it skips, and waits while an Other answer is blank', async () => {
    await mountWithAsk();
    expect(submitButton().textContent).toBe('Submit · 5 skipped');
    fireEvent.click(within(section('q1')).getByRole('radio', { name: 'Other…' }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(section('q1')).getByRole('textbox'), { target: { value: 'Teal' } });
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    expect(submitButton().textContent).toBe('Submit · 4 skipped');
  });

  it('sends the answers through maws.ask.answer, then shows the resting state', async () => {
    await mountWithAsk();
    fireEvent.click(within(section('q1')).getByRole('radio', { name: 'Blue' }));
    fireEvent.click(within(section('q2')).getByRole('checkbox', { name: 'Mon' }));
    fireEvent.click(within(section('q2')).getByRole('checkbox', { name: 'Wed' }));
    fireEvent.click(within(section('q2')).getByRole('checkbox', { name: 'Other…' }));
    fireEvent.change(within(section('q2')).getByRole('textbox'), { target: { value: 'Fri' } });
    fireEvent.click(within(section('q3')).getByRole('button', { name: 'Skip' }));
    fireEvent.click(within(section('q5')).getByRole('button', { name: 'Decide for me' }));
    fireEvent.click(within(section('q4')).getByRole('button', { name: 'Skip' }));
    fireEvent.click(submitButton());
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(section('q1')).getByRole('radio', { name: 'Red' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.invoked('maws.ask.answer')).toEqual([{
      appSessionId: A, askId: 'toolu_a', answers: [
        { id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] },
        { id: 'q2', question: 'Which days?', status: 'answered', value: ['Mon', 'Wed'], otherText: 'Fri' },
        { id: 'q3', question: 'What should the title be?', status: 'skipped' },
        { id: 'q4', question: 'Which folder holds the assets?', status: 'skipped' },
        { id: 'q5', question: 'Which repository is this for?', status: 'decide_for_me' },
      ],
    }]);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    expect(await screen.findByText('No open questions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull();
  });

  it('write_failed keeps the drafts and offers Retry', async () => {
    await mountWithAsk();
    fireEvent.click(within(section('q1')).getByRole('radio', { name: 'Green' }));
    fireEvent.click(submitButton());
    await fake.reply('maws.ask.answer', { outcome: 'write_failed' });
    expect(await screen.findByText("Couldn't deliver the answers")).toBeTruthy();
    expect(within(section('q1')).getByRole('radio', { name: 'Green' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fake.invoked('maws.ask.answer')).toHaveLength(2);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    expect(await screen.findByText('No open questions')).toBeTruthy();
  });

  it('Retry waits, as Submit does, while a question is half answered', async () => {
    await mountWithAsk();
    fireEvent.click(within(section('q1')).getByRole('radio', { name: 'Green' }));
    fireEvent.click(submitButton());
    await fake.reply('maws.ask.answer', { outcome: 'write_failed' });
    await screen.findByText("Couldn't deliver the answers");
    fireEvent.click(within(section('q1')).getByRole('radio', { name: 'Other…' }));
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(fake.invoked('maws.ask.answer')).toHaveLength(1);
  });

  it('while one ask’s answers are on their way, no other ask can be submitted', async () => {
    await mountWithAsk([ASK, { ...ASK, askId: 'toolu_b', title: 'Deploy', questions: [{ id: 'q1', question: 'Ship now?', modality: 'text' }] }]);
    fireEvent.click(submitButton());
    fireEvent.click(within(screen.getByRole('navigation', { name: '2 open asks' })).getByRole('button', { name: 'Deploy' }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    await fake.reply('maws.ask.answer', { outcome: 'delivered' });
    await waitFor(() => expect((submitButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it('not_pending says the ask was answered elsewhere and moves on', async () => {
    await mountWithAsk();
    fireEvent.click(submitButton());
    await fake.reply('maws.ask.answer', { outcome: 'not_pending' });
    expect(await screen.findByText('Already answered elsewhere')).toBeTruthy();
    expect(screen.getByText('No open questions')).toBeTruthy();
  });
});

describe('the asks a session holds', () => {
  it('a restored tab (no params) reads the host’s table and shows the pending ask: the reload path', async () => {
    mount(undefined);
    expect(fake.invoked('maws.asks.list')).toEqual([{ appSessionId: A }]);
    expect(screen.getByText('No open questions')).toBeTruthy();
    await fake.reply('maws.asks.list', { asks: [ASK] });
    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeTruthy();
    expect(submitButton()).toBeTruthy();
  });

  it('a refused read says so in place of the resting state, and Retry reads again', async () => {
    mount(undefined);
    await fake.fail('maws.asks.list', 'engine host unavailable');
    expect(await screen.findByText("Couldn't read this session's questions")).toBeTruthy();
    expect(screen.queryByText('No open questions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fake.invoked('maws.asks.list')).toHaveLength(2);
    await fake.reply('maws.asks.list', { asks: [ASK] });
    expect(await screen.findByRole('heading', { name: 'Setup' })).toBeTruthy();
    expect(screen.queryByText("Couldn't read this session's questions")).toBeNull();
  });

  it('two open asks: a switcher between them, the drafts kept per ask', async () => {
    await mountWithAsk([ASK, { ...ASK, askId: 'toolu_b', title: 'Deploy', questions: [{ id: 'q1', question: 'Ship now?', modality: 'text' }] }]);
    const nav = screen.getByRole('navigation', { name: '2 open asks' });
    fireEvent.click(within(section('q1')).getByRole('radio', { name: 'Red' }));
    fireEvent.click(within(nav).getByRole('button', { name: 'Deploy' }));
    expect(screen.getByRole('heading', { name: 'Deploy' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Setup' }));
    expect(within(section('q1')).getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a cancelled ask says the session ended, offers nothing to submit, and can be dismissed', async () => {
    await mountWithAsk();
    applyAskEvents(A, [{ kind: 'maws.ask.cancelled', askId: 'toolu_a', toolUseId: 'toolu_a', reason: 'exit', id: 'e1', sessionId: 's', at: '', seq: 1, agentId: null, parentToolUseId: null } as never]);
    expect(await screen.findByText('This session ended before you answered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('No open questions')).toBeTruthy();
  });

  // E1 review: an interrupted turn withdraws the ask while the session lives on
  it('an ask the engine withdrew says the turn was interrupted', async () => {
    await mountWithAsk();
    applyAskEvents(A, [{ kind: 'maws.ask.cancelled', askId: 'toolu_a', toolUseId: 'toolu_a', reason: 'withdrawn', id: 'e1', sessionId: 's', at: '', seq: 1, agentId: null, parentToolUseId: null } as never]);
    expect(await screen.findByText('The turn was interrupted before you answered')).toBeTruthy();
    expect(screen.queryByText('This session ended before you answered')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull();
  });
});

describe('a capsule’s ask, read-only', () => {
  const ANSWERED: AskRowData = {
    askId: 'toolu_old', toolUseId: 'toolu_old' as ToolUseId, title: null, context: null, blocking: true, questions: QUESTIONS, state: 'answered', error: null, cancelReason: null,
    answers: [
      { id: 'q1', question: 'Which colour?', status: 'answered', value: [], otherText: 'Teal' },
      { id: 'q2', question: 'Which days?', status: 'answered', value: ['Mon', 'Wed'] },
      { id: 'q3', question: 'What should the title be?', status: 'skipped' },
      { id: 'q4', question: 'Which folder holds the assets?', status: 'answered', value: ['/work/app-a/assets'] },
      { id: 'q5', question: 'Which repository is this for?', status: 'decide_for_me' },
    ],
  };

  it('shows an answered ask with no Submit and no controls, also when the store has never loaded anything', () => {
    // the sheet's state as a fresh renderer has it: never loaded, and nothing read before the body asks
    const state = askSheetTool.createState({ appSessionId: A, session: null, instanceId: 'ask-sheet:t', params: { askId: 'toolu_old', historical: ANSWERED } });
    expect(askSheet(A).getState().loaded).toBe(false);
    const Body = askSheetTool.render;
    render(<Body state={state} ctx={ctx()} />);
    expect(screen.getByRole('heading', { name: 'Questions' })).toBeTruthy();
    expect(screen.getByText('Answered')).toBeTruthy();
    expect(within(section('q1')).getByText('Other: Teal')).toBeTruthy();
    expect(within(section('q2')).getByText('Mon, Wed')).toBeTruthy();
    expect(within(section('q3')).getByText('Skipped')).toBeTruthy();
    expect(within(section('q4')).getByText('/work/app-a/assets')).toBeTruthy();
    expect(within(section('q5')).getByText('Decided for me')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('a cancelled capsule says why: the turn was interrupted, else the session ended', () => {
    const shown = (historical: AskRowData) => {
      const state = askSheetTool.createState({ appSessionId: A, session: null, instanceId: 'ask-sheet:t', params: { askId: historical.askId, historical } });
      const Body = askSheetTool.render;
      const view = render(<Body state={state} ctx={ctx()} />);
      const text = view.container.textContent;
      view.unmount();
      return text;
    };
    const cancelled = { ...ANSWERED, state: 'cancelled', answers: null } as const;
    expect(shown({ ...cancelled, cancelReason: 'withdrawn' })).toContain('The turn was interrupted before you answered');
    expect(shown({ ...cancelled, cancelReason: 'exit' })).toContain('This session ended before you answered');
    expect(shown(cancelled)).toContain('This session ended before you answered'); // the disk path: no reason known
  });

  it('a pending capsule the host turns out not to hold says so, still read-only', async () => {
    mount({ askId: 'toolu_gone', historical: { ...ANSWERED, askId: 'toolu_gone', state: 'asked', answers: null } });
    await fake.reply('maws.asks.list', { asks: [] });
    expect(await screen.findByText('MAWS no longer holds this ask, so it cannot be answered here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull();
  });

  it('opening a pending capsule the host holds shows the live, answerable ask', async () => {
    mount({ askId: 'toolu_a', historical: { ...ANSWERED, askId: 'toolu_a', state: 'pending', answers: null } });
    await fake.reply('maws.asks.list', { asks: [ASK] });
    await waitFor(() => expect(submitButton()).toBeTruthy());
  });
});

it('no session: the sheet says to open one', () => {
  const Body = askSheetTool.render;
  render(<Body state={{ appSessionId: null }} ctx={ctx({ appSessionId: null, session: null })} />);
  expect(screen.getByText('Open a session to see its questions')).toBeTruthy();
});
