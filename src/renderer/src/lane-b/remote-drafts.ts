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
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { Draft } from '@shared/ipc/schema/session';
import { heardReaderRows } from './reader-rows';

/** A session's saves not yet taken: the newest draft handed to `save`, whether a save is out, and whether one waits. */
type Saves = { latest: Draft | null; out: boolean; waiting: boolean; refused(draft: Draft | null): void };
const saves = new Map<AppSessionId, Saves>();

export function resetRemoteDraftSaves(): void {
  saves.clear();
}

/** The newest draft handed to a save of the session that the machine hasn't taken; undefined when none is. */
export const unsavedRemoteDraft = (appSessionId: AppSessionId): Draft | null | undefined => saves.get(appSessionId)?.latest;

/** The session's saves here end, unanswered ones included: a newer save went to the caller's fallback. */
export function dropRemoteDraftSaves(appSessionId: AppSessionId): void {
  saves.delete(appSessionId);
}

/** The member's draft there, or the one still being saved; `refused`, the fallback's, if the machine offers none. */
export async function loadRemoteDraft(client: MawsBridge, appSessionId: AppSessionId, refused: () => Draft | null): Promise<Draft | null> {
  const unsaved = unsavedRemoteDraft(appSessionId);
  if (unsaved !== undefined) return unsaved;
  const result = await client.invoke('session.drafts.get', { appSessionId });
  const heard = heardReaderRows(appSessionId, result);
  if (result.ok) return result.value;
  if (heard === 'refused') return refused();
  console.warn('[composer] the draft could not be read from its machine', result.error.message);
  return null;
}

/** The draft saved there after the session's saves before it; `refused` takes the newest if the machine offers none. */
export function saveRemoteDraft(client: MawsBridge, appSessionId: AppSessionId, draft: Draft | null, refused: (draft: Draft | null) => void): void {
  const held = saves.get(appSessionId);
  const queue = held ?? { latest: draft, out: false, waiting: false, refused };
  if (held === undefined) saves.set(appSessionId, queue);
  queue.latest = draft;
  queue.waiting = true;
  queue.refused = refused;
  if (!queue.out) void pump(client, appSessionId, queue);
}

async function pump(client: MawsBridge, appSessionId: AppSessionId, queue: Saves): Promise<void> {
  queue.out = true;
  let taken = false;
  while (queue.waiting && saves.get(appSessionId) === queue) {
    queue.waiting = false;
    const result = await client.invoke('session.drafts.set', { appSessionId, draft: queue.latest });
    if (saves.get(appSessionId) !== queue) return; // dropped (a newer save went to the fallback) or reset: nothing to hand on
    if (heardReaderRows(appSessionId, result) === 'refused') {
      saves.delete(appSessionId);
      return queue.refused(queue.latest);
    }
    taken = result.ok;
    if (!result.ok) console.warn('[composer] the draft was not kept on its machine', result.error.message);
  }
  queue.out = false;
  if (taken && saves.get(appSessionId) === queue) saves.delete(appSessionId);
}
