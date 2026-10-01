// Edit-and-resubmit (C7 execution document, "Edit-and-resubmit and the fork seam"; M4b). A bubble's Edit (C6's
// `editAndResubmit`, adapted here) or the refusal dialog's Edit prompt prefills the composer in edit mode with the
// message it resubmits against and the seen cursor. Send then forks through the provider C10 registers, and until C10
// lands offers the explicit alternative: rewind this session to that message and resend, driven by the state machine
// below over the composer store's per-session `Resubmit` record.
//
//   idle ─Send→ confirming ─confirm→ rewinding ─rewound: true→ rewound_awaiting_send ─sent→ idle (edit mode left)
//                        ╰cancel→ idle   │  ├ rewound: false → idle, the engine's reason as a toast
//                                        │  ├ the process left → idle, the exit banner (edit mode and draft kept)
//                                        │  ╰ an IpcError while ready → rewind_uncertain
//   rewind_uncertain: nothing is issued; C3's `boundary.rewind` for the target → rewound_awaiting_send (Send is the
//   human's); a process exit → idle; the window with no boundary → rewind_unresolved: Rewind again (one more rewind),
//   Send without rewinding, or Keep editing; a boundary still confirms it.
//
// The gate: `session.rewind` is issued once per human decision (a confirm, or Rewind again) and never repeated here;
// a rewind whose outcome the host could not report is reconciled against the transcript's `boundary.rewind` before
// any retry is offered; a send that fails after a rewind retries the send alone. Timers and subscriptions live here,
// per session, not in a component, so the flow outlives a tab switch; the session's event batches are subscribed only
// while the rewind is uncertain or unresolved.
//
// Edit mode also survives a reload: the edit rides in the draft document (`doc.attrs.editing`) and is restored at
// `idle`. A restored edit whose rewind the hydrated transcript shows (a boundary naming its message, or a rewind to an earlier one) was rewound
// before the reload: edit mode ends and the text stays as the draft. A message merely absent keeps edit mode; Send then
// confirms, and the engine's `target_not_found` ends it the same way. Send after a reload always starts again at `confirming`, a fresh human
// decision, so no rewind repeats on its own. Any rewind the engine answers `target_not_found` (reload or not) finds its
// target gone, so edit mode ends the same way.
import type { ContentBlock } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { editingOf, prefillComposer, resubmitRecordOf, setEditing, setResubmit, useComposerStore, type Editing, type Resubmit } from '../stores/composer';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import type { TranscriptEntry } from '../stores/transcript';
import { useTranscriptStore } from '../transcript';
import { focusedSession } from './ComposerAppKeys';
import { newestUserUuid, rowPrefill, type UserRow } from './edit-prefill';

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

// ---- C6's editAndResubmit, adapted (registered from App.tsx's C7 block) ------------------------------------------------

// The action receives only the row, so the session is the focused pane's active tab (a click on the bubble's Edit has
// just moved focus into that pane), and the adapter acts only when that session's transcript holds the row's message.
export function editAndResubmitRow(row: UserRow): void {
  const appSessionId = focusedSession();
  if (appSessionId === null || row.messageUuid === null) return;
  const rows = useTranscriptStore.getState().rows(appSessionId);
  if (!rows.some((r) => r.kind === 'user' && r.messageUuid === row.messageUuid)) return;
  prefillComposer(appSessionId, rowPrefill({ ...row, messageUuid: row.messageUuid }, newestUserUuid(rows)));
}

