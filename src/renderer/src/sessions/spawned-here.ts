// The spawned-here lead (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, *The sidebar row*; the
// Decision Log's "A session spawned from this app leads its sidebar group until its first turn ends", the architect's
// ruling of 2026-11-04, a sidebar-order change made in the owner's place, which the owner can overrule). A session this
// window started, on this machine (a New chat's first Send) or another (`session.spawn`), leads its sidebar group until
// its first turn ends; after that it ranks by its state, and Resume… reaches it past the cap. `leading` is the set the
// sidebar's order reads (`sidebar/derive.ts`, `leadsAsSpawned`); dropping the rule is emptying it.
//
// The first turn has ended when the session's digest says a turn ended (`lastTurnEndedAt`), or its process failed or
// exited; for a listed row with no record, when its listing, once seen `busy`, says it rests (a listing may be posted
// `idle` before the engine took the brief, and `waiting` is a prompt inside the turn), or says the session ended. The
// marks are this window's memory: a reload, or another window, ranks the session by its state alone.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { useSessions, type ListedSession } from '../stores/sessions';

export const useSpawnedHere = create<{ leading: ReadonlySet<AppSessionId> }>()(() => ({ leading: new Set() }));

const marks = new Map<AppSessionId, { busySeen: boolean }>();
const ENDED = new Set(['done', 'stopped', 'failed', 'retired']); // sminos's words for a session that ended
const RESTING = new Set(['idle', ...ENDED]);
let unsubscribe: (() => void) | null = null;

function firstTurnEnded(mark: { busySeen: boolean }, digest: SessionDigest | undefined, listed: ListedSession | undefined): boolean {
  if (digest !== undefined) return digest.lastTurnEndedAt !== null || digest.phase === 'failed' || digest.phase === 'exited';
  if (listed === undefined) return false;
  if (listed.state === 'busy') mark.busySeen = true;
  return ENDED.has(listed.state) || (mark.busySeen && RESTING.has(listed.state));
}

function settle({ digests, listed }: { digests: ReadonlyMap<AppSessionId, SessionDigest>; listed: ReadonlyMap<AppSessionId, ListedSession> }): void {
  let changed = false;
  for (const [id, mark] of marks) {
    if (!firstTurnEnded(mark, digests.get(id), listed.get(id))) continue;
    marks.delete(id);
    changed = true;
  }
  if (changed) publish();
}

function publish(): void {
  useSpawnedHere.setState({ leading: new Set(marks.keys()) });
  if (marks.size > 0 && unsubscribe === null) {
    unsubscribe = useSessions.subscribe((state, previous) => {
      if (state.digests !== previous.digests || state.listed !== previous.listed) settle(state);
    });
  } else if (marks.size === 0 && unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }
}

/** A session this window just started: it leads its sidebar group until its first turn ends. */
export function markSpawnedHere(appSessionId: AppSessionId): void {
  if (marks.has(appSessionId)) return;
  marks.set(appSessionId, { busySeen: false });
  publish();
  settle(useSessions.getState());
}

/** Tests only: forgets every mark. */
export function resetSpawnedHere(): void {
  marks.clear();
  publish();
}
