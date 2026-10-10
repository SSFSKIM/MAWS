// P2-E1 (M2): the comment card's thread phase (P2-E1 document, D5 and D6; acceptance 3, 4 and 5). A card's Side thread
// turns the card into the thread (no Side tool, no toast; the comment echoed until the thread's anchored prompt
// arrives, then the thread's own rows through the shell's transcript); Reply goes through the human send seam with its
// dispositions read in one place (a reply that started its thread is already the host's); the needs-you strip names what waits; the card yields to the Side pane or a main tab and publishes its
// thread while on screen; a thread whose card went before the fork answered is revealed as the sheet does.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { anchoredMessage } from '@shared/anchor/message';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { Lineage } from '@shared/graph/session';
import { tabId } from '@shared/ipc/schema/layout';
import { deliverableUrl } from '@shared/maws/deliverable';
import { item, record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { sendHumanPrompt } from '../../composer/submit/send-human-prompt';
import { useSetup } from '../../sessions/store';
import { useAttention } from '../../stores/attention';
import { useLayout } from '../../stores/layout';
import { isOpen } from '../../stores/layout-model';
import { useNotices } from '../../stores/notices';
import { resetQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { A, panelOf, resetPanelStores } from '../../test-support/panel';
import { resetSetupStore, trustState } from '../../test-support/setup-intents';
import { deliverables, lookupKey } from '../../tools/deliverables/store';
import { openCommentComposer, registerCommentComposer } from '../../tools/code/anchor/anchor';
import { registerRequestRenderer, registerTranscriptActions, useTranscriptStore } from '../../transcript';
import { builder, request, tool, uuid } from '../../transcript/model/test-events';
import { SIDE_TOOL_ID } from '../actions';
import { openComment, registerSidePane } from '../register';
import { showSideChild, sidePaneOf, useSidePane } from '../store';
import { CommentCardHost, type CardFrame } from './CardHost';
import { useCommentCard } from './store';

vi.mock('../../composer/submit/send-human-prompt', async (original) => ({ ...(await original<typeof import('../../composer/submit/send-human-prompt')>()), sendHumanPrompt: vi.fn() }));
const seam = vi.mocked(sendHumanPrompt);

const PARENT = A;
const RECORD = '00000000-0000-4000-8000-0000000000e1';
const ANCHOR: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v1 › h1#hero “Sales overview”', pageUrl: deliverableUrl(PARENT, RECORD, 1) };
const COMMENT = 'Make the heading larger';
const REPLY = 'Done: the heading is now 48 px.';
const HOST_BOX = { width: 600, height: 800 };
const EMPTY_QUEUE = { entries: [], paused: false, pauseReason: null, steers: [], withdrawn: [] };

// jsdom lays nothing out: the host measures this box, and the virtualiser a viewport and a height per row
const sizes = {
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!,
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')!,
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!,
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => {
  for (const [key, descriptor] of Object.entries(sizes)) Object.defineProperty(HTMLElement.prototype, key, descriptor);
});

let fake: FakeClient;
let child: AppSessionId;
let snapshot: SessionEvent[];
let queue: unknown;
let serial = 0;
const showVersion = vi.fn();
const offs: (() => void)[] = [];

beforeEach(() => {
  resetPanelStores();
  resetSetupStore();
  resetQueueStore();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  useAttention.setState({ bySession: new Map() });
  registerSidePane();
  offs.push(registerCommentComposer(openComment));
  child = `c5555555-5555-4555-8555-${String(++serial).padStart(12, '0')}` as AppSessionId;
  snapshot = [];
  queue = EMPTY_QUEUE;
  seam.mockReset();
  showVersion.mockClear();
  fake = fakeClient({
    'side.thread.open': { status: 'starting', appSessionId: child },
    'session.intent.get': null,
    'session.events': () => ({ events: snapshot, lastSeq: snapshot.length, complete: true }),
    'session.queue.list': () => queue,
  });
  window.maws = fake.client;
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  useCommentCard.setState({ open: null, shownThread: null });
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  deliverables.setState({ lookups: new Map() });
});

const FRAME: CardFrame = { scale: 1, offset: { x: 0, y: 0 }, key: 'k1', showVersion };

function mount() {
  return render(
    <div className="relative">
      <CommentCardHost hostId="h1" host="deliverable" mode="panel" layout="anchored" accepts={() => true} frame={FRAME} visible />
    </div>,
  );
}

const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const lineage = (): Lineage => ({ kind: 'side-thread', parentAppSessionId: PARENT, parentEngineSessionId: null, anchor: ANCHOR, openedBy: 'comment' });
const withRecord = () => act(() => useSessions.setState({ records: new Map(useSessions.getState().records).set(child, { ...record(child), lineage: lineage() }) }));
const replyField = () => screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
const push = (events: SessionEvent[]) => act(() => fake.event('session.eventBatch', { appSessionId: child, events }));

// Pick, type the comment, Enter: the fork answers at once and the card turns into the thread.
async function intoThread() {
  mount();
  act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'deliverable', hostId: 'h1', rect: { x: 24, y: 0, width: 300, height: 90 } } }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), `${COMMENT}{Enter}`);
  await waitFor(() => expect(card()?.dataset.cardPhase).toBe('thread'));
}

