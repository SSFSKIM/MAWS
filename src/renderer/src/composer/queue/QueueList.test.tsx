import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { connectKeys } from '../../keymap/dispatcher';
import { useNotices } from '../../stores/notices';
import type { SessionQueue } from '../../stores/queue';
import { SEND_NOW_DETAIL, SENDS_NOW } from '../submit/submit-state';
import { PAUSED_COPY, QueueList, UNCERTAIN_TEXT } from './QueueList';

const APP = 'app-1' as AppSessionId;
const entry = (queueId: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId, appSessionId: APP, content: `message ${queueId}`, createdAt: '2026-09-29T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});
const queue = (entries: QueueEntry[], over: Partial<SessionQueue> = {}): SessionQueue => ({ entries, paused: false, pauseReason: null, steers: [], withdrawn: [], loaded: true, ...over });

function bridge(answers: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (name: string) => (name in answers ? answers[name] : { ok: true, value: name === 'session.queue.promote' ? { messageUuid: null } : undefined }));
  return { client: { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge, invoke };
}

let disconnect: () => void;
beforeEach(() => {
  useNotices.setState({ notices: [] });
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  vi.useRealTimers();
});

describe('queue list renders every entry state', () => {
  it('lists held entries with Send now (now), Send at the next step (next), Edit and Delete; the running turn is not listed', async () => {
    const { client, invoke } = bridge();
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-0', { state: 'released' }), entry('q-1'), entry('q-2', { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }, { type: 'text', text: 'look' }] })])} sessionId={null} cwd="/repo" client={client} />);
    const list = screen.getByRole('region', { name: 'Queued messages' });
    expect(within(list).getByText('2 held until the turn ends')).toBeTruthy();
    expect(within(list).queryByText('message q-0')).toBeNull();
    expect(within(list).getByText('[Image #1] look')).toBeTruthy();
    const user = userEvent.setup();
    const [row] = within(list).getAllByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Send now' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'now' });
    await user.click(within(row).getByRole('button', { name: 'More ways to send' }));
    await user.click(await screen.findByRole('menuitem', { name: /Send at the next step/ }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'next' });
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.remove', { appSessionId: APP, queueId: 'q-1' });
  });

  // A held row waits for the running turn, so its Send now stops that turn first; a paused queue at idle has no turn to
  // stop, and the same promote just sends.
  it('titles a held row’s Send now by whether a turn runs', () => {
    const { client } = bridge();
    const view = (busy: boolean) => <QueueList appSessionId={APP} busy={busy} queue={queue([entry('q-1')], { paused: !busy, pauseReason: busy ? null : 'interrupt' })} sessionId={null} cwd="/repo" client={client} />;
    const { rerender } = render(view(true));
    expect(screen.getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe(SEND_NOW_DETAIL);
    rerender(view(false));
    expect(screen.getByRole('button', { name: 'Send now' }).getAttribute('title')).toBe(SENDS_NOW);
    expect(SENDS_NOW).toBe('Sends this now');
  });

  // W1: Enter while a turn runs writes a `next` steer; until the engine takes it, it is a row with Send now and Hold.
  it('lists pending steers first with Send now (an interrupt) and Hold until the turn ends', async () => {
    const { client, invoke } = bridge({ 'session.queue.hold': { ok: true, value: entry('q-9') }, 'session.interrupt': { ok: true, value: { stillQueued: [], cancelled: [] } } });
    const steer = { messageUuid: 'm-1' as never, content: 'look at b too', createdAt: '2026-09-29T10:00:00.000Z' };
    render(<QueueList appSessionId={APP} busy queue={queue([entry('q-1')], { steers: [steer] })} sessionId={null} cwd="/repo" client={client} />);
    const list = screen.getByRole('region', { name: 'Queued messages' });
    expect(within(list).getByRole('banner').textContent).toBe('1 at the next step · 1 held until the turn ends');
    const [row] = within(list).getAllByRole('listitem');
    expect(row.getAttribute('data-queue-state')).toBe('steer');
    expect(row.textContent).toContain('look at b too');
    expect(row.textContent).toContain('Sends at the next step');
    const user = userEvent.setup();
    await user.click(within(row).getByRole('button', { name: 'Hold until the turn ends' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.hold', { appSessionId: APP, messageUuid: 'm-1' });
    await user.click(within(row).getByRole('button', { name: 'Send now' }));
    expect(invoke).toHaveBeenCalledWith('session.interrupt', { appSessionId: APP, cancelEngineQueued: false });
  });

  it('edits a queued entry inline and writes the re-serialised content; Escape cancels', async () => {
    const { client, invoke } = bridge();
    render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1')])} sessionId={null} cwd="/repo" client={client} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const box = await screen.findByRole('textbox', { name: 'Edit queued message' });
    await waitFor(() => expect(box.textContent).toBe('message q-1'));
    // Tiptap keeps its instance on the view's element; typing into a contenteditable is the e2e's
    act(() => void (box as HTMLElement & { editor: { commands: { insertContentAt(at: number, text: string): boolean } } }).editor.commands.insertContentAt(12, ' again'));
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.queue.edit', { appSessionId: APP, queueId: 'q-1', content: 'message q-1 again' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit queued message' })).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const again = await screen.findByRole('textbox', { name: 'Edit queued message' });
    await act(async () => void again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(screen.queryByRole('textbox', { name: 'Edit queued message' })).toBeNull();
    expect(invoke.mock.calls.filter(([name]) => name === 'session.queue.edit')).toHaveLength(1);
  });

  it('puts an uncertain head first in warning, with Resume and Delete, and nothing to act on for a submitting sibling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const now = new Date('2026-09-29T10:00:00.000Z');
    vi.setSystemTime(now);
    const { client, invoke } = bridge();
    render(
      <QueueList
        appSessionId={APP}
        busy={false}
        queue={queue([entry('q-u', { uncertain: true }), entry('q-s', { state: 'submitting', submittedAt: now.toISOString() })], { paused: true, pauseReason: 'uncertain' })}
        sessionId={null}
        cwd="/repo"
        client={client}
      />,
    );
    const [uncertain] = screen.getAllByRole('listitem');
    expect(uncertain.getAttribute('data-queue-state')).toBe('uncertain');
    expect(within(uncertain).getByRole('status').textContent).toBe(UNCERTAIN_TEXT);
    expect(within(uncertain).getAllByRole('button').map((b) => b.textContent)).toEqual(['Resume', 'Edit', 'Delete']);
    expect(screen.queryByText(PAUSED_COPY.uncertain, { exact: false })).toBeNull(); // the row explains the pause, not the header
    expect(screen.queryByText('Sending…')).toBeNull(); // not yet: C3 acknowledges within milliseconds
    await act(async () => void vi.advanceTimersByTime(300));
    const sending = screen.getByText('Sending…').closest('li')!;
    expect(sending.getAttribute('data-queue-state')).toBe('submitting');
    expect(within(sending).queryAllByRole('button')).toEqual([]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(uncertain).getByRole('button', { name: 'Resume' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.setPaused', { appSessionId: APP, paused: false });
  });

  it('says why a paused queue paused, by the host’s reason, with Resume', async () => {
    const { client } = bridge();
    const cases: [SessionQueue['pauseReason'], string][] = [
      ['interrupt', 'Queue paused because you interrupted'],
      ['user', 'Queue paused'],
      ['exit', 'Queue paused · the session ended'],
      ['engine_turn', 'Queue paused · a background task finished while messages were waiting'],
      ['write_failed', 'Queue paused · a message could not be sent'],
      ['state_corrupt', 'Queue paused · the saved queue could not be read'],
      [null, 'Queue paused'],
    ];
    for (const [pauseReason, copy] of cases) {
      const { unmount } = render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1')], { paused: true, pauseReason })} sessionId={null} cwd="/repo" client={client} />);
      expect(screen.getByRole('region', { name: 'Queued messages' }).querySelector('header')!.textContent).toBe(`1 held until the turn ends · ${copy}Resume`);
      unmount();
    }
  });

  it('keeps a row whose action the host refused, and says so', async () => {
    const { client } = bridge({ 'session.queue.remove': { ok: false, error: { code: 'internal', message: 'entry is in flight' } } });
    render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1')])} sessionId={null} cwd="/repo" client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['entry is in flight']));
    expect(screen.getByText('message q-1')).toBeTruthy();
  });

  it('renders nothing for a fresh submitting entry, and its row once it has lasted 300 ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const now = new Date('2026-09-29T10:00:00.000Z');
    vi.setSystemTime(now);
    const { client } = bridge();
    const { container } = render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-s', { state: 'submitting', submittedAt: now.toISOString() })])} sessionId={null} cwd="/repo" client={client} />);
    expect(container.innerHTML).toBe(''); // every Send passes through submitting: no empty box flashes
    await act(async () => void vi.advanceTimersByTime(299));
    expect(container.innerHTML).toBe('');
    await act(async () => void vi.advanceTimersByTime(1));
    expect(screen.getByRole('region', { name: 'Queued messages' }).textContent).toContain('Sending…');
  });

  it('an entry reverted to queued and submitted again waits its 300 ms again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const first = new Date('2026-09-29T10:00:00.000Z');
    vi.setSystemTime(first);
    const { client } = bridge();
    const at = (entries: QueueEntry[]) => <QueueList appSessionId={APP} busy={false} queue={queue(entries)} sessionId={null} cwd="/repo" client={client} />;
    const { rerender } = render(at([entry('q-s', { state: 'submitting', submittedAt: first.toISOString() })]));
    await act(async () => void vi.advanceTimersByTime(300));
    expect(screen.queryByText('Sending…')).toBeTruthy();
    rerender(at([entry('q-s')])); // reverted: queued again
    expect(screen.queryByText('Sending…')).toBeNull();
    const again = new Date(first.getTime() + 5_000);
    vi.setSystemTime(again);
    rerender(at([entry('q-s', { state: 'submitting', submittedAt: again.toISOString() })]));
    expect(screen.queryByText('Sending…')).toBeNull(); // a new submission: fresh, not shown
    await act(async () => void vi.advanceTimersByTime(300));
    expect(screen.queryByText('Sending…')).toBeTruthy();
  });

  it('renders nothing when nothing waits', () => {
    const { client } = bridge();
    const { container } = render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-0', { state: 'released' })], { paused: true, pauseReason: 'interrupt' })} sessionId={null} cwd="/repo" client={client} />);
    expect(container.innerHTML).toBe('');
  });
});


it.each(['# Heading', '! x'])('keeps the literal queued prompt %s when saving its real editor', async (content) => {
  const { client, invoke } = bridge();
  render(<QueueList appSessionId={APP} busy={false} queue={queue([entry('q-1', { content })])} sessionId={null} cwd="/repo" client={client} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Edit' }));
  const box = await screen.findByRole('textbox', { name: 'Edit queued message' });
  await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(invoke).toHaveBeenCalledWith('session.queue.edit', { appSessionId: APP, queueId: 'q-1', content });
});
