// UX wave U1b M3 (the U1b document, Interfaces §C to §E and §G; proofs b to h2 and j): a session's waiting requests
// drawn in its transcript, over the real transcript slot, the card's registered renderer, the attention store and the
// key dispatcher. A question's form in its call's row and its receipt once it leaves; a permission prompt at the end row,
// with "Also waiting" under it; the end row present exactly while something is placed there or a settling receipt is
// held; the transcript's one operation `show`; a card's delivery through a remount; the call that waits on its own row;
// a request answered elsewhere (decision 8a); a subagent's requests over a recorded fixture. Every question, command and
// id is invented, but the fixture's.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { bareOf } from '@shared/machine/address';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { loadJournal } from '../../../../test/support/fixtures';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { resetSurfaceRegistry } from '../engine-surface/registry';
import { connectKeys } from '../keymap/dispatcher';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { SETTLED_MS } from '../lane-a/race';
import { NOT_PENDING_MS, selectWaitingRequests, useAttention } from '../stores/attention';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { resetComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { Transcript, TranscriptSlot, useTranscriptStore } from '../transcript';
import { journalToEvents } from '../transcript/dev/journal';
import { builder, request, tool } from '../transcript/model/test-events';
import { connectRequestCard, renderSessionRequest } from './index';
import { itemFor, type RequestEvent } from './test-requests';

const APP = at('app-rows' as AppSessionId);
const QUESTIONS = [
  { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: null, preview: null }, { label: 'Blue', description: null, preview: null }] },
  { question: 'Which size?', header: 'Size', multiSelect: false, options: [{ label: 'Small', description: null, preview: null }, { label: 'Large', description: null, preview: null }] },
];
const permissionOf = (requestId: string, toolUseId: string, command: string) => ({
  requestId: request(requestId), toolUseId: tool(toolUseId), toolName: 'Bash', displayName: 'Bash', input: { command }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null,
});

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  // happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts rows (C6's own setup)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 4000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

let fake: FakeClient;
let events: SessionEvent[] = [];
let requests = new Map<string, SessionEvent>();
let offs: (() => void)[] = [];
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetLaneAStore();
  resetSurfaceRegistry();
  useAttention.setState({ receipts: new Map(), settling: new Map() });
  events = [];
  requests = new Map();
  fake = fakeClient({
    'session.events': () => ({ events, lastSeq: events.length, complete: true }),
    'attention.request': (input: { requestId: string }) => ({ event: requests.get(input.requestId) ?? null }),
  });
  window.maws = fake.client as unknown as PreloadBridge;
  offs = [connectKeys(), connectRequestCard()];
});
afterEach(() => {
  offs.forEach((off) => off());
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: PreloadBridge }).maws;
  vi.useRealTimers();
});

// A turn that asks two questions in one call and runs a shell call that waits for permission, as a session MAWS runs
// streams it: each request event pending.
function scene() {
  const b = builder();
  b.turn('u1', 'Set things up');
  b.text('m0', 0, 'Two things first.');
  b.toolUse('q1', 'AskUserQuestion', { questions: QUESTIONS });
  const asked = b.emit('question.requested', { requestId: request('rq'), toolUseId: tool('q1'), questions: QUESTIONS });
  b.toolUse('b1', 'Bash', { command: 'make check' }, 'm2', 0);
  const prompt = b.emit('permission.requested', permissionOf('rp', 'b1', 'make check'));
  b.toolUse('b2', 'Bash', { command: 'make lint' }, 'm2', 1);
  const second = b.emit('permission.requested', permissionOf('rp2', 'b2', 'make lint'));
  events = b.events;
  for (const event of [asked, prompt, second]) requests.set(event.requestId, event);
  return {
    question: itemFor(asked as RequestEvent, APP, { summary: 'Which colour?' }),
    prompt: itemFor(prompt as RequestEvent, APP, { summary: 'Bash: make check' }),
    second: itemFor(second as RequestEvent, APP, { summary: 'Bash: make lint' }),
  };
}

