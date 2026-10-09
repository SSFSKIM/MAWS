// What C10's renderer does with an intent and a start (C10 execution document, Interfaces "The unstarted session",
// M3's carried rule for card continuations): the hook's `patch` and `start`, the cards' continuations and hand-backs,
// a record's resume, and the close guard's decision. Every command goes through `ipc`; the answers update the setup
// store directly as well as through the events that follow.
import type { AppSessionId } from '@shared/graph/ids';
import type { StartOptions } from '@shared/ipc/schema/session';
import type { FirstMessage, SetupIntent, SetupIntentPatch } from '@shared/sessions/intent';
import type { SetupResources, StartOutcome } from '@shared/sessions/setup';
import { isEmptyDoc, liveDraftDoc } from '../composer/editor/drafts';
import { sendHumanPrompt } from '../composer/submit/send-human-prompt'; // P2-A
import { pickDirectModel } from '../gateway/direct-model'; // debt wave 4: the direct route's model refusal
import { ipc } from '../ipc/client';
import { clearComposer } from '../stores/composer'; // P2-A
import type { ReplaceVerdict } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { acquireSession, acquisitionWords, dockFor } from './acquire'; // P2-A
import { heldToast } from './attach';
import { cleanupTargetAt, confirm, removeWorktreeAction } from './dialogs';
import { holderWords } from './holder-words';
import { returnMessage } from './message-return';
import { isStarting, startNoticeId, useSetup } from './store'; // P2-A: startNoticeId

export type HookResult = { ok: true } | { ok: false; error: string };
export type WorktreeResource = NonNullable<SetupResources['worktree']>;

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
// A directory inside the intent's repository, which a cleanup target of a hand-made checkout is asked through.
// (a failed attempt's intent always has a location: a start refuses one without)
const repositoryOf = (intent: SetupIntent) => (intent.location === null ? '' : intent.location.kind === 'directory' ? intent.location.path : intent.location.repoRoot);

// ---- outcomes in words -------------------------------------------------------------------------------------------

// The refusal a start answered, in words; null for the outcomes that start or dock a card.
function refusalOf(outcome: StartOutcome): string | null {
  switch (outcome.status) {
    case 'starting':
    case 'needs_trust':
    case 'relay_unreachable':
      return null;
    case 'invalid':
      return outcome.message;
    case 'missing_directory':
      return `Directory not found: ${outcome.directory}`;
    case 'refused':
      return outcome.message;
    case 'held':
      return `Held by ${holderWords(outcome.holder)}`;
    case 'already_live':
      return 'This session is already running';
    case 'archived':
      return 'This session is archived; unarchive it first';
  }
}

// P2-A: `dockFor`, the card an outcome waits on, lives with the acquisition (`./acquire.ts`), which docks the same cards.
// A record's card is one for a session this page knows by its record and no intent (an acquisition's); an intent's
// provisional record, and an id whose intent has not reached this page yet (a side thread's), stay C10's.
const isRecordCard = (appSessionId: AppSessionId) => !useSetup.getState().intents.has(appSessionId) && useSessions.getState().records.has(appSessionId);

async function start(appSessionId: AppSessionId, message: FirstMessage | null, options: StartOptions): Promise<StartOutcome | { error: string }> {
  const store = useSetup.getState();
  store.undock(appSessionId);
  store.setInvoking(appSessionId, true);
  try {
    const result = await ipc.invoke('session.start', { appSessionId, message, options });
    return result.ok ? result.value : { error: result.error.message };
  } finally {
    useSetup.getState().setInvoking(appSessionId, false);
  }
}

// ---- the hook's commands -----------------------------------------------------------------------------------------

export async function patchIntent(appSessionId: AppSessionId, patch: SetupIntentPatch): Promise<HookResult> {
  const result = await ipc.invoke('session.intent.patch', { appSessionId, patch });
  if (!result.ok) return { ok: false, error: result.error.message };
  useSetup.getState().setIntent(result.value);
  return { ok: true };
}

