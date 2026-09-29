import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { connectKeys } from '../keymap/dispatcher';
import { itemFor, syntheticRequest } from '../request-card/test-requests';
import { useAttention } from '../stores/attention';
import { editingOf, prefillComposer, resetComposerStore, resubmitOf, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { resetCatalogStore } from '../stores/catalog';
import { ipcSource, useTranscriptStore, type Row } from '../transcript';
import { builder } from '../transcript/model/test-events';
import { Composer } from './Composer';
import { resetDockedCards } from './docked/registry';
import { editAndResubmitRow, registerResubmitProvider, setRewindWindow } from './resubmit-seam';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const u = (s: string) => s as MessageUuid;
let fake: FakeClient;
let disconnect: () => void;
let queryClient: QueryClient;
let sessionEvents: SessionEvent[];

// The session's transcript (C6's store over its IPC source): two human turns, u-1 then u-2.
function transcriptOf() {
  const b = builder();
  b.turn('u-1', 'first prompt');
  b.end(['u-1']);
  b.turn('u-2', 'second prompt');
  b.end(['u-2']);
  return b;
}

beforeEach(async () => {
  resetShellStores();
  resetComposerStore();
  resetQueueStore();
  resetCatalogStore();
  resetDockedCards();
  useNotices.setState({ notices: [] });
  sessionEvents = transcriptOf().events;
  // session.rewind and session.send are answered by each case (reply, or fail as an IpcError)
  fake = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': null,
    'session.drafts.set': undefined,
    'session.history.append': undefined,
    'session.answer': { outcome: 'delivered' },
    'session.events': () => ({ events: sessionEvents, lastSeq: sessionEvents.length, complete: true }),
  });
  window.maws = fake.client;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectKeys();
  useSessions.setState({ records: new Map([[A, record(A)]]), engine: new Map([[A, status(A)]]), recordsVersion: 1 });
  await act(() => useTranscriptStore.getState().attach(A, ipcSource(A))); // the session pane's transcript
});
afterEach(() => {
  disconnect();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  setRewindWindow(null);
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

type TiptapElement = HTMLElement & { editor: { commands: { insertContent(text: string): boolean }; getText(): string; isEditable: boolean } };
const pane = () => screen.getByRole('region', { name: 'pane 0' });
const editor = () => within(pane()).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
const primary = () => pane().querySelector<HTMLButtonElement>('[data-submit-state]')!;
const line = () => pane().querySelector<HTMLElement>('[data-edit-mode]');
const key = (target: HTMLElement, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const rewound = { rewound: true, reason: null, error: null, prefillText: 'second prompt', precedingAssistantUuid: null, files: null };
const sent = { messageUuid: null, disposition: 'sent', queueId: 'q-1' };
const rowOf = (uuid: string) => useTranscriptStore.getState().rows(A).find((r): r is Extract<Row, { kind: 'user' }> => r.kind === 'user' && r.messageUuid === uuid)!;
const toasts = () => useNotices.getState().notices.map((n) => n.text);
const liveEvent = (events: SessionEvent[]) => act(() => fake.event('session.eventBatch', { appSessionId: A, events }));

function mount(extra: ReactNode = null) {
  return render(
    <QueryClientProvider client={queryClient}>
      <section data-pane={0} aria-label="pane 0" onFocusCapture={() => useLayout.getState().focusPane(0)}>
        <Composer appSessionId={A} paneIndex={0} />
      </section>
      {extra}
    </QueryClientProvider>,
  );
}

// The shell's pane 0 shows A's tab, focused: where a bubble's Edit is clicked.
function focusedOn(appSessionId: AppSessionId) {
  const overview = { tabs: [{ id: 'overview' as const, kind: 'overview' as const, pinned: true as const }], activeTabId: 'overview' };
  const session = { tabs: [{ id: `session:${appSessionId}`, kind: 'session' as const, appSessionId, pinned: false }], activeTabId: `session:${appSessionId}` };
  useLayout.setState((s) => ({ main: { ...s.main, panes: [session, overview], focusedPane: 0 } }));
}

// A bubble's Edit on u-1, while u-2 is the newest message: edit mode with the seen cursor u-2.
async function editFirst() {
  focusedOn(A);
  act(() => editAndResubmitRow(rowOf('u-1')));
  await waitFor(() => expect(editor().editor.getText()).toBe('first prompt'));
  await waitFor(() => expect(line()?.textContent).toContain('Editing an earlier message · sending forks this session from here'));
}

async function confirmRewind() {
  await key(editor(), { key: 'Enter' });
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Rewind and resend' }));
  await waitFor(() => expect(fake.pending('session.rewind')).toBe(1));
}

describe('edit-and-resubmit in the composer', () => {
  it("C6's Edit prefills the focused pane's session with the row's text and the newest message as the seen cursor; another session's row does nothing", async () => {
    mount();
    await editFirst();
    expect(editingOf(useComposerStore.getState(), A)).toEqual({ messageUuid: 'u-1', seenCursor: 'u-2' });
    act(() => editAndResubmitRow({ ...rowOf('u-1'), messageUuid: u('u-elsewhere') }));
    expect(useComposerStore.getState().prefills.size).toBe(0);
  });

  it('the state line leaves edit mode on Esc or its ×, keeping the text', async () => {
    mount();
    await editFirst();
    act(() => editor().focus());
    await key(editor(), { key: 'Escape' });
    await waitFor(() => expect(line()).toBeNull());
    expect(editor().editor.getText()).toBe('first prompt');
    await editFirst();
    await userEvent.setup().click(within(line()!).getByRole('button', { name: 'Leave edit mode' }));
    await waitFor(() => expect(line()).toBeNull());
    expect(editingOf(useComposerStore.getState(), A)).toBeNull();
  });

  it('Send asks first, then rewinds once with the cursor captured at the edit and resends the edited text; edit mode ends', async () => {
    mount();
    await editFirst();
    act(() => void editor().editor.commands.insertContent(', edited'));
    await key(editor(), { key: 'Enter' });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Forking arrives with C10. Rewind this session to that message and resend instead?');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Rewind and resend' }));
    await waitFor(() => expect(fake.invoked('session.rewind')).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-2', files: false }]));
    expect(editor().editor.isEditable).toBe(false); // read-only while rewinding
    await fake.reply('session.rewind', rewound);
    await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: 'first prompt, edited' }]));
    await fake.reply('session.send', sent);
    await waitFor(() => expect(editor().editor.getText()).toBe(''));
    expect(line()).toBeNull();
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('idle');
    expect(fake.invoked('session.rewind')).toHaveLength(1);
  });

  it('a cancelled confirm keeps edit mode and issues nothing', async () => {
    mount();
    await editFirst();
    await key(editor(), { key: 'Enter' });
    await userEvent.setup().click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fake.invoked('session.rewind')).toEqual([]);
    expect(line()).not.toBeNull();
  });

  it('a later message after the edit began asks again, and the rewind carries the advanced cursor', async () => {
    mount();
    await editFirst();
    const later = builder('2026-09-28T11:00:00.000Z');
    later.turn('u-3', 'a queued prompt that ran');
    liveEvent(later.events.map((e, i) => ({ ...e, id: `later-${i}` }) as SessionEvent));
    await waitFor(() => expect(useTranscriptStore.getState().rows(A).some((r) => r.kind === 'user' && r.messageUuid === 'u-3')).toBe(true));
    await key(editor(), { key: 'Enter' });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('A newer turn started after you began editing. Rewinding discards it too. Rewind anyway?');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Rewind anyway' }));
    await waitFor(() => expect(fake.invoked('session.rewind')).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-3', files: false }]));
  });

  it('a send that fails after the rewind stays rewound with Retry, and Retry sends again without a second rewind', async () => {
    mount();
    await editFirst();
    await confirmRewind();
    await fake.reply('session.rewind', rewound);
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    await fake.fail('session.send', 'write_failed: the engine did not take the message');
    await waitFor(() => expect(line()?.textContent).toContain('Rewound · the message was not sent'));
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('rewound_awaiting_send');
    expect(editor().editor.getText()).toBe('first prompt');
    await userEvent.setup().click(within(line()!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    await fake.reply('session.send', sent);
    await waitFor(() => expect(line()).toBeNull());
    expect(fake.invoked('session.send')).toHaveLength(2);
    expect(fake.invoked('session.rewind')).toHaveLength(1);
  });

  it('a rewind the host could not report waits read-only for the boundary, then Send sends the edited text only', async () => {
    mount();
    await editFirst();
    await confirmRewind();
    await fake.fail('session.rewind', 'rewind_conversation unanswered after 8 s');
    await waitFor(() => expect(line()?.textContent).toContain('Rewind unconfirmed · checking the transcript…'));
    expect(editor().editor.isEditable).toBe(false);
    expect(editor().editor.getText()).toBe('first prompt');
    expect(primary().disabled).toBe(true);
    const confirm = builder('2026-09-28T11:00:00.000Z');
    confirm.emit('boundary.rewind', { targetMessageUuid: u('u-1'), precedingAssistantUuid: null, prefillText: 'first prompt' });
    liveEvent(confirm.events.map((e) => ({ ...e, id: 'boundary-1' }) as SessionEvent));
    await waitFor(() => expect(line()?.textContent).toContain('Rewound'));
    expect(fake.invoked('session.send')).toEqual([]); // confirmed later: the human sends
    await waitFor(() => expect(primary().disabled).toBe(false));
    await userEvent.setup().click(primary());
    await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: 'first prompt' }]));
    await fake.reply('session.send', sent);
    await waitFor(() => expect(line()).toBeNull());
    expect(fake.invoked('session.rewind')).toHaveLength(1);
  });

  it('unresolved after the window: Send without rewinding sends and never rewinds; Keep editing returns the editor', async () => {
    setRewindWindow(20);
    mount();
    await editFirst();
    await confirmRewind();
    await fake.fail('session.rewind');
    await waitFor(() => expect(line()?.textContent).toContain('The rewind could not be confirmed'));
    expect(within(line()!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Rewind again', 'Send without rewinding', 'Keep editing']);
    expect(editor().editor.isEditable).toBe(true);
    await userEvent.setup().click(within(line()!).getByRole('button', { name: 'Send without rewinding' }));
    await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: 'first prompt' }]));
    await fake.reply('session.send', sent);
    await waitFor(() => expect(line()).toBeNull());
    expect(fake.invoked('session.rewind')).toHaveLength(1);

    await editFirst();
    await confirmRewind();
    await fake.fail('session.rewind');
    await waitFor(() => expect(line()?.textContent).toContain('The rewind could not be confirmed'));
    await userEvent.setup().click(within(line()!).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(line()?.textContent).toContain('Editing an earlier message'));
    expect(editor().editor.getText()).toBe('first prompt');
    expect(fake.invoked('session.send')).toHaveLength(1);
  });

  it('the engine exiting mid-rewind returns to edit mode with the banner and sends nothing', async () => {
    mount();
    await editFirst();
    await confirmRewind();
    act(() => useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) }));
    await waitFor(() => expect(line()?.textContent).toContain('The engine exited before the rewind was confirmed · your edited text is kept'));
    await fake.reply('session.rewind', rewound);
    expect(fake.invoked('session.send')).toEqual([]);
    expect(editor().editor.getText()).toBe('first prompt');
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
  });

  it('with a registered provider, Send forks from the message and opens the new session', async () => {
    const forkFrom = vi.fn(async () => ({ appSessionId: B }));
    const off = registerResubmitProvider({ forkFrom });
    try {
      mount();
      await editFirst();
      await key(editor(), { key: 'Enter' });
      await waitFor(() => expect(forkFrom).toHaveBeenCalledWith({ appSessionId: A, messageUuid: 'u-1', content: 'first prompt' }));
      await waitFor(() => expect(useLayout.getState().main.panes[0].activeTabId).toBe(`session:${B}`));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(fake.invoked('session.rewind')).toEqual([]);
      expect(editingOf(useComposerStore.getState(), A)).toBeNull();
    } finally {
      off();
    }
  });

  it("the refusal dialog's Edit prompt lands in edit mode as a bubble's Edit does", async () => {
    mount();
    const event = syntheticRequest('refusal-fallback-dialog');
    const item = itemFor(event, A);
    act(() => useAttention.setState({ bySession: new Map([[A, [item]]]), requests: new Map([[item.id, event]]), version: 1 }));
    fireEvent.click(await within(pane()).findByRole('button', { name: 'Edit prompt' }));
    await waitFor(() => expect(fake.invoked('session.answer')).toHaveLength(1));
    act(() => useAttention.setState({ bySession: new Map([[A, []]]), version: 2 })); // the item retires
    await waitFor(() => expect(line()?.textContent).toContain('Editing an earlier message'));
    expect(editor().editor.getText()).toBe('second prompt');
    expect(editingOf(useComposerStore.getState(), A)).toEqual({ messageUuid: 'u-2', seenCursor: 'u-2' });
  });

  it('Enter in edit mode does nothing while the process is not ready, as the control says (no confirm, no send)', async () => {
    mount();
    await editFirst();
    act(() => useSessions.setState({ engine: new Map([[A, status(A, { process: 'starting' })]]) }));
    await waitFor(() => expect(primary().disabled).toBe(true));
    await key(editor(), { key: 'Enter' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(resubmitOf(useComposerStore.getState(), A)).toBe('idle');

    // rewound, confirmed by the transcript (Send is the human's), then the process leaves: Enter sends nothing
    act(() => useSessions.setState({ engine: new Map([[A, status(A)]]) }));
    await confirmRewind();
    await fake.fail('session.rewind');
    const confirm = builder('2026-09-28T11:00:00.000Z');
    confirm.emit('boundary.rewind', { targetMessageUuid: u('u-1'), precedingAssistantUuid: null, prefillText: 'first prompt' });
    liveEvent(confirm.events.map((e) => ({ ...e, id: 'boundary-ready' }) as SessionEvent));
    await waitFor(() => expect(resubmitOf(useComposerStore.getState(), A)).toBe('rewound_awaiting_send'));
    act(() => useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) }));
    await waitFor(() => expect(editor().editor.isEditable).toBe(true));
    await key(editor(), { key: 'Enter' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('keeps edit mode in the draft: entering it writes the edit into the draft document, leaving it writes it out', async () => {
    mount();
    await editFirst();
    const drafted = () => fake.invoked('session.drafts.set').at(-1) as { draft: { doc: { attrs: Record<string, unknown> } } | null } | undefined;
    await waitFor(() => expect(drafted()?.draft?.doc.attrs.editing).toEqual({ messageUuid: 'u-1', seenCursor: 'u-2' }), { timeout: 2_000 });
    act(() => editor().focus());
    await key(editor(), { key: 'Escape' });
    await waitFor(() => expect(drafted()?.draft?.doc.attrs.editing).toBeNull(), { timeout: 2_000 });
    expect(drafted()?.draft?.doc).toMatchObject({ content: [{ content: [{ text: 'first prompt' }] }] });
  });

  describe('after a reload (edit mode restored from the draft)', () => {
    const editedDraft = { doc: { type: 'doc', attrs: { attachments: [], editing: { messageUuid: 'u-1', seenCursor: 'u-2' } }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first prompt, edited' }] }] }, attachments: [], updatedAt: '2026-09-29T12:00:00.000Z' };
    beforeEach(() => {
      fake = fakeClient({
        'session.queue.list': { entries: [], paused: false, pauseReason: null },
        'session.history.list': { entries: [] },
        'session.drafts.get': editedDraft,
        'session.drafts.set': undefined,
        'session.history.append': undefined,
        'session.events': () => ({ events: sessionEvents, lastSeq: sessionEvents.length, complete: true }),
      });
      window.maws = fake.client;
    });
    // The store as a reload leaves it: nothing in memory, the transcript hydrating again from its source.
    async function reloaded() {
      resetComposerStore();
      for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
      mount();
      await act(() => useTranscriptStore.getState().attach(A, ipcSource(A)));
    }

    it('restores edit mode at idle when the edited message is still in the transcript, and Send confirms against it', async () => {
      await reloaded();
      await waitFor(() => expect(editor().editor.getText()).toBe('first prompt, edited'));
      await waitFor(() => expect(line()?.textContent).toContain('Editing an earlier message'));
      expect(editingOf(useComposerStore.getState(), A)).toEqual({ messageUuid: 'u-1', seenCursor: 'u-2' });
      expect(resubmitOf(useComposerStore.getState(), A)).toBe('idle');
      await confirmRewind();
      expect(fake.invoked('session.rewind')).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-2', files: false }]);
    });

    it('leaves edit mode, text kept, when the transcript shows the rewind already applied', async () => {
      const b = transcriptOf();
      b.emit('boundary.rewind', { targetMessageUuid: u('u-1'), precedingAssistantUuid: null, prefillText: 'first prompt' });
      sessionEvents = b.events;
      await reloaded();
      await waitFor(() => expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']));
      expect(line()).toBeNull();
      expect(editingOf(useComposerStore.getState(), A)).toBeNull();
      expect(editor().editor.getText()).toBe('first prompt, edited');
      expect(fake.invoked('session.rewind')).toEqual([]);
    });

    it('a target_not_found refusal after the reload leaves edit mode with the same copy, text kept', async () => {
      await reloaded();
      await waitFor(() => expect(line()?.textContent).toContain('Editing an earlier message'));
      await confirmRewind();
      await fake.reply('session.rewind', { rewound: false, reason: 'target_not_found', error: 'target not found', prefillText: null, precedingAssistantUuid: null, files: null });
      await waitFor(() => expect(line()).toBeNull());
      expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']);
      expect(editingOf(useComposerStore.getState(), A)).toBeNull();
      expect(editor().editor.getText()).toBe('first prompt, edited');
      expect(fake.invoked('session.send')).toEqual([]);
    });
  });

  it('a prefill with no edit leaves edit mode (C10 handing back a first message)', async () => {
    mount();
    await editFirst();
    act(() => prefillComposer(A, { text: 'handed back', editing: null }));
    await waitFor(() => expect(line()).toBeNull());
    expect(toasts()).toEqual([]);
  });
});