const list = (items: AttentionItem[]) => act(() => useAttention.getState().applyChanged({ appSessionId: APP, items }, TEST_MACHINE));
async function mount(items: AttentionItem[], node = <TranscriptSlot appSessionId={APP} />) {
  act(() => useAttention.getState().applySnapshot(items, TEST_MACHINE));
  const view = render(<section data-pane={0}>{node}</section>);
  await waitFor(() => expect(document.querySelector('[data-kind="question"]')).not.toBeNull());
  return view;
}
const questionRow = () => document.querySelector<HTMLElement>('.transcript-row[data-kind="question"]')!;
const endRow = () => document.querySelector<HTMLElement>('[data-row-id="request-end"]');
const end = () => document.querySelector<HTMLElement>('[data-request-end]');
const lastRowId = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index)).at(-1)?.dataset.rowId;
const lines = (root: HTMLElement) => [...root.querySelectorAll('[data-question]')].map((line) => line.textContent);
const answered = () => fake.invoked('session.answer') as { requestId: string; answer: unknown }[];
const pick = async (label: string, next: string) => {
  fireEvent.click(within(questionRow()).getByRole('radio', { name: label }));
  fireEvent.click(within(questionRow()).getByRole('button', { name: next }));
};

describe('a question’s form in its call’s row', () => {
  it('stands in the row in place of the receipt, under its two-line header, and becomes the row’s answer lines once its item leaves', async () => {
    const { question } = scene();
    await mount([question]);
    await waitFor(() => expect(within(questionRow()).queryByRole('radio', { name: 'Red' })).not.toBeNull());
    expect(questionRow().querySelector('.transcript-question')).toBeNull(); // no receipt while the form stands
    expect(within(questionRow()).getByRole('group', { name: 'Question' })).toBeTruthy();
    const header = questionRow().querySelector<HTMLElement>('[data-form-header]')!;
    expect(header.textContent).toBe('?Question· 2 questions'); // the owner's "Two lines": the kind line carries the count
    expect(questionRow().textContent).not.toContain('Main session asks');
    await pick('Red', 'Next');
    await pick('Small', 'Submit');
    await waitFor(() => expect(answered()).toHaveLength(1));
    expect(answered()[0]).toMatchObject({ requestId: 'rq', answer: { kind: 'question', answers: { 'Which colour?': 'Red', 'Which size?': 'Small' } } });
    await act(() => fake.reply('session.answer', { outcome: 'delivered' }));
    list([]); // the holder lets it go
    await waitFor(() => expect(questionRow().querySelector('[data-request-card]')).toBeNull());
    expect(lines(questionRow())).toEqual(['Colour→Red', 'Size→Small']);
    expect(endRow()).toBeNull();
  });

  it('asks the AskUserQuestion site once while the form stands, never the row’s own as well', async () => {
    const { question } = scene();
    useSessions.getState().applyStatus({ appSessionId: APP, status: { ...status(APP), uiSurface: { clientId: 'maws-main' } } }, TEST_MACHINE);
    fake = fakeClient({
      'session.events': () => ({ events, lastSeq: events.length, complete: true }),
      'attention.request': (input: { requestId: string }) => ({ event: requests.get(input.requestId) ?? null }),
      'session.ui.render': () => ({ tree: { type: 'engine', ref: 0 }, props: {}, rewritten: false, hooked: false }),
    });
    window.maws = fake.client as unknown as PreloadBridge;
    await mount([question]);
    await waitFor(() => expect(within(questionRow()).queryByRole('radio', { name: 'Red' })).not.toBeNull());
    const asks = () => (fake.invoked('session.ui.render') as { component: string; instanceId: string }[]).filter((ask) => ask.component === 'AskUserQuestion');
    await waitFor(() => expect(asks()).toHaveLength(1));
    expect(asks()[0]).toMatchObject({ appSessionId: bareOf(APP), instanceId: 'q1' });
  });

  it('a waiting plan draws the card’s plan body in its row; a waiting ask keeps its capsule line, reads Open beside, and draws the sheet’s form under it', async () => {
    const b = builder();
    b.turn('u1', 'Plan it');
    b.toolUse('q0', 'AskUserQuestion', { questions: QUESTIONS });
    b.result('q0', 'User has answered your questions: "Which colour?"="Blue", "Which size?"="Large".');
    b.toolUse('p1', 'ExitPlanMode', { plan: '1. Read the notes.\n2. Write the page.' });
    const plan = b.emit('plan.requested', { requestId: request('rplan'), toolUseId: tool('p1'), plan: '1. Read the notes.\n2. Write the page.', input: {} });
    events = b.events;
    requests.set('rplan', plan);
    const item = itemFor(plan as RequestEvent, APP, { summary: 'Plan' });
    await mount([item]);
    const planRow = () => document.querySelector<HTMLElement>('.transcript-row[data-kind="plan"]')!;
    await waitFor(() => expect(planRow()?.querySelector('[data-request-card]')).not.toBeNull());
    expect(within(planRow()).getByRole('group', { name: 'Plan review' })).toBeTruthy();
    expect(planRow().querySelector('.transcript-plan')).toBeNull();
    list([]);
    await waitFor(() => expect(planRow().querySelector('[data-request-card]')).toBeNull());
    expect(planRow().querySelector('.transcript-plan')).not.toBeNull();
  });
});

