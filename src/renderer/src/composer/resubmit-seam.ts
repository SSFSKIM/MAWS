// Edit-and-resubmit (C7 execution document, "Edit-and-resubmit and the fork seam"; M4b; W3 B6, charter line 134 and
// §5.3 as amended 2026-10-01). A bubble's Edit (C6's `editAndResubmit`) turns the bubble itself into an editor, Codex's
// pattern: nothing is pulled into the composer. Its Send rewinds this session to that message and resends the edited
// text (the terminal's Esc Esc semantics); its Fork opens a forked session from that message through the provider C10
// registers; its Cancel puts the bubble back. A prompt a hook blocked (W1's `editPrompt`) never reached the model, so its
// in-place Send sends the text as a new message. The rewind is driven by the state machine below over the composer
// store's per-session `Resubmit` record, the text by the session's `InlineEdit`.
//
//   idle ─Send→ (confirming, only when a newer turn began after the edit did ─confirm→) rewinding
//     rewinding ─rewound: true→ the edited text is sent at once ─accepted→ idle (the edit ends)
//                                                              ╰failed→ rewound_awaiting_send (Retry sends again)
//              ├ rewound: false → idle, the engine's reason as a toast (the edit stays)
//              ├ target_not_found → the edit ends, its text goes into the composer
//              ├ the process left → idle, the exit note (the edit and its text kept)
//              ╰ an IpcError while ready → rewind_uncertain
//   rewind_uncertain: nothing is issued; C3's `boundary.rewind` for the target → rewound_awaiting_send (Send is the
//   human's); a process exit → idle; the window with no boundary → rewind_unresolved: Rewind again (one more rewind),
//   Send without rewinding, or Keep editing; a boundary still confirms it.
//
// The gate: `session.rewind` is issued once per human decision (a Send, a confirm, or Rewind again) and never repeated
// here; a rewind whose outcome the host could not report is reconciled against the transcript's `boundary.rewind`
// before any retry is offered; a send that fails after a rewind retries the send alone; one send or fork is with the
// host at a time, and until it answers nothing else is taken (the record's `sending`). Timers and subscriptions live
// here, per session, not in a component, so the flow outlives a tab switch and the bubble leaving the list (a rewind
// hides the turn it edits); the session's event batches are subscribed only while the rewind is uncertain or unresolved.
// An edit does not survive a reload (as Codex's does not): nothing in flight resumes on its own.
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { inlineEditOf, prefillComposer, resubmitRecordOf, setInlineEdit, setResubmit, useComposerStore, type InlineEdit, type Resubmit, type ResubmitState } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import type { TranscriptEntry } from '../stores/transcript';
import { useTranscriptStore } from '../transcript';
import { focusedSession } from './ComposerAppKeys';
import { newestUserUuid, rowPrefill, type UserRow } from './edit-prefill';
import { bodiesByPlaceholder, prefillToDoc } from './editor/recall';
import { serializeDraft } from './editor/serialize';
import { submitSerialized, type Dispatch } from './editor/submit';
import type { ContentBlock } from '@shared/graph/events';

// ---- the fork seam (C10 registers; null until then) ------------------------------------------------------------------

export interface ResubmitProvider {
  forkFrom(req: { appSessionId: AppSessionId; messageUuid: MessageUuid; content: string | ContentBlock[] }): Promise<{ appSessionId: AppSessionId }>;
}

let provider: ResubmitProvider | null = null;

export function registerResubmitProvider(p: ResubmitProvider): () => void {
  provider = p;
  return () => {
    if (provider === p) provider = null;
  };
}

export const resubmitProvider = (): ResubmitProvider | null => provider;

// ---- C6's two actions (registered from App.tsx's C7 block) ------------------------------------------------------------