// Send on an unstarted session: `starting`, `needs_trust` and `relay_unreachable` are `{ ok: true }` (the message is
// retained; a card takes over), every refusal `{ ok: false }` with the editor keeping its text.
// Main refuses a relay alias on the direct route (`invalid`, field `model`); Send then offers C11's Direct-compatible
// choice, and a pick is written to the intent (with the effort it admits) and sent once more. Cancelling leaves the
// refusal as the editor's error, the intent unchanged; the resend after a pick asks no second time (`pick` null).
export async function startIntent(appSessionId: AppSessionId, first: FirstMessage, pick: typeof pickDirectModel | null = pickDirectModel): Promise<HookResult> {
  const outcome = await start(appSessionId, first, {});
  if ('error' in outcome) return { ok: false, error: outcome.error };
  if (outcome.status === 'invalid' && outcome.field === 'model' && pick !== null) {
    const choice = await pick(appSessionId);
    if (choice === null) return { ok: false, error: outcome.message };
    const patched = await patchIntent(appSessionId, { model: choice.model, ...(choice.effort !== null && { effort: choice.effort }) });
    return patched.ok ? startIntent(appSessionId, first, null) : patched;
  }
  dockFor(appSessionId, outcome, first);
  const refusal = refusalOf(outcome);
  return refusal === null ? { ok: true } : { ok: false, error: refusal };
}

// ---- the cards ---------------------------------------------------------------------------------------------------

// A card's continuation (Trust and start, Start without trusting, Run direct, the relay's own restart, Retry): the
// same start with the retained message (`message: null`) and only the option the human chose. A refusal or a failure
// clears the retained message in main, so the card returns the message it docked with to the editor first.
export async function continueSetup(appSessionId: AppSessionId, options: StartOptions, docked: FirstMessage | null): Promise<HookResult> {
  if (isRecordCard(appSessionId)) return continueRecord(appSessionId, options, docked); // P2-A
  const outcome = await start(appSessionId, null, options);
  if ('error' in outcome && outcome.error.startsWith('starting:')) {
    // a start of this id still runs (another window's, or one this page lost to a reload): main holds the message
    toast({ level: 'info', text: 'Starting…', actions: [], dismissible: true });
    return { ok: false, error: outcome.error };
  }
  const refusal = 'error' in outcome ? outcome.error : refusalOf(outcome);
  if (refusal !== null) {
    if (docked !== null) returnMessage(appSessionId, docked);
    toast({ level: 'danger', text: refusal, actions: [], dismissible: true });
    return { ok: false, error: refusal };
  }
  dockFor(appSessionId, outcome as StartOutcome, docked);
  return { ok: true };
}