describe('the end row', () => {
  it('is the last row while a prompt waits, its card open and the other under Also waiting; choosing the line opens that one and folds the first', async () => {
    const { question, prompt, second } = scene();
    await mount([question, prompt, second]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    expect(lastRowId()).toBe('request-end');
    expect(within(end()!).getByRole('group', { name: 'Approval needed' }).textContent).toContain('make check'); // the oldest open
    expect(within(end()!).getByText('Also waiting')).toBeTruthy();
    const line = end()!.querySelector<HTMLElement>(`[data-waiting-line="${second.id}"]`)!;
    expect(line.textContent).toBe('◐Bash: make lint');
    expect(end()!.querySelector(`[data-waiting-line="${question.id}"]`)).toBeNull(); // the question is in its row
    fireEvent.click(line);
    await waitFor(() => expect(within(end()!).getByRole('group', { name: 'Approval needed' }).textContent).toContain('make lint'));
    expect(end()!.querySelector<HTMLElement>(`[data-waiting-line="${prompt.id}"]`)?.textContent).toBe('◐Bash: make check');
    // answered and let go, the oldest remaining opens; the last one gone, the end row goes
    list([question, prompt]);
    await waitFor(() => expect(within(end()!).getByRole('group', { name: 'Approval needed' }).textContent).toContain('make check'));
    expect(within(end()!).queryByText('Also waiting')).toBeNull();
    list([question]);
    await waitFor(() => expect(endRow()).toBeNull());
  });

  it('is absent with nothing placed there, and in a transcript whose key names no session', async () => {
    const { question, prompt } = scene();
    await mount([question]);
    expect(endRow()).toBeNull();
    cleanup();
    const source = { subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
    await mount([question, prompt], <Transcript source={source} variant="session" renderRequest={renderSessionRequest} />);
    expect(endRow()).toBeNull();
    expect(document.querySelector('[data-request-card]')).toBeNull();
  });

  it('holds a single prompt its terminal answered for SETTLED_MS with the settlement’s words and no control, waiting for nothing, then goes', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    vi.useFakeTimers();
    const settled: LaneAState['settled'][number] = { request: 'rp', session: 'eng', winner: 'terminal', outcome: 'allow', by: 'terminal' };
    act(() => applyLaneAState(APP, laneAState(APP, { engineSessionId: 'eng', settled: [settled] })));
    list([]);
    expect(end()?.textContent).toBe('Bash: make check · Answered in the terminal: Allowed');
    expect(end()!.querySelectorAll('button')).toHaveLength(0);
    expect(selectWaitingRequests(useAttention.getState(), APP)).toEqual([]);
    act(() => void vi.advanceTimersByTime(SETTLED_MS));
    expect(endRow()).toBeNull();
  });
});

describe('show, the transcript’s one way to a waiting request', () => {
  it('with two prompts and the older open, selects the younger before the keyboard lands on its row, so an answer then is the younger’s; a request gone answers gone and moves nothing', async () => {
    const { prompt, second } = scene();
    await mount([prompt, second]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    const { waitingViewsOf } = await import('../transcript/view/waiting-view'); // M3's module: a red run fails this case alone
    const [view] = waitingViewsOf(APP);
    expect(view).toBeDefined();
    let shown: string = '';
    act(() => void (shown = view.show(second.id)));
    expect(shown).toBe('shown');
    await waitFor(() => expect(document.activeElement?.closest('[data-row-id]')?.getAttribute('data-row-id')).toBe('request-end'));
    expect(within(end()!).getByRole('group', { name: 'Approval needed' }).textContent).toContain('make lint');
    fireEvent.click(within(end()!).getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answered()).toHaveLength(1));
    expect(answered()[0]).toMatchObject({ requestId: 'rp2' });

    const before = document.activeElement;
    act(() => void (shown = view.show('att-gone' as AttentionItem['id'])));
    expect(shown).toBe('gone');
    expect(document.activeElement).toBe(before);
    expect(within(end()!).getByRole('group', { name: 'Approval needed' }).textContent).toContain('make lint');
  });

  it('a request in its row: scrolls there and puts the keyboard on the row', async () => {
    const { question } = scene();
    await mount([question]);
    await waitFor(() => expect(within(questionRow()).queryByRole('radio', { name: 'Red' })).not.toBeNull());
    const { waitingViewsOf } = await import('../transcript/view/waiting-view');
    let shown: string = '';
    act(() => void (shown = waitingViewsOf(APP)[0]!.show(question.id)));
    expect(shown).toBe('shown');
    await waitFor(() => expect(document.activeElement).toBe(questionRow()));
  });
});

describe('a card’s delivery, in a row and at the end', () => {
  it('a prompt answered at the end whose write fails while the transcript is unmounted comes back failed, and Retry sends the same answer', async () => {
    const { prompt } = scene();
    const first = await mount([prompt]);
    await waitFor(() => expect(within(end()!).queryByRole('button', { name: 'Allow once' })).not.toBeNull());
    fireEvent.click(within(end()!).getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answered()).toHaveLength(1));
    expect(end()!.querySelector('[data-request-card]')?.getAttribute('aria-busy')).toBe('true');
    first.unmount();
    await act(() => fake.fail('session.answer', 'the link is down'));
    render(<section data-pane={0}><TranscriptSlot appSessionId={APP} /></section>);
    await waitFor(() => expect(end()?.querySelector('[role="alert"]')?.textContent).toBe("Couldn't deliver the answerRetry"));
    fireEvent.click(within(end()!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(answered()).toHaveLength(2));
    expect(answered()[1]).toEqual(answered()[0]);
  });

  it('a question answered in its row whose write is out while the transcript is unmounted comes back sending, and answers once', async () => {
    const { question } = scene();
    const first = await mount([question]);
    await waitFor(() => expect(within(questionRow()).queryByRole('radio', { name: 'Red' })).not.toBeNull());
    await pick('Red', 'Next');
    await pick('Small', 'Submit');
    await waitFor(() => expect(answered()).toHaveLength(1));
    first.unmount();
    render(<section data-pane={0}><TranscriptSlot appSessionId={APP} /></section>);
    await waitFor(() => expect(questionRow()?.querySelector('[data-request-card]')?.getAttribute('aria-busy')).toBe('true'));
    expect(answered()).toHaveLength(1);
  });
});

describe('the call that waits, on its own row', () => {
  const cell = (id: string) => document.querySelector<HTMLElement>(`[data-cell-id="cell:${id}"]`);
  it('reads Waiting for approval with no counts while its prompt waits, as running once allowed; a request with no call id leaves its label', async () => {
    const { question, prompt, second } = scene();
    await mount([question, prompt, { ...second, request: { ...second.request, toolUseId: null } }]);
    act(() => useTranscriptStore.getState().expandAll(APP));
    await waitFor(() => expect(cell('b1')).not.toBeNull());
    expect(cell('b1')!.hasAttribute('data-waiting')).toBe(true);
    expect(cell('b1')!.querySelector('.transcript-cell-label')?.textContent).toBe('Waiting for approval: make check');
    expect(cell('b2')!.hasAttribute('data-waiting')).toBe(false);
    list([question]);
    await waitFor(() => expect(cell('b1')!.hasAttribute('data-waiting')).toBe(false));
    expect(cell('b1')!.dataset.status).toBe('running');
  });
});

// Decision 8a: a delivery that ends as answered elsewhere while its item is still listed
describe('a request answered elsewhere while its row still waits', () => {
  it('reads Already answered elsewhere on each line with no form and no control, across a remount and after the item leaves; its prompt’s row reads as its tool row; a closed card is not the end’s open one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { question, prompt, second } = scene();
    const first = await mount([question, prompt, second]);
    await waitFor(() => expect(within(questionRow()).queryByRole('radio', { name: 'Red' })).not.toBeNull());
    await pick('Red', 'Next');
    await pick('Small', 'Submit');
    await waitFor(() => expect(answered()).toHaveLength(1));
    await act(() => fake.reply('session.answer', { outcome: 'not_pending' }));
    await waitFor(() => expect(within(end()!).queryByRole('button', { name: 'Allow once' })).not.toBeNull());
    fireEvent.click(within(end()!).getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answered()).toHaveLength(2));
    await act(() => fake.reply('session.answer', { outcome: 'not_pending' }));
    act(() => void vi.advanceTimersByTime(NOT_PENDING_MS));
    await waitFor(() => expect(questionRow().querySelector('[data-request-card]')).toBeNull());
    const quiet = () => {
      expect(lines(questionRow())).toEqual(['Colour→Already answered elsewhere', 'Size→Already answered elsewhere']);
      expect(questionRow().querySelectorAll('button, [role="radio"]')).toHaveLength(0);
    };
    quiet();
    expect(document.querySelector('[data-cell-id="cell:b1"]')?.hasAttribute('data-waiting') ?? false).toBe(false);
    expect(within(end()!).getByRole('group', { name: 'Approval needed' }).textContent).toContain('make lint'); // the closed one is not open
    expect(end()!.querySelector(`[data-waiting-line="${prompt.id}"]`)).toBeNull();
    first.unmount();
    render(<section data-pane={0}><TranscriptSlot appSessionId={APP} /></section>);
    await waitFor(() => expect(questionRow()).not.toBeNull());
    quiet();
    list([second]);
    await waitFor(() => quiet());
  });
});

