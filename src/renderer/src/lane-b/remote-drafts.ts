// A lane B session's draft on its machine (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §P): the composer's draft, kept per member on that machine's index (`session.drafts.get`, a call;
// `session.drafts.set`, a `machine` act), so it outlives this app's run. `rememberingRemoteDrafts`
// (../composer/editor/drafts.ts) brings a session's loads and saves here while its machine isn't known to refuse them.
//
// - One session's saves go one after another (M6a Task 2, item 6): main's adapter takes each as an act, and the machine
//   decides acts concurrently, so two out at once could land in either order. While one is out only the newest waiting
//   is kept: each is the whole document, so those between are superseded.
// - A load while a save waits or is out answers that save's draft, since the machine's may be older than what was typed.
//   So does one after a save the machine didn't take, for this run, until a later save is taken.
// - A `not-offered` (an endpoint older than M6a) hands the newest draft to the caller's fallback, and ./reader-rows.ts
//   hears it. A refusal may be heard first by another session's request: the caller's next save then goes to its fallback
//   and ends this session's saves here (`dropRemoteDraftSaves`), so a save still out, answered later, hands nothing over
//   the newer one (Task 3's review, H1).
// - Each save names the draft it replaces there (`replaces`, by its `updatedAt`: STALE_DRAFT_WORDS), as last read or
//   saved (M6a's branch review, F1). Main answers a save still out at its pending bound `timeout`, and the act may yet
//   land, so after one the next save reads what is kept first; the late one, landing after it, is refused there. A save
//   refused so (it lost to a late act, or to another device of the member) reads what is kept and goes again, a few
//   times: the newest typed here is this device's word. A `timeout` with nothing newer to send sends the newest again a
//   while later, a few times, since a late act may yet make it stale there (M6a's re-review). A clear is kept there at a stamp its machine mints (M6a's
//   re-review, K1), read as a draft with no document, which loads as none.
// - A save keeps the text there whatever its attachments weigh (M6a's branch review, F3; @shared/sessions/draft-fit.ts):
//   those past one act's bound stay in this run, which loads the draft whole, and the composer is told once; a draft
//   read from the machine names those its machine left there, which is said too, and each save after it names them
//   again, so the machine keeps them (M6a's re-review, K2): left out is not removed. So are those a save's own fitting
//   leaves out, which the machine may hold already (M6a's last pass, L1). A clear takes them off.
// - UX wave U4a (decision 13; docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, Interfaces K): a take-back's
//   claim and its settling save (`replaces` given) go once each, in the order of the session's other saves, and their
//   answer is the caller's: nothing here reads what is kept and goes again on their behalf, since a claim answered stale
//   is an earlier store's answer and going again on top of what is kept would stage where nothing fences.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import { STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { isAddress, machineOf } from '@shared/machine/address';
import { fitDraft, nameWithheld, takeWithheld, type Withheld } from '@shared/sessions/draft-fit';
import { useMachines } from '../stores/machines';
import { toast } from '../stores/notices';
import { machineName } from '../stores/org-projects';
import { heardReaderRows, isNotOffered } from './reader-rows';

export const REMOTE_DRAFT_WORDS = {
  keptHere: (names: readonly string[], machine: string) => `${names.join(', ')} stays in this window only: too large to keep with the draft on ${machine}`,
  leftThere: (names: readonly string[], machine: string) => `${names.join(', ')} stayed on ${machine}: too large to bring here with the draft`,
} as const;

/**
 * A session's saves not yet taken: the newest draft handed to `save`, whether a save is out, whether one waits, and the
 * newest's sending again after a `timeout` (how many times since it was handed, and the one due).
 */
type Saves = { latest: Draft | null; out: boolean; waiting: boolean; refused(draft: Draft | null): void; resent: number; resend: ReturnType<typeof setTimeout> | null };
const saves = new Map<AppSessionId, Saves>();
/** The draft kept there as this run last knew it, by its `updatedAt` (null: none); absent while not known. */
const bases = new Map<AppSessionId, string | null>();
/** A save refused as stale goes again this many times, each after reading what is kept. */
const STALE_RETRIES = 3;
/** After a `timeout` with nothing newer to send, the newest goes again this long after, at most this many times. */
export const REMOTE_DRAFT_RETRY_MS = 15_000;
export const REMOTE_DRAFT_RETRIES = 3;
/** The whole draft of a session whose last save left attachments out there, for this run's loads. */
const wholeHere = new Map<AppSessionId, Draft>();
/** The attachments the machine's last read of a session left there, which its saves name. */
const leftThere = new Map<AppSessionId, Withheld[]>();
/** The attachments last said as kept here, per session, so the same ones are said once. */
const said = new Map<AppSessionId, string>();

