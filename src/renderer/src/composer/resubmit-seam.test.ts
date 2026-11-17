// The resubmit state machine over a bubble edited in place (W3, B6): Send rewinds once with the seen cursor and resends
// the edited text; nothing ever repeats a rewind; an uncertain rewind is reconciled against the transcript.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import { anchoredMessage, anchorTag, commentsMessage, promotionMessage, PROMOTION_ANCHOR, quotedComment, readAnchoredMessage } from '@shared/anchor/message';
import { PASTED_BLOCK } from '@shared/composer/pasted-content';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { record as sessionRecord, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { expectNoGrantSent, grantsReadFrom, TYPED_CONSENT } from '../../../../test/support/grant-readers';
import { at } from '../../../../test/support/machine';
import { inlineEditOf, resetComposerStore, resubmitRecordOf, setInlineEdit, setInlineText, setResubmit, useComposerStore, type InlineEdit } from '../stores/composer';
import { prefillToDoc } from './editor/recall';
import { serializeDraft } from './editor/serialize';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore, type TranscriptEntry } from '../stores/transcript';
import { applyEvents, createState } from '../transcript';
import { rowsOf } from '../transcript/model/derive';
import { builder, uuid } from '../transcript/model/test-events';
import { userTextOf } from '../transcript/model/user-text';
import { pastedTagId, wrapPasted } from '@shared/composer/pasted-framing'; // ticket 733a
import { consentMessage, pastedBodies } from '@shared/engine/arrival'; // ticket 733a
import { LINE_LEFT_OUT, leaveOutGrant } from '@shared/engine/composed-content'; // ticket 733a
import { asTyped, quotesGrant } from '@shared/engine/grant'; // ticket 733a
import { planPrompt } from '@shared/engine/host-prompts'; // ticket 733a
import { pinPlanPrompt, pinPromotionMessage, pinQuotedComment, pinWrapPasted } from '../../../../test/support/pin-forms'; // ticket 733a
import { relayText } from '../tools/agents/model/relay'; // ticket 733a: the relay's writer, unchanged at the pin
import { resetShellStores } from '../test-support/shell-stores';
import {
  cancelInlineEdit,
  cancelRewind,
  confirmRewind,
  editRowOf,
  entryShowsRewind,
  forkInlineEdit,
  keepEditing,
  registerResubmitProvider,
  REWIND_WINDOW_MS,
  REWOUND_COPY,
  resubmitProvider,
  READY_WAIT_MS,
  rewindAgain,
  sendInlineEdit,
  startInlineEdit,
} from './resubmit-seam';

const A = at('app-a') as AppSessionId; // the page holds addresses
const u = (s: string) => s as MessageUuid;
type RewindResult = CommandResult<'session.rewind'>;
type SendResult = CommandResult<'session.send'>;

let fake: FakeClient;
let client: MawsBridge;
let rewinds: { input: unknown; answer(result: RewindResult): void }[];
let sendFails = false;
let sent: unknown[] = [];
let holdSends = false;
let held: ((accepted: boolean) => void)[] = [];

// session.rewind answered by the test, one call at a time; session.send by the flag, or, held, by the test; everything
// else by the fake.
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  useNotices.setState({ notices: [] });
  useTranscriptStore.setState({ entries: {} });
  useSessions.setState({ engine: new Map([[A, status(A)]]) });
  fake = fakeClient({ 'session.history.append': undefined });
  rewinds = [];
  sendFails = false;
  sent = [];
  holdSends = false;
  held = [];
  client = {
    ...fake.client,
    invoke: ((name, input, ...rest: unknown[]) => {
      if (name === 'session.send') {
        sent.push(input);
        const answer = (accepted: boolean): SendResult => (accepted ? { ok: true, value: { messageUuid: null, disposition: 'sent', queueId: 'q' } } : { ok: false, error: { code: 'internal', message: 'write failed' } });
        if (holdSends) return new Promise<SendResult>((resolve) => held.push((accepted) => resolve(answer(accepted))));
        return Promise.resolve(answer(!sendFails));
      }
      if (name !== 'session.rewind') return (fake.client.invoke as unknown as (...a: unknown[]) => Promise<never>)(name, input, ...rest);
      return new Promise<RewindResult>((resolve) => rewinds.push({ input, answer: resolve }));
    }) as MawsBridge['invoke'],
  };
});
afterEach(() => {
  cancelInlineEdit(A); // disposes any timer or subscription a case left behind (refused while in flight)
  vi.useRealTimers();
});