const record = (appSessionId: AppSessionId): Resubmit => resubmitRecordOf(useComposerStore.getState(), appSessionId);
// A rewind in flight or unconfirmed, or the edit's send or fork with the host.
const inFlight = (appSessionId: AppSessionId) => {
  const { state, sending } = record(appSessionId);
  return sending || state === 'rewinding' || state === 'rewind_uncertain';
};
// The record at `state` with nothing with the host.
const at = (appSessionId: AppSessionId, state: ResubmitState) => record(appSessionId).state === state && !record(appSessionId).sending;

// The bubble `row` of the session's transcript, in place: `edit` rewinds and resends, `blocked` sends anew. Refused
// while the session's rewind is in flight or unconfirmed, or its edit is being sent (what goes is the edit in hand).
export function startInlineEdit(appSessionId: AppSessionId, row: UserRow & { messageUuid: MessageUuid }, kind: InlineEdit['kind']): boolean {
  if (inFlight(appSessionId)) {
    toast({ level: 'info', text: record(appSessionId).sending ? 'Your edited message is being sent' : 'A rewind is in progress', actions: [], dismissible: true });
    return false;
  }
  const rows = useTranscriptStore.getState().rows(appSessionId);
  const prefill = rowPrefill(row);
  dispose(appSessionId);
  setInlineEdit(appSessionId, { messageUuid: row.messageUuid, seenCursor: kind === 'edit' ? newestUserUuid(rows) : null, kind, text: prefill.text, bodies: bodiesByPlaceholder(prefill), images: prefill.images ?? [] });
  setResubmit(appSessionId, 'idle');
  return true;
}

// The action receives only the row, so the session is the focused pane's active tab (a click on the bubble's Edit has
// just moved focus into that pane), and the adapter acts only when that session's transcript holds the row's message.
function sessionHolding(row: UserRow): AppSessionId | null {
  const appSessionId = focusedSession();
  if (appSessionId === null || row.messageUuid === null) return null;
  return useTranscriptStore.getState().rows(appSessionId).some((r) => r.kind === 'user' && r.messageUuid === row.messageUuid) ? appSessionId : null;
}

export function editAndResubmitRow(row: UserRow): void {
  const appSessionId = sessionHolding(row);
  if (appSessionId !== null) startInlineEdit(appSessionId, { ...row, messageUuid: row.messageUuid! }, 'edit');
}

// C6's editPrompt (W1): a prompt a hook blocked, edited in the same place, sent as a new message.
export function editPromptRow(row: UserRow): void {
  const appSessionId = sessionHolding(row);
  if (appSessionId !== null) startInlineEdit(appSessionId, { ...row, messageUuid: row.messageUuid! }, 'blocked');
}

// ---- the explicit-rewind state machine ---------------------------------------------------------------------------------

// C3's late window: a `rewind_conversation` response that arrives within it still yields `boundary.rewind`.
export const REWIND_WINDOW_MS = 60_000;
let windowMs = REWIND_WINDOW_MS;
// The harness shortens the window so an end-to-end run need not wait a minute; null restores it.
export function setRewindWindow(ms: number | null): void {
  windowMs = ms ?? REWIND_WINDOW_MS;
}

export type RewindOutcome = 'rewound' | 'refused' | 'uncertain' | 'stale';

interface Flight {
  generation: number; // a disposed flight's late answers are ignored
  offs: (() => void)[];
}
const flights = new Map<AppSessionId, Flight>();

export const REWOUND_COPY = 'The conversation was already rewound past that message; your edited text is in the composer';

// Ends whatever the session's flow was waiting on (its timer, its subscriptions, an answer still in flight).
function dispose(appSessionId: AppSessionId): Flight {
  const flight = flights.get(appSessionId) ?? { generation: 0, offs: [] };
  flight.offs.splice(0).forEach((off) => off());
  flight.generation += 1;
  flights.set(appSessionId, flight);
  return flight;
}