// The thread's own turn: its anchored prompt (with the chip) and the reply.
function threadTurn(b = builder()) {
  b.turn('t1', anchoredMessage({ anchor: ANCHOR, text: COMMENT, destination: 'thread', screenshot: false }));
  b.text('m1', 0, REPLY);
  b.end(['t1']);
  return b;
}

describe('the card becomes the thread', () => {
  it('Side thread adds no Side tool and no toast; the comment is echoed with “Starting…” until the thread’s anchored prompt arrives, then the thread’s rows', async () => {
    await intoThread();
    expect(useCommentCard.getState().open?.phase).toEqual({ kind: 'thread', child, echo: COMMENT });
    expect(panelOf(PARENT)?.tabs.some((t) => t.toolId === SIDE_TOOL_ID) ?? false).toBe(false);
    expect(useNotices.getState().notices).toEqual([]);
    const echo = card()!.querySelector('[data-card-echo]')!;
    expect(echo.textContent).toContain(COMMENT);
    expect(echo.textContent).toContain('Starting…');
    expect(replyField().disabled).toBe(true); // no record yet

    withRecord();
    await waitFor(() => expect(useTranscriptStore.getState().entries[child]?.phase).toBe('live'));
    expect(card()!.querySelector('[data-card-echo]')).not.toBeNull(); // loaded, nothing of the thread's yet

    push(threadTurn().events);
    await waitFor(() => expect(card()!.querySelector('[data-card-echo]')).toBeNull());
    const thread = within(card()!);
    expect(thread.getByText(COMMENT)).toBeTruthy();
    expect(card()!.querySelector('[data-chip="anchor"]')?.textContent).toBe(ANCHOR.label);
    expect(thread.getByText(REPLY)).toBeTruthy();
    expect(replyField().disabled).toBe(false);
  });

  it('a thread read from disk starts at its anchored prompt: none of the parent’s copied history', async () => {
    const b = builder();
    b.turn('p1', 'The parent’s copied prompt');
    b.text('pm1', 0, 'The parent’s copied answer.');
    b.end(['p1']);
    snapshot = threadTurn(b).events;
    await intoThread();
    withRecord();
    await waitFor(() => expect(within(card()!).getByText(REPLY)).toBeTruthy());
    expect(card()!.textContent).not.toContain('The parent’s copied');
  });

  it('the owner channel’s marks draw through MAWS’s presenter, without the resume line', async () => {
    const b = builder();
    b.turn('t1', anchoredMessage({ anchor: ANCHOR, text: COMMENT, destination: 'thread', screenshot: false }));
    b.text('m1', 0, '<need-input>Larger by how much?</need-input>');
    b.end(['t1']);
    snapshot = b.events;
    await intoThread();
    withRecord();
    await waitFor(() => expect(card()!.querySelector('[data-owner-report]')).not.toBeNull());
    expect(card()!.textContent).not.toContain('<need-input>');
    expect(card()!.textContent).not.toContain('Resume this session to answer.');
  });

  it('a Side thread send answered after the card closed reveals the thread as the sheet does', async () => {
    fake = fakeClient({ 'session.intent.get': null });
    window.maws = fake.client;
    mount();
    act(() => openCommentComposer(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'deliverable', hostId: 'h1' } }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), `${COMMENT}{Enter}`);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: child }));
    expect(sidePaneOf(useSidePane.getState(), PARENT).view).toEqual({ kind: 'thread', childAppSessionId: child });
    expect(panelOf(PARENT)?.tabs.some((t) => t.toolId === SIDE_TOOL_ID)).toBe(true);
    expect(useCommentCard.getState().open).toBeNull();
  });
});

