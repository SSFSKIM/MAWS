// UX wave U1b M5 (the U1b document, Interfaces §D "The jump button", §E `WaitingCard` and `showWaiting`; decision 19;
// acceptance 6, 7 and 10): finding what waits. The card column's card lists the session's waiting requests and each line
// goes to its request; the jump button reads "Needs you" while a request is out of view and goes to the oldest
// of them; a notification's open and ⇧⌘J go to a request once the session is in front; a request asked for before its
// transcript mounts is shown at the mount; a closed floating card's compact composer says how many wait. Every way goes
// through the transcript's one operation, so the request chosen is the one an answer then carries (asserted on the
// answer sent). Over the real transcript slot, the card's registered renderer, the attention store and the key
// dispatcher. Every question, command and id is invented.
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { bareOf } from '@shared/machine/address';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { connectAttention } from '../attention/navigation';
import { resetSurfaceRegistry } from '../engine-surface/registry';
import { ipc } from '../ipc/client';
import { connectKeys } from '../keymap/dispatcher';
import { runAction } from '../keymap/actions-runtime';
import { SessionPane } from '../session/SessionPane';
import { useFloatingCard } from '../shell/floating';
import { useAttention } from '../stores/attention';
import { registerFocusTarget, resetComposerStore } from '../stores/composer';
import { resetLaneAStore } from '../stores/lane-a';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { preloadOf } from '../test-support/preload-of';
import { resetShellStores } from '../test-support/shell-stores';
import { Transcript, TranscriptSlot, useTranscriptStore } from '../transcript';
import { useWaitingView } from '../transcript/view/waiting-view';
import { builder, request, tool } from '../transcript/model/test-events';
import { connectRequestCard } from './index';
import { itemFor, type RequestEvent } from './test-requests';
import { accessibleText } from '../test-support/accessible-text';
import { registerTranscriptActions } from '../transcript/view/registry'; // the question sheet's C3 M4
import { connectSheets, resetSheetStore, useSheets } from '../stores/sheet';
import { CLASH, FIXTURE, sheetOf } from '../sheet/test-support/questions';

const APP = at('app-finding' as AppSessionId);
const QUESTIONS = [
  { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: null, preview: null }, { label: 'Blue', description: null, preview: null }] },
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
  useNotices.setState({ notices: [] });
  events = [];
  requests = new Map();
  fake = fakeClient({
    'session.events': () => ({ events, lastSeq: events.length, complete: true }),
    'attention.request': (input: { requestId: string }) => ({ event: requests.get(input.requestId) ?? null }),
    'attention.pendingNavigate': { navigate: null },
  });
  window.maws = preloadOf(fake); // the page's real client (`ipc`) reads main's events through it
  offs = [connectKeys(), connectRequestCard()];
});
afterEach(() => {
  offs.forEach((off) => off());
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: PreloadBridge }).maws;
  vi.useRealTimers();
});

// A turn that asks a question in one call and runs two shell calls that wait for permission, as a session MAWS runs
// streams it: each request event pending, oldest first.
function scene() {
  const b = builder();
  b.turn('u1', 'Set things up');
  b.toolUse('q1', 'AskUserQuestion', { questions: QUESTIONS });
  const asked = b.emit('question.requested', { requestId: request('rq'), toolUseId: tool('q1'), questions: QUESTIONS });
  b.toolUse('b1', 'Bash', { command: 'make check' }, 'm2', 0);
  const prompt = b.emit('permission.requested', permissionOf('rp', 'b1', 'make check'));
  b.toolUse('b2', 'Bash', { command: 'make lint' }, 'm2', 1);
  const second = b.emit('permission.requested', permissionOf('rp2', 'b2', 'make lint'));
  events = b.events;
  for (const event of [asked, prompt, second]) requests.set(event.requestId, event);
  // ids addressed on the test machine, as the page holds them, so that main's bare id in a notification names them
  return {
    question: itemFor(asked as RequestEvent, APP, { id: at('att-rq' as AttentionId), summary: 'Which colour?' }),
    prompt: itemFor(prompt as RequestEvent, APP, { id: at('att-rp' as AttentionId), summary: 'Bash: make check' }),
    second: itemFor(second as RequestEvent, APP, { id: at('att-rp2' as AttentionId), summary: 'Bash: make lint' }),
  };
}