// The agent rule (decision 15; §A), over the one recorded fixture that shows a producer giving requests an agent id
describe('a subagent’s requests (pass3/relay-to-child)', () => {
  it('its transcript lists its own at its end, the parent’s lists them all, and one answer settles both', async () => {
    const recorded = journalToEvents(loadJournal('pass3', 'relay-to-child')).filter((event): event is Extract<SessionEvent, { kind: 'permission.requested' }> => event.kind === 'permission.requested' && event.agentId !== null);
    const agents = [...new Set(recorded.map((event) => event.agentId!))];
    expect(agents).toHaveLength(2);
    const [child] = agents;
    const items = recorded.map((event, i) => itemFor(event, APP, { summary: `request ${i}`, createdAt: new Date(Date.parse('2026-09-29T15:00:00Z') + i * 1000).toISOString() }));
    for (const event of recorded) requests.set(event.requestId, event);
    const b = builder();
    b.turn('u1', 'Survey');
    b.toolUse('q1', 'AskUserQuestion', { questions: QUESTIONS }); // a row the waits are counted against
    events = b.events;
    act(() => useAttention.getState().applySnapshot(items, TEST_MACHINE));
    render(
      <>
        <section data-pane={0} data-testid="parent">
          <TranscriptSlot appSessionId={APP} />
        </section>
        <section data-pane={1} data-testid="child">
          <TranscriptSlot appSessionId={APP} agentId={child as AgentId} />
        </section>
      </>,
    );
    const endOf = (id: string) => screen.getByTestId(id).querySelector<HTMLElement>('[data-request-end]');
    const held = (id: string) => (endOf(id) === null ? 0 : endOf(id)!.querySelectorAll('[data-request-card]').length + endOf(id)!.querySelectorAll('[data-waiting-line]').length);
    const own = items.filter((item) => item.request.agentId === child);
    await waitFor(() => expect(held('parent')).toBe(items.length));
    await waitFor(() => expect(held('child')).toBe(own.length));
    const open = own[0]!;
    await waitFor(() => expect(within(endOf('child')!).queryByRole('button', { name: 'Allow once' })).not.toBeNull());
    fireEvent.click(within(endOf('child')!).getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answered()).toHaveLength(1));
    expect(answered()[0]).toMatchObject({ requestId: open.request.requestId });
    await act(() => fake.reply('session.answer', { outcome: 'delivered' }));
    list(items.filter((item) => item.id !== open.id));
    await waitFor(() => expect(held('parent')).toBe(items.length - 1));
    expect(held('child')).toBe(own.length - 1);
  });
});