describe('Reply through the human send seam', () => {
  async function ready() {
    snapshot = threadTurn().events;
    await intoThread();
    withRecord();
    await waitFor(() => expect(within(card()!).getByText(REPLY)).toBeTruthy());
  }

  it('sends with origin comment; sent, steered and queued clear the field', async () => {
    await ready();
    for (const disposition of ['sent', 'steered', 'queued'] as const) {
      seam.mockResolvedValueOnce(disposition === 'queued' ? { disposition, started: false, queueId: 'q1' } : { disposition, started: false });
      await userEvent.type(replyField(), `Also the subtitle{Enter}`);
      await waitFor(() => expect(replyField().value).toBe(''));
      expect(card()!.querySelector('[role="alert"]')).toBeNull();
    }
    expect(seam.mock.calls.map(([id, content, options]) => [id, content, options])).toEqual(Array(3).fill([child, 'Also the subtitle', { origin: 'comment' }]));
  });

  it('refused keeps the text with the reason and Retry; a thrown host error reads as a refusal with its message', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'refused', started: false, reason: 'The session is starting' });
    await userEvent.type(replyField(), 'Again{Enter}');
    await waitFor(() => expect(within(card()!).getByRole('alert').textContent).toContain('The session is starting'));
    expect(replyField().value).toBe('Again');

    seam.mockRejectedValueOnce(new Error('host write failed'));
    await userEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(card()!).getByRole('alert').textContent).toContain('host write failed'));
    expect(replyField().value).toBe('Again');

    seam.mockResolvedValueOnce({ disposition: 'sent', started: false });
    await userEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(replyField().value).toBe(''));
    expect(card()!.querySelector('[role="alert"]')).toBeNull();
    expect(seam).toHaveBeenCalledTimes(3);
  });

  it('a refusal while the thread’s engine exited without a budget release also offers the Side pane, where Resume is', async () => {
    await ready();
    act(() => useSessions.setState({ engine: new Map(useSessions.getState().engine).set(child, status(child, { process: 'exited' } as never)) }));
    seam.mockResolvedValueOnce({ disposition: 'refused', started: false, reason: 'The session has ended' });
    await userEvent.type(replyField(), 'Again{Enter}');
    const alert = await waitFor(() => within(card()!).getByRole('alert'));
    await userEvent.click(within(alert).getByRole('button', { name: 'Open in Side pane' }));
    expect(sidePaneOf(useSidePane.getState(), PARENT).view).toEqual({ kind: 'thread', childAppSessionId: child });
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('queued: the host queue’s held bubble at the thread’s tail, replaced by the user row once the host submits it', async () => {
    await ready();
    const held = { queueId: 'q1', appSessionId: child, content: 'Also the subtitle', createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    seam.mockImplementationOnce(async () => {
      fake.event('session.queue', { appSessionId: child, ...EMPTY_QUEUE, entries: [held] });
      return { disposition: 'queued', started: false, queueId: 'q1' };
    });
    await userEvent.type(replyField(), 'Also the subtitle{Enter}');
    const heldBubble = () => card()!.querySelector('[data-pending="held"]');
    await waitFor(() => expect(heldBubble()?.textContent).toContain('Also the subtitle'));

    const b = threadTurn();
    b.turn('t2', 'Also the subtitle');
    act(() => fake.event('session.queue', { appSessionId: child, ...EMPTY_QUEUE }));
    push(b.events);
    await waitFor(() => expect(heldBubble()).toBeNull());
    expect(within(card()!).getAllByRole('region', { name: 'Your message' }).at(-1)!.textContent).toContain('Also the subtitle');
  });

  // L121 (P2-F): Desktop's "Sent to Claude" on the reply's row, by X22's delivered rule (the engine's `started` for the
  // uuid beside the host's own row, or a replayed one), never by the host's optimistic write alone
  it('marks a sent reply’s row “Sent to Claude” once the engine starts it, and not before', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'sent', started: false, messageUuid: uuid('t2') });
    await userEvent.type(replyField(), 'Also the subtitle{Enter}');
    await waitFor(() => expect(replyField().value).toBe(''));
    const b = threadTurn();
    b.turn('t2', 'Also the subtitle');
    push(b.events.slice(-2)); // the host's own row: not delivered yet
    const replyRow = () => within(card()!).getAllByRole('region', { name: 'Your message' }).at(-1)!;
    await waitFor(() => expect(replyRow().textContent).toContain('Also the subtitle'));
    await act(async () => {});
    expect(replyRow().textContent).not.toContain('Sent to Claude');
    push([b.emit('command.lifecycle', { commandUuid: uuid('t2'), state: 'started' })]);
    await waitFor(() => expect(replyRow().textContent).toContain('Sent to Claude'));
    const rows = within(card()!).getAllByRole('region', { name: 'Your message' });
    expect(rows[0]!.textContent, 'the comment the card did not send this time carries no mark').not.toContain('Sent to Claude');
  });

  it('a queued reply is marked once the host releases it under its minted uuid and the engine starts it', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'queued', started: false, queueId: 'q3' });
    await userEvent.type(replyField(), 'Later then{Enter}');
    await waitFor(() => expect(replyField().value).toBe(''));
    const b = threadTurn();
    b.emit('queue.transition', { action: 'release', queueId: 'q3', messageUuid: uuid('t3'), reason: null }); // the host's release, journalled
    b.turn('t3', 'Later then');
    b.emit('command.lifecycle', { commandUuid: uuid('t3'), state: 'started' });
    push(b.events.slice(-4));
    await waitFor(() => expect(within(card()!).getAllByRole('region', { name: 'Your message' }).at(-1)!.textContent).toContain('Sent to Claude'));
  });

  // P2-A's final shape: the seam starts a released thread first and then sends, so a started reply is already the host's
  it('a reply that started its thread is sent: the field clears and Reply stays enabled', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'sent', started: true, messageUuid: 'm' as never });
    await userEvent.type(replyField(), 'Wake up and do it{Enter}');
    await waitFor(() => expect(replyField().value).toBe(''));
    expect(replyField().disabled).toBe(false);
    expect(card()!.querySelector('[role="alert"]')).toBeNull();
  });

  // Whole-branch review (fix wave): a released thread whose host queue is paused resumes with the reply queued; the held
  // bubble draws it, the card draws no bubble of its own and the field is free
  it('started, then the reply held by the host queue: one bubble (the held one) and Reply enabled', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'queued', started: true, queueId: 'q2' });
    await userEvent.type(replyField(), 'Wake up and do it{Enter}');
    await waitFor(() => expect(replyField().value).toBe(''));
    const held = { queueId: 'q2', appSessionId: child, content: 'Wake up and do it', createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    act(() => fake.event('session.queue', { appSessionId: child, ...EMPTY_QUEUE, paused: true, pauseReason: 'user', entries: [held] }));
    await waitFor(() => expect(card()!.querySelector('[data-pending="held"]')?.textContent).toContain('Wake up and do it'));
    expect(replyField().disabled).toBe(false);
  });

  // P2-F F-C1 (C scalpel-3#1): as the comment form's own refusal after its presentation went
  it.each([
    ['Close', () => userEvent.click(within(card()!).getByRole('button', { name: 'Close' }))],
    ['Open as tab', () => userEvent.click(within(card()!).getByRole('button', { name: 'Open as tab' }))],
  ])('a reply refused after the card went (%s) is a toast with its reason, the reply one click from the clipboard', async (_way, leave) => {
    await ready();
    let answer!: (result: Awaited<ReturnType<typeof sendHumanPrompt>>) => void;
    seam.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await userEvent.type(replyField(), 'Also the subtitle{Enter}');
    await leave();
    expect(card()).toBeNull();
    await act(async () => answer({ disposition: 'refused', started: false, reason: 'The session has ended' }));
    const notices = useNotices.getState().notices;
    expect(notices.map((n) => n.text)).toEqual(['The reply was not sent: The session has ended']);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    notices[0]!.actions.find((a) => a.label === 'Copy reply')!.run();
    expect(writeText).toHaveBeenCalledWith('Also the subtitle');
  });

  it('a reply the seam took after the card went says nothing', async () => {
    await ready();
    let answer!: (result: Awaited<ReturnType<typeof sendHumanPrompt>>) => void;
    seam.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await userEvent.type(replyField(), 'Also the subtitle{Enter}');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    await act(async () => answer({ disposition: 'sent', started: false }));
    expect(useNotices.getState().notices).toEqual([]);
  });
});