function say(client: MawsBridge, appSessionId: AppSessionId, names: readonly string[], words: (names: readonly string[], machine: string) => string): void {
  const key = `${words === REMOTE_DRAFT_WORDS.keptHere ? 'here' : 'there'}:${names.join('\n')}`;
  if (said.get(appSessionId) === key) return;
  said.set(appSessionId, key);
  const machine = isAddress(appSessionId) ? machineName(useMachines.getState().machines, machineOf(appSessionId), client.localMachine) : 'its machine';
  toast({ level: 'warning', text: words(names, machine), actions: [], dismissible: true });
}

export function resetRemoteDraftSaves(): void {
  saves.clear();
  bases.clear();
  leftThere.clear();
  wholeHere.clear();
  said.clear();
  onceOut.clear();
  waitingForDrain.clear();
}

/** The newest draft of the session the machine doesn't hold whole: a save not yet taken, or one that left attachments out. */
export function unsavedRemoteDraft(appSessionId: AppSessionId): Draft | null | undefined {
  const queue = saves.get(appSessionId);
  return queue !== undefined ? queue.latest : wholeHere.get(appSessionId);
}

/** The session's saves here end, unanswered ones included: a newer save went to the caller's fallback. */
export function dropRemoteDraftSaves(appSessionId: AppSessionId): void {
  saves.delete(appSessionId);
  wholeHere.delete(appSessionId);
}

const isStale = (result: CommandResult<CommandName>): boolean => !result.ok && result.error.message.includes(STALE_DRAFT_WORDS);

/** The machine's draft read, what it says of the machine heard and what is kept there known. */
async function readKept(client: MawsBridge, appSessionId: AppSessionId): Promise<CommandResult<'session.drafts.get'>> {
  const result = await client.invoke('session.drafts.get', { appSessionId });
  heardReaderRows(appSessionId, result);
  if (result.ok) {
    bases.set(appSessionId, result.value?.updatedAt ?? null);
    const { withheld } = result.value === null ? { withheld: [] } : takeWithheld(result.value);
    if (withheld.length > 0) leftThere.set(appSessionId, withheld);
    else leftThere.delete(appSessionId);
  }
  return result;
}

/** The member's draft there, or the one still being saved; `refused`, the fallback's, if the machine offers none. */
export async function loadRemoteDraft(client: MawsBridge, appSessionId: AppSessionId, refused: () => Draft | null): Promise<Draft | null> {
  const unsaved = unsavedRemoteDraft(appSessionId);
  if (unsaved !== undefined) return unsaved;
  const result = await readKept(client, appSessionId);
  if (result.ok) {
    if (result.value === null || result.value.doc === null) return null; // none, or cleared there (its stamp now known)
    const { draft, withheld } = takeWithheld(result.value);
    if (withheld.length > 0) say(client, appSessionId, withheld.map((entry) => entry.name), REMOTE_DRAFT_WORDS.leftThere);
    return draft;
  }
  if (isNotOffered(result)) return refused();
  console.warn('[composer] the draft could not be read from its machine', result.error.message);
  return null;
}

/** The draft saved there after the session's saves before it; `refused` takes the newest if the machine offers none. */
export function saveRemoteDraft(client: MawsBridge, appSessionId: AppSessionId, draft: Draft | null, refused: (draft: Draft | null) => void): void {
  const held = saves.get(appSessionId);
  const queue = held ?? { latest: draft, out: false, waiting: false, refused, resent: 0, resend: null };
  if (held === undefined) saves.set(appSessionId, queue);
  queue.latest = draft;
  queue.waiting = true;
  queue.refused = refused;
  queue.resent = 0;
  if (!queue.out) void pump(client, appSessionId, queue);
}

/** One draft saved on top of what is kept there: read first when that isn't known, and again after a stale refusal. */
async function saveOnce(client: MawsBridge, appSessionId: AppSessionId, draft: Draft | null, current: () => boolean): Promise<CommandResult<CommandName> | null> {
  for (let attempt = 0; ; attempt++) {
    if (!bases.has(appSessionId)) {
      const read = await readKept(client, appSessionId);
      if (!current()) return null;
      if (!read.ok) return read;
    }
    const fitted = draft === null ? { draft: null, withheld: [] } : fitDraft(nameWithheld(draft, leftThere.get(appSessionId) ?? []));
    // M6a's last pass, L1: those this save's own fitting leaves out are named too, since the machine may hold them already
    const sent = fitted.draft === null || fitted.withheld.length === 0 ? fitted.draft : nameWithheld(fitted.draft, [...(leftThere.get(appSessionId) ?? []), ...fitted.withheld]);
    const result = await client.invoke('session.drafts.set', { appSessionId, draft: sent, replaces: bases.get(appSessionId) ?? null });
    if (!current()) return null;
    heardReaderRows(appSessionId, result);
    if (result.ok) {
      if (draft === null) {
        bases.delete(appSessionId); // the machine stamped the clear: read before the next save
        leftThere.delete(appSessionId);
      } else bases.set(appSessionId, draft.updatedAt);
      if (draft === null || fitted.withheld.length === 0) {
        wholeHere.delete(appSessionId);
        said.delete(appSessionId); // what is left out next is said again
      } else {
        wholeHere.set(appSessionId, draft);
        say(client, appSessionId, fitted.withheld.map((entry) => entry.name), REMOTE_DRAFT_WORDS.keptHere);
      }
      return result;
    }
    bases.delete(appSessionId); // `timeout` (it may still land), stale, or lost: what is kept there is read again
    if (!isStale(result) || attempt >= STALE_RETRIES) return result;
  }
}