const record = () => resubmitRecordOf(useComposerStore.getState(), A);
const edit = () => inlineEditOf(useComposerStore.getState(), A);
const toasts = () => useNotices.getState().notices.map((n) => n.text);
const sends = () => sent;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const rewound = (): RewindResult => ({ ok: true, value: { rewound: true, reason: null, error: null, prefillText: 'the old text', precedingAssistantUuid: null, files: null } });
const refused = (reason: string): RewindResult => ({ ok: true, value: { rewound: false, reason, error: reason.replace(/_/g, ' '), prefillText: null, precedingAssistantUuid: null, files: null } });
const failed = (code: 'timeout' | 'internal'): RewindResult => ({ ok: false, error: { code, message: `session.rewind: ${code}` } });
const batch = (events: Partial<SessionEvent>[]) =>
  fake.event('session.eventBatch', { appSessionId: A, events: events.map((e, i) => ({ id: `ev-${i}`, sessionId: 'eng-a', at: '2026-09-29T12:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, ...e })) });
const boundary = (target: string) => batch([{ kind: 'boundary.rewind', targetMessageUuid: u(target), precedingAssistantUuid: null, prefillText: null } as Partial<SessionEvent>]);
const listening = () => fake.calls.filter((c) => c === 'on session.eventBatch').length;

// The bubble `u-1` edited in place with `u-2` the newest message seen: its text edited, the transcript showing `u-2`.
function editing(over: Partial<InlineEdit> = {}): void {
  setInlineEdit(A, { messageUuid: u('u-1'), seenCursor: u('u-2'), kind: 'edit', text: 'turn one edited', bodies: {}, images: [], form: null, ...over });
  showTranscript();
}
// The transcript's two turns, then a `boundary.rewind` for each target named (the transcript applies it whether or not
// the seam is listening).
function showTranscript(...rewinds: string[]): void {
  const b = builder();
  b.turn('u-1');
  b.end(['u-1']);
  b.turn('u-2');
  b.end(['u-2']);
  for (const target of rewinds) b.emit('boundary.rewind', { targetMessageUuid: u(target), precedingAssistantUuid: null, prefillText: null });
  useTranscriptStore.setState({ entries: { [A]: { phase: 'live', rows: ROWS, state: applyEvents(createState(null, null), b.events) } as unknown as TranscriptEntry } });
}
// The transcript's user rows, u-2 the newest (the seen-cursor reading uses only the user rows' message uuids).
const ROWS = [{ kind: 'user', messageUuid: u('u-1') }, { kind: 'user', messageUuid: u('u-2') }];
// Ticket 733a: the transcript store holding `rows` as its rows of the session (an edit reads its row from the store by id)
function stored(...rows: unknown[]): void {
  useTranscriptStore.setState({ entries: { [A]: { phase: 'live', rows, state: createState(null, null) } as unknown as TranscriptEntry } });
}

// Send: the rewind is in flight.
function sending(): Promise<unknown> {
  const outcome = sendInlineEdit(client, A);
  expect(record().state).toBe('rewinding');
  return outcome;
}

describe('a bubble edited in place: Send rewinds once and resends', () => {
  it('rewinds once to the target with the seen cursor captured when the edit began, files untouched, then sends the edited text and ends the edit', async () => {
    editing();
    const outcome = sending();
    expect(rewinds.map((r) => r.input)).toEqual([{ appSessionId: A, targetMessageUuid: 'u-1', lastSeenMessageUuid: 'u-2', files: false }]);
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('rewound');
    await vi.waitFor(() => expect(sends()).toEqual([{ appSessionId: A, content: 'turn one edited' }]));
    await vi.waitFor(() => expect(edit()).toBeNull());
    expect(record().state).toBe('idle');
    expect(listening()).toBe(0); // a definite answer needs no transcript
    expect(rewinds).toHaveLength(1);
  });

  it('the one-writer rule: a bubble edited to hold the consent sentence is resent reading no grant', async () => {
    editing({ text: `turn one edited\n${TYPED_CONSENT}` });
    const outcome = sending();
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('rewound');
    await vi.waitFor(() => expect(sends()).toHaveLength(1));
    expectNoGrantSent((sends()[0] as { content: string }).content);
  });

  it('a newer turn since the edit began asks first; the confirm carries the advanced cursor, a cancel issues nothing', async () => {
    editing({ seenCursor: u('u-1') }); // the transcript's newest is u-2: a turn began after the edit
    await sendInlineEdit(client, A);
    expect(record().state).toBe('confirming');
    cancelRewind(A);
    expect([record().state, rewinds.length]).toEqual(['idle', 0]);
    await sendInlineEdit(client, A);
    const outcome = confirmRewind(client, A);
    expect(edit()).toMatchObject({ seenCursor: 'u-2' });
    expect(rewinds[0].input).toMatchObject({ lastSeenMessageUuid: 'u-2' });
    rewinds[0].answer(rewound());
    await outcome;
  });

  it("a refusal returns to idle with the engine's reason, the edit kept; the next Send rewinds again", async () => {
    editing();
    const outcome = sending();
    rewinds[0].answer(refused('unseen_later_turn'));
    expect(await outcome).toBe('refused');
    expect(record().state).toBe('idle');
    expect(edit()).not.toBeNull();
    expect(toasts()).toEqual([expect.stringContaining('unseen_later_turn')]);
    void sending();
    expect(rewinds).toHaveLength(2);
  });

  it('a send that fails after the rewind stays rewound with the failure; Retry sends again and never rewinds', async () => {
    editing();
    sendFails = true;
    const outcome = sending();
    rewinds[0].answer(rewound());
    await outcome;
    await vi.waitFor(() => expect(record()).toMatchObject({ state: 'rewound_awaiting_send', sendFailed: true }));
    expect(edit()).not.toBeNull(); // the text is kept for the retry
    sendFails = false;
    expect(await sendInlineEdit(client, A)).toBe('sent');
    expect(record().state).toBe('idle');
    expect(edit()).toBeNull();
    expect(rewinds).toHaveLength(1);
    expect(sends()).toHaveLength(2);
  });

  for (const code of ['timeout', 'internal'] as const) {
    it(`a rewind that rejects with ${code} while the process is ready waits for the transcript and issues nothing`, async () => {
      editing();
      const outcome = sending();
      expect(listening()).toBe(0); // subscribed only once uncertain
      rewinds[0].answer(failed(code));
      expect(await outcome).toBe('uncertain');
      expect(record().state).toBe('rewind_uncertain');
      expect(listening()).toBe(1);
      boundary('u-9'); // another target changes nothing
      expect(record().state).toBe('rewind_uncertain');
      boundary('u-1');
      expect(record()).toMatchObject({ state: 'rewound_awaiting_send', autoSend: false }); // confirmed later: Send is the human's
      await settle();
      expect(sends()).toEqual([]);
      expect(rewinds).toHaveLength(1);
      boundary('u-1'); // unsubscribed: a repeat is not heard
      expect(record().state).toBe('rewound_awaiting_send');
    });
  }

  it('with no boundary for the window the rewind is unresolved; Rewind again issues exactly one more, whose target_not_found means the first applied: the edit ends, its text in the composer', async () => {
    vi.useFakeTimers();
    editing();
    const outcome = sending();
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
    expect(edit()).toBeNull(); // rewinding again could only loop
    expect(useComposerStore.getState().prefills.get(A)).toMatchObject({ text: 'turn one edited' });
    expect(toasts()).toEqual([REWOUND_COPY]);
  });

  it('unresolved: Send without rewinding sends alone; Keep editing returns to idle and nothing listens any more', async () => {
    vi.useFakeTimers();
    editing();
    let outcome = sending();
    rewinds[0].answer(failed('internal'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    expect(await sendInlineEdit(client, A, 'without_rewinding')).toBe('sent');
    expect(rewinds).toHaveLength(1);
    expect(edit()).toBeNull();

    editing();
    outcome = sending();
    rewinds[1].answer(failed('internal'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    expect(await sendInlineEdit(client, A)).toBe('stale'); // a plain Send while unresolved does nothing
    keepEditing(A);
    expect(record().state).toBe('idle');
    expect(edit()).not.toBeNull();
    boundary('u-1'); // nothing listens any more
    expect(record().state).toBe('idle');
  });

  it('the engine exiting while the rewind is in flight returns to idle with the exit note, the edit kept, and a late answer is ignored', async () => {
    editing();
    const outcome = sending();
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) });
    expect(record()).toMatchObject({ state: 'idle', exited: true });
    expect(edit()).not.toBeNull();
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('stale');
    expect(record()).toMatchObject({ state: 'idle', exited: true, autoSend: false });
    expect(sends()).toEqual([]);
  });

  it('a process.exited event while uncertain returns to idle with the note; a rejection after the process left is the exit', async () => {
    editing();
    let outcome = sending();
    rewinds[0].answer(failed('timeout'));
    await outcome;
    batch([{ kind: 'process.exited', code: 1, signal: null, reason: 'crash', lostAttentionCount: 0 } as Partial<SessionEvent>]);
    expect(record()).toMatchObject({ state: 'idle', exited: true });
    expect(edit()).not.toBeNull();

    useSessions.setState({ engine: new Map([[A, status(A)]]) });
    outcome = sending();
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) });
    rewinds[1].answer(failed('internal'));
    expect(await outcome).toBe('stale');
  });

  it('Cancel is refused while the rewind is in flight; after the rewind the edited text goes into the composer', async () => {
    editing();
    sendFails = true;
    const outcome = sending();
    expect(cancelInlineEdit(A)).toBe(false);
    expect(record().state).toBe('rewinding');
    rewinds[0].answer(rewound());
    await outcome;
    await vi.waitFor(() => expect(record().sendFailed).toBe(true));
    expect(cancelInlineEdit(A)).toBe(true);
    expect(edit()).toBeNull();
    expect(useComposerStore.getState().prefills.get(A)).toMatchObject({ text: 'turn one edited' });
  });

  it('a blocked prompt (a hook stopped it) is sent as a new message, never rewound', async () => {
    editing({ kind: 'blocked', seenCursor: null });
    expect(await sendInlineEdit(client, A)).toBe('sent');
    expect(rewinds).toEqual([]);
    expect(sends()).toEqual([{ appSessionId: A, content: 'turn one edited' }]);
    expect(edit()).toBeNull();
  });

  it('a new edit is refused while a rewind is in flight or unconfirmed', async () => {
    editing();
    const outcome = sending();
    expect(startInlineEdit(A, u('u-5'), 'edit')).toBe(false);
    expect(toasts()).toEqual(['A rewind is in progress']);
    expect(edit()).toMatchObject({ messageUuid: 'u-1' });
    rewinds[0].answer(rewound());
    await outcome;
  });

  it('an edit is a prompt as written: a leading # or ! is sent as text, never as a memory note or a shell command', async () => {
    const forkFrom = vi.fn(async () => ({ appSessionId: 'app-fork' as AppSessionId }));
    const off = registerResubmitProvider({ forkFrom });
    try {
      editing({ text: '# Requirements' });
      const outcome = sending();
      rewinds[0].answer(rewound());
      await outcome;
      await vi.waitFor(() => expect(edit()).toBeNull());
      editing({ kind: 'blocked', seenCursor: null, text: '!ls -la' });
      expect(await sendInlineEdit(client, A)).toBe('sent');
      expect(sends()).toEqual([
        { appSessionId: A, content: '# Requirements' },
        { appSessionId: A, content: '!ls -la' },
      ]);
      editing({ text: '# Requirements' });
      expect(await forkInlineEdit(client, A)).toBe(true);
      expect(forkFrom).toHaveBeenCalledWith({ appSessionId: A, messageUuid: 'u-1', content: '# Requirements' });
    } finally {
      off();
    }
  });
});

describe('one submission at a time: the send or fork is with the host until it answers', () => {

  it("the resend after the rewind holds the dock line's Send, Fork, Cancel and a new edit; its answer ends the edit it was sent for", async () => {
    const forkFrom = vi.fn(async () => ({ appSessionId: 'app-fork' as AppSessionId }));
    const off = registerResubmitProvider({ forkFrom });
    try {
      editing();
      holdSends = true;
      const outcome = sending();
      rewinds[0].answer(rewound());
      await outcome;
      await vi.waitFor(() => expect(sends()).toHaveLength(1));
      expect(record()).toMatchObject({ state: 'rewound_awaiting_send', sending: true });
      const again = sendInlineEdit(client, A);
      const fork = forkInlineEdit(client, A);
      expect([sends().length, forkFrom.mock.calls.length]).toEqual([1, 0]);
      expect(cancelInlineEdit(A)).toBe(false);
      expect(startInlineEdit(A, u('u-5'), 'edit')).toBe(false);
      expect(toasts()).toEqual(['Your edited message is being sent']);
      expect(edit()).toMatchObject({ messageUuid: 'u-1', text: 'turn one edited' });
      held[0](true);
      await vi.waitFor(() => expect(edit()).toBeNull());
      expect(record()).toMatchObject({ state: 'idle', sending: false });
      expect([await again, await fork]).toEqual(['stale', false]);
      expect([sends().length, rewinds.length]).toEqual([1, 1]);
    } finally {
      off();
    }
  });

  it("a blocked prompt's Send is held until the host answers; a failure puts the edit back for another Send", async () => {
    editing({ kind: 'blocked', seenCursor: null });
    holdSends = true;
    const first = sendInlineEdit(client, A);
    expect(record()).toMatchObject({ state: 'idle', sending: true });
    const second = sendInlineEdit(client, A);
    expect(cancelInlineEdit(A)).toBe(false);
    expect(sends()).toHaveLength(1);
    held[0](false);
    expect([await first, await second]).toEqual(['stale', 'stale']);
    expect(record()).toMatchObject({ state: 'idle', sending: false });
    expect(edit()).not.toBeNull();
    holdSends = false;
    expect(await sendInlineEdit(client, A)).toBe('sent');
    expect(sends()).toHaveLength(2);
    expect(edit()).toBeNull();
  });

  it('a Fork with the host holds Send and another Fork; its answer ends the edit', async () => {
    let answer: (opened: { appSessionId: AppSessionId }) => void = () => {};
    const forkFrom = vi.fn(() => new Promise<{ appSessionId: AppSessionId }>((resolve) => (answer = resolve)));
    const off = registerResubmitProvider({ forkFrom });
    try {
      editing();
      const forked = forkInlineEdit(client, A);
      expect(record().sending).toBe(true);
      const again = forkInlineEdit(client, A);
      const send = sendInlineEdit(client, A);
      expect([forkFrom.mock.calls.length, rewinds.length, record().state]).toEqual([1, 0, 'idle']);
      answer({ appSessionId: 'app-fork' as AppSessionId });
      expect([await forked, await again, await send]).toEqual([true, false, 'stale']);
      expect(edit()).toBeNull();
      expect(record()).toMatchObject({ state: 'idle', sending: false });
    } finally {
      off();
    }
  });

  it('Send without rewinding holds Rewind again and Keep editing and stops watching the transcript; its answer ends the edit', async () => {
    vi.useFakeTimers();
    editing();
    const outcome = sending();
    rewinds[0].answer(failed('internal'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    holdSends = true;
    const send = sendInlineEdit(client, A, 'without_rewinding');
    expect(record()).toMatchObject({ state: 'rewind_unresolved', sending: true });
    keepEditing(A);
    const again = rewindAgain(client, A);
    boundary('u-1'); // the human chose not to wait for it
    expect(record()).toMatchObject({ state: 'rewind_unresolved', sending: true });
    expect(rewinds).toHaveLength(1);
    held[0](true);
    expect([await send, await again]).toEqual(['sent', 'stale']);
    expect(edit()).toBeNull();
  });

  // The rewind left unresolved (a rejection, then the window with no boundary).
  async function unresolved(): Promise<void> {
    vi.useFakeTimers();
    editing();
    const outcome = sending();
    rewinds[0].answer(failed('internal'));
    await outcome;
    await vi.advanceTimersByTimeAsync(REWIND_WINDOW_MS);
    expect(record().state).toBe('rewind_unresolved');
  }

  it("a Send without rewinding that fails watches for the boundary again: one arriving after it confirms the rewind, the send the human's", async () => {
    await unresolved();
    sendFails = true;
    expect(await sendInlineEdit(client, A, 'without_rewinding')).toBe('stale');
    expect(record()).toMatchObject({ state: 'rewind_unresolved', sending: false });
    boundary('u-9'); // another target changes nothing
    expect(record().state).toBe('rewind_unresolved');
    boundary('u-1');
    expect(record()).toMatchObject({ state: 'rewound_awaiting_send', autoSend: false, sendFailed: false, sending: false });
    expect([sends().length, rewinds.length]).toEqual([1, 1]);
  });

  it('a boundary the transcript took while that send was with the host confirms the rewind as soon as the send fails', async () => {
    await unresolved();
    holdSends = true;
    const send = sendInlineEdit(client, A, 'without_rewinding');
    boundary('u-1'); // the seam is not listening while the send is with the host
    showTranscript('u-1'); // the transcript applies it all the same
    expect(record()).toMatchObject({ state: 'rewind_unresolved', sending: true });
    held[0](false);
    expect(await send).toBe('stale');
    expect(record()).toMatchObject({ state: 'rewound_awaiting_send', autoSend: false, sendFailed: false, sending: false });
    expect([sends().length, rewinds.length]).toEqual([1, 1]);
  });

  it('a Send without rewinding that fails after the process left is the exit: idle with the note, the edit kept', async () => {
    await unresolved();
    holdSends = true;
    const send = sendInlineEdit(client, A, 'without_rewinding');
    useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]) });
    held[0](false);
    expect(await send).toBe('stale');
    expect(record()).toMatchObject({ state: 'idle', exited: true, sending: false });
    expect(edit()).not.toBeNull();
    expect(rewinds).toHaveLength(1);
  });
});

// P2-A (2026-10-09; the execution document §5.6): an edit's Send on a session with a record and no ready process
// starts it first (`session.acquire`, reason resubmit), holding the edit meanwhile, then runs the flow as today.
describe('an edit resubmitted on an exited session', () => {
  const exited = () => useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' })]]), records: new Map([[A, sessionRecord(A)]]) });

  it('starts the session first, holding the edit, then rewinds once the session reads ready and resends', async () => {
    exited();
    editing();
    const outcome = sendInlineEdit(client, A);
    await settle();
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: A, reason: 'resubmit' }]);
    expect(record()).toMatchObject({ state: 'idle', sending: true });
    expect(rewinds).toHaveLength(0);
    await fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false });
    expect(rewinds).toHaveLength(0); // the renderer's status still trails: nothing goes to a process it reads as gone
    useSessions.setState({ engine: new Map([[A, status(A)]]) });
    await settle();
    expect(rewinds).toHaveLength(1);
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('rewound');
    await settle();
    expect(sends()).toHaveLength(1);
    expect(fake.invoked('session.acquire')).toHaveLength(1);
  });

  it('a blocked prompt sent anew on an exited session starts it, then sends once', async () => {
    exited();
    editing({ kind: 'blocked' });
    const outcome = sendInlineEdit(client, A);
    await settle();
    await fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: false, joined: true });
    useSessions.setState({ engine: new Map([[A, status(A)]]) });
    expect(await outcome).toBe('sent');
    expect(sends()).toHaveLength(1);
    expect(rewinds).toHaveLength(0);
  });

  // M3 review: main answered ready, so the host's own status is read rather than waiting on an event that may not come
  it('acquire answers ready and no ready event follows: the host’s status read reconciles it and the flow goes on', async () => {
    exited();
    editing();
    const outcome = sendInlineEdit(client, A);
    await settle();
    await fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false });
    expect(fake.invoked('session.status')).toEqual([{ appSessionId: A }]);
    await fake.reply('session.status', status(A));
    await settle();
    expect(useSessions.getState().engine.get(A)?.process).toBe('ready'); // applied: the host's answer is authoritative
    expect(rewinds).toHaveLength(1);
    rewinds[0].answer(rewound());
    expect(await outcome).toBe('rewound');
  });

  it('acquire answers ready and neither the status read nor an event ever says so: the wait is bounded, the edit released, and a late ready sends nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    exited();
    editing();
    const outcome = sendInlineEdit(client, A);
    await settle();
    await fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false });
    expect(record()).toMatchObject({ sending: true });
    vi.advanceTimersByTime(READY_WAIT_MS);
    expect(await outcome).toBe('stale');
    expect(record()).toMatchObject({ state: 'idle', sending: false });
    expect(edit()).not.toBeNull();
    expect(toasts()).toEqual(['The session did not become ready']);
    useSessions.setState({ engine: new Map([[A, status(A)]]) }); // a ready arriving after the bound starts nothing
    await settle();
    expect([rewinds.length, sends().length]).toEqual([0, 0]);
  });

  it('Cancel while the session starts ends the edit: the wait and its subscription go, and nothing is rewound or sent', async () => {
    exited();
    editing();
    const outcome = sendInlineEdit(client, A);
    await settle();
    await fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false });
    expect(cancelInlineEdit(A)).toBe(true);
    expect(edit()).toBeNull();
    expect(await outcome).toBe('stale');
    useSessions.setState({ engine: new Map([[A, status(A)]]) });
    await fake.reply('session.status', status(A));
    await settle();
    expect([rewinds.length, sends().length]).toEqual([0, 0]);
    expect(record()).toMatchObject({ state: 'idle', sending: false });
  });

  it('Cancel during the acquisition itself: the start goes on, the edit ends, and its late ready sends nothing', async () => {
    exited();
    editing();
    const outcome = sendInlineEdit(client, A);
    await settle();
    expect(cancelInlineEdit(A)).toBe(true);
    await fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false });
    expect(await outcome).toBe('stale');
    expect(fake.invoked('session.status')).toEqual([]);
    expect([rewinds.length, sends().length]).toEqual([0, 0]);
  });

  it('a refused start leaves the edit as it was, says why, and rewinds nothing', async () => {
    exited();
    editing();
    const outcome = sendInlineEdit(client, A);
    await settle();
    await fake.reply('session.acquire', { status: 'missing_directory', appSessionId: A, directory: '/gone' });
    expect(await outcome).toBe('stale');
    expect(record()).toMatchObject({ state: 'idle', sending: false });
    expect(edit()).not.toBeNull();
    expect(toasts()).toEqual(['Directory not found: /gone']);
    expect([rewinds.length, sends().length]).toEqual([0, 0]);
  });
});