describe('needs you', () => {
  it('a pending permission: the request card in the thread, and the strip above Reply with Open in Side pane and Open as tab', async () => {
    offs.push(registerRequestRenderer((slot) => <div data-request-card="">{`Approval needed · ${slot.requestId}`}</div>));
    const b = threadTurn();
    b.turn('t2', 'Edit the page');
    b.toolUse('e1', 'Edit', { file_path: '/r/dashboard.html' });
    b.emit('permission.requested', { requestId: request('r1'), toolUseId: tool('e1'), toolName: 'Edit', displayName: null, input: {}, description: null, decisionReasonType: null, suggestions: [], blockedPath: null });
    snapshot = b.events;
    await intoThread();
    withRecord();
    act(() => useAttention.setState({ bySession: new Map([[child, [item(child, 'permission', new Date().toISOString())]]]) }));
    await waitFor(() => expect(card()!.querySelector('[data-request-card]')?.textContent).toBe('Approval needed · r1'));
    const strip = card()!.querySelector<HTMLElement>('[data-needs-you]')!;
    expect(strip.dataset.needsYou).toBe('attention');
    expect(strip.textContent).toContain('Waiting for your permission');
    expect(within(strip).getByRole('button', { name: 'Open in Side pane' })).toBeTruthy();
    expect(within(strip).getByRole('button', { name: 'Open as tab' })).toBeTruthy();
  });

  it('a start waiting on a trust card shows the strip alone, its words the card’s', async () => {
    await intoThread();
    act(() => useSetup.getState().dock(child, { kind: 'trust', trust: trustState(), message: null }));
    const strip = card()!.querySelector<HTMLElement>('[data-needs-you]')!;
    expect(strip.dataset.needsYou).toBe('setup-card');
    expect(strip.textContent).toContain('Waiting for you to trust this folder');
  });

  it('a terminal holding the thread: “Held by …” with Open as tab only, and Reply disabled', async () => {
    await intoThread();
    act(() => useSessions.setState({ records: new Map(useSessions.getState().records).set(child, { ...record(child), lineage: lineage(), holder: { kind: 'terminal', pid: 4242 } }) }));
    const strip = card()!.querySelector<HTMLElement>('[data-needs-you]')!;
    expect(strip.textContent).toContain('Held by terminal · 4242');
    expect(within(strip).queryByRole('button', { name: 'Open in Side pane' })).toBeNull();
    expect(within(strip).getByRole('button', { name: 'Open as tab' })).toBeTruthy();
    expect(replyField().disabled).toBe(true);
  });
});

