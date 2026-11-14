// E3 (M3): the comment composer's sheet (E3 execution document, Acceptance 1 and M3's decisions): the anchor named in
// its title and locator, Side thread chosen by default, Send disabled until the comment has text, and each destination
// sent. UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision 19): the sheet shows the
// card's checkbox, "Send to main", its caption as its title; ticked, the comment goes through the session's port.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { digest, record, remoteRow, status } from '../../../../test/support/builders';
import { addressOf } from '@shared/machine/address';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE } from '../../../../test/support/machine';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { fileLineAnchor } from '../tools/code/anchor/anchor';
import { resetShellStores } from '../test-support/shell-stores';
import { CommentComposerHost, openComposer, useCommentComposer } from './CommentComposer';
import { applyLaneAState, dismissPendingSend, resetLaneAStore } from '../stores/lane-a'; // UX wave U5a
import { TOAST_DURATION_MS, ToastHost } from '../app/ToastHost';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { shownSession } from '../panel/host';
import { useMachines } from '../stores/machines';
import { resetPlaceNotes } from './card/store';
import { T0 } from '../../../../test/support/builders';

// P5 O6 M2: main is asked and answers with the bare id; the page holds its address
const PARENT_ID = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const PARENT = at(PARENT_ID);
const ANCHOR = fileLineAnchor('/work/repo/src/x.ts', 42);

let fake: FakeClient;

function withParent(process: 'ready' | 'exited', turn = false) {
  const s = useSessions.getState();
  const engine = status(PARENT, { process, ...(turn && { turn: { id: 'e1', origin: 'human', startedAt: 'x', acceptedAt: 'x', userMessageUuids: [] } }) } as never);
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' } })]]), engine: new Map([[PARENT, engine]]), recordsVersion: s.recordsVersion + 1 });
}