describe('the pasted bodies an edit sends', () => {
  // A row with two pasted blocks as C6 derives it: each placeholder in the text, its body a `text` attachment.
  const ROW_TEXT = 'compare [Pasted text #1 +1 lines] with [Pasted text #2 +1 lines]';
  const pastedRow = {
    kind: 'user',
    id: 'r-1',
    messageUuid: u('u-1'),
    text: ROW_TEXT,
    attachments: [
      { kind: 'text', name: 'Pasted text #1', bytes: 3, dataUrl: null, mediaType: 'text/plain', text: 'one' },
      { kind: 'text', name: 'Pasted text #2', bytes: 3, dataUrl: null, mediaType: 'text/plain', text: 'two' },
    ],
    placeholders: [8, 39],
  } as never;
  const bodiesOf = (content: unknown) => [...String(content).matchAll(PASTED_BLOCK)].map((m) => m[2]);

  it('each placeholder sends the body it named when the edit began, wherever the edit moved it; one it never named is unavailable', async () => {
    const cases: [string, string[]][] = [
      ['compare with [Pasted text #2 +1 lines]', ['two']], // #1 deleted
      ['[Pasted text #2 +1 lines] before [Pasted text #1 +1 lines]', ['two', 'one']], // moved
      ['[Pasted text #3 +1 lines] and [Pasted text #2 +1 lines]', ['two']], // #3 named nothing
      [ROW_TEXT, ['one', 'two']], // untouched
    ];
    for (const [text, bodies] of cases) {
      sent = [];
      stored(pastedRow);
      expect(startInlineEdit(A, u('u-1'), 'blocked')).toBe(true);
      setInlineText(A, text);
      expect(await sendInlineEdit(client, A)).toBe('sent');
      expect(bodiesOf((sends()[0] as { content: unknown }).content)).toEqual(bodies);
    }
    expect(toasts()).toEqual(['1 pasted segment was unavailable and was left out']);
  });

  it('the edited text handed to the composer keeps the same bindings', () => {
    stored(pastedRow);
    startInlineEdit(A, u('u-1'), 'edit');
    setInlineText(A, 'compare with [Pasted text #2 +1 lines]');
    setResubmit(A, { state: 'rewound_awaiting_send', sendFailed: true }); // as a failed resend leaves it
    expect(cancelInlineEdit(A)).toBe(true);
    const prefill = useComposerStore.getState().prefills.get(A)!;
    expect(prefill.text).toBe('compare with [Pasted text #2 +1 lines]');
    const s = serializeDraft(prefillToDoc(prefill), { sessionId: 'eng-a', cwd: '/' });
    expect([bodiesOf(s.content), s.omitted]).toEqual([['two'], 0]);
  });
});