// C6's editPrompt (W1): a prompt a hook blocked never reached the model, so there is nothing to fork or rewind; its text
// goes back into the composer as a new message, not in edit mode. The same session rule as the bubble's Edit.
export function editPromptRow(row: UserRow): void {
  const appSessionId = focusedSession();
  if (appSessionId === null || row.messageUuid === null) return;
  if (!useTranscriptStore.getState().rows(appSessionId).some((r) => r.kind === 'user' && r.messageUuid === row.messageUuid)) return;
  prefillComposer(appSessionId, { ...rowPrefill({ ...row, messageUuid: row.messageUuid }, null), editing: null });
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

export const REWOUND_COPY = 'The conversation was rewound; your edited text is in the editor';

function markRestored(appSessionId: AppSessionId, restored: boolean): void {
  if (useComposerStore.getState().restoredEdits.has(appSessionId) === restored) return;
  useComposerStore.setState((s) => {
    const restoredEdits = new Set(s.restoredEdits);
    if (restored) restoredEdits.add(appSessionId);
    else restoredEdits.delete(appSessionId);
    return { restoredEdits };
  });
}
const isRestored = (appSessionId: AppSessionId): boolean => useComposerStore.getState().restoredEdits.has(appSessionId);

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
// earlier launches' messages. Pure; a selector runs it, so a later boundary naming the target flips it.
export function entryShowsRewind(entry: TranscriptEntry | undefined, target: MessageUuid): boolean {
  if (entry?.phase !== 'live') return false;
  const { loose, index, turns, order } = entry.state;
  const rewinds = loose.filter((event) => event.kind === 'boundary.rewind');
  if (rewinds.some((event) => event.targetMessageUuid === target)) return true;
  const turn = index.messages.get(target);
  return rewinds.length > 0 && turn !== undefined && turns.has(turn) && !order.includes(turn);
}

export const transcriptShowsRewind = (appSessionId: AppSessionId, target: MessageUuid): boolean => entryShowsRewind(useTranscriptStore.getState().entries[appSessionId], target);

const record = (appSessionId: AppSessionId): Resubmit => resubmitRecordOf(useComposerStore.getState(), appSessionId);
const ready = (appSessionId: AppSessionId): boolean => useSessions.getState().engine.get(appSessionId)?.process === 'ready';

function exited(appSessionId: AppSessionId): void {
  dispose(appSessionId);
  setResubmit(appSessionId, { state: 'idle', exited: true });
}

function rewound(appSessionId: AppSessionId, autoSend: boolean): void {
  dispose(appSessionId);
  setResubmit(appSessionId, { state: 'rewound_awaiting_send', autoSend });
}

// A prefill the composer took: edit mode for its message (or none), whatever the last edit was doing forgotten.
export function enterEditMode(appSessionId: AppSessionId, editing: Editing | null): void {
  dispose(appSessionId);
  markRestored(appSessionId, false);
  setEditing(appSessionId, editing);
  setResubmit(appSessionId, 'idle');
}

// A draft that carried an edit, restored after a reload: edit mode again, at `idle` (whatever was in flight is the
// transcript's to tell).
export function restoreEditMode(appSessionId: AppSessionId, editing: Editing): void {
  enterEditMode(appSessionId, editing);
  markRestored(appSessionId, true);
}

// The rewind applied before the reload: edit mode ends, the edited text stays in the editor as the draft.
function leaveRewound(appSessionId: AppSessionId): void {
  dispose(appSessionId);
  markRestored(appSessionId, false);
  setEditing(appSessionId, null);
  setResubmit(appSessionId, 'idle');
  toast({ level: 'info', text: REWOUND_COPY, actions: [], dismissible: true });
}

// A restored edit against the hydrated transcript (the caller's selector runs `entryShowsRewind`; checked again here
// against the store as it now stands): its message rewound ends it. Only an idle restored edit is settled here; once
// the human has sent, the engine's answer decides.
export function settleRestoredEdit(appSessionId: AppSessionId, rewoundInTranscript: boolean): void {
  const editing = editingOf(useComposerStore.getState(), appSessionId);
  if (!isRestored(appSessionId) || !rewoundInTranscript || record(appSessionId).state !== 'idle' || !editing) return;
  if (!transcriptShowsRewind(appSessionId, editing.messageUuid)) return;
  leaveRewound(appSessionId);
}

// Esc or the state line's ×. Refused while the rewind is in flight or unconfirmed (the editor is read-only then).
export function leaveEditMode(appSessionId: AppSessionId): boolean {
  const { state } = record(appSessionId);
  if (state === 'rewinding' || state === 'rewind_uncertain') return false;
  dispose(appSessionId);
  markRestored(appSessionId, false);
  setEditing(appSessionId, null);
  setResubmit(appSessionId, 'idle');
  if (state === 'rewound_awaiting_send') toast({ level: 'info', text: REWOUND_COPY, actions: [], dismissible: true });
  return true;
}

// Send in edit mode with no provider: the confirm dialog.
export function askToRewind(appSessionId: AppSessionId): void {
  if (record(appSessionId).state === 'idle' && editingOf(useComposerStore.getState(), appSessionId)) setResubmit(appSessionId, 'confirming');
}

export function cancelRewind(appSessionId: AppSessionId): void {
  if (record(appSessionId).state === 'confirming') setResubmit(appSessionId, 'idle');
}

// The human's confirm; `advanceTo` is the newer cursor a reconfirm accepted (a later turn began after the edit did).
export function confirmRewind(client: MawsBridge, appSessionId: AppSessionId, advanceTo: MessageUuid | null): Promise<RewindOutcome> {
  const editing = editingOf(useComposerStore.getState(), appSessionId);
  if (record(appSessionId).state !== 'confirming' || !editing) return Promise.resolve('stale');
  if (advanceTo !== null && advanceTo !== editing.seenCursor) setEditing(appSessionId, { ...editing, seenCursor: advanceTo });
  return issueRewind(client, appSessionId);
}

// Rewind again, from unresolved: the engine answers `rewound: true` when the first attempt never applied and refuses
// otherwise, so the transcript, not an inference, says what happened.
export function rewindAgain(client: MawsBridge, appSessionId: AppSessionId): Promise<RewindOutcome> {
  if (record(appSessionId).state !== 'rewind_unresolved') return Promise.resolve('stale');
  return issueRewind(client, appSessionId);
}

export function keepEditing(appSessionId: AppSessionId): void {
  if (record(appSessionId).state !== 'rewind_unresolved') return;
  dispose(appSessionId);
  setResubmit(appSessionId, 'idle');
}

// The edited text was sent (after a rewind, or without one by the human's choice): edit mode ends.
export function resubmitSent(appSessionId: AppSessionId): void {
  dispose(appSessionId);
  markRestored(appSessionId, false);
  setEditing(appSessionId, null);
  setResubmit(appSessionId, 'idle');
}

// A send after the rewind failed: the state stays, and its banner offers Retry (a send, never a rewind).
export function resubmitSendFailed(appSessionId: AppSessionId): void {
  if (record(appSessionId).state === 'rewound_awaiting_send') setResubmit(appSessionId, { state: 'rewound_awaiting_send', sendFailed: true });
}

// Whether the composer should send now, as part of the confirm that rewound (answered once).
export function takeAutoSend(appSessionId: AppSessionId): boolean {
  const current = record(appSessionId);
  if (current.state !== 'rewound_awaiting_send' || !current.autoSend) return false;
  setResubmit(appSessionId, { ...current, autoSend: false });
  return true;
}

async function issueRewind(client: MawsBridge, appSessionId: AppSessionId): Promise<RewindOutcome> {
  const editing = editingOf(useComposerStore.getState(), appSessionId)!;
  const flight = dispose(appSessionId);
  const generation = flight.generation;
  const current = () => flights.get(appSessionId)?.generation === generation;
  setResubmit(appSessionId, 'rewinding');
  // The process leaving while the call is in flight: nothing is sent, and a late answer cannot come from a process that is gone.
  flight.offs.push(
    useSessions.subscribe((s) => {
      if (current() && s.engine.get(appSessionId)?.process !== 'ready') exited(appSessionId);
    }),
  );
  const result = await client.invoke('session.rewind', {
    appSessionId,
    targetMessageUuid: editing.messageUuid,
    lastSeenMessageUuid: editing.seenCursor ?? editing.messageUuid, // the target itself when the transcript showed nothing newer
    files: false,
  });
  if (!current()) return 'stale';
  if (result.ok && result.value.rewound) {
    rewound(appSessionId, true);
    return 'rewound';
  }
  if (result.ok && result.value.reason === 'target_not_found') {
    leaveRewound(appSessionId); // the target left the conversation (an earlier rewind applied): confirming again could only loop
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
  if (transcriptShowsRewind(appSessionId, editing.messageUuid)) {
    rewound(appSessionId, false);
    return 'rewound';
  }
  setResubmit(appSessionId, 'rewind_uncertain');
  flight.offs.push(
    client.on('session.eventBatch', ({ appSessionId: id, events }) => {
      if (id !== appSessionId || !current()) return;
      for (const event of events) {
        if (event.kind === 'process.exited') return exited(appSessionId);
        if (event.kind === 'boundary.rewind' && event.targetMessageUuid === editing.messageUuid) return rewound(appSessionId, false);
      }
    }),
  );
  const timer = setTimeout(() => {
    if (current() && record(appSessionId).state === 'rewind_uncertain') setResubmit(appSessionId, 'rewind_unresolved');
  }, windowMs);
  flight.offs.push(() => clearTimeout(timer));
  return 'uncertain';
}