// A hydrated transcript shows the edited message `target` rewound: a `boundary.rewind` names it (a rewind boundary is
// always a loose event of the transcript state; C6's row names no target), or a rewind to an earlier message hid the
// turn holding it (a hidden turn stays in `turns` but leaves `order`; a folded one leaves both). A rewind to any later
// message, or one this launch's transcript cannot place, proves nothing: a resumed launch's transcript begins after
// earlier launches' messages. Pure.
export function entryShowsRewind(entry: TranscriptEntry | undefined, target: MessageUuid): boolean {
  if (entry?.phase !== 'live') return false;
  const { loose, index, turns, order } = entry.state;
  const rewinds = loose.filter((event) => event.kind === 'boundary.rewind');
  if (rewinds.some((event) => event.targetMessageUuid === target)) return true;
  const turn = index.messages.get(target);
  return rewinds.length > 0 && turn !== undefined && turns.has(turn) && !order.includes(turn);
}

export const transcriptShowsRewind = (appSessionId: AppSessionId, target: MessageUuid): boolean => entryShowsRewind(useTranscriptStore.getState().entries[appSessionId], target);

const ready = (appSessionId: AppSessionId): boolean => useSessions.getState().engine.get(appSessionId)?.process === 'ready';
const editOf = (appSessionId: AppSessionId): InlineEdit | null => inlineEditOf(useComposerStore.getState(), appSessionId);

function exited(appSessionId: AppSessionId): void {
  dispose(appSessionId);
  setResubmit(appSessionId, { state: 'idle', exited: true });
}

// The edit ends: the bubble is a bubble again (or, rewound, gone with its turn), and the record is idle.
function end(appSessionId: AppSessionId): void {
  dispose(appSessionId);
  setInlineEdit(appSessionId, null);
  setResubmit(appSessionId, 'idle');
}

// The edit's text as the composer takes it: each pasted placeholder with the body it named when the edit began.
const editPrefill = (edit: InlineEdit) => ({ text: edit.text, bodies: edit.bodies, images: edit.images });

// Cancel, Keep editing's way out, or the dock line's ×. Refused while the rewind is in flight or unconfirmed, or the
// edit is being sent. After a rewind (the bubble is gone) the edited text goes into the composer rather than nowhere.
export function cancelInlineEdit(appSessionId: AppSessionId): boolean {
  if (inFlight(appSessionId)) return false;
  const edit = editOf(appSessionId);
  const rewound = record(appSessionId).state === 'rewound_awaiting_send';
  end(appSessionId);
  if (rewound && edit) prefillComposer(appSessionId, editPrefill(edit));
  return true;
}

// What the edit sends: its text through the composer's serialiser as a prompt as written (a leading `!` or `#` is
// text, never the composer's bash or memory mode), the pasted bodies framed as the terminal frames them and the images
// re-attached, so a resend is the message as typed.
function serialized(appSessionId: AppSessionId, edit: InlineEdit) {
  const status = useSessions.getState().engine.get(appSessionId) ?? null;
  const sessionId = status?.engineSessionId ?? useSessions.getState().records.get(appSessionId)?.engineSessionId ?? null;
  return serializeDraft(prefillToDoc(editPrefill(edit)), { sessionId, cwd: status?.cwd ?? '', literal: true });
}

// The edit's one send or fork (the old composer controller's guard): `sending` holds Send, Fork, Cancel and another edit
// until the host answers. It takes the session's flight over, ending whatever the flow was waiting on (Send without
// rewinding stops watching the transcript), and its answer acts only while that flight is current, so it never ends
// or alters an edit other than the one it was sent for: accepted, the edit ends; refused, the record is `failed`.
async function submitOnce(appSessionId: AppSessionId, go: () => Promise<boolean>, failed: Partial<Resubmit> & { state: ResubmitState }): Promise<boolean> {
  const generation = dispose(appSessionId).generation;
  setResubmit(appSessionId, { ...record(appSessionId), sending: true });
  const accepted = await go();
  if (flights.get(appSessionId)?.generation !== generation) return accepted;
  if (accepted) end(appSessionId);
  else setResubmit(appSessionId, failed);
  return accepted;
}

