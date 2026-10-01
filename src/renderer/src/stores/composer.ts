// Per-session composer state that outlives any one mounted composer (C7 execution document, Composer public surface,
// `useComposerStore`). M2 lands the seam the request card and the docked frame need before the composer exists:
// a pending prefill per session (the refusal dialog's Edit prompt, C6's edit-and-resubmit and C10's hand-back put the
// document here; M4's Composer takes it when mounted, so a prefill made from an Overview card waits for the pane),
// the requests a docked placement is showing (the transcript's request slot shows a pointer for those), and the focus
// targets a mounted composer registers (the docked frame gives focus back through them). M3 adds the `#` target each
// session remembers; M4 adds the composer's own state beside these: the synchronous `starting` gate of an unstarted
// session's first send and the resubmit state the edit-and-resubmit flow (M4b) drives, each per session so they outlive
// a tab switch. The final fixes add the models each session's engine last listed (C11's Session info and widgets read
// them; the model chip names its model from `engine.models`). W3 (B6): the user bubble a session edits in place, with
// its text, which outlives the virtualised row it sits in; the composer has no edit mode any more.
import { create } from 'zustand';
import type { AppSessionId, MessageUuid, RequestId } from '@shared/graph/ids';
import type { ListModelsResponse } from '@shared/wire/control';

export interface Prefill {
  text: string; // the row's text with `[Pasted text #n +L lines]` placeholders in place
  pasted?: Array<{ name: string; text: string }>; // placeholder order; each becomes a Pasted atom; a placeholder with no entry becomes an unavailable atom
  // W3 (B6): instead of `pasted`, an edited text's bodies keyed by the placeholder that named each (`bodiesByPlaceholder`):
  // a placeholder takes the body it names wherever the edit moved it; one it does not name is unavailable
  bodies?: Readonly<Record<string, string>>;
  images?: Array<{ name: string; mediaType: string; data: string }>; // base64, re-attached
}

// W3 (B6; charter line 134 and §5.3 as amended 2026-10-01): a user bubble edited in place. Send rewinds the session to
// `messageUuid` (with the seen cursor, the transcript's newest user uuid when the edit began) and resends the text; a
// `blocked` prompt (a hook stopped it, so it never reached the model) is sent as a new message instead. The text keeps
// the row's pasted placeholders, whose bodies (keyed by the placeholder that named each when the edit began, so one the
// human deletes or moves takes no other's body) and the row's images go with the send.
export interface InlineEdit {
  messageUuid: MessageUuid;
  seenCursor: MessageUuid | null;
  kind: 'edit' | 'blocked';
  text: string;
  bodies: NonNullable<Prefill['bodies']>;
  images: NonNullable<Prefill['images']>;
}

export interface FocusTarget {
  focusEditor(): void;
  focusFrame(): void;
  insertText(text: string): void; // at the editor's caret, at the end when it is not focused (C11's insertComposerText)
  openWidget?(name: string, args: string): boolean; // C11: a registered widget over the composer, with its argument (openComposerWidget)
}

// Where edit-and-resubmit stands (C7 execution document, "Edit-and-resubmit and the fork seam"); M4b drives it from
// `composer/resubmit-seam.ts` (W3: over the bubble edited in place). Every state keeps the edited text; only `sent`
// clears it (and `sent` is left at once: the accepted send ends the edit and the record returns to `idle`).
export type ResubmitState = 'idle' | 'confirming' | 'rewinding' | 'rewind_uncertain' | 'rewind_unresolved' | 'rewound_awaiting_send' | 'sent';

// The state with what its banner says: `exited` (idle after the engine exited mid-rewind), `sendFailed` (rewound, and
// the send that followed failed), `autoSend` (rewound by the human's own confirm: the composer sends the edited text
// as part of that decision; a rewind confirmed only later by the transcript waits for Send), `sending` (the edit's one
// send or fork is with the host, in whatever state it left: nothing else is taken until it answers).
export interface Resubmit {
  state: ResubmitState;
  exited: boolean;
  sendFailed: boolean;
  autoSend: boolean;
  sending: boolean;
}
export const IDLE_RESUBMIT: Resubmit = Object.freeze({ state: 'idle', exited: false, sendFailed: false, autoSend: false, sending: false }) as Resubmit;

// Where `#` appends (C3's `session.memoryAppend` target): the memory dialog's project or user file, or a listed path.
export interface MemoryTarget {
  kind: 'user' | 'project' | 'path';
  path: string | null;
}
export const DEFAULT_MEMORY_TARGET: MemoryTarget = Object.freeze({ kind: 'project', path: null }) as MemoryTarget;

