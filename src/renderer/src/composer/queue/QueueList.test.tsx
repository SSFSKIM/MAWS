import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { connectKeys } from '../../keymap/dispatcher';
import { useNotices } from '../../stores/notices';
import type { SessionQueue } from '../../stores/queue';
import { PAUSED_COPY, QueueList, UNCERTAIN_TEXT } from './QueueList';

const APP = 'app-1' as AppSessionId;
const entry = (queueId: string, over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId, appSessionId: APP, content: `message ${queueId}`, createdAt: '2026-09-29T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});
const queue = (entries: QueueEntry[], over: Partial<SessionQueue> = {}): SessionQueue => ({ entries, paused: false, pauseReason: null, loaded: true, ...over });

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
  it('lists queued entries with Steer (next), Interrupt and send (now), Edit and Delete; the running turn is not listed', async () => {
    const { client, invoke } = bridge();
    render(<QueueList appSessionId={APP} queue={queue([entry('q-0', { state: 'released' }), entry('q-1'), entry('q-2', { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }, { type: 'text', text: 'look' }] })])} sessionId={null} cwd="/repo" client={client} />);
    const list = screen.getByRole('region', { name: 'Queued messages' });
    expect(within(list).getByText('2 queued')).toBeTruthy();
    expect(within(list).queryByText('message q-0')).toBeNull();
    expect(within(list).getByText('[Image #1] look')).toBeTruthy();
    const user = userEvent.setup();
    const [row] = within(list).getAllByRole('listitem');
    await user.click(within(row).getByRole('button', { name: 'Steer' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'next' });
    await user.click(within(row).getByRole('button', { name: 'More ways to send' }));
    await user.click(await screen.findByRole('menuitem', { name: /Interrupt and send/ }));
    expect(invoke).toHaveBeenCalledWith('session.queue.promote', { appSessionId: APP, queueId: 'q-1', priority: 'now' });
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(invoke).toHaveBeenCalledWith('session.queue.remove', { appSessionId: APP, queueId: 'q-1' });
  });

  it('edits a queued entry inline and writes the re-serialised content; Escape cancels', async () => {
    const { client, invoke } = bridge();
    render(<QueueList appSessionId={APP} queue={queue([entry('q-1')])} sessionId={null} cwd="/repo" client={client} />);
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
      const { unmount } = render(<QueueList appSessionId={APP} queue={queue([entry('q-1')], { paused: true, pauseReason })} sessionId={null} cwd="/repo" client={client} />);
      expect(screen.getByRole('region', { name: 'Queued messages' }).querySelector('header')!.textContent).toBe(`1 queued · ${copy}Resume`);
      unmount();
    }
  });

  it('keeps a row whose action the host refused, and says so', async () => {
    const { client } = bridge({ 'session.queue.remove': { ok: false, error: { code: 'internal', message: 'entry is in flight' } } });
    render(<QueueList appSessionId={APP} queue={queue([entry('q-1')])} sessionId={null} cwd="/repo" client={client} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['entry is in flight']));
    expect(screen.getByText('message q-1')).toBeTruthy();
  });

  it('renders nothing when nothing waits', () => {
    const { client } = bridge();
    const { container } = render(<QueueList appSessionId={APP} queue={queue([entry('q-0', { state: 'released' })], { paused: true, pauseReason: 'interrupt' })} sessionId={null} cwd="/repo" client={client} />);
    expect(container.innerHTML).toBe('');
  });
});