// The edited text sent with `session.send` (after the rewind, without one by the human's choice, or a blocked prompt
// sent anew); a send that fails after the rewind says so and waits for Retry.
function sendEdited(client: MawsBridge, appSessionId: AppSessionId): Promise<boolean> {
  const edit = editOf(appSessionId);
  if (!edit) return Promise.resolve(false);
  const s = serialized(appSessionId, edit);
  const before = record(appSessionId);
  const dispatch: Dispatch = async () => {
    const result = await client.invoke('session.send', { appSessionId, content: s.content });
    return result.ok ? null : result.error.message;
  };
  const failed = before.state === 'rewound_awaiting_send' ? { state: before.state, sendFailed: true } : before;
  return submitOnce(appSessionId, () => submitSerialized(client, appSessionId, s, 'send', null, { dispatch }), failed);
}

// Whether a turn began after the edit did: the rewind would discard it too, so the human confirms first.
export function newerTurnSince(appSessionId: AppSessionId): MessageUuid | null {
  const edit = editOf(appSessionId);
  if (!edit || edit.kind !== 'edit') return null;
  const newest = newestUserUuid(useTranscriptStore.getState().rows(appSessionId));
  return newest !== null && newest !== edit.seenCursor ? newest : null;
}

// The editor's Send: a blocked prompt goes as a new message; an edit rewinds first (confirming a newer turn), resends
// once rewound, retries the send after a failed one, and from unresolved sends without rewinding by the human's choice.
export function sendInlineEdit(client: MawsBridge, appSessionId: AppSessionId, how: 'send' | 'without_rewinding' = 'send'): Promise<RewindOutcome | 'sent' | 'stale'> {
  const edit = editOf(appSessionId);
  if (!edit || !ready(appSessionId) || record(appSessionId).sending) return Promise.resolve('stale');
  const { state } = record(appSessionId);
  if (edit.kind === 'blocked' || state === 'rewound_awaiting_send' || (state === 'rewind_unresolved' && how === 'without_rewinding'))
    return sendEdited(client, appSessionId).then((accepted) => (accepted ? 'sent' : 'stale'));
  if (state !== 'idle') return Promise.resolve('stale');
  if (newerTurnSince(appSessionId) !== null) {
    setResubmit(appSessionId, 'confirming');
    return Promise.resolve('stale');
  }
  return issueRewind(client, appSessionId);
}

export function cancelRewind(appSessionId: AppSessionId): void {
  if (at(appSessionId, 'confirming')) setResubmit(appSessionId, 'idle');
}

// The human's confirm of a rewind past a newer turn: the cursor advances to the newest message they saw.
export function confirmRewind(client: MawsBridge, appSessionId: AppSessionId): Promise<RewindOutcome> {
  const edit = editOf(appSessionId);
  if (!at(appSessionId, 'confirming') || !edit) return Promise.resolve('stale');
  const newest = newerTurnSince(appSessionId);
  if (newest !== null) setInlineEdit(appSessionId, { ...edit, seenCursor: newest });
  return issueRewind(client, appSessionId);
}

// Rewind again, from unresolved: the engine answers `rewound: true` when the first attempt never applied and refuses
// otherwise, so the transcript, not an inference, says what happened.
export function rewindAgain(client: MawsBridge, appSessionId: AppSessionId): Promise<RewindOutcome> {
  if (!at(appSessionId, 'rewind_unresolved')) return Promise.resolve('stale');
  return issueRewind(client, appSessionId);
}

export function keepEditing(appSessionId: AppSessionId): void {
  if (!at(appSessionId, 'rewind_unresolved')) return;
  dispose(appSessionId);
  setResubmit(appSessionId, 'idle');
}

