// W3 (B6; charter line 134 and §5.3 as amended 2026-10-01): Edit turns the user bubble itself into an editor with
// Cancel, Send and Fork; Send rewinds this session to that message and resends; nothing is pulled into the composer.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { resetComposerStore, resubmitRecordOf, setResubmit, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { resetCatalogStore } from '../stores/catalog';
import { ipcSource, registerBubbleEditor, useTranscriptStore, type Row } from '../transcript';
import { builder } from '../transcript/model/test-events';
import { renderRow } from '../transcript/view/rows/test-support';
import { Composer } from './Composer';
import { resetDockedCards } from './docked/registry';
import { BubbleEdit, BUSY_REASON } from './InlineEdit';
import { editAndResubmitRow, editPromptRow, registerResubmitProvider } from './resubmit-seam';

const A = 'app-a' as AppSessionId;
let fake: FakeClient;
let offEditor: () => void;

beforeEach(async () => {
  resetShellStores();
  resetComposerStore();
  resetQueueStore();
  resetCatalogStore();
  resetDockedCards();
  useNotices.setState({ notices: [] });
  const b = builder();
  b.turn('u-1', 'first prompt');
  b.end(['u-1']);
  b.turn('u-2', 'second prompt');
  b.end(['u-2']);
  // session.rewind and session.send are answered by each case
  fake = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': null,
    'session.drafts.set': undefined,
    'session.history.append': undefined,
    'session.events': () => ({ events: b.events, lastSeq: b.events.length, complete: true }),
  });
  window.maws = fake.client;
  useSessions.setState({ records: new Map([[A, record(A)]]), engine: new Map([[A, status(A)]]), recordsVersion: 1 });
  await act(() => useTranscriptStore.getState().attach(A, ipcSource(A))); // the session pane's transcript
  offEditor = registerBubbleEditor((props) => <BubbleEdit {...props} />);
  // the shell's pane 0 shows A's tab, focused: where a bubble's Edit is clicked
  const other = { tabs: [{ id: 'diagnostics' as const, kind: 'diagnostics' as const, pinned: false }], activeTabId: 'diagnostics' };
  const session = { tabs: [{ id: `session:${A}`, kind: 'session' as const, appSessionId: A, pinned: false }], activeTabId: `session:${A}` };
  useLayout.setState((s) => ({ main: { ...s.main, panes: [session, other], focusedPane: 0 } }));
});
afterEach(() => {
  offEditor();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: MawsBridge }).maws;
});