// The question sheet's C3 M4: a sheet question's item, as the spine makes it (src/shared/attention/sheet-item.ts) and the
// page holds it (addressed); it names the call that asked, here the scene's own question call, so a placement that did
// not skip it would draw a form in that row.
const SHEET = sheetOf([CLASH, FIXTURE]);
function sheetItem(questionId: string, minute: number, agentId: string | null = null): AttentionItem {
  const at0 = `2026-11-24T10:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    id: at(`sheet:${SHEET.session}:${questionId}` as AttentionId), appSessionId: APP, sessionId: SHEET.session as AttentionItem['sessionId'], kind: 'async_input',
    request: { requestId: questionId as AttentionItem['request']['requestId'], toolUseId: tool('q1'), taskId: null, agentId: agentId as AttentionItem['request']['agentId'] },
    summary: `Sentence of ${questionId}?`, createdAt: at0, state: 'pending', stateChangedAt: at0, expiresAt: null,
  };
}

// M5's own modules, read at the case's run: a red run (before they exist) fails the cases that use them, not the file.
const WAITING_CARD = './WaitingCard';
const SHOW_WAITING = './show-waiting';
const waitingCard = async (): Promise<(props: { appSessionId: AppSessionId }) => ReactNode> => ((await import(/* @vite-ignore */ WAITING_CARD)) as { WaitingCard: (props: { appSessionId: AppSessionId }) => ReactNode }).WaitingCard;
const showWaitingOf = async (): Promise<(appSessionId: AppSessionId, attentionId: AttentionId | null) => void> =>
  ((await import(/* @vite-ignore */ SHOW_WAITING)) as { showWaiting: (appSessionId: AppSessionId, attentionId: AttentionId | null) => void }).showWaiting;

const list = (items: AttentionItem[]) => act(() => useAttention.getState().applyChanged({ appSessionId: APP, items }, TEST_MACHINE));
const slot = () => <TranscriptSlot appSessionId={APP} />;
async function mount(items: AttentionItem[], beside: ReactNode = null) {
  act(() => useAttention.getState().applySnapshot(items, TEST_MACHINE));
  const view = render(
    <>
      <section data-pane={0}>{slot()}</section>
      {beside}
    </>,
  );
  await waitFor(() => expect(document.querySelector('[data-kind="question"]')).not.toBeNull());
  return view;
}
const questionRow = () => document.querySelector<HTMLElement>('.transcript-row[data-kind="question"]')!;
const end = () => document.querySelector<HTMLElement>('[data-request-end]');
const openPrompt = () => within(end()!).getByRole('group', { name: 'Approval needed' }).textContent;
const keyboardRow = () => document.activeElement?.closest('[data-row-id]')?.getAttribute('data-row-id') ?? null;
const answered = () => fake.invoked('session.answer') as { requestId: string; answer: unknown }[];
const card = () => document.querySelector<HTMLElement>('section[aria-label="Waiting for you"]');
const cardLine = (id: AttentionId) => card()!.querySelector<HTMLElement>(`[data-waiting-card-line="${id}"]`)!;
const toasts = () => useNotices.getState().notices.map((notice) => notice.text);
const GONE = 'That request is no longer waiting';

describe('the card column’s card, Waiting for you', () => {
  it('lists the session’s waiting requests oldest first: glyph in its tone, summary, who asked, age, the full text as tooltip; the count past one; absent with nothing waiting', async () => {
    const WaitingCard = await waitingCard();
    const { question, prompt, second } = scene();
    const fromAgent = { ...second, request: { ...second.request, agentId: 'agent-x' as AttentionItem['request']['agentId'] } };
    const unanswerable = { ...prompt, id: at('att-error' as AttentionId), kind: 'error' as const, request: { ...prompt.request, requestId: null } };
    act(() => useAttention.getState().applySnapshot([fromAgent, unanswerable, prompt, question], TEST_MACHINE));
    const view = render(<WaitingCard appSessionId={APP} />);
    // the word cut (N111): the heading and a bare count, named by what it counts
    const heading = within(card()!).getByRole('heading', { name: 'Waiting for you 3 requests' });
    expect(accessibleText(heading)).toBe('Waiting for you 3');
    expect(within(heading).getByRole('img', { name: '3 requests' }).tabIndex).toBe(0);
    const lines = [...card()!.querySelectorAll<HTMLElement>('[data-waiting-card-line]')];
    expect(lines.map((line) => line.dataset.waitingCardLine)).toEqual([question.id, prompt.id, second.id]);
    expect(lines.map((line) => line.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(lines[0].querySelector('[aria-hidden]')!.textContent).toBe('?');
    expect(lines[1].querySelector('[aria-hidden]')!.textContent).toBe('◐');
    expect(lines[1].querySelector('[aria-hidden]')!.className).toContain('text-warning');
    expect(lines[1].textContent).toContain('Bash: make check');
    expect(lines[1].textContent).toContain('waiting ');
    expect(lines[1].textContent).not.toContain('from ');
    expect(lines[2].textContent).toContain('from A subagent');
    expect(lines.map((line) => line.title)).toEqual(['Which colour?', 'Bash: make check', 'Bash: make lint']);
    expect(card()!.querySelectorAll('[data-request-card]')).toHaveLength(0); // no answer controls
    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [unanswerable, prompt] }, TEST_MACHINE));
    expect(card()!.querySelector('h3')!.textContent).toBe('Waiting for you');
    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [unanswerable] }, TEST_MACHINE));
    expect(card()).toBeNull();
    view.unmount();
  });

  it('with two prompts waiting and the older open, choosing the younger’s line selects it, so an allow then is sent with the younger’s request id', async () => {
    const WaitingCard = await waitingCard();
    const { prompt, second } = scene();
    await mount([prompt, second], <WaitingCard appSessionId={APP} />);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    expect(openPrompt()).toContain('make check');
    fireEvent.click(cardLine(second.id));
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    expect(openPrompt()).toContain('make lint');
    fireEvent.click(within(end()!).getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answered()).toHaveLength(1));
    expect(answered()[0]).toMatchObject({ requestId: 'rp2' });
    await act(() => fake.reply('session.answer', { outcome: 'delivered' })); // the store holds one answer in flight per item, past the case
  });

  it('a line whose request was answered meanwhile says it is no longer waiting, leaves the open card as it was and moves the keyboard nowhere', async () => {
    const WaitingCard = await waitingCard();
    const { prompt, second } = scene();
    await mount([prompt, second], <WaitingCard appSessionId={APP} />);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    // answered in another window: its delivery closed, its item not yet dropped from the list
    act(() => useAttention.setState((s) => ({ deliveries: new Map(s.deliveries).set(second.id, { phase: 'closed' }) })));
    const before = document.activeElement;
    fireEvent.click(cardLine(second.id));
    expect(toasts()).toEqual([GONE]);
    expect(document.activeElement).toBe(before);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(before);
    expect(openPrompt()).toContain('make check');
  });
});

// The question sheet's C3 M4 (§H; frame 4): a sheet question's line in the card, and its way, which is the sheet.
describe('a sheet question in Waiting for you', () => {
  let opened: [AppSessionId, string | null][];
  beforeEach(() => {
    resetSheetStore();
    opened = [];
    offs.push(registerTranscriptActions({ openSheet: (appSessionId, questionId) => void opened.push([appSessionId, questionId]) }));
  });

  it('is a line of its own: the calm mark, the question’s sentence, from <agent> named by the sheet where the rows do not know the subagent, its age', async () => {
    const WaitingCard = await waitingCard();
    const { prompt } = scene();
    offs.push(connectSheets(ipc)); // the window's sheets, as App.tsx connects them
    act(() => useSheets.setState({ summaries: new Map([[SHEET.session, { session: SHEET.session, appSessionId: APP, title: null, live: true, seq: 1, open: 2, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false }]]) }));
    act(() => useAttention.getState().applySnapshot([prompt, sheetItem('q4', 0), sheetItem('q7', 1, 'a1b2c3')], TEST_MACHINE));
    render(<WaitingCard appSessionId={APP} />);
    await waitFor(() => expect(fake.invoked('sheet.read')).toEqual([{ session: SHEET.session }])); // the sheet read for the asker's name
    await act(() => fake.reply('sheet.read', { model: SHEET, door: { known: false } }));
    const all = [...card()!.querySelectorAll<HTMLElement>('[data-waiting-card-line]')];
    expect(all.map((line) => line.dataset.waitingCardLine)).toEqual([prompt.id, sheetItem('q4', 0).id, sheetItem('q7', 1).id]); // oldest first
    const lines = all.slice(1);
    const mark = lines[0]!.querySelector('[aria-hidden]')!;
    expect([mark.textContent, mark.className.includes('text-info')]).toEqual(['?', true]);
    expect(lines[0]!.textContent).toContain('Sentence of q4?');
    expect(lines[0]!.textContent).not.toContain('from ');
    expect(lines[1]!.textContent).toContain('from reviewer');
    expect(lines[1]!.textContent).toContain('waiting ');
    // "from <agent>" is whole or not at all: never cut, and always in the line's name and title
    const from = lines[1]!.querySelector<HTMLElement>('[data-waiting-from]')!;
    expect([from.textContent, from.className.includes('truncate'), from.className.includes('whitespace-nowrap')]).toEqual(['from reviewer', false, true]);
    expect(lines[1]!.title).toBe('Sentence of q7? from reviewer');
    expect(within(card()!).getByRole('button', { name: /Sentence of q7\? from reviewer/ })).toBe(lines[1]);
  });

  it('opens the session’s sheet at its question when chosen, and nothing in the transcript', async () => {
    const WaitingCard = await waitingCard();
    const { prompt } = scene();
    await mount([prompt, sheetItem('q4', 0)], <WaitingCard appSessionId={APP} />);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    expect(questionRow().querySelector('[data-waiting-form]')).toBeNull(); // its call's row draws no form
    expect(end()!.querySelectorAll('[data-request-card]')).toHaveLength(1); // and the end no card: the prompt's alone
    const before = document.activeElement;
    fireEvent.click(cardLine(sheetItem('q4', 0).id));
    expect(opened).toEqual([[APP, 'q4']]);
    expect(toasts()).toEqual([]);
    expect(document.activeElement).toBe(before);
  });

  it('is reached from outside the transcript the same way: Needs you, a notice and ⇧⌘J open the sheet at it', async () => {
    const showWaiting = await showWaitingOf();
    act(() => useAttention.getState().applySnapshot([sheetItem('q4', 0)], TEST_MACHINE));
    act(() => showWaiting(APP, sheetItem('q4', 0).id));
    act(() => showWaiting(APP, null)); // the session's oldest waiting
    expect(opened).toEqual([[APP, 'q4'], [APP, 'q4']]);
    expect(toasts()).toEqual([]);
  });
});

describe('a way to a request from outside its transcript', () => {
  it('opening the younger from Needs you (a notification that names it) selects it, so an allow then is sent with the younger’s request id', async () => {
    const { prompt, second } = scene();
    await mount([prompt, second]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    offs.push(connectAttention(ipc));
    act(() => fake.event('attention.navigate', { appSessionId: bareOf(APP), attentionId: bareOf(second.id), source: 'notification' }));
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    expect(openPrompt()).toContain('make lint');
    fireEvent.click(within(end()!).getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answered()).toHaveLength(1));
    expect(answered()[0]).toMatchObject({ requestId: 'rp2' });
    await act(() => fake.reply('session.answer', { outcome: 'delivered' }));
  });

  it('⇧⌘J lands on the oldest request of the session it opens', async () => {
    const showWaiting = await showWaitingOf();
    const { prompt, second } = scene();
    act(() => useSessions.setState({ records: new Map([[APP, record(APP)]]) }));
    await mount([prompt, second]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    act(() => showWaiting(APP, second.id)); // the younger open first
    await waitFor(() => expect(openPrompt()).toContain('make lint'));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    offs.push(connectAttention(ipc));
    act(() => runAction('attention.next'));
    await waitFor(() => expect(openPrompt()).toContain('make check'));
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
  });

  it('a request asked for before its transcript mounts is shown at the mount, checked again there', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    act(() => showWaiting(APP, second.id));
    expect(toasts()).toEqual([]);
    render(<section data-pane={0}>{slot()}</section>);
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    expect(openPrompt()).toContain('make lint');
    cleanup();
    for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);

    act(() => showWaiting(APP, second.id));
    list([question, prompt]); // answered before the mount
    render(<section data-pane={0}>{slot()}</section>);
    await waitFor(() => expect(toasts()).toEqual([GONE]));
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    expect(openPrompt()).toContain('make check');
    expect(keyboardRow()).toBeNull();
  });

  // The review of M5 (its Important finding): a request remembered for a transcript not yet mounted belongs to the
  // navigation that asked for it. The person moving to another session, or any later call, lets it go.
  const OTHER = at('app-elsewhere' as AppSessionId);
  const front = (id: AppSessionId) => act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: id }, { pane: 'focused' }));
  const settleFrames = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  async function mountLater() {
    render(<section data-pane={0}>{slot()}</section>);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    await settleFrames();
  }

  it('a remembered request is let go once the person moves to another session: its transcript ready later focuses nothing', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    front(APP);
    act(() => showWaiting(APP, second.id));
    front(OTHER);
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
    expect(toasts()).toEqual([]);
  });

  it('a remembered request does not fire on a later visit after the person left and came back', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    front(APP);
    act(() => showWaiting(APP, second.id));
    front(OTHER);
    front(APP);
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
  });

  // The re-review of M5: leaving for no session at all (a page, the Overview) is leaving too.
  it.each([
    ['a page', () => useLayout.getState().openDestination({ kind: 'library' })],
    ['the Overview', () => useLayout.getState().setOverviewOpen(true)],
  ])('a remembered request is let go when the person leaves for %s: its transcript ready later focuses nothing', async (_, leave) => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    front(APP);
    act(() => showWaiting(APP, second.id));
    act(() => leave());
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
    expect(toasts()).toEqual([]);
  });

  it('a remembered request does not fire after the person left for a page and came back', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    front(APP);
    act(() => showWaiting(APP, second.id));
    act(() => useLayout.getState().openDestination({ kind: 'library' }));
    front(APP); // opening the session's tab closes the page
    expect(useLayout.getState().destination).toBeNull();
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
  });

  // The third review pass: a floating card behind a page is no session in front.
  const carriedByCard = () =>
    act(() => {
      useLayout.setState((s) => ({
        main: { ...s.main, panes: [{ tabs: [{ id: `session:${APP}`, kind: 'session', appSessionId: APP, pinned: false }], activeTabId: `session:${APP}` }] },
        regions: { ...s.regions, panel: { ...s.regions.panel, collapsed: false, floating: true } },
        panelBySession: new Map([[APP, { tabs: [{ id: 'terminal-1', toolId: 'terminal', pinned: false }], activeTabId: 'terminal-1' }]]),
      }));
      useFloatingCard.setState({ closed: false });
    });

  it('a remembered request for a session in the floating card is let go when a page covers the shell', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    carriedByCard();
    act(() => showWaiting(APP, second.id));
    act(() => useLayout.getState().openDestination({ kind: 'library' }));
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
  });

  it('a remembered request for a session in the floating card does not fire after a page came and went', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    carriedByCard();
    act(() => showWaiting(APP, second.id));
    act(() => useLayout.getState().openDestination({ kind: 'library' }));
    act(() => useLayout.getState().closeDestination());
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
  });

  it('a remembered request still lands when the session stays in front until its transcript is ready', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    front(APP);
    act(() => showWaiting(APP, second.id));
    render(<section data-pane={0}>{slot()}</section>);
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    expect(openPrompt()).toContain('make lint');
  });

  it('a later call, even one that finds nothing to show, lets the remembered request go', async () => {
    const showWaiting = await showWaitingOf();
    const { question, prompt, second } = scene();
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    front(APP);
    act(() => showWaiting(APP, second.id));
    act(() => showWaiting(OTHER, null)); // nothing of that session waits
    await mountLater();
    expect(keyboardRow()).toBeNull();
    expect(openPrompt()).toContain('make check');
    expect(toasts()).toEqual([]);
  });

  // the word cut (N113): "Waiting for you 3", a bare count whose meaning is the line's name and its tooltip; the line stays
  // a worded button, the count's one focusable owner
  it('a closed floating card’s compact composer reads Waiting for you N while N wait; its click opens the card and goes to the oldest', async () => {
    const { question, prompt, second } = scene();
    act(() => useSessions.setState({ records: new Map([[APP, record(APP)]]) }));
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    act(() => useFloatingCard.setState({ closed: true }));
    const compact = render(<SessionPane appSessionId={APP} paneIndex={0} compact />);
    const line = compact.getByRole('button', { name: 'Waiting for you 3 requests' });
    expect(line.textContent).toBe('Waiting for you 3');
    list([prompt, second]);
    expect(line.textContent).toBe('Waiting for you 2');
    expect(line.getAttribute('aria-describedby')).toBeNull(); // the meaning is in the name: no description repeats it
    act(() => line.focus());
    expect(compact.getByRole('tooltip').textContent).toBe('2 requests'); // the keyboard reaches the tooltip
    expect(line.getAttribute('aria-describedby')).toBeNull(); // and the open tooltip does not repeat the name as a description
    fireEvent.click(line);
    expect(useFloatingCard.getState().closed).toBe(false);
    compact.unmount();
    render(<section data-pane={0}>{slot()}</section>);
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    expect(openPrompt()).toContain('make check');
    cleanup();
    list([]);
    const none = render(<SessionPane appSessionId={APP} paneIndex={0} compact />);
    expect(none.queryByRole('button', { name: /Waiting for you/ })).toBeNull();
  });

  // The card's transcript, its history already read, shows the request in the commit the card mounts in, and its row
  // takes the keyboard a frame later; the card's composer registers in the same commit, after the transcript, and its
  // editor focuses in a frame it queues then (Tiptap's `commands.focus()`), so a composer marked to take the keyboard as
  // it mounts would take it from the row. The line opens the card without that mark.
  it('after the compact composer’s line opens the card, the keyboard stays on the request’s row as the card’s composer mounts beside its transcript', async () => {
    function FrameComposer() {
      const field = useRef<HTMLTextAreaElement>(null);
      useEffect(
        () =>
          registerFocusTarget(APP, {
            focusFrame: () => void requestAnimationFrame(() => field.current?.focus()),
          } as unknown as Parameters<typeof registerFocusTarget>[1]),
        [],
      );
      return <textarea ref={field} aria-label="Message" />;
    }
    const cardPane = () => (
      <section data-pane="card">
        {slot()}
        <FrameComposer />
      </section>
    );
    const { prompt, second } = scene(); // two prompts, both at the end: the oldest is the open one
    act(() => useSessions.setState({ records: new Map([[APP, record(APP)]]) }));
    act(() => useAttention.getState().applySnapshot([prompt, second], TEST_MACHINE));
    carriedByCard();
    const open = render(cardPane()); // the card open: its transcript reads the history
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    await settleFrames();
    open.unmount();
    act(() => useFloatingCard.setState({ closed: true }));
    const compact = render(<SessionPane appSessionId={APP} paneIndex={0} compact />);
    fireEvent.click(compact.getByRole('button', { name: 'Waiting for you 2 requests' }));
    expect(useFloatingCard.getState().closed).toBe(false);
    compact.unmount();
    render(cardPane());
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    await settleFrames();
    await settleFrames();
    expect(keyboardRow()).toBe('request-end');
    expect(openPrompt()).toContain('make check');
  });
});

// happy-dom never fires an `IntersectionObserver`: these cases stand one in for the transcript's own, the one rooted at
// its scroll element, and report which tracked elements intersect it.
describe('the jump button', () => {
  const observers = new Set<{ root: Element | null; callback: IntersectionObserverCallback; targets: Set<Element> }>();
  const real = globalThis.IntersectionObserver;
  beforeEach(() => {
    observers.clear();
    globalThis.IntersectionObserver = class {
      private readonly watch: { root: Element | null; callback: IntersectionObserverCallback; targets: Set<Element> };
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.watch = { root: (options?.root as Element | undefined) ?? null, callback, targets: new Set() };
        observers.add(this.watch);
      }
      observe(target: Element) {
        this.watch.targets.add(target);
      }
      unobserve(target: Element) {
        this.watch.targets.delete(target);
      }
      disconnect() {
        observers.delete(this.watch);
      }
      takeRecords = () => [];
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = real;
  });
  const scroller = () => document.querySelector<HTMLElement>('[data-transcript-scroller]')!;
  const rooted = () => [...observers].filter((watch) => watch.root !== null && watch.root === scroller());
  const see = (visible: (element: Element) => boolean) =>
    act(() => {
      for (const watch of rooted()) {
        const entries = [...watch.targets].map((target) => ({ target, isIntersecting: visible(target), intersectionRatio: visible(target) ? 1 : 0 }) as unknown as IntersectionObserverEntry);
        if (entries.length > 0) watch.callback(entries, watch as unknown as IntersectionObserver);
      }
    });
  const atEnd = (element: Element) => element.matches('[data-request-end]');
  const inRow = (element: Element) => element.matches('[data-waiting-form]');
  const jump = () => document.querySelector<HTMLButtonElement>('.transcript-jump');
  const PILL = 'Needs your input. Scroll to the request';

  it('state by state: nothing while following with every request in view; the pill while one is out of view, following or not; the round button once nothing is', async () => {
    const { prompt } = scene();
    await mount([prompt]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    expect(rooted()).toHaveLength(1);
    see(atEnd);
    expect(jump()).toBeNull();
    see(() => false); // the reader at the end, the end card scrolled out of the scroller
    await waitFor(() => expect(jump()?.dataset.state).toBe('input'));
    expect(jump()!.getAttribute('aria-label')).toBe(PILL);
    expect(jump()!.hasAttribute('title')).toBe(false); // the word cut (N110): its name keeps the sentence, no tooltip
    expect(jump()!.textContent).toBe('◐Needs you'); // N109: the sidebar's words
    fireEvent.wheel(scroller(), { deltaY: -100 }); // the reader turns back: no longer following
    expect(jump()?.dataset.state).toBe('input');
    see(atEnd);
    await waitFor(() => expect(jump()?.getAttribute('aria-label')).toBe('Jump to latest'));
    expect(jump()!.dataset.state).toBeUndefined();
    see(() => false);
    await waitFor(() => expect(jump()?.dataset.state).toBe('input'));
    list([]); // answered: the button is the round one again
    await waitFor(() => expect(jump()?.getAttribute('aria-label')).toBe('Jump to latest'));
  });

  it('an element tracked again for the same request within one commit is the only one observed', async () => {
    const { prompt } = scene();
    act(() => useAttention.getState().applySnapshot([prompt], TEST_MACHINE));
    const made: HTMLElement[] = [];
    function Retrack() {
      const { track } = useWaitingView();
      useLayoutEffect(() => {
        const [old, next] = [document.createElement('div'), document.createElement('div')];
        made.push(old, next);
        track(prompt.id, old);
        track(prompt.id, null);
        track(prompt.id, next);
      }, [track]);
      return null;
    }
    const source = { key: APP, subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
    render(<section data-pane={0}><Transcript source={source} variant="session" renderRequest={() => <Retrack />} /></section>);
    await waitFor(() => expect(made).toHaveLength(2));
    await act(() => Promise.resolve());
    const [watch] = rooted();
    expect(watch.targets.has(made[1])).toBe(true);
    expect(watch.targets.has(made[0])).toBe(false);
  });

  it('a desk transcript’s key names no MAWS session: no observer, nothing placed', async () => {
    const { prompt } = scene();
    // the session a desk key's prefix would be misread as, given a waiting request
    act(() => useAttention.getState().applySnapshot([{ ...prompt, appSessionId: 'desk' as AppSessionId }], TEST_MACHINE));
    const source = { key: 'desk:proj:sess-1', subscribe: () => () => {}, snapshot: () => Promise.resolve(events) };
    render(<Transcript source={source} variant="session" renderRequest={() => <div data-desk-slot="" />} />);
    await waitFor(() => expect(document.querySelector('[data-kind="question"]')).not.toBeNull());
    expect([...observers].filter((watch) => watch.root !== null)).toEqual([]);
    expect(document.querySelector('[data-row-id="request-end"]')).toBeNull();
    expect(document.querySelector('[data-desk-slot]')).toBeNull();
    expect(jump()).toBeNull();
  });

  it('a question in its row above a reader at the end raises the pill though the reader follows; the pill goes to the oldest out of view, by row and by the end', async () => {
    const WaitingCard = await waitingCard();
    const { question, prompt, second } = scene();
    await mount([question, prompt, second], <WaitingCard appSessionId={APP} />);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    await waitFor(() => expect(questionRow().querySelector('[data-waiting-form]')).not.toBeNull());
    see(atEnd);
    await waitFor(() => expect(jump()?.dataset.state).toBe('input'));
    fireEvent.click(jump()!);
    await waitFor(() => expect(document.activeElement).toBe(questionRow()));

    fireEvent.click(cardLine(second.id)); // the younger prompt open at the end
    await waitFor(() => expect(openPrompt()).toContain('make lint'));
    see(inRow); // the question in view, the end out of it
    await waitFor(() => expect(jump()?.dataset.state).toBe('input'));
    fireEvent.click(jump()!);
    await waitFor(() => expect(openPrompt()).toContain('make check')); // the oldest out of view is the older prompt
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    see(() => true);
    await waitFor(() => expect(jump()).toBeNull());
  });

  // The question sheet's C3 M4 (the look's L4, the owner's answer): an open sheet question does not raise the pill
  it('with a prompt and a sheet question waiting the pill is the prompt’s; with sheet questions alone it is the plain arrow', async () => {
    const { prompt } = scene();
    const view = await mount([prompt, sheetItem('q4', 0)]);
    await waitFor(() => expect(end()?.querySelector('[data-request-card]')).not.toBeNull());
    see(() => false);
    await waitFor(() => expect(jump()?.dataset.state).toBe('input'));
    fireEvent.click(jump()!);
    await waitFor(() => expect(keyboardRow()).toBe('request-end'));
    view.unmount();
    list([sheetItem('q4', 0)]);
    await mount([sheetItem('q4', 0)]);
    fireEvent.wheel(scroller(), { deltaY: -100 });
    see(() => false);
    await waitFor(() => expect(jump()?.getAttribute('aria-label')).toBe('Jump to latest'));
    expect(jump()!.dataset.state).toBeUndefined();
  });
});