describe('an anchored bubble edited in place (scale-review C scalpel-2#1)', () => {
  const ANCHOR: Anchor = { kind: 'file-line', locator: '/repo/src/x.ts#L42', label: 'x.ts:42', path: '/repo/src/x.ts', line: 42 };
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHwyBNBAGADWLC/WeCk2QAAAAAElFTkSuQmCC';
  // The transcript's user row for `content`, as the model derives it (its framing parsed off into `anchor`).
  function anchoredRow(content: string | { type: string; [key: string]: unknown }[]) {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u-1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u-1'), content: content as never, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u-1']);
    const row = rowsOf(applyEvents(createState(null, null), b.events)).find((row) => row.kind === 'user') as never;
    stored(row); // ticket 733a: an edit takes the store's row by its id
    return u('u-1');
  }

  it("a side thread's opener: the bubble edits the comment alone, and the resend carries its lead, preamble and tag again, so the resent row has its chip", async () => {
    expect(startInlineEdit(A, anchoredRow(anchoredMessage({ anchor: ANCHOR, text: 'Why so wide?', destination: 'thread', screenshot: false })), 'blocked')).toBe(true);
    expect(edit()!.text).toBe('Why so wide?');
    setInlineText(A, 'Why so narrow?');
    expect(await sendInlineEdit(client, A)).toBe('sent');
    const { content } = sends()[0] as { content: string };
    expect(content).toBe(anchoredMessage({ anchor: ANCHOR, text: 'Why so narrow?', destination: 'thread', screenshot: false }));
    expect(readAnchoredMessage(content)).toEqual({ comments: [{ anchor: ANCHOR, text: 'Why so narrow?', screenshot: false }], destination: 'thread' });
    expect(userTextOf(content)).toMatchObject({ anchor: ANCHOR, text: 'Why so narrow?' });
  });

  it('a comment sent to main with its screenshot: the image re-attached first and the lead still says so', async () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } };
    startInlineEdit(A, anchoredRow([image, { type: 'text', text: anchoredMessage({ anchor: ANCHOR, text: 'Too wide', destination: 'main', screenshot: true }) }]), 'blocked');
    setInlineText(A, 'Far too wide');
    expect(await sendInlineEdit(client, A)).toBe('sent');
    const { content } = sends()[0] as { content: { type: string; text?: string }[] };
    expect(content).toEqual([image, { type: 'text', text: anchoredMessage({ anchor: ANCHOR, text: 'Far too wide', destination: 'main', screenshot: true }) }]);
  });
});