// P2-F F-C1 (C scalpel-3#2): a nested layer's Escape (the turn summary's Radix popover, portalled out of the card's DOM
// but bubbling through its React tree) closes that layer only; the card and its unsent Reply stay
describe('Escape in a nested layer', () => {
  it('closes the turn summary and leaves the card open with its draft; the next Escape dismisses the card', async () => {
    const b = builder(); // a turn with a tool call, so its divider offers the summary
    b.turn('t1', anchoredMessage({ anchor: ANCHOR, text: COMMENT, destination: 'thread', screenshot: false }));
    b.toolUse('x1', 'Bash', { command: 'ls' }, 'm0', 0);
    b.result('x1', 'a');
    b.text('m1', 0, REPLY);
    b.end(['t1'], { durationMs: 4_000 });
    snapshot = b.events;
    await intoThread();
    withRecord();
    await waitFor(() => expect(within(card()!).getByText(REPLY)).toBeTruthy());
    await userEvent.type(replyField(), 'Unsent');
    await userEvent.click(within(card()!).getAllByRole('button', { name: 'Turn summary' })[0]!);
    const popover = await waitFor(() => document.querySelector<HTMLElement>('.transcript-popover')!);
    expect(card()!.contains(popover)).toBe(false);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.transcript-popover')).toBeNull());
    expect(card()).not.toBeNull();
    expect(replyField().value).toBe('Unsent');
    fireEvent.keyDown(replyField(), { key: 'Escape' });
    expect(card()).toBeNull();
  });
});

