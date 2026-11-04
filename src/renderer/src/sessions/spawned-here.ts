// The spawned-here lead (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, *The sidebar row*; the
// Decision Log's "A session spawned from this app leads its sidebar group until its first turn ends", the architect's
// ruling of 2026-11-04, a sidebar-order change made in the owner's place, which the owner can overrule). A session this
// window started, on this machine (a New chat's first Send) or another (`session.spawn`), leads its sidebar group until
// its first turn ends; after that it ranks by its state, and Resume… reaches it past the cap. `leading` is the set the
// sidebar's order reads (`sidebar/derive.ts`, `leadsAsSpawned`); dropping the rule is emptying it.
//
// When the first turn has ended, by the most authoritative word held:
// - attached (the session's status or digest is held here): the status, once it said a turn ran, saying none runs; the
//   digest saying a turn ended (`lastTurnEndedAt`); or its process failed or exited;
// - by its listing alone: once seen `busy`, a resting word (a listing may be posted `idle` before the engine took the
//   brief, and `waiting` is a prompt inside the turn); never seen busy, a resting listing issued again (sminos issues a
//   listing anew at each change of its state, so a short turn passed between); a word that the session ended;
// - with nothing attached, LISTING_LEAD_MS after the spawn at the latest (the architect's review ruling: never forever;
//   long enough to keep a just-started session in view while its first answer comes).
// A start that failed (its setup's `failed`), or whose provisional record was removed, ends its lead at once. The marks
// are this window's memory: a reload, or another window, ranks the session by its state alone (a known limit, ruled).
import { create } from 'zustand';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { useSessions, type ListedSession } from '../stores/sessions';
import { useSetup } from './store';

export const useSpawnedHere = create<{ leading: ReadonlySet<AppSessionId> }>()(() => ({ leading: new Set() }));

export const LISTING_LEAD_MS = 3 * 60_000;

interface Mark {
  at: number; // when it was spawned
  busySeen: boolean; // its listing said `busy`
  turnSeen: boolean; // its status said a turn runs
  firstRevision: number | null; // the first listing revision seen
  recordSeen: boolean;
}
interface Held {
  records: ReadonlyMap<AppSessionId, SessionRecord>;
  digests: ReadonlyMap<AppSessionId, SessionDigest>;
  engine: ReadonlyMap<AppSessionId, EngineSessionStatus>;
  listed: ReadonlyMap<AppSessionId, ListedSession>;
}

const marks = new Map<AppSessionId, Mark>();
const ENDED = new Set(['done', 'stopped', 'failed', 'retired']); // sminos's words for a session that ended
const RESTING = new Set(['idle', ...ENDED]);
let offSessions: (() => void) | null = null;
let offSetup: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function leadEnded(id: AppSessionId, mark: Mark, held: Held, now: number): boolean {
  if (useSetup.getState().phases.get(id)?.phase === 'failed') return true;
  if (held.records.has(id)) mark.recordSeen = true;
  else if (mark.recordSeen && !held.listed.has(id)) return true; // its provisional record was removed
  const status = held.engine.get(id);
  const digest = held.digests.get(id);
  if (status !== undefined) {
    if (status.turn !== null) mark.turnSeen = true;
    else if (mark.turnSeen) return true;
  }
  if (digest !== undefined && (digest.lastTurnEndedAt !== null || digest.phase === 'failed' || digest.phase === 'exited')) return true;
  if (status !== undefined || digest !== undefined) return false; // attached: its own word will come
  const listed = held.listed.get(id);
  if (listed !== undefined) {
    if (listed.state === 'busy') mark.busySeen = true;
    mark.firstRevision ??= listed.revision;
    if (ENDED.has(listed.state)) return true;
    if (RESTING.has(listed.state) && (mark.busySeen || listed.revision > mark.firstRevision)) return true;
  }
  return now - mark.at >= LISTING_LEAD_MS;
}

function settle(): void {
  const held = useSessions.getState();
  const now = Date.now();
  let changed = false;
  for (const [id, mark] of marks) {
    if (!leadEnded(id, mark, held, now)) continue;
    marks.delete(id);
    changed = true;
  }
  if (changed) publish();
  schedule(now);
}

// A wake at the next mark's bound still ahead (an attached mark past its own keeps its lead, and needs none).
function schedule(now: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const ahead = [...marks.values()].map((mark) => mark.at + LISTING_LEAD_MS).filter((at) => at > now);
  if (ahead.length > 0) timer = setTimeout(settle, Math.min(...ahead) - now);
}

function publish(): void {
  useSpawnedHere.setState({ leading: new Set(marks.keys()) });
  if (marks.size === 0) {
    offSessions?.();
    offSetup?.();
    offSessions = offSetup = null;
    return;
  }
  offSessions ??= useSessions.subscribe((state, previous) => {
    if (state.digests !== previous.digests || state.listed !== previous.listed || state.engine !== previous.engine || state.records !== previous.records) settle();
  });
  offSetup ??= useSetup.subscribe((state, previous) => {
    if (state.phases !== previous.phases) settle();
  });
}

/** A session this window just started: it leads its sidebar group until its first turn ends. */
export function markSpawnedHere(appSessionId: AppSessionId): void {
  if (marks.has(appSessionId)) return;
  marks.set(appSessionId, { at: Date.now(), busySeen: false, turnSeen: false, firstRevision: null, recordSeen: false });
  publish();
  settle(); // also arms its bound
}

/** Tests only: forgets every mark. */
export function resetSpawnedHere(): void {
  marks.clear();
  publish();
  schedule(Date.now());
}