// P2-A start (2026-10-09; the execution document §5.4): a record's card continuation. The session is acquired with the
// option the owner chose, then the docked composer message is sent through the human seam, and the composer clears
// only once the host accepted it: until then the text stays in the composer's draft, so a refusal or a host error only
// undocks the card and says why. A card a surface docked without a message only starts the session.
async function continueRecord(appSessionId: AppSessionId, options: StartOptions, docked: FirstMessage | null): Promise<HookResult> {
  const store = useSetup.getState();
  store.setInvoking(appSessionId, true);
  const refuse = (words: string): HookResult => {
    useSetup.getState().undock(appSessionId);
    toast({ id: startNoticeId(appSessionId), level: 'danger', text: words, actions: [], dismissible: true });
    return { ok: false, error: words };
  };
  try {
    const outcome = await acquireSession(appSessionId, docked === null ? 'resume' : 'send', { ...options, ...(docked !== null && { dockMessage: docked }) });
    if (outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable') return { ok: true }; // a card again, docked by the acquisition
    if (outcome.status !== 'ready') return refuse(acquisitionWords(outcome) ?? 'The session could not start');
    if (docked !== null) {
      const sent = await sendHumanPrompt(appSessionId, docked.content, { origin: 'composer', display: docked.display });
      if (sent.disposition === 'refused' || sent.disposition === 'held') return refuse(sent.reason ?? 'The message was not sent');
      clearComposer(appSessionId);
    }
    useSetup.getState().undock(appSessionId);
    return { ok: true };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  } finally {
    useSetup.getState().setInvoking(appSessionId, false);
  }
}
// P2-A end

// Cancel and "Back to editing": the retained message back to the editor, then main's hand-back, which clears
// `intent.message` so the composer's held-message gate opens from the fact it closed on. P2-A: a record's card only
// undocks; its message never left the composer's draft and main retains nothing for an acquisition.
export async function releaseMessage(appSessionId: AppSessionId, docked: FirstMessage | null): Promise<HookResult> {
  if (isRecordCard(appSessionId)) {
    useSetup.getState().settle(appSessionId);
    return { ok: true };
  }
  useSetup.getState().settle(appSessionId);
  if (docked !== null) returnMessage(appSessionId, docked);
  const result = await ipc.invoke('session.intent.release', { appSessionId });
  if (!result.ok) {
    toast({ level: 'danger', text: result.error.message, actions: [], dismissible: true });
    return { ok: false, error: result.error.message };
  }
  if (result.value !== null) useSetup.getState().setIntent(result.value);
  return { ok: true };
}

// "Back to editing" on the card a reload restored (the store's UNSENT): the page cannot tell whether main still runs the
// start, so main's hand-back comes first and the message returns to the editor only once main gave it up; a `starting`
// refusal means main is sending it (the card goes when the start's next phase arrives).
export async function reclaimMessage(appSessionId: AppSessionId, docked: FirstMessage | null): Promise<HookResult> {
  const result = await ipc.invoke('session.intent.release', { appSessionId });
  if (!result.ok) {
    const starting = result.error.message.startsWith('starting:');
    toast({ level: starting ? 'info' : 'danger', text: starting ? 'Starting…' : result.error.message, actions: [], dismissible: true });
    return { ok: false, error: result.error.message };
  }
  useSetup.getState().settle(appSessionId);
  if (docked !== null) returnMessage(appSessionId, docked);
  if (result.value !== null) useSetup.getState().setIntent(result.value);
  return { ok: true };
}

// The resolutions of a checkout the failed attempt created and kept (the failure card's, and the empty state's note
// once the card is dismissed). Answers what became of the checkout, which the failure card shows in place of the
// rollback's account.
// A kept checkout is named with its way into the cleanup: until a session runs there no record names it.
export async function resolveWorktree(appSessionId: AppSessionId, resolution: 'discard' | 'keep'): Promise<WorktreeResource | null> {
  const result = await ipc.invoke('session.intent.resolveWorktree', { appSessionId, resolution });
  if (!result.ok) {
    toast({ level: 'danger', text: result.error.message, actions: [], dismissible: true });
    return null;
  }
  const { intent, worktree } = result.value;
  useSetup.getState().setIntent(intent);
  if (resolution === 'keep' && worktree.state === 'kept') {
    const target = cleanupTargetAt(worktree, repositoryOf(intent));
    toast({ level: 'info', text: `Worktree ${basename(worktree.path)} kept as this session’s location`, actions: [removeWorktreeAction(target)], dismissible: true });
  }
  return worktree;
}

// ---- a record's resume -------------------------------------------------------------------------------------------

// `session.resume` (the row's explicit Resume, a take-over's resume): P2-A, an acquisition like every other gesture's,
// so it joins a start in flight; a trust or relay card docks in the session's tab, every refusal is a toast naming it.
// Answers whether the session is ready or a card waits.
export async function resumeSession(appSessionId: AppSessionId): Promise<boolean> {
  const store = useSetup.getState();
  store.setInvoking(appSessionId, true);
  try {
    const outcome = await acquireSession(appSessionId, 'resume');
    if (outcome.status === 'ready' || outcome.status === 'needs_trust' || outcome.status === 'relay_unreachable') return true;
    if (outcome.status === 'held') heldToast(appSessionId, outcome.holder, outcome.attach);
    else toast({ id: startNoticeId(appSessionId), level: 'danger', text: acquisitionWords(outcome) ?? 'The session could not start', actions: [], dismissible: true });
    return false;
  } catch (error) {
    toast({ level: 'danger', text: error instanceof Error ? error.message : String(error), actions: [], dismissible: true });
    return false;
  } finally {
    useSetup.getState().setInvoking(appSessionId, false);
  }
}

// ---- closing an unstarted tab ------------------------------------------------------------------------------------

// A draft with nothing in it: no attachments and no text or atom anywhere in the document.
export function isEmptyDraft(draft: SetupIntent['draft']): boolean {
  if (draft === null) return true;
  if (draft.attachments.length > 0) return false;
  const hasContent = (node: unknown): boolean => {
    if (typeof node !== 'object' || node === null) return false;
    const { type, text, content, attrs } = node as { type?: unknown; text?: unknown; content?: unknown; attrs?: { attachments?: unknown } };
    if (type === 'doc' && Array.isArray(attrs?.attachments) && attrs.attachments.length > 0) return true;
    if (type === 'text') return typeof text === 'string' && text.trim().length > 0;
    if (type !== undefined && type !== 'doc' && type !== 'paragraph' && type !== 'hardBreak') return true; // an atom (mention, pasted)
    return Array.isArray(content) && content.some(hasContent);
  };
  return !hasContent(draft.doc);
}

// E11 F2b (plan 2.5; owner decision 2): opening a session in an unstarted tab's place. A start in flight keeps the tab
// (the launch must land somewhere); a draft (typed text, attachments, a first message held behind a card) is set aside:
// the tab goes to the ⌘⇧T history with its intent and draft kept, nothing asked. A blank one answers null: discarded
// silently by its close guard, as before. A session with a record is not this verdict's.
export function unstartedReplaceVerdict(appSessionId: AppSessionId): ReplaceVerdict {
  const setup = useSetup.getState();
  const intent = setup.intents.get(appSessionId);
  if (intent === undefined || useSessions.getState().records.has(appSessionId)) return null;
  if (isStarting(setup, appSessionId)) return { keep: 'The new chat is starting' };
  const liveDoc = liveDraftDoc(appSessionId);
  const blank = (liveDoc === undefined ? isEmptyDraft(intent.draft) : isEmptyDoc(liveDoc)) && intent.message === null;
  return blank ? null : { aside: 'The new chat’s draft is kept; ⌘⇧T or Reopen brings it back' };
}

// C5's close guard for a session tab: a session with a record closes as usual; an unstarted one with nothing typed is
// discarded silently; a start in flight keeps the tab; anything typed (or a first message held behind a card) asks.
export async function beforeCloseUnstarted(appSessionId: AppSessionId): Promise<'closed' | 'kept'> {
  const setup = useSetup.getState();
  const intent = setup.intents.get(appSessionId);
  if (intent === undefined || useSessions.getState().records.has(appSessionId)) return 'closed';
  if (isStarting(setup, appSessionId)) {
    toast({ level: 'info', text: 'Starting…', actions: [], dismissible: true });
    return 'kept';
  }
  const liveDoc = liveDraftDoc(appSessionId);
  if (!(liveDoc === undefined ? isEmptyDraft(intent.draft) : isEmptyDoc(liveDoc)) || intent.message !== null) {
    const discard = await confirm({ title: 'Discard this unstarted session?', body: 'Its draft will be lost.', confirmLabel: 'Discard', destructive: true });
    if (!discard) return 'kept';
  }
  const result = await ipc.invoke('session.intent.discard', { appSessionId });
  if (!result.ok) {
    toast({ level: 'danger', text: result.error.message, actions: [], dismissible: true });
    return 'kept';
  }
  // no record names this checkout, so the notice is its way into the cleanup
  const leftover = result.value.leftover?.worktree;
  if (leftover) toast({ level: 'info', text: `Worktree ${leftover.path} was kept`, actions: [removeWorktreeAction(cleanupTargetAt(leftover, repositoryOf(intent)))], dismissible: true });
  return 'closed';
}