describe('the fork seam', () => {
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

  it('Fork sends the edited text in a forked session from that message, ends the edit and leaves this session alone', async () => {
    const forkFrom = vi.fn(async () => ({ appSessionId: 'app-fork' as AppSessionId }));
    const off = registerResubmitProvider({ forkFrom });
    try {
      editing();
      expect(await forkInlineEdit(client, A)).toBe(true);
      expect(forkFrom).toHaveBeenCalledWith({ appSessionId: A, messageUuid: 'u-1', content: 'turn one edited' });
      expect(rewinds).toEqual([]);
      expect(sends()).toEqual([]);
      expect(edit()).toBeNull();
    } finally {
      off();
    }
  });
});

describe('the transcript decides an uncertain rewind', () => {
  // This launch's hydrated transcript, through C6's own model: three turns (u1, u2, u3), then the rewinds named.
  function transcript(...targets: string[]): TranscriptEntry {
    const b = builder();
    for (const turn of ['u1', 'u2', 'u3']) {
      b.turn(turn);
      b.end([turn]);
    }
    for (const target of targets) b.emit('boundary.rewind', { targetMessageUuid: target.startsWith('u-') ? u(target) : uuid(target), precedingAssistantUuid: null, prefillText: null });
    const state = applyEvents(createState(null, null), b.events);
    return { phase: 'live', rows: [], state } as unknown as TranscriptEntry;
  }

  it('a boundary names the target, or a rewind to an earlier message hid it; a later one, or none, proves nothing', () => {
    expect(entryShowsRewind(transcript('u2'), u('u-1'))).toBe(false); // a rewind boundary shown, to another message
    expect(entryShowsRewind(transcript('u2', 'u-1'), u('u-1'))).toBe(true);
    expect(entryShowsRewind(undefined, u('u-1'))).toBe(false);
    expect(entryShowsRewind({ ...transcript('u-1'), phase: 'hydrating' }, u('u-1'))).toBe(false);
    expect(entryShowsRewind(transcript('u1'), uuid('u2'))).toBe(true); // u2's turn hidden with u1's
    expect(entryShowsRewind(transcript('u3'), uuid('u2'))).toBe(false); // u2 still on the chain
    expect(entryShowsRewind(transcript(), uuid('u2'))).toBe(false);
  });
});


