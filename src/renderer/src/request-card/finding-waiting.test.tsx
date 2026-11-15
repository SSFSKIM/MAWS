// UX wave U1b M5 (the U1b document, Interfaces §D "The jump button", §E `WaitingCard` and `showWaiting`; decision 19;
// acceptance 6, 7 and 10): finding what waits. The card column's card lists the session's waiting requests and each line
// goes to its request; the jump button reads "Needs your input" while a request is out of view and goes to the oldest
// of them; a notification's open and ⇧⌘J go to a request once the session is in front; a request asked for before its
// transcript mounts is shown at the mount; a closed floating card's compact composer says how many wait. Every way goes
// through the transcript's one operation, so the request chosen is the one an answer then carries (asserted on the
// answer sent). Over the real transcript slot, the card's registered renderer, the attention store and the key
// dispatcher. Every question, command and id is invented.
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
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
import { resetComposerStore } from '../stores/composer';
import { resetLaneAStore } from '../stores/lane-a';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { TranscriptSlot, useTranscriptStore } from '../transcript';
import { builder, request, tool } from '../transcript/model/test-events';
import { connectRequestCard } from './index';
import { itemFor, type RequestEvent } from './test-requests';

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
  return {
    question: itemFor(asked as RequestEvent, APP, { summary: 'Which colour?' }),
    prompt: itemFor(prompt as RequestEvent, APP, { summary: 'Bash: make check' }),
    second: itemFor(second as RequestEvent, APP, { summary: 'Bash: make lint' }),
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
    const unanswerable = { ...prompt, id: 'att-error' as AttentionId, kind: 'error' as const, request: { ...prompt.request, requestId: null } };
    act(() => useAttention.getState().applySnapshot([fromAgent, unanswerable, prompt, question], TEST_MACHINE));
    const view = render(<WaitingCard appSessionId={APP} />);
    expect(card()!.querySelector('h3')!.textContent).toBe('Waiting for you · 3');
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

  it('a closed floating card’s compact composer reads Waiting for you · N while N wait; its click opens the card and goes to the oldest', async () => {
    const { question, prompt, second } = scene();
    act(() => useSessions.setState({ records: new Map([[APP, record(APP)]]) }));
    act(() => useAttention.getState().applySnapshot([question, prompt, second], TEST_MACHINE));
    act(() => useFloatingCard.setState({ closed: true }));
    const compact = render(<SessionPane appSessionId={APP} paneIndex={0} compact />);
    const line = compact.getByRole('button', { name: 'Waiting for you · 3' });
    list([prompt, second]);
    expect(line.textContent).toBe('Waiting for you · 2');
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
    expect(jump()!.title).toBe(PILL);
    expect(jump()!.textContent).toBe('◐Needs your input');
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
});
