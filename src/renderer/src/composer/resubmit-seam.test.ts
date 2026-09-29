import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { editingOf, prefillComposer, resetComposerStore, resubmitRecordOf, setEditing, useComposerStore } from '../stores/composer';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore, type TranscriptEntry } from '../stores/transcript';
import { applyEvents, createState } from '../transcript';
import { builder, uuid } from '../transcript/model/test-events';
import { resetShellStores } from '../test-support/shell-stores';
import {
  askToRewind,
  cancelRewind,
  confirmRewind,
  enterEditMode,
  keepEditing,
  leaveEditMode,
  REWIND_WINDOW_MS,
  registerResubmitProvider,
  resubmitProvider,
  resubmitSendFailed,
  resubmitSent,
  restoreEditMode,
  rewindAgain,
  entryShowsRewind,
  settleRestoredEdit,
  takeAutoSend,
  transcriptShowsRewind,
} from './resubmit-seam';

const A = 'app-a' as AppSessionId;
const u = (s: string) => s as MessageUuid;
type RewindResult = CommandResult<'session.rewind'>;

let fake: FakeClient;
let client: MawsBridge;
let rewinds: { input: unknown; answer(result: RewindResult): void }[];

// session.rewind answered by the test, one call at a time; everything else by the fake.
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  useNotices.setState({ notices: [] });
  useTranscriptStore.setState({ entries: {} });
  useSessions.setState({ engine: new Map([[A, status(A)]]) });
  fake = fakeClient();
  rewinds = [];
  client = {
    ...fake.client,
    invoke: ((name, input) => {
      if (name !== 'session.rewind') return fake.client.invoke(name, input);
      return new Promise<RewindResult>((resolve) => rewinds.push({ input, answer: resolve }));
    }) as MawsBridge['invoke'],
  };
});
afterEach(() => {
  leaveEditMode(A); // disposes any timer or subscription a case left behind
  vi.useRealTimers();
});