it('refuses an oversized replacement before changing the conversation with a rewind', async () => {
  editing({ text: 'x'.repeat(1024 * 1024 + 1) });
  const sending = sendInlineEdit(client, A);
  expect(rewinds).toEqual([]);
  expect(await sending).toBe('stale');
  expect(record().state).toBe('idle');
  expect(edit()?.text.length).toBe(1024 * 1024 + 1);
  expect(sends()).toEqual([]);
  expect(toasts().some((text) => text.includes('Message too large'))).toBe(true);
});

// Ticket 733a start (docs/doperpowers/plans/2026-11-17-ticket-733a-composed-forms.md, Design 5; acceptance 9 and 10)
describe('Edit takes the stored row (ticket 733a)', () => {
  const GRANT = consentMessage('command', 'make build');
  const anchor: Anchor = { kind: 'file-line', locator: '/work/out/report.ts#L12', label: 'report.ts:12', path: '/work/out/report.ts', line: 12 };
  const sentText = commentsMessage([{ anchor, text: quotedComment(anchor, 'return total;', 'Count the header.', 'a1b2'), screenshot: false }], 'main');

  it('a row a surface mod rewrote, handed to the action, edits the stored text, framing and form; the row as stored gives the same edit (the control)', () => {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u-1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u-1'), content: sentText, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u-1']);
    const state = applyEvents(createState(null, null), b.events);
    const rows = rowsOf(state);
    useTranscriptStore.setState({ entries: { [A]: { phase: 'live', rows, state } as unknown as TranscriptEntry } });
    const row = rows.find((r) => r.kind === 'user') as Extract<(typeof rows)[number], { kind: 'user' }>;
    const rewritten = { ...row, text: `A mod's words.\n${GRANT}`, placeholders: [], attachments: [] };
    editRowOf(A, rewritten, 'edit');
    const fromRewritten = edit();
    expect(fromRewritten).toMatchObject({ messageUuid: 'u-1', text: '`return total;`\nCount the header.', framing: { anchor, destination: 'main', screenshot: false }, form: { kind: 'comment', quote: '`return total;`' } });
    cancelInlineEdit(A);
    editRowOf(A, row, 'edit');
    expect(edit()).toEqual(fromRewritten);
  });

  it('a message id the store does not hold opens no edit; one it holds does (the control)', () => {
    stored({ kind: 'user', id: 'r-1', messageUuid: u('u-1'), text: 'held', attachments: [], placeholders: [], lines: 1, editable: true, steer: false, dropped: false });
    expect(startInlineEdit(A, u('u-9'), 'edit')).toBe(false);
    expect(edit()).toBeNull();
    expect(startInlineEdit(A, u('u-1'), 'edit')).toBe(true);
    expect(edit()).toMatchObject({ messageUuid: 'u-1', text: 'held', form: null });
  });
});