async function pump(client: MawsBridge, appSessionId: AppSessionId, queue: Saves): Promise<void> {
  queue.out = true;
  await onceOut.get(appSessionId); // UX wave U4a: a take-back's save already out goes first
  if (queue.resend !== null) clearTimeout(queue.resend);
  queue.resend = null;
  let taken = false;
  let timedOut = false;
  const current = () => saves.get(appSessionId) === queue; // else dropped (a newer save went to the fallback) or reset
  while (queue.waiting && current()) {
    queue.waiting = false;
    const result = await saveOnce(client, appSessionId, queue.latest, current);
    if (result === null) return;
    if (isNotOffered(result)) {
      saves.delete(appSessionId);
      return queue.refused(queue.latest);
    }
    taken = result.ok;
    timedOut = !result.ok && result.error.code === 'timeout';
    if (!result.ok) console.warn('[composer] the draft was not kept on its machine', result.error.message);
  }
  queue.out = false;
  drained(appSessionId);
  if (!current()) return;
  if (taken) return void saves.delete(appSessionId);
  // A save past main's bound may land later, after a newer one it then makes stale there: nobody would send the newest
  // again, so it goes again itself, on top of what is kept by then (M6a's re-review, the enumerated draft path).
  if (timedOut && queue.resent < REMOTE_DRAFT_RETRIES) {
    queue.resent += 1;
    queue.resend = setTimeout(() => {
      queue.resend = null;
      if (!current() || queue.out) return;
      queue.waiting = true;
      void pump(client, appSessionId, queue);
    }, REMOTE_DRAFT_RETRY_MS);
  }
}

// ---- UX wave U4a: a take-back's save, sent once in the session's order ------------------------------------------------

const onceOut = new Map<AppSessionId, Promise<unknown>>();
const waitingForDrain = new Map<AppSessionId, (() => void)[]>();
function drained(appSessionId: AppSessionId): void {
  const waiting = waitingForDrain.get(appSessionId) ?? [];
  waitingForDrain.delete(appSessionId);
  waiting.forEach((resolve) => resolve());
}
/** Resolves once no ordinary save of the session is out. */
const ordinarySavesOut = (appSessionId: AppSessionId): Promise<void> =>
  saves.get(appSessionId)?.out ? new Promise((resolve) => waitingForDrain.set(appSessionId, [...(waitingForDrain.get(appSessionId) ?? []), resolve])) : Promise.resolve();

/**
 * One save of a take-back (the claim, or the settling save), with the `replaces` given, after the session's saves out
 * and before those handed later; sent once, its answer the caller's. A draft this machine's link would cut is not sent
 * (`withheld`): a stage must hold every byte.
 */
export async function saveRemoteDraftOnce(client: MawsBridge, appSessionId: AppSessionId, draft: Draft | null, replaces: string): Promise<CommandResult<'session.drafts.set'> | { withheld: true }> {
  if (draft !== null && fitDraft(draft).withheld.length > 0) return { withheld: true };
  const before = onceOut.get(appSessionId);
  const sent = (async () => {
    await before;
    await ordinarySavesOut(appSessionId);
    const result = await client.invoke('session.drafts.set', { appSessionId, draft, replaces });
    heardReaderRows(appSessionId, result);
    if (result.ok) {
      if (draft === null) bases.delete(appSessionId); // the machine stamped the clear: read before the next save
      else bases.set(appSessionId, draft.updatedAt);
      wholeHere.delete(appSessionId);
    } else bases.delete(appSessionId); // what is kept there is read again before the next ordinary save
    return result;
  })();
  onceOut.set(appSessionId, sent);
  try {
    return await sent;
  } finally {
    if (onceOut.get(appSessionId) === sent) onceOut.delete(appSessionId);
  }
}

/** What is kept for the member there, as the take-back reads it (null: none, or cleared). */
export async function readRemoteDraft(client: MawsBridge, appSessionId: AppSessionId): Promise<CommandResult<'session.drafts.get'>> {
  return readKept(client, appSessionId);
}