const rowOf = (uuid: string) => useTranscriptStore.getState().rows(A).find((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user' && r.messageUuid === uuid)!;
const editor = () => screen.getByRole('region', { name: 'Edit your message' });
const field = () => screen.getByRole('textbox', { name: 'Edited message' }) as HTMLTextAreaElement;
const rewound = { rewound: true, reason: null, error: null, prefillText: 'first prompt', precedingAssistantUuid: null, files: null };
const sent = { messageUuid: null, disposition: 'sent', queueId: 'q-1' };
const state = () => resubmitRecordOf(useComposerStore.getState(), A).state;

describe('Edit turns the bubble into an editor in its place', () => {
  it('shows the bubble until its Edit, then an editor with the text as typed, Cancel and Send; nothing goes into the composer', async () => {
    const view = renderRow(rowOf('u-1'), { storeKey: A });
    expect(within(view.container).getByText('first prompt')).toBeTruthy();
    act(() => editAndResubmitRow(rowOf('u-1')));
    expect(field().value).toBe('first prompt');
    expect(document.activeElement).toBe(field());
    expect(within(editor()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Send']); // no provider: no Fork
    expect(within(view.container).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(useComposerStore.getState().prefills.size).toBe(0);
    fireEvent.click(within(editor()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Edit your message' })).toBeNull();
    expect(within(view.container).getByText('first prompt')).toBeTruthy();
  });

  it('another bubble of the session stays a bubble, and Esc in the field cancels', async () => {
    renderRow(rowOf('u-2'), { storeKey: A });
    act(() => editAndResubmitRow(rowOf('u-1')));
    expect(screen.queryByRole('region', { name: 'Edit your message' })).toBeNull();
    cleanup();
    renderRow(rowOf('u-1'), { storeKey: A });
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Edit your message' })).toBeNull();
  });

  it('Send (or ⌘Enter) rewinds this session to that message with the newest message seen, then resends the edited text', async () => {
    renderRow(rowOf('u-1'), { storeKey: A });
    act(() => editAndResubmitRow(rowOf('u-1')));
    fireEvent.change(field(), { target: { value: 'first prompt, edited' } });
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(fake.pending('session.rewind')).toBe(1));
    expect(fake.invoked('session.rewind')).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-2', files: false }]);
    expect(within(editor()).getByRole('status').textContent).toBe('Rewinding this session to that message…');
    expect(field().readOnly).toBe(true);
    await act(() => fake.reply('session.rewind', rewound));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: 'first prompt, edited' }]);
    await act(() => fake.reply('session.send', sent));
    await waitFor(() => expect(state()).toBe('idle'));
    expect(useComposerStore.getState().inlineEdits.size).toBe(0);
  });

  it('while the resend is with the host, Cancel, Fork and Send are locked and neither Esc nor ⌘Enter acts', async () => {
    const off = registerResubmitProvider({ forkFrom: vi.fn(async () => ({ appSessionId: 'app-fork' as AppSessionId })) });
    try {
      renderRow(rowOf('u-1'), { storeKey: A });
      act(() => editAndResubmitRow(rowOf('u-1')));
      fireEvent.click(within(editor()).getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(fake.pending('session.rewind')).toBe(1));
      await act(() => fake.reply('session.rewind', rewound));
      await waitFor(() => expect(fake.pending('session.send')).toBe(1));
      expect(within(editor()).getByRole('status').textContent).toBe('Rewound · sending your edited message…');
      expect(['Cancel', 'Fork', 'Send'].map((name) => (within(editor()).getByRole('button', { name }) as HTMLButtonElement).disabled)).toEqual([true, true, true]);
      expect(field().readOnly).toBe(true);
      fireEvent.keyDown(field(), { key: 'Escape' });
      fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
      expect(fake.invoked('session.send')).toHaveLength(1);
      expect(editor()).toBeTruthy();
      await act(() => fake.reply('session.send', sent));
      await waitFor(() => expect(useComposerStore.getState().inlineEdits.size).toBe(0));
    } finally {
      off();
    }
  });

  it('Send waits while a turn runs, and says why', async () => {
    useSessions.setState({ engine: new Map([[A, status(A, { engineState: 'running', turn: { origin: 'human', startedAt: '2026-09-28T10:00:00.000Z', userMessageUuids: [] } })]]) });
    renderRow(rowOf('u-1'), { storeKey: A });
    act(() => editAndResubmitRow(rowOf('u-1')));
    expect((within(editor()).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(editor().textContent).toContain(BUSY_REASON);
  });

  it('with C10’s provider, Fork sends the edited text in a forked session from that message and leaves this one', async () => {
    const forkFrom = vi.fn(async () => ({ appSessionId: 'app-fork' as AppSessionId }));
    const off = registerResubmitProvider({ forkFrom });
    try {
      renderRow(rowOf('u-1'), { storeKey: A });
      act(() => editAndResubmitRow(rowOf('u-1')));
      fireEvent.click(within(editor()).getByRole('button', { name: 'Fork' }));
      await waitFor(() => expect(forkFrom).toHaveBeenCalledWith({ appSessionId: A, messageUuid: 'u-1', content: 'first prompt' }));
      expect(fake.invoked('session.rewind')).toEqual([]);
      await waitFor(() => expect(useComposerStore.getState().inlineEdits.size).toBe(0));
    } finally {
      off();
    }
  });

  it('a prompt a hook blocked (W1’s Edit prompt) is edited in the same place and sent as a new message, never rewound', async () => {
    renderRow(rowOf('u-2'), { storeKey: A });
    act(() => editPromptRow(rowOf('u-2')));
    expect(within(editor()).queryByRole('button', { name: 'Fork' })).toBeNull();
    fireEvent.click(within(editor()).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    expect(fake.invoked('session.rewind')).toEqual([]);
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: 'second prompt' }]);
  });
});

describe('once the rewind hid the bubble, the composer’s dock carries the resend', () => {
  function mountComposer() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <section aria-label="pane 0">
          <Composer appSessionId={A} paneIndex={0} />
        </section>
      </QueryClientProvider>,
    );
  }

  it('a failed resend reads Retry there, which sends again without a second rewind; × puts the text in the composer', async () => {
    mountComposer();
    act(() => editAndResubmitRow(rowOf('u-1')));
    act(() => setResubmit(A, { state: 'rewound_awaiting_send', sendFailed: true })); // as the seam leaves a failed resend
    const line = await screen.findByText('Rewound · the message was not sent');
    const dock = line.closest('[data-edit-mode]') as HTMLElement;
    fireEvent.click(within(dock).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    expect(fake.invoked('session.rewind')).toEqual([]);
    await act(() => fake.fail('session.send', 'still down'));
    await waitFor(() => expect(within(dock).getByRole('button', { name: 'Retry' })).toBeTruthy());
    fireEvent.click(within(dock).getByRole('button', { name: 'Leave the edit' }));
    expect(useComposerStore.getState().inlineEdits.size).toBe(0);
    await waitFor(() => expect(screen.queryByText('Rewound · the message was not sent')).toBeNull());
  });

  it('its Send and × are locked while the send is with the host, so a second click sends nothing', async () => {
    mountComposer();
    act(() => editAndResubmitRow(rowOf('u-1')));
    act(() => setResubmit(A, 'rewound_awaiting_send')); // a rewind the transcript confirmed late: Send is the human's
    const line = await screen.findByText('Rewound · send your edited message');
    const dock = line.closest('[data-edit-mode]') as HTMLElement;
    fireEvent.click(within(dock).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    expect(within(dock).getByRole('status').textContent).toBe('Rewound · sending your edited message…');
    const buttons = [within(dock).getByRole('button', { name: 'Send' }), within(dock).getByRole('button', { name: 'Leave the edit' })] as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
    buttons.forEach((b) => fireEvent.click(b));
    expect(fake.invoked('session.send')).toHaveLength(1);
    expect(useComposerStore.getState().inlineEdits.size).toBe(1);
    await act(() => fake.reply('session.send', sent));
    await waitFor(() => expect(useComposerStore.getState().inlineEdits.size).toBe(0));
  });
});
