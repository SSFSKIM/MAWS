// W3 (B7): the rewind picker, `/rewind` and Esc Esc: the session's own messages newest first, and the conversation, its
// files or both rewound to before the chosen one (pass2/rewind seq 41-42, pass3/rewind-files seq 141-142).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { resetComposerStore, useComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { ipcSource, useTranscriptStore } from '../transcript';
import { builder } from '../transcript/model/test-events';
import { RewindWidget } from './RewindWidget';

const A = 'app-a' as AppSessionId;
let fake: FakeClient;

beforeEach(async () => {
  resetShellStores();
  resetComposerStore();
  const b = builder();
  b.turn('u-1', 'first prompt');
  b.end(['u-1']);
  b.turn('u-2', 'second prompt\nwith a second line');
  b.end(['u-2']);
  fake = fakeClient({ 'session.events': () => ({ events: b.events, lastSeq: b.events.length, complete: true }) });
  window.maws = fake.client;
  useSessions.setState({ records: new Map([[A, record(A)]]), engine: new Map([[A, status(A)]]), recordsVersion: 1 });
  await act(() => useTranscriptStore.getState().attach(A, ipcSource(A)));
});
afterEach(() => {
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: MawsBridge }).maws;
});

const mount = () => {
  const close = vi.fn();
  render(<RewindWidget appSessionId={A} args="" close={close} />);
  return close;
};
const messages = () => within(screen.getByRole('radiogroup', { name: 'Your messages' })).getAllByRole('radio');
const option = (name: string) => within(screen.getByRole('radiogroup', { name: 'What to rewind' })).getByRole('radio', { name }) as HTMLButtonElement;
const rewound = (prefillText: string, files: unknown = null) => ({ rewound: true, reason: null, error: null, prefillText, precedingAssistantUuid: null, files });

describe('the rewind picker', () => {
  it('lists the session’s messages newest first, the newest chosen, and rewinds the conversation with the newest seen: the composer holds the engine’s prefillText', async () => {
    const close = mount();
    expect(messages().map((m) => m.querySelector('.truncate')?.textContent)).toEqual(['second prompt', 'first prompt']); // the first line
    expect(messages()[0].getAttribute('aria-checked')).toBe('true');
    fireEvent.click(messages()[1]);
    expect(option('Conversation').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Rewind to before it' }));
    await waitFor(() => expect(fake.pending('session.rewind')).toBe(1));
    expect(fake.invoked('session.rewind')).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-2', files: false }]);
    await act(() => fake.reply('session.rewind', rewound('first prompt')));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(useComposerStore.getState().prefills.get(A)).toEqual({ text: 'first prompt' });
  });

  it('offers files only while the session checkpoints them; Files restores the checkpoint alone, Both rewinds with files', async () => {
    useSessions.setState({ engine: new Map([[A, { ...status(A), fileCheckpointing: false }]]) });
    mount();
    expect([option('Files').disabled, option('Both').disabled]).toEqual([true, true]); // rewind_files: "File rewinding is not enabled."
    expect(screen.getByText('File checkpointing is off for this session, so its files cannot be rewound')).toBeTruthy();
    cleanup();
    useSessions.setState({ engine: new Map([[A, { ...status(A), fileCheckpointing: true }]]) });
    const close = mount();
    fireEvent.click(option('Files'));
    fireEvent.click(screen.getByRole('button', { name: 'Rewind to before it' }));
    await waitFor(() => expect(fake.invoked('session.rewindFiles')).toEqual([{ appSessionId: A, userMessageUuid: 'u-2', dryRun: false }]));
    await act(() => fake.reply('session.rewindFiles', { ok: true, enabled: true, message: null, dryRun: false, changedFiles: null, insertions: null, deletions: null, skippedLinks: 0 }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(fake.invoked('session.rewind')).toEqual([]);
    expect(useComposerStore.getState().prefills.size).toBe(0);
    cleanup();
    mount();
    fireEvent.click(option('Both'));
    fireEvent.click(screen.getByRole('button', { name: 'Rewind to before it' }));
    await waitFor(() => expect(fake.invoked('session.rewind')).toEqual([{ appSessionId: A, targetMessageUuid: 'u-2', lastSeenMessageUuid: 'u-2', files: true }]));
  });

  it('says why a refused rewind did nothing, and issues nothing while a turn runs', async () => {
    const close = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Rewind to before it' }));
    await act(() => fake.reply('session.rewind', { rewound: false, reason: 'stale_target', error: 'stale target', prefillText: null, precedingAssistantUuid: null, files: null }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The rewind was refused · stale_target'));
    expect(close).not.toHaveBeenCalled();
    cleanup();
    useSessions.setState({ engine: new Map([[A, status(A, { engineState: 'running', turn: { origin: 'human', startedAt: '2026-09-28T10:00:00.000Z', userMessageUuids: [] } })]]) });
    mount();
    expect((screen.getByRole('button', { name: 'Rewind to before it' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Wait for the turn to end, or stop it first')).toBeTruthy();
  });
});