describe('where the thread is drawn', () => {
  it('Open as tab opens the thread as a main tab and closes the card', async () => {
    await intoThread();
    await userEvent.click(within(card()!.querySelector('header')!).getByRole('button', { name: 'Open as tab' }));
    expect(isOpen(useLayout.getState().main, tabId({ kind: 'session', appSessionId: child }))).toBe(true);
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('Open in Side pane shows the thread in the parent’s Side pane and closes the card', async () => {
    await intoThread();
    act(() => useAttention.setState({ bySession: new Map([[child, [item(child, 'question', new Date().toISOString())]]]) }));
    await userEvent.click(within(card()!.querySelector<HTMLElement>('[data-needs-you]')!).getByRole('button', { name: 'Open in Side pane' }));
    expect(sidePaneOf(useSidePane.getState(), PARENT).view).toEqual({ kind: 'thread', childAppSessionId: child });
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('closes when the Side pane draws the same thread, or a main tab opens it', async () => {
    await intoThread();
    act(() => showSideChild(PARENT, child));
    expect(useCommentCard.getState().open).toBeNull();

    act(() => useSidePane.setState({ panes: new Map() }));
    child = `c5555555-5555-4555-8555-${String(++serial).padStart(12, '0')}` as AppSessionId;
    fake = fakeClient({ 'side.thread.open': { status: 'starting', appSessionId: child }, 'session.intent.get': null });
    window.maws = fake.client;
    cleanup();
    await intoThread();
    act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: child }));
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('publishes its thread while on screen, and withdraws it when it closes', async () => {
    await intoThread();
    expect(useCommentCard.getState().shownThread).toEqual({ parent: PARENT, child });
    await userEvent.click(within(card()!.querySelector('header')!).getByRole('button', { name: 'Close' }));
    expect(useCommentCard.getState().shownThread).toBeNull();
  });
});

describe('the thread’s artifact row', () => {
  it('Open on the card’s own record shows that version in the card’s viewer (null for the latest); another record goes to the registered action', async () => {
    const registered = vi.fn();
    offs.push(registerTranscriptActions({ openDeliverable: registered }));
    deliverables.setState({ lookups: new Map([[lookupKey(PARENT, RECORD), { status: 'ready', record: { versions: [{}, {}, {}] } as never, present: [true, true, true] }]]) });
    const b = threadTurn();
    b.turn('t2', 'Update it');
    const update = (id: string, deliverableId: string, version: number) => {
      b.toolUse(id, 'mcp__maws__artifact_update', { id: 'dash', html_path: 'dash.html' });
      b.result(id, [{ type: 'text', text: JSON.stringify({ status: 'updated', id: 'dash', deliverableId, version, title: 'Dashboard', externalReferences: 0, ownerAppSessionId: PARENT }) }]);
    };
    update('a3', RECORD, 3);
    update('a2', RECORD, 2);
    update('ax', '00000000-0000-4000-8000-0000000000e2', 4);
    b.end(['t2']);
    snapshot = b.events;
    await intoThread();
    withRecord();
    await waitFor(() => expect(card()!.querySelectorAll('[data-artifact]')).toHaveLength(3));
    const open = (n: number) => fireEvent.click(within(card()!.querySelectorAll<HTMLElement>('[data-artifact]')[n]!).getByRole('button', { name: 'Open' }));
    open(0);
    expect(showVersion).toHaveBeenLastCalledWith(null);
    open(1);
    expect(showVersion).toHaveBeenLastCalledWith(2);
    open(2);
    expect(showVersion).toHaveBeenCalledTimes(2);
    expect(registered).toHaveBeenCalledWith(PARENT, '00000000-0000-4000-8000-0000000000e2', 4);
  });
});