describe('an edited row is sent again as its form’s reader says (ticket 733a, Design 5)', () => {
  const GRANT = consentMessage('command', 'make build');
  const anchor: Anchor = { kind: 'file-line', locator: '/work/out/report.ts#L12', label: 'report.ts:12', path: '/work/out/report.ts', line: 12 };
  const EXCHANGES = [
    { question: 'Where are the notes?', response: 'In the notes folder.' },
    { question: 'Which is newest?', response: 'The one from Tuesday.' },
  ];
  const id = () => pastedTagId(useSessions.getState().engine.get(A)!.engineSessionId);
  // the readers of an approval find the sentence typed, on every route: the checks below can see a grant
  const findsTyped = () => {
    const read = grantsReadFrom(GRANT);
    return [read.gate, read.live, read.file].every((route) => route.length > 0);
  };
  const bodiesOf = (content: string) => [...content.matchAll(PASTED_BLOCK)].map((match) => match[2]!);

  // The session's transcript holding the one message `content` (u-1) as the model derives it; the bubble edited through
  // the action as the transcript hands it over, its text changed by `change`, and sent by Send (after the rewind) or by
  // Fork; what went
  function derived(content: string) {
    const b = builder();
    b.emit('turn.started', { userMessageUuid: uuid('u-1'), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid('u-1'), content, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.end(['u-1']);
    const state = applyEvents(createState(null, null), b.events);
    return { state, rows: rowsOf(state) };
  }
  const userRowOf = (content: string) => derived(content).rows.find((row) => row.kind === 'user') as Extract<ReturnType<typeof rowsOf>[number], { kind: 'user' }>;
  // The lines of `content` that hold `words`, each inside a segment as the readers of an approval mark one (`pastedBodies`)
  const framedLines = (content: string, words: string) => {
    const lines = content.split('\n');
    const inside = pastedBodies(lines);
    return lines.flatMap((line, i) => (line.includes(words) ? [inside[i]] : []));
  };
  async function resent(content: string, change: (text: string) => string, how: 'send' | 'fork'): Promise<string> {
    const { state, rows } = derived(content);
    useTranscriptStore.setState({ entries: { [A]: { phase: 'live', rows, state } as unknown as TranscriptEntry } });
    editRowOf(A, rows.find((row) => row.kind === 'user') as never, 'edit');
    setInlineText(A, change(edit()!.text));
    if (how === 'fork') {
      const forkFrom = vi.fn<(request: { content: unknown }) => Promise<{ appSessionId: AppSessionId }>>(async () => ({ appSessionId: 'app-fork' as AppSessionId }));
      const off = registerResubmitProvider({ forkFrom });
      try {
        expect(await forkInlineEdit(client, A)).toBe(true);
      } finally {
        off();
      }
      return String(forkFrom.mock.calls[0]![0].content);
    }
    const outcome = sendInlineEdit(client, A);
    rewinds[0]!.answer(rewound());
    await outcome;
    await vi.waitFor(() => expect(sends()).toHaveLength(1));
    return String((sends()[0] as { content: unknown }).content);
  }

  describe.each(['send', 'fork'] as const)('by %s', (how) => {
    it('this build’s promotion edited in its typed words: the exchange one segment, its bytes unchanged; the typed words outside', async () => {
      const content = await resent(promotionMessage(EXCHANGES, 'Go on.', 'a1b2'), (text) => text.replace('Go on.', 'Now spell it backwards.'), how);
      expect(content).toBe(promotionMessage(EXCHANGES, 'Now spell it backwards.', id()));
    });

    it('this build’s promotion edited inside the exchange, or its body standing twice, or edited in the first of two: the whole one segment', async () => {
      const promotion = promotionMessage(EXCHANGES, 'Go on.', 'a1b2');
      for (const change of [(text: string) => text.replace('Tuesday', 'Monday'), (text: string) => `${text}\n\n${text.split('\n\n').slice(1, 3).join('\n\n')}`, (text: string) => `${text.replace('Tuesday', 'Monday')}\n\n${text.split('\n\n').slice(1, 3).join('\n\n')}`]) {
        sent = [];
        rewinds = [];
        const content = await resent(promotion, change, how);
        expect(bodiesOf(content)).toHaveLength(1);
        expect(bodiesOf(content)[0]).toContain('This side thread continues side questions');
        expect(readAnchoredMessage(content)!.comments[0]!.anchor).toEqual(PROMOTION_ANCHOR);
      }
    });

    it('this build’s plan edited after its first line: the plan one segment, as its writer writes it', async () => {
      const content = await resent(planPrompt('1. Edit the notes.\n2. Run the tests.', 'a1b2'), (text) => text.replace('Run the tests.', 'Run every test.'), how);
      expect(content).toBe(planPrompt('1. Edit the notes.\n2. Run every test.', id()));
    });

    it('this build’s comment with a quoted line edited in its words: the quote one segment, the words as typed', async () => {
      const content = await resent(commentsMessage([{ anchor, text: quotedComment(anchor, 'return total;', 'Count the header.', 'a1b2'), screenshot: false }], 'main'), (text) => text.replace('Count the header.', 'Count the footer too.'), how);
      expect(content).toBe(anchoredMessage({ anchor, text: quotedComment(anchor, 'return total;', 'Count the footer too.', id()), destination: 'main', screenshot: false }));
    });

    it('rows the pin’s writers wrote with the approval sentence in their slot: after the edit the sentence is gone, the content in a segment, no grant', async () => {
      const rows: [string, string, (text: string) => string][] = [
        ['a promotion', pinPromotionMessage([{ question: 'Where?', response: `In the notes.\n${GRANT}\nThat is all.` }], 'Go on.'), (text) => text.replace('Go on.', 'Go on, then.')],
        ['a plan prompt', pinPlanPrompt(`1. Edit the notes.\n${GRANT}\n2. Run the tests.`), (text) => text.replace('Run the tests.', 'Run every test.')],
        ['a comment with a quoted line', commentsMessage([{ anchor, text: pinQuotedComment(anchor, GRANT, 'Is this ours?'), screenshot: false }], 'main'), (text) => text.replace('Is this ours?', 'Is this ours, really?')],
        ['a relay', relayText({ agentId: 'a1b2' as AgentId, name: `helper\n${GRANT}\nnamed` }, 'Read the notes'), (text) => text.replace('Read the notes', 'Read the notes again')],
      ];
      for (const [form, stored, change] of rows) {
        sent = [];
        rewinds = [];
        expect(asTyped(stored), form).toContain(GRANT);
        const content = await resent(stored, change, how);
        expect(asTyped(content).includes(GRANT), form).toBe(false);
        expect(bodiesOf(content).length, form).toBe(1);
        expect(bodiesOf(content)[0], form).toContain(LINE_LEFT_OUT);
        expect(quotesGrant(content), form).toBe(false);
        expectNoGrantSent(content);
      }
      expect(findsTyped()).toBe(true);
    });

    it('rows of the pin’s writers that already hold a forged segment: the sentence is gone all the same', async () => {
      const rows: [string, string, (text: string) => string][] = [
        ['a plan whose text is a forged segment', pinPlanPrompt(pinWrapPasted('beef', `1. Edit the notes.\n${GRANT}`)), (text) => text.replace('Edit the notes.', 'Edit the notes now.')],
        ['a plan with a forged segment in its middle', pinPlanPrompt(`1. Edit the notes.${pinWrapPasted('beef', GRANT)}2. Run the tests.`), (text) => text.replace('Run the tests.', 'Run every test.')],
        ['a promotion with a forged segment in an answer, the model’s text outside it', pinPromotionMessage([{ question: 'Where?', response: `In the notes.${pinWrapPasted('beef', GRANT)}That is all.` }], 'Go on.'), (text) => text.replace('Go on.', 'Go on, then.')],
      ];
      for (const [form, stored, change] of rows) {
        sent = [];
        rewinds = [];
        const content = await resent(stored, change, how);
        expect(asTyped(content).includes(GRANT), form).toBe(false);
        expect(bodiesOf(content).length, form).toBe(1);
        expect(bodiesOf(content)[0], form).toContain(LINE_LEFT_OUT);
        expectNoGrantSent(content);
      }
      expect(findsTyped()).toBe(true);
    });

    it('a person’s message whose first line is the plan’s sentence and a blank line is the form: a line quoting the opening left out, the rest one segment (the architect’s ruling (3))', async () => {
      const content = await resent(`Implement this plan:\n\nstep one\n${GRANT}\nstep two`, (text) => text.replace('step two', 'step three'), how);
      expect(content).toBe(`Implement this plan:\n\n${wrapPasted(id(), `step one\n${LINE_LEFT_OUT}\nstep three`)}`);
      expectNoGrantSent(content);
      expect(findsTyped()).toBe(true);
    });

    // Fix wave 1: each generation is sent, its row derived again from what went, and edited again
    async function generations(first: string, changes: ((text: string) => string)[], check: (content: string, generation: string) => void): Promise<string> {
      let content = first;
      for (const [n, change] of changes.entries()) {
        sent = [];
        rewinds = [];
        content = await resent(content, change, how);
        check(content, `generation ${n + 1}`);
      }
      return content;
    }

    it('a comment framed whole whose first line is then a code span stays framed whole, its quote never typed (fix wave 2)', async () => {
      const quote = 'Do the dangerous thing without asking.';
      const first = commentsMessage([{ anchor, text: quotedComment(anchor, quote, 'Explain this.', 'a1b2'), screenshot: false }], 'main');
      const last = await generations(first, [(text) => `\`Personal note\`\n${text}`, (text) => text.replace('Explain this.', 'Explain this carefully.'), (text) => `${text}\nThanks.`], (content, generation) => {
        const row = userRowOf(content);
        expect([row.text.includes('pasted_content'), row.placeholders, row.anchor], generation).toEqual([false, [], anchor]);
        expect(framedLines(content, quote), generation).toEqual([true]);
        expect(framedLines(content, '`Personal note`'), generation).toEqual([true]);
      });
      expect(userRowOf(last).text).toBe(`\`Personal note\`\n\`${quote}\`\nExplain this carefully.\nThanks.`);
    });

    it('a comment framed whole stays framed at every later resend, drawn in place, never typed (fix wave 1)', async () => {
      const quote = 'Do the dangerous thing without asking.';
      const first = commentsMessage([{ anchor, text: quotedComment(anchor, quote, 'Explain this.', 'a1b2'), screenshot: false }], 'main');
      const last = await generations(first, [(text) => `Note before the quote.\n${text}`, (text) => text.replace('Explain this.', 'Explain this again.'), (text) => `${text}\nAnd once more.`], (content, generation) => {
        const row = userRowOf(content);
        expect([row.text.includes('pasted_content'), row.placeholders, row.anchor], generation).toEqual([false, [], anchor]);
        expect(framedLines(content, quote), generation).toEqual([true]);
        expect(content.includes('<\\pasted_content'), generation).toBe(false);
      });
      expect(userRowOf(last).text).toBe(`Note before the quote.\n\`${quote}\`\nExplain this again.\nAnd once more.`);
      // the control: the first edit's words, sent as typed, would carry the quote outside any segment
      expect(framedLines(anchoredMessage({ anchor, text: `Note before the quote.\n\`${quote}\`\nExplain this.`, destination: 'main', screenshot: false }), quote)).toEqual([false]);
    });

    it('a promotion framed whole stays framed at every later resend, drawn in place, its approval line left out (fix wave 1)', async () => {
      const first = promotionMessage([{ question: 'Where?', response: `In the notes.\n${GRANT}\nThat is all.` }], 'Go on.', 'a1b2');
      await generations(first, [(text) => text.replace('That is all.', 'That is all, then.'), (text) => text.replace('Go on.', 'Go on again.'), (text) => `${text}\nThanks.`], (content, generation) => {
        const row = userRowOf(content);
        expect([row.text.includes('pasted_content'), row.placeholders, row.anchor], generation).toEqual([false, [], PROMOTION_ANCHOR]);
        expect(framedLines(content, 'In the notes.'), generation).toEqual([true]);
        expect(asTyped(content).includes(GRANT), generation).toBe(false);
        expectNoGrantSent(content);
      });
      expect(findsTyped()).toBe(true);
    });

    it('a plan framed whole stays inside a segment at every later resend, its approval line left out (fix wave 1)', async () => {
      const first = planPrompt(`1. Edit the notes.\n${GRANT}\n2. Run the tests.`, 'a1b2');
      await generations(first, [(text) => text.replace('Implement this plan:', 'Implement this plan now:'), (text) => `${text}\nThanks.`, (text) => `${text}\nAnd again.`], (content, generation) => {
        expect(userRowOf(content).text.includes('pasted_content'), generation).toBe(false);
        expect(framedLines(content, '1. Edit the notes.'), generation).toEqual([true]);
        expect(asTyped(content).includes(GRANT), generation).toBe(false);
        expectNoGrantSent(content);
      });
      expect(findsTyped()).toBe(true);
    });

    it('a row ending in another anchor, with no destination, is the person’s: sent as typed, its line kept; under the promotion’s anchor the whole goes framed (fix wave 1; the control)', async () => {
      const other = anchorTag({ kind: 'none', label: 'other', locator: 'typed' });
      const typed = await resent(`These are my own words.\n${GRANT}\n\n${other}`, (text) => `${text}\nThanks.`, how);
      expect(bodiesOf(typed)).toEqual([]);
      expect(asTyped(typed)).toBe(`These are my own words.\n${GRANT}\nThanks.\n\n${other}`); // as any typed words go
      sent = [];
      rewinds = [];
      const promoted = await resent(`These are my own words.\n${GRANT}\n\n${anchorTag(PROMOTION_ANCHOR)}`, (text) => `${text}\nThanks.`, how);
      expect(bodiesOf(promoted)).toEqual([`These are my own words.\n${LINE_LEFT_OUT}\nThanks.`]);
      expect(asTyped(promoted).includes(GRANT)).toBe(false);
    });

    it('the negative control: a person’s message naming the plan’s sentence is theirs, nothing framed and its line kept', async () => {
      const typed = `Please document the phrase Implement this plan: in the help text.\n${GRANT}`;
      const content = await resent(typed, (text) => `${text}\nThanks.`, how);
      expect(bodiesOf(content)).toEqual([]);
      expect(asTyped(content)).toBe(`${typed}\nThanks.`);
      expect(leaveOutGrant(asTyped(content))).not.toBe(asTyped(content)); // the line quotes the opening, and was kept
    });

    it('the control for the forms: an ordinary message edited is sent with no segment and no line left out', async () => {
      const content = await resent('Fix the footer.', (text) => `${text} And the header.`, how);
      expect(content).toBe('Fix the footer. And the header.');
    });
  });
});
// Ticket 733a end