export interface ComposerState {
  prefills: ReadonlyMap<AppSessionId, Prefill>;
  docked: ReadonlyMap<AppSessionId, ReadonlyMap<RequestId, number>>; // how many docked placements show each request
  focusTargets: ReadonlyMap<AppSessionId, FocusTarget>;
  memoryTargets: ReadonlyMap<AppSessionId, MemoryTarget>; // M3: the `#` target chosen per session
  starting: ReadonlySet<AppSessionId>; // M4: an unstarted session's first send is with C10's `start`
  inlineEdits: ReadonlyMap<AppSessionId, InlineEdit>; // W3 (B6): the bubble each session edits in place
  resubmit: ReadonlyMap<AppSessionId, Resubmit>; // M4b: absent is IDLE_RESUBMIT
  models: ReadonlyMap<AppSessionId, readonly ListedModel[]>; // the engine's latest `session.listModels` answer per session
  chipWidgets: ReadonlyMap<AppSessionId, ChipWidgetRequest>; // W3: the model chip's open menu (`/model`, `/effort`, `/fast`, or the chip itself)
}

// W3: the widget the model chip's menu shows (opened by the chip, the palette, a typed command or `openComposerWidget`),
// until it closes; `nonce` tells two opens of the same name apart.
export interface ChipWidgetRequest {
  name: string;
  args: string;
  nonce: number;
}

export type ListedModel = ListModelsResponse['models'][number];

const initial = (): ComposerState => ({
  prefills: new Map(),
  docked: new Map(),
  focusTargets: new Map(),
  memoryTargets: new Map(),
  starting: new Set(),
  inlineEdits: new Map(),
  resubmit: new Map(),
  models: new Map(),
  chipWidgets: new Map(),
});

export const useComposerStore = create<ComposerState>()(initial);

export function resetComposerStore(): void {
  useComposerStore.setState(initial());
}

// Replaces the session's untaken prefill: the latest ask wins.
export function prefillComposer(appSessionId: AppSessionId, prefill: Prefill): void {
  useComposerStore.setState((s) => ({ prefills: new Map(s.prefills).set(appSessionId, prefill) }));
}

// The composer's side: the pending prefill, removed as it is taken.
export function takePrefill(appSessionId: AppSessionId): Prefill | null {
  const prefill = useComposerStore.getState().prefills.get(appSessionId) ?? null;
  if (prefill) {
    useComposerStore.setState((s) => {
      const prefills = new Map(s.prefills);
      prefills.delete(appSessionId);
      return { prefills };
    });
  }
  return prefill;
}

function countDocked(appSessionId: AppSessionId, requestId: RequestId, delta: 1 | -1): void {
  useComposerStore.setState((s) => {
    const counts = new Map(s.docked.get(appSessionId));
    const next = (counts.get(requestId) ?? 0) + delta;
    if (next > 0) counts.set(requestId, next);
    else counts.delete(requestId);
    const docked = new Map(s.docked);
    if (counts.size > 0) docked.set(appSessionId, counts);
    else docked.delete(appSessionId);
    return { docked };
  });
}

// A docked placement showing `requestId`, for as long as it is mounted; the disposer releases it once.
export function markDocked(appSessionId: AppSessionId, requestId: RequestId): () => void {
  countDocked(appSessionId, requestId, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    countDocked(appSessionId, requestId, -1);
  };
}

export const isDocked = (state: ComposerState, appSessionId: AppSessionId, requestId: RequestId): boolean => (state.docked.get(appSessionId)?.get(requestId) ?? 0) > 0;

// A mounted composer's focus target; the latest registration for a session wins and a disposer removes only its own.
export function registerFocusTarget(appSessionId: AppSessionId, target: FocusTarget): () => void {
  useComposerStore.setState((s) => ({ focusTargets: new Map(s.focusTargets).set(appSessionId, target) }));
  return () => {
    if (useComposerStore.getState().focusTargets.get(appSessionId) !== target) return;
    useComposerStore.setState((s) => {
      const focusTargets = new Map(s.focusTargets);
      focusTargets.delete(appSessionId);
      return { focusTargets };
    });
  };
}

export const memoryTargetOf = (state: ComposerState, appSessionId: AppSessionId): MemoryTarget => state.memoryTargets.get(appSessionId) ?? DEFAULT_MEMORY_TARGET;

export function setMemoryTarget(appSessionId: AppSessionId, target: MemoryTarget): void {
  useComposerStore.setState((s) => ({ memoryTargets: new Map(s.memoryTargets).set(appSessionId, target) }));
}