const BUILT = [{ type: 'text', text: 'the built message' }];
const MAIN_SENDS = { 'side.comment.content': { content: BUILT }, 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q0' } } as const;
const box = () => screen.getByRole('checkbox', { name: 'Send to main' }) as HTMLInputElement;
const titleOf = (input: HTMLInputElement) => input.closest('label')!.getAttribute('title');

beforeEach(() => {
  resetShellStores();
  resetLaneAStore();
  resetPlaceNotes(); // UX wave U5a: and the hand-off toasts it follows
  useNotices.setState({ notices: [] });
  fake = fakeClient(MAIN_SENDS);
  window.maws = fake.client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  useCommentComposer.setState({ open: null });
});

const show = () => {
  render(<CommentComposerHost />);
  act(() => openComposer(ANCHOR, { appSessionId: PARENT }));
};

describe('the comment composer', () => {
  it('names the line, defaults to Side thread, and keeps Send disabled until the comment has text', async () => {
    withParent('ready');
    show();
    expect(screen.getByRole('dialog', { name: 'Comment on x.ts:42' })).toBeTruthy();
    expect(screen.getByText('/work/repo/src/x.ts#L42')).toBeTruthy();
    expect(box().checked).toBe(false);
    expect(box().hasAttribute('data-send-to-main')).toBe(true);
    expect(screen.queryAllByRole('radio')).toEqual([]);
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), '   ');
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Why twice?');
    expect(send.disabled).toBe(false);
    expect(screen.queryByText(/Screenshot/)).toBeNull(); // E5's gutter gives no screenshot: no slot
  });

  // P2-A (2026-10-09; the execution document §5.6): Send to main is offered for every parent it can start
  it('Send to main stays enabled for an exited parent, saying it starts the session; off with the reason for one a terminal holds; an archived parent sends neither way; its title follows the running turn', () => {
    withParent('exited');
    show();
    expect(box().disabled).toBe(false);
    expect(titleOf(box())).toBe('Starts this session');
    expect(screen.queryByText('Starts this session'), 'its caption is its title alone (decision 19)').toBeNull();
    expect(fake.invoked('session.acquire')).toEqual([]); // opening the sheet starts nothing
    act(() => useSessions.setState((s) => ({ records: new Map([[PARENT, { ...record(PARENT), holder: { kind: 'terminal', pid: 42 } }]]), digests: new Map(s.digests).set(PARENT, digest(PARENT, { availability: 'foreign_held' })) })));
    expect(box().disabled).toBe(true);
    expect(titleOf(box())).toBe('Held by terminal · 42');
    act(() => useSessions.setState((s) => ({ digests: new Map(s.digests).set(PARENT, digest(PARENT, { availability: 'archived' })) })));
    expect(box().disabled).toBe(true);
    expect(screen.getByText('Archived · unarchive it to continue')).toBeTruthy(); // neither state sends: the line under the field
    cleanup();
    useCommentComposer.setState({ open: null });
    useSessions.setState({ digests: new Map() });
    withParent('ready', true);
    show();
    expect(titleOf(box())).toBe('Sends at the next step');
  });

  // P5 O7 M8 ("The offer audit and its contract"): a parent on another machine takes no side thread yet
  // (REMOTE_UNAVAILABLE). UX wave U5a (A1): the checkbox is ticked and locked there, and the comment goes to its main
  // conversation through the session's port, as a typed message does
  it('ticks and locks the checkbox for a parent on another machine, saying why, and sends to its main conversation', async () => {
    const remote = addressOf(OTHER_MACHINE, PARENT_ID);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: T0, generation: 0 }]);
    useSessions.setState({ records: new Map([[remote, record(remote)]]), engine: new Map([[remote, status(remote)]]), listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, PARENT_ID), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]) });
    try {
      render(<CommentComposerHost />);
      act(() => openComposer(ANCHOR, { appSessionId: remote }));
      expect(box().checked).toBe(true);
      expect(box().disabled).toBe(true);
      expect(titleOf(box())).toBe('A side thread is not available on Studio yet');
      expect(REMOTE_UNAVAILABLE['side.thread.open']).toBeDefined(); // the window still reads the shared set's row
      await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Why twice?{Enter}');
      await vi.waitFor(() => expect(fake.invoked('session.send')).toHaveLength(1));
      expect(fake.invoked('side.comment.content')).toEqual([{ comments: [{ anchor: ANCHOR, text: 'Why twice?', screenshot: null }] }]);
      expect(fake.invoked('side.thread.open')).toEqual([]);
      expect(fake.invoked('side.sendToMain')).toEqual([]);
    } finally {
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });

  // UX wave U5a: the send starts the session itself (the port's acquisition); the form acquires nothing of its own
  it('Send to main on an exited parent: the send starts it, reading Starting…, then sends once and closes', async () => {
    withParent('exited');
    show();
    await userEvent.click(box());
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
    await vi.waitFor(() => expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: PARENT_ID, reason: 'send' }]));
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    expect(fake.invoked('session.send')).toEqual([]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: PARENT_ID, launched: true, joined: false }));
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: PARENT_ID, content: BUILT }]);
    expect(fake.invoked('session.acquire')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused start keeps the comment in the sheet with its words and Retry; nothing is sent', async () => {
    withParent('exited');
    show();
    await userEvent.click(box());
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
    await vi.waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
    await act(() => fake.reply('session.acquire', { status: 'missing_directory', appSessionId: PARENT_ID, directory: '/gone' }));
    expect(screen.getByRole('alert').textContent).toContain('Directory not found: /gone');
    expect(fake.invoked('session.send')).toEqual([]);
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('Look here');
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a refused start after the sheet closed is a toast with its words', async () => {
    withParent('exited');
    show();
    await userEvent.click(box());
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
    await vi.waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
    act(() => useCommentComposer.setState({ open: null }));
    await act(() => fake.reply('session.acquire', { status: 'needs_trust', appSessionId: PARENT_ID, trust: { directory: '/work/repo', trustKey: '/work/repo', keyKind: 'directory', configPath: '/home/.claude.json', trusted: false, source: null, isHome: false, found: [] } }));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The comment was not sent: Trust this folder in the session to continue']);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('Side thread sends side.thread.open with the comment and no screenshot; Enter sends, Shift+Enter breaks a line', async () => {
    withParent('ready');
    show();
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await userEvent.type(field, 'Line one{Shift>}{Enter}{/Shift}line two{Enter}');
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: PARENT_ID, from: { kind: 'comment', anchor: ANCHOR, text: 'Line one\nline two', screenshot: null } }]);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'no_engine_session', message: 'This session has not started yet' }));
    expect(screen.getByRole('alert').textContent).toContain('This session has not started yet');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to main instead' })).toBeTruthy();
  });

  it('Send to main asks main for the content and closes the sheet; a producer’s screenshot travels as its own field and can be removed', async () => {
    withParent('ready');
    render(<CommentComposerHost />);
    const screenshot = { path: '/user-data/captures/one.png', width: 640, height: 480 };
    act(() => openComposer({ ...ANCHOR, screenshot }, { appSessionId: PARENT }));
    expect(screen.getByText('Screenshot · 640 × 480')).toBeTruthy();
    await userEvent.click(box());
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(fake.invoked('side.comment.content')).toEqual([{ comments: [{ anchor: ANCHOR, text: 'Look here', screenshot }] }]);
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: PARENT_ID, content: BUILT }]);
    expect(fake.invoked('side.sendToMain')).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openComposer({ ...ANCHOR, screenshot }, { appSessionId: PARENT }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove screenshot' }));
    expect(screen.queryByText('Screenshot · 640 × 480')).toBeNull();
  });

  // E11 F2b (Q4, owner-decided: "a small image preview"): the screenshot shows as a thumbnail of itself, named as the chip
  // was, so the area can be checked before sending; Remove stays a button of its own; a picture main will not read keeps
  // the words alone
  it('shows a producer’s screenshot as a thumbnail named with its size, removable by keyboard; an unreadable one keeps its words', async () => {
    const DATA = 'data:image/png;base64,iVBORw0KGgo=';
    fake = fakeClient({ 'side.screenshot.preview': { dataUrl: DATA } });
    window.maws = fake.client as unknown as PreloadBridge;
    withParent('ready');
    render(<CommentComposerHost />);
    const screenshot = { path: '/user-data/browser/crops/one.png', width: 640, height: 480 };
    act(() => openComposer({ ...ANCHOR, screenshot }, { appSessionId: PARENT }));
    const thumbnail = await screen.findByRole('img', { name: 'Screenshot · 640 × 480' });
    expect(thumbnail.getAttribute('src')).toBe(DATA);
    expect(fake.invoked('side.screenshot.preview')).toEqual([{ appSessionId: PARENT_ID, screenshot }]);
    const remove = screen.getByRole('button', { name: 'Remove screenshot' });
    remove.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('img', { name: 'Screenshot · 640 × 480' })).toBeNull();
    act(() => useCommentComposer.setState({ open: null }));

    fake = fakeClient({});
    window.maws = fake.client as unknown as PreloadBridge;
    act(() => openComposer({ ...ANCHOR, screenshot }, { appSessionId: PARENT }));
    await act(() => fake.fail('side.screenshot.preview', 'screenshot: not found'));
    expect(screen.queryByRole('img', { name: 'Screenshot · 640 × 480' })).toBeNull();
    expect(screen.getByText('Screenshot · 640 × 480')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove screenshot' })).toBeTruthy();
  });

  // M3's review (M4): the failure paths
  it('a refusal arriving after the sheet closed mid-send is a toast with its reason', async () => {
    withParent('ready');
    show();
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Why?{Enter}');
    expect(fake.pending('side.thread.open')).toBe(1);
    act(() => useCommentComposer.setState({ open: null }));
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'unknown_session', message: 'The session is gone' }));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The comment was not sent: The session is gone']);
  });

  // UX wave U5a: the sheet has no place of its own to draw a line in, so what a card's place would say beyond a plain
  // delivery is its toast: a send the app queue holds, and a hand-off a terminal session has not confirmed
  it('Send to main held by the app queue says so in a toast', async () => {
    fake = fakeClient({ ...MAIN_SENDS, 'session.send': { messageUuid: null, disposition: 'queued', queueId: 'q1' } });
    window.maws = fake.client as unknown as PreloadBridge;
    withParent('ready');
    show();
    await userEvent.click(box());
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Later{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Queued for Q3 plan; it sends when the queue resumes']);
  });

  // Decision Log 27 (the architect's ruling): the hand-off's toast is keyed and follows its pending send as a place's
  // pending line does: it stays past the toast's time while the send is pending or refused, its words following the
  // send; it reads "Sent to <title>" once the delivery entered and then leaves on the ordinary time; it leaves when the
  // strip's entry is dismissed (or resent, which dismisses it); each send has its own; a plain delivery says nothing
  describe('a terminal session’s unconfirmed hand-off', () => {
    const SECOND = { writer: 'maws/m', seq: 2 };
    const THIRD = { writer: 'maws/m', seq: 3 };
    const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => n.text);
    const delivery = (key: { writer: string; seq: number }, state: 'entered' | 'refused', reason?: string) => ({ key, at: '2026-11-12T09:00:00.000Z', state, ...(reason !== undefined && { reason }) });
    const sendThrough = async (key: { writer: string; seq: number }, state: 'submitted' | 'entered' = 'submitted') => {
      fake = fakeClient({ 'side.comment.content': { content: BUILT }, 'laneA.send': { key, state } });
      window.maws = fake.client as unknown as PreloadBridge;
      act(() => openComposer(ANCHOR, { appSessionId: PARENT }));
      await userEvent.click(box());
      await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true }); // before any toast mounts, so the host's timeout is a fake one
      useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' }, holder: { kind: 'terminal', pid: 42 } })]]), engine: new Map() });
      applyLaneAState(PARENT, laneAState(PARENT));
      render(<CommentComposerHost />);
      render(<ToastHost />);
    });
    afterEach(() => vi.useRealTimers());

    it('stays past the toast’s time while pending, follows a late refusal, and leaves when the strip’s entry is dismissed', async () => {
      await sendThrough(SECOND);
      await vi.waitFor(() => expect(screen.getByText('Not confirmed yet in Q3 plan')).toBeTruthy());
      await act(async () => vi.advanceTimersByTime(TOAST_DURATION_MS + 500));
      expect(screen.getByText('Not confirmed yet in Q3 plan')).toBeTruthy();
      act(() => applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [delivery(SECOND, 'refused', 'the terminal was busy')] })));
      expect(screen.getByText('Not entered in Q3 plan: the terminal was busy')).toBeTruthy();
      await act(async () => vi.advanceTimersByTime(TOAST_DURATION_MS + 500));
      expect(toasts()).toEqual(['Not entered in Q3 plan: the terminal was busy']);
      act(() => dismissPendingSend(PARENT, SECOND)); // the strip's Dismiss (a resend dismisses its entry the same way)
      expect(toasts()).toEqual([]);
    });

    it('reads Sent to <title> once entered and leaves on the ordinary time; each send has its own; Show brings the session’s tab; a plain delivery says nothing', async () => {
      await sendThrough(SECOND);
      await sendThrough(THIRD);
      await vi.waitFor(() => expect(toasts()).toEqual(['Not confirmed yet in Q3 plan', 'Not confirmed yet in Q3 plan']));
      act(() => applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [delivery(SECOND, 'entered')] })));
      expect(toasts()).toEqual(['Sent to Q3 plan', 'Not confirmed yet in Q3 plan']);
      await act(async () => vi.advanceTimersByTime(TOAST_DURATION_MS + 500));
      expect(toasts()).toEqual(['Not confirmed yet in Q3 plan']);
      const [notice] = useNotices.getState().notices;
      expect(notice!.actions.map((a) => a.label)).toEqual(['Show']);
      act(() => screen.getByRole('button', { name: 'Show' }).click());
      expect(shownSession()).toBe(PARENT);
      expect(toasts(), 'acting on a toast dismisses it; the strip it showed says the rest').toEqual([]);
      act(() => applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [delivery(THIRD, 'entered')] })));
      expect(toasts()).toEqual([]);

      await sendThrough({ writer: 'maws/m', seq: 4 }, 'entered');
      await act(async () => {});
      expect(toasts()).toEqual([]);
    });
  });

  it('Retry is disabled once its destination can no longer send (Send to main, the parent archived meanwhile); an exited parent can still be started', async () => {
    fake = fakeClient({ 'side.comment.content': { content: BUILT }, 'session.queue.list': { entries: [], paused: false } }); // session.send answers when told
    window.maws = fake.client as unknown as PreloadBridge;
    withParent('ready');
    show();
    await userEvent.click(box());
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Now{Enter}');
    await vi.waitFor(() => expect(fake.pending('session.send')).toBe(1));
    await act(() => fake.fail('session.send', 'Session is not ready (exited)'));
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    act(() => withParent('exited'));
    expect(retry.disabled).toBe(false); // P2-A: Retry starts it first
    act(() => useSessions.setState({ digests: new Map([[PARENT, digest(PARENT, { availability: 'archived' })]]) }));
    expect(retry.disabled).toBe(true);
    useSessions.setState({ digests: new Map() });
  });
});
