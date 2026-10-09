// P2-E1 (M2): the comment card's thread phase (P2-E1 document, D5 and D6; acceptance 3, 4 and 5). A card's Side thread
// turns the card into the thread (no Side tool, no toast; the comment echoed until the thread's anchored prompt
// arrives, then the thread's own rows through the shell's transcript); Reply goes through the human send seam with its
// dispositions read in one place; a started reply waits as a pending bubble and a failed start hands its text back to
// the card; the needs-you strip names what waits; the card yields to the Side pane or a main tab and publishes its
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
import { item, record } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { sendHumanPrompt } from '../../composer/submit/send-human-prompt';
import { registerMessageReturn, returnMessage } from '../../sessions/message-return';
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
import { builder, request, tool } from '../../transcript/model/test-events';
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
      seam.mockResolvedValueOnce(disposition === 'queued' ? { disposition, queueId: 'q1' } : { disposition });
      await userEvent.type(replyField(), `Also the subtitle{Enter}`);
      await waitFor(() => expect(replyField().value).toBe(''));
      expect(card()!.querySelector('[role="alert"]')).toBeNull();
    }
    expect(seam.mock.calls.map(([id, content, options]) => [id, content, options])).toEqual(Array(3).fill([child, 'Also the subtitle', { origin: 'comment' }]));
  });

  it('refused keeps the text with the reason and Retry; a thrown host error reads as a refusal with its message', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'refused', reason: 'The session is starting' });
    await userEvent.type(replyField(), 'Again{Enter}');
    await waitFor(() => expect(within(card()!).getByRole('alert').textContent).toContain('The session is starting'));
    expect(replyField().value).toBe('Again');

    seam.mockRejectedValueOnce(new Error('host write failed'));
    await userEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(card()!).getByRole('alert').textContent).toContain('host write failed'));
    expect(replyField().value).toBe('Again');

    seam.mockResolvedValueOnce({ disposition: 'sent' });
    await userEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(replyField().value).toBe(''));
    expect(card()!.querySelector('[role="alert"]')).toBeNull();
    expect(seam).toHaveBeenCalledTimes(3);
  });

  it('queued: the host queue’s held bubble at the thread’s tail, replaced by the user row once the host submits it', async () => {
    await ready();
    const held = { queueId: 'q1', appSessionId: child, content: 'Also the subtitle', createdAt: new Date().toISOString(), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    seam.mockImplementationOnce(async () => {
      fake.event('session.queue', { appSessionId: child, ...EMPTY_QUEUE, entries: [held] });
      return { disposition: 'queued', queueId: 'q1' };
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

  it('started: a pending bubble with “Starting…” until a user row newer than the reply arrives', async () => {
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'started' });
    await userEvent.type(replyField(), 'Wake up and do it{Enter}');
    await waitFor(() => expect(card()!.querySelector('[data-card-pending]')?.textContent).toContain('Wake up and do it'));
    expect(card()!.querySelector('[data-card-pending]')!.textContent).toContain('Starting…');
    expect(replyField().value).toBe('');

    const b = threadTurn();
    b.at = Date.now() + 60_000;
    b.turn('t2', 'Wake up and do it');
    push(b.events);
    await waitFor(() => expect(card()!.querySelector('[data-card-pending]')).toBeNull());
  });

  it('a failed start hands the reply back to the card’s field, not the registered return, with the failure in the strip', async () => {
    const registered = vi.fn();
    offs.push(registerMessageReturn(registered));
    await ready();
    seam.mockResolvedValueOnce({ disposition: 'started' });
    await userEvent.type(replyField(), 'Wake up and do it{Enter}');
    await waitFor(() => expect(card()!.querySelector('[data-card-pending]')).not.toBeNull());
    act(() => returnMessage(child, { content: 'Wake up and do it', display: 'Wake up and do it' }));
    expect(replyField().value).toBe('Wake up and do it');
    expect(card()!.querySelector('[data-card-pending]')).toBeNull();
    expect(card()!.querySelector('[data-needs-you]')?.textContent).toContain('Could not start');
    expect(registered).not.toHaveBeenCalled();
    act(() => returnMessage(child, { content: 'later', display: 'later' }));
    expect(registered).toHaveBeenCalledTimes(1); // the claim went with its reply
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