// ---- M4: the composer's own per-session state ------------------------------------------------------------------------

export const isStarting = (state: ComposerState, appSessionId: AppSessionId): boolean => state.starting.has(appSessionId);

// Set synchronously before C10's `start` is awaited, cleared when it settles: a second submission in the same tick reads it.
export function setStarting(appSessionId: AppSessionId, on: boolean): void {
  if (useComposerStore.getState().starting.has(appSessionId) === on) return;
  useComposerStore.setState((s) => {
    const starting = new Set(s.starting);
    if (on) starting.add(appSessionId);
    else starting.delete(appSessionId);
    return { starting };
  });
}

// ---- W3 (B6): the bubble edited in place --------------------------------------------------------------------------

export const inlineEditOf = (state: ComposerState, appSessionId: AppSessionId): InlineEdit | null => state.inlineEdits.get(appSessionId) ?? null;

export function setInlineEdit(appSessionId: AppSessionId, edit: InlineEdit | null): void {
  useComposerStore.setState((s) => {
    const inlineEdits = new Map(s.inlineEdits);
    if (edit) inlineEdits.set(appSessionId, edit);
    else inlineEdits.delete(appSessionId);
    return { inlineEdits };
  });
}

export function setInlineText(appSessionId: AppSessionId, text: string): void {
  const edit = inlineEditOf(useComposerStore.getState(), appSessionId);
  if (edit && edit.text !== text) setInlineEdit(appSessionId, { ...edit, text });
}

export const resubmitRecordOf = (state: ComposerState, appSessionId: AppSessionId): Resubmit => state.resubmit.get(appSessionId) ?? IDLE_RESUBMIT;
export const resubmitOf = (state: ComposerState, appSessionId: AppSessionId): ResubmitState => resubmitRecordOf(state, appSessionId).state;

// Replaces the session's record: a bare state, or a state with the flags it carries (every flag not given is false).
export function setResubmit(appSessionId: AppSessionId, next: ResubmitState | (Partial<Resubmit> & { state: ResubmitState })): void {
  const record: Resubmit = { ...IDLE_RESUBMIT, ...(typeof next === 'string' ? { state: next } : next) };
  useComposerStore.setState((s) => {
    const resubmit = new Map(s.resubmit);
    if (record.state === 'idle' && !record.exited && !record.sending) resubmit.delete(appSessionId);
    else resubmit.set(appSessionId, record);
    return { resubmit };
  });
}

// C11's ask: text at the caret of the session's mounted composer (at the end when it is not focused), the document kept.
export function insertComposerText(appSessionId: AppSessionId, text: string): void {
  const target = useComposerStore.getState().focusTargets.get(appSessionId);
  if (target) target.insertText(text);
  else console.warn(`[composer] insertComposerText: no composer is mounted for ${appSessionId}`);
}

// C11 start: a registered slash widget opened over the session's mounted composer with an argument, from anywhere (the
// context widget's Compact…, Session info's actions); whether one opened.
export function openComposerWidget(appSessionId: AppSessionId, name: string, args: string): boolean {
  const target = useComposerStore.getState().focusTargets.get(appSessionId);
  if (target?.openWidget) return target.openWidget(name, args);
  console.warn(`[composer] openComposerWidget: no composer is mounted for ${appSessionId}`);
  return false;
}
// C11 end

// The session's listed models, kept past any one read (the model chip's name comes from C10's `engine.models`).
export const listedModelsOf = (state: ComposerState, appSessionId: AppSessionId): readonly ListedModel[] | null => state.models.get(appSessionId) ?? null;

export function rememberListedModels(appSessionId: AppSessionId, models: readonly ListedModel[]): void {
  useComposerStore.setState((s) => (s.models.get(appSessionId) === models ? s : { models: new Map(s.models).set(appSessionId, models) }));
}

// ---- W3: the model chip's menu, opened from the editor ----------------------------------------------------------------

let chipNonce = 0;
export function requestChipWidget(appSessionId: AppSessionId, name: string, args: string): void {
  chipNonce += 1;
  useComposerStore.setState((s) => ({ chipWidgets: new Map(s.chipWidgets).set(appSessionId, { name, args, nonce: chipNonce }) }));
}

export function closeChipWidget(appSessionId: AppSessionId): void {
  if (!useComposerStore.getState().chipWidgets.has(appSessionId)) return;
  useComposerStore.setState((s) => {
    const chipWidgets = new Map(s.chipWidgets);
    chipWidgets.delete(appSessionId);
    return { chipWidgets };
  });
}