const record = () => resubmitRecordOf(useComposerStore.getState(), A);
const toasts = () => useNotices.getState().notices.map((n) => n.text);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const rewound = (): RewindResult => ({ ok: true, value: { rewound: true, reason: null, error: null, prefillText: 'the old text', precedingAssistantUuid: null, files: null } });
const refused = (reason: string): RewindResult => ({ ok: true, value: { rewound: false, reason, error: reason.replace(/_/g, ' '), prefillText: null, precedingAssistantUuid: null, files: null } });
const failed = (code: 'timeout' | 'internal'): RewindResult => ({ ok: false, error: { code, message: `session.rewind: ${code}` } });
const batch = (events: Partial<SessionEvent>[]) =>
  fake.event('session.eventBatch', { appSessionId: A, events: events.map((e, i) => ({ id: `ev-${i}`, sessionId: 'eng-a', at: '2026-09-29T12:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, ...e })) });
const boundary = (target: string) => batch([{ kind: 'boundary.rewind', targetMessageUuid: u(target), precedingAssistantUuid: null, prefillText: null } as Partial<SessionEvent>]);
const listening = () => fake.calls.filter((c) => c === 'on session.eventBatch').length;

// Edit mode on `u-1`, seen cursor `u-2`, confirmed: the rewind is in flight.
function confirmed(advanceTo: MessageUuid | null = null): { outcome: ReturnType<typeof confirmRewind> } {
  enterEditMode(A, { messageUuid: u('u-1'), seenCursor: u('u-2') });
  askToRewind(A);
  expect(record().state).toBe('confirming');
  const outcome = confirmRewind(client, A, advanceTo);
  expect(record().state).toBe('rewinding');
  return { outcome };
}

describe('resubmit state never repeats a rewind and reconciles an uncertain one', () => {
  it('rewinds once to the target with the seen cursor captured when the edit began, files untouched, then sends as part of that decision', async () => {
    const { outcome } = confirmed();
    expect(rewinds.map((r) => r.input)).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-2', files: false }]);
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('rewound');
    expect(record()).toMatchObject({ state: 'rewound_awaiting_send', autoSend: true });
    expect([takeAutoSend(A), takeAutoSend(A)]).toEqual([true, false]); // the composer sends once
    expect(listening()).toBe(0); // a definite answer needs no transcript
  });

  it('a confirm over a newer turn carries the advanced cursor', async () => {
    const { outcome } = confirmed(u('u-3'));
    expect(editingOf(useComposerStore.getState(), A)).toEqual({ messageUuid: 'u-1', seenCursor: 'u-3' });
    expect(rewinds[0].input).toMatchObject({ lastSeenMessageUuid: 'u-3' });
    rewinds[0].answer(rewound());
    await outcome;
  });

  it('a cancelled confirm issues nothing and keeps edit mode', () => {
    enterEditMode(A, { messageUuid: u('u-1'), seenCursor: u('u-1') });
    askToRewind(A);
    cancelRewind(A);
    expect(record().state).toBe('idle');
    expect(rewinds).toEqual([]);
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
  });

  it("a refusal returns to idle with the engine's reason, edit mode kept; the next Send confirms again", async () => {
    const { outcome } = confirmed();
    rewinds[0].answer(refused('unseen_later_turn'));
    expect(await outcome).toBe('refused');
    expect(record().state).toBe('idle');
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
    expect(toasts()).toEqual([expect.stringContaining('unseen_later_turn')]);
    askToRewind(A);
    expect(record().state).toBe('confirming');
    expect(rewinds).toHaveLength(1);
  });

  it('a send failure after the rewind stays rewound and says so; a successful send leaves edit mode', async () => {
    const { outcome } = confirmed();
    rewinds[0].answer(rewound());
    await outcome;
    resubmitSendFailed(A);
    expect(record()).toMatchObject({ state: 'rewound_awaiting_send', sendFailed: true });
    resubmitSent(A);
    expect(record().state).toBe('idle');
    expect(editingOf(useComposerStore.getState(), A)).toBeNull();
    expect(rewinds).toHaveLength(1);
  });

  for (const code of ['timeout', 'internal'] as const) {
    it(`a rewind that rejects with ${code} while the process is ready waits for the transcript and issues nothing`, async () => {
      const { outcome } = confirmed();
      expect(listening()).toBe(0); // subscribed only once uncertain
      rewinds[0].answer(failed(code));
      expect(await outcome).toBe('uncertain');
      expect(record().state).toBe('rewind_uncertain');
      expect(listening()).toBe(1);
      boundary('u-9'); // another target changes nothing
      expect(record().state).toBe('rewind_uncertain');
      boundary('u-1');
      expect(record()).toMatchObject({ state: 'rewound_awaiting_send', autoSend: false }); // confirmed later: Send is the human's
      expect(takeAutoSend(A)).toBe(false);
      expect(rewinds).toHaveLength(1);
      boundary('u-1'); // unsubscribed: a repeat is not heard
      expect(record().state).toBe('rewound_awaiting_send');
    });
  }

  it('with no boundary for the window the rewind is unresolved; Rewind again issues exactly one more, whose target_not_found means the first applied: edit mode ends, text kept', async () => {
    vi.useFakeTimers();
    const { outcome } = confirmed();
    rewinds[0].answer(failed('timeout'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS - 1);
    expect(record().state).toBe('rewind_uncertain');
    await vi.advanceTimersByTimeAsync(1);
    expect(record().state).toBe('rewind_unresolved');
    expect(rewinds).toHaveLength(1);
    const again = rewindAgain(client, A);
    expect(record().state).toBe('rewinding');
    expect(rewinds).toHaveLength(2);
    rewinds[1].answer(refused('target_not_found'));
    expect(await again).toBe('refused');
    expect(record().state).toBe('idle');
    expect(editingOf(useComposerStore.getState(), A)).toBeNull(); // confirming again could only loop
    expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']);
  });

  it('a boundary while unresolved confirms the rewind; Keep editing returns to idle', async () => {
    vi.useFakeTimers();
    let { outcome } = confirmed();
    rewinds[0].answer(failed('internal'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    boundary('u-1');
    expect(record().state).toBe('rewound_awaiting_send');

    leaveEditMode(A);
    ({ outcome } = confirmed());
    rewinds[1].answer(failed('internal'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    keepEditing(A);
    expect(record().state).toBe('idle');
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    boundary('u-1'); // nothing listens any more
    expect(record().state).toBe('idle');
  });

  it('the engine exiting while the rewind is in flight returns to idle with the banner, edit mode kept, and a late answer is ignored', async () => {
    const { outcome } = confirmed();
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) });
    expect(record()).toMatchObject({ state: 'idle', exited: true });
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('stale');
    expect(record()).toMatchObject({ state: 'idle', exited: true, autoSend: false });
  });

  it('a process.exited event while uncertain returns to idle with the banner', async () => {
    const { outcome } = confirmed();
    rewinds[0].answer(failed('timeout'));
    await outcome;
    batch([{ kind: 'process.exited', code: 1, signal: null, reason: 'crash', lostAttentionCount: 0 } as Partial<SessionEvent>]);
    expect(record()).toMatchObject({ state: 'idle', exited: true });
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
    askToRewind(A); // the next Send confirms against the transcript as it then stands
    expect(record()).toMatchObject({ state: 'confirming', exited: false });
  });

  it('a rejection after the process left is the exit, not an uncertain rewind', async () => {
    const { outcome } = confirmed();
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) });
    rewinds[0].answer(failed('internal'));
    expect(await outcome).toBe('stale');
    expect(listening()).toBe(0);
  });

  it('leaving edit mode after the rewind says where the text is; leaving is refused while the rewind is in flight', async () => {
    const { outcome } = confirmed();
    leaveEditMode(A);
    expect(record().state).toBe('rewinding'); // in flight: edit mode stays
    rewinds[0].answer(rewound());
    await outcome;
    leaveEditMode(A);
    expect(editingOf(useComposerStore.getState(), A)).toBeNull();
    expect(record().state).toBe('idle');
    expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']);
    await settle();
  });

  it('target_not_found always means the target left the conversation: edit mode ends and says so, restored edit or fresh', async () => {
    restoreEditMode(A, { messageUuid: u('u-1'), seenCursor: u('u-2') });
    expect(record().state).toBe('idle');
    askToRewind(A);
    const outcome = confirmRewind(client, A, null);
    rewinds[0].answer(refused('target_not_found'));
    expect(await outcome).toBe('refused');
    expect(editingOf(useComposerStore.getState(), A)).toBeNull();
    expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']);

    useNotices.setState({ notices: [] });
    const fresh = confirmed().outcome; // a new edit, not a restored one
    rewinds[1].answer(refused('target_not_found'));
    await fresh;
    expect(editingOf(useComposerStore.getState(), A)).toBeNull();
    expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']);
  });

  // This launch's hydrated transcript, through C6's own model: three turns (u1, u2, u3), then the rewinds named.
  function transcript(...rewinds: string[]): TranscriptEntry {
    const b = builder();
    for (const turn of ['u1', 'u2', 'u3']) {
      b.turn(turn);
      b.end([turn]);
    }
    for (const target of rewinds) b.emit('boundary.rewind', { targetMessageUuid: target.startsWith('u-') ? u(target) : uuid(target), precedingAssistantUuid: null, prefillText: null });
    const state = applyEvents(createState(null, null), b.events);
    return { phase: 'live', rows: [], state } as unknown as TranscriptEntry;
  }
  const hydrated = (...rewinds: string[]) => useTranscriptStore.setState({ entries: { [A]: transcript(...rewinds) } });

  it('a restored edit whose rewind the hydrated transcript shows ends at once; otherwise it stays', () => {
    restoreEditMode(A, { messageUuid: uuid('u2'), seenCursor: uuid('u3') });
    hydrated('u2');
    settleRestoredEdit(A, false);
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
    settleRestoredEdit(A, true);
    expect(editingOf(useComposerStore.getState(), A)).toBeNull();
    expect(toasts()).toEqual(['The conversation was rewound; your edited text is in the editor']);
    enterEditMode(A, { messageUuid: uuid('u2'), seenCursor: uuid('u3') });
    settleRestoredEdit(A, true); // not restored: the transcript is not consulted
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
  });

  it('a restored edit to an earlier launch’s message stays when this launch rewound to another message', () => {
    restoreEditMode(A, { messageUuid: u('u-1'), seenCursor: u('u-1') });
    hydrated('u2');
    expect(transcriptShowsRewind(A, u('u-1'))).toBe(false);
    settleRestoredEdit(A, true);
    expect(editingOf(useComposerStore.getState(), A)).not.toBeNull();
    expect(toasts()).toEqual([]);
  });

  it('what the selector reads flips when a later boundary names the edit’s own target, over an earlier rewind', () => {
    expect(entryShowsRewind(transcript('u2'), u('u-1'))).toBe(false); // a rewind boundary shown, to another message
    expect(entryShowsRewind(transcript('u2', 'u-1'), u('u-1'))).toBe(true);
    expect(entryShowsRewind(undefined, u('u-1'))).toBe(false);
    expect(entryShowsRewind({ ...transcript('u-1'), phase: 'hydrating' }, u('u-1'))).toBe(false);
  });

  it('a rewind to a message before the edited one ends the edit (its message is off the chain); one after it does not', () => {
    expect(entryShowsRewind(transcript('u1'), uuid('u2'))).toBe(true); // u2's turn hidden with u1's
    expect(entryShowsRewind(transcript('u3'), uuid('u2'))).toBe(false); // u2 still on the chain
    expect(entryShowsRewind(transcript(), uuid('u2'))).toBe(false);
  });

  it('a provider is null until one registers; its disposer removes only itself', () => {
    expect(resubmitProvider()).toBeNull();
    const provider = { forkFrom: vi.fn() };
    const off = registerResubmitProvider(provider);
    expect(resubmitProvider()).toBe(provider);
    const later = { forkFrom: vi.fn() };
    const offLater = registerResubmitProvider(later);
    off();
    expect(resubmitProvider()).toBe(later);
    offLater();
    expect(resubmitProvider()).toBeNull();
  });

  it('a prefill is refused while a rewind is in flight or unconfirmed (it would overwrite the confirmed text); once unresolved a new edit replaces the last one', async () => {
    vi.useFakeTimers();
    const next = { text: 'another message', editing: { messageUuid: u('u-5'), seenCursor: u('u-5') } };
    const { outcome } = confirmed();
    prefillComposer(A, next); // rewinding
    expect(useComposerStore.getState().prefills.has(A)).toBe(false);
    rewinds[0].answer(failed('timeout'));
    await outcome;
    prefillComposer(A, next); // rewind_uncertain
    expect(useComposerStore.getState().prefills.has(A)).toBe(false);
    expect(toasts()).toEqual(['A rewind is in progress', 'A rewind is in progress']);
    expect(record().state).toBe('rewind_uncertain');
    expect(editingOf(useComposerStore.getState(), A)).toEqual({ messageUuid: 'u-1', seenCursor: 'u-2' });

    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    prefillComposer(A, next); // rewind_unresolved: the human may move on
    expect(useComposerStore.getState().prefills.has(A)).toBe(true);
    enterEditMode(A, next.editing); // the composer takes it
    expect(record().state).toBe('idle');
    boundary('u-1');
    expect(record().state).toBe('idle');
    setEditing(A, null);
  });
});