// The Fork: a forked session from that message, sent the edited text, in a tab of its own; this session is untouched.
// Refused while a rewind or the edit's send is in flight.
export async function forkInlineEdit(client: MawsBridge, appSessionId: AppSessionId): Promise<boolean> {
  const edit = editOf(appSessionId);
  const fork = provider;
  if (!edit || !fork || edit.kind !== 'edit' || inFlight(appSessionId)) return false;
  const s = serialized(appSessionId, edit);
  let opened: AppSessionId | null = null;
  const dispatch: Dispatch = async () => {
    try {
      opened = (await fork.forkFrom({ appSessionId, messageUuid: edit.messageUuid, content: s.content })).appSessionId;
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const accepted = await submitOnce(appSessionId, () => submitSerialized(client, appSessionId, s, 'send', null, { dispatch }), record(appSessionId));
  if (accepted && opened) useLayout.getState().openSession(opened);
  return accepted;
}

async function issueRewind(client: MawsBridge, appSessionId: AppSessionId): Promise<RewindOutcome> {
  const edit = editOf(appSessionId)!;
  const flight = dispose(appSessionId);
  const generation = flight.generation;
  const current = () => flights.get(appSessionId)?.generation === generation;
  const rewound = (autoSend: boolean) => {
    dispose(appSessionId);
    setResubmit(appSessionId, { state: 'rewound_awaiting_send', autoSend });
    if (autoSend) void sendEdited(client, appSessionId); // rewound by the human's own Send: the text goes as part of it
  };
  setResubmit(appSessionId, 'rewinding');
  // The process leaving while the call is in flight: nothing is sent, and a late answer cannot come from a process that is gone.
  flight.offs.push(
    useSessions.subscribe((s) => {
      if (current() && s.engine.get(appSessionId)?.process !== 'ready') exited(appSessionId);
    }),
  );
  const result = await client.invoke('session.rewind', {
    appSessionId,
    targetMessageUuid: edit.messageUuid,
    lastSeenMessageUuid: edit.seenCursor ?? edit.messageUuid, // the target itself when the transcript showed nothing newer
    files: false,
  });
  if (!current()) return 'stale';
  if (result.ok && result.value.rewound) {
    rewound(true);
    return 'rewound';
  }
  if (result.ok && result.value.reason === 'target_not_found') {
    // the target left the conversation (an earlier rewind applied): the edit cannot apply, and its text is not lost
    end(appSessionId);
    prefillComposer(appSessionId, editPrefill(edit));
    toast({ level: 'info', text: REWOUND_COPY, actions: [], dismissible: true });
    return 'refused';
  }
  if (result.ok) {
    dispose(appSessionId);
    setResubmit(appSessionId, 'idle');
    const reason = result.value.reason ?? result.value.error ?? 'no reason given';
    toast({ level: 'warning', text: `The rewind was refused · ${reason}`, actions: [], dismissible: true });
    return 'refused';
  }
  if (!ready(appSessionId)) {
    exited(appSessionId);
    return 'stale';
  }
  // Neither C3's `timeout` nor C1's nor an `internal` failure proves the rewind unapplied: the transcript decides, and
  // its boundary may already be there (a late answer can arrive before the rejection).
  if (transcriptShowsRewind(appSessionId, edit.messageUuid)) {
    rewound(false);
    return 'rewound';
  }
  setResubmit(appSessionId, 'rewind_uncertain');
  flight.offs.push(
    client.on('session.eventBatch', ({ appSessionId: id, events }) => {
      if (id !== appSessionId || !current()) return;
      for (const event of events) {
        if (event.kind === 'process.exited') return exited(appSessionId);
        if (event.kind === 'boundary.rewind' && event.targetMessageUuid === edit.messageUuid) return rewound(false);
      }
    }),
  );
  const timer = setTimeout(() => {
    if (current() && record(appSessionId).state === 'rewind_uncertain') setResubmit(appSessionId, 'rewind_unresolved');
  }, windowMs);
  flight.offs.push(() => clearTimeout(timer));
  return 'uncertain';
}
