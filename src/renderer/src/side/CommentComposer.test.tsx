// E3 (M3): the comment composer's sheet (E3 execution document, Acceptance 1 and M3's decisions): the anchor named in
// its title and locator, Side thread chosen by default, Send disabled until the comment has text, Send to main
// available only while the parent's process is ready, and each destination sent through main's command.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { digest, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { fileLineAnchor } from '../tools/code/anchor/anchor';
import { resetShellStores } from '../test-support/shell-stores';
import { CommentComposerHost, openComposer, useCommentComposer } from './CommentComposer';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const ANCHOR = fileLineAnchor('/work/repo/src/x.ts', 42);

let fake: FakeClient;

function withParent(process: 'ready' | 'exited', turn = false) {
  const s = useSessions.getState();
  const engine = status(PARENT, { process, ...(turn && { turn: { id: 'e1', origin: 'human', startedAt: 'x', acceptedAt: 'x', userMessageUuids: [] } }) } as never);
  useSessions.setState({ records: new Map([[PARENT, record(PARENT)]]), engine: new Map([[PARENT, engine]]), recordsVersion: s.recordsVersion + 1 });
}

beforeEach(() => {
  resetShellStores();
  useNotices.setState({ notices: [] });
  fake = fakeClient({ 'side.sendToMain': { messageUuid: null, disposition: 'sent' } });
  window.maws = fake.client;
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
    expect((screen.getByRole('radio', { name: /Side thread/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Send to main/ }) as HTMLInputElement).checked).toBe(false);
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), '   ');
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Why twice?');
    expect(send.disabled).toBe(false);
    expect(screen.queryByText(/Screenshot/)).toBeNull(); // E5's gutter gives no screenshot: no slot
  });

  // P2-A (2026-10-09; the execution document §5.6): Send to main is offered for every parent it can start
  it('Send to main stays enabled for an exited parent, saying it starts the session; disabled with the reason for one a terminal holds or archived; its caption follows the running turn', () => {
    withParent('exited');
    show();
    const main = () => screen.getByRole('radio', { name: /Send to main/ }) as HTMLInputElement;
    expect(main().disabled).toBe(false);
    expect(screen.getByText('Starts this session')).toBeTruthy();
    expect(fake.invoked('session.acquire')).toEqual([]); // opening the sheet starts nothing
    act(() => useSessions.setState((s) => ({ records: new Map([[PARENT, { ...record(PARENT), holder: { kind: 'terminal', pid: 42 } }]]), digests: new Map(s.digests).set(PARENT, digest(PARENT, { availability: 'foreign_held' })) })));
    expect(main().disabled).toBe(true);
    expect(screen.getByText('Held by terminal · 42')).toBeTruthy();
    act(() => useSessions.setState((s) => ({ digests: new Map(s.digests).set(PARENT, digest(PARENT, { availability: 'archived' })) })));
    expect(main().disabled).toBe(true);
    expect(screen.getByText('Archived · unarchive it to continue')).toBeTruthy();
    cleanup();
    useCommentComposer.setState({ open: null });
    useSessions.setState({ digests: new Map() });
    withParent('ready', true);
    show();
    expect(screen.getByText('Sends at the next step')).toBeTruthy();
  });

  it('Send to main on an exited parent starts it (side), reading Starting…, then sends once and closes', async () => {
    fake = fakeClient({ 'side.sendToMain': { messageUuid: null, disposition: 'sent' } });
    window.maws = fake.client;
    withParent('exited');
    show();
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: PARENT, reason: 'side' }]);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    expect(fake.invoked('side.sendToMain')).toEqual([]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: PARENT, launched: true, joined: false }));
    expect(fake.invoked('side.sendToMain')).toHaveLength(1);
    expect(fake.invoked('session.acquire')).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused start keeps the comment in the sheet with its words and Retry; nothing is sent', async () => {
    withParent('exited');
    show();
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
    await act(() => fake.reply('session.acquire', { status: 'missing_directory', appSessionId: PARENT, directory: '/gone' }));
    expect(screen.getByRole('alert').textContent).toContain('Directory not found: /gone');
    expect(fake.invoked('side.sendToMain')).toEqual([]);
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('Look here');
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a refused start after the sheet closed is a toast with its words', async () => {
    withParent('exited');
    show();
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here{Enter}');
    act(() => useCommentComposer.setState({ open: null }));
    await act(() => fake.reply('session.acquire', { status: 'needs_trust', appSessionId: PARENT, trust: { directory: '/work/repo', trustKey: '/work/repo', keyKind: 'directory', configPath: '/home/.claude.json', trusted: false, source: null, isHome: false, found: [] } }));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['The comment was not sent: Trust this folder in the session to continue']);
    expect(fake.invoked('side.sendToMain')).toEqual([]);
  });

  it('Side thread sends side.thread.open with the comment and no screenshot; Enter sends, Shift+Enter breaks a line', async () => {
    withParent('ready');
    show();
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await userEvent.type(field, 'Line one{Shift>}{Enter}{/Shift}line two{Enter}');
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: PARENT, from: { kind: 'comment', anchor: ANCHOR, text: 'Line one\nline two', screenshot: null } }]);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy();
    await act(() => fake.reply('side.thread.open', { status: 'refused', appSessionId: 'b2222222-2222-4222-8222-222222222222', reason: 'no_engine_session', message: 'This session has not started yet' }));
    expect(screen.getByRole('alert').textContent).toContain('This session has not started yet');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to main instead' })).toBeTruthy();
  });

  it('Send to main sends side.sendToMain and closes the sheet; a producer’s screenshot travels as its own field and can be removed', async () => {
    withParent('ready');
    render(<CommentComposerHost />);
    const screenshot = { path: '/user-data/captures/one.png', width: 640, height: 480 };
    act(() => openComposer({ ...ANCHOR, screenshot }, { appSessionId: PARENT }));
    expect(screen.getByText('Screenshot · 640 × 480')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Look here');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(fake.invoked('side.sendToMain')).toEqual([{ appSessionId: PARENT, anchor: ANCHOR, text: 'Look here', screenshot }]);
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
    window.maws = fake.client;
    withParent('ready');
    render(<CommentComposerHost />);
    const screenshot = { path: '/user-data/browser/crops/one.png', width: 640, height: 480 };
    act(() => openComposer({ ...ANCHOR, screenshot }, { appSessionId: PARENT }));
    const thumbnail = await screen.findByRole('img', { name: 'Screenshot · 640 × 480' });
    expect(thumbnail.getAttribute('src')).toBe(DATA);
    expect(fake.invoked('side.screenshot.preview')).toEqual([{ appSessionId: PARENT, screenshot }]);
    const remove = screen.getByRole('button', { name: 'Remove screenshot' });
    remove.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('img', { name: 'Screenshot · 640 × 480' })).toBeNull();
    act(() => useCommentComposer.setState({ open: null }));

    fake = fakeClient({});
    window.maws = fake.client;
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

  it('Send to main held by the app queue says so in a toast', async () => {
    fake = fakeClient({ 'side.sendToMain': { messageUuid: null, disposition: 'queued' } });
    window.maws = fake.client;
    withParent('ready');
    show();
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Later{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Queued; it sends when the queue resumes']);
  });

  it('Retry is disabled once its destination can no longer send (Send to main, the parent archived meanwhile); an exited parent can still be started', async () => {
    fake = fakeClient(); // main answers when the test says
    window.maws = fake.client;
    withParent('ready');
    show();
    await userEvent.click(screen.getByRole('radio', { name: /Send to main/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Comment' }), 'Now{Enter}');
    await act(() => fake.fail('side.sendToMain', 'Session is not ready (exited)'));
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    act(() => withParent('exited'));
    expect(retry.disabled).toBe(false); // P2-A: Retry starts it first
    act(() => useSessions.setState({ digests: new Map([[PARENT, digest(PARENT, { availability: 'archived' })]]) }));
    expect(retry.disabled).toBe(true);
    useSessions.setState({ digests: new Map() });
  });
});
