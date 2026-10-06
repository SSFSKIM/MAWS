// The side-thread rows of a parent's transcript (E3 execution document, Design §5): two X1 events main synthesises into
// the parent's stream (`seq: null`, ids under the parent's app id, so `isAppSynthesised` holds and the renderer's
// live-wins filter passes them). `side.thread.opened` is emitted once the launch binds (`finishBinding`, setup.ts);
// `side.thread.summarised` by the tap below, once per live turn end of a side thread. Both mirror the index's
// `side_threads` row, from which `sideThreadEvents` re-synthesises them for a transcript's snapshot with the ids and
// times the live run emitted (so they bypass the read model's capped store of app events).
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId, SessionId } from '@shared/graph/ids';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import type { Emit, HostEvents } from '../sessions/context';
import type { SideThreadRow, SideThreadStore } from '../index/side-threads';

// The title a `/btw` promotion's thread takes (a comment's takes its anchor's label).
export const SIDE_QUESTION_TITLE = 'Side question';

// A side thread's name: what `finishBinding` renames it to through the engine, and (M5) the first prompt its record is
// seeded with, so the row is never titled by the anchored text (its lead, preamble and tag) before the engine's title
// is read back from its store.
export function sideThreadTitle(lineage: Pick<Lineage, 'openedBy' | 'anchor'>): string {
  return lineage.openedBy === 'btw' ? SIDE_QUESTION_TITLE : lineage.anchor?.label.trim() || SIDE_QUESTION_TITLE;
}

export const isSideThreadEvent = (event: SessionEvent): boolean => event.kind === 'side.thread.opened' || event.kind === 'side.thread.summarised';

const SUMMARY_MAX = 400;
const SUMMARY_CUT_FROM = 200;

// A turn's result text as the row shows it: whole up to 400 characters; longer, cut at the first sentence end (kept)
// or line end (dropped) past 200, else at 400 with an ellipsis. A sentence end is `.`, `!` or `?` before whitespace or
// the end, and not an abbreviation's dot (`e.g.`), so a path, a number or an abbreviation is never cut mid-token.
const SENTENCE_OR_LINE_END = /(?<!\.\w)[.!?](?=\s|$)|\n/g;

export function summaryText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  SENTENCE_OR_LINE_END.lastIndex = SUMMARY_CUT_FROM;
  const end = SENTENCE_OR_LINE_END.exec(trimmed);
  if (end !== null && end.index < SUMMARY_MAX) return trimmed.slice(0, end.index + (end[0] === '\n' ? 0 : 1)).trimEnd();
  return `${trimmed.slice(0, SUMMARY_MAX - 1)}…`;
}

// The parent's stream as a side thread's lineage names it (stable across the parent's `/clear`); null for a record that
// is no side thread, which has no rows.
function threadOf(child: SessionRecord): { parent: AppSessionId; sessionId: SessionId; openedBy: 'comment' | 'btw' } | null {
  const lineage = child.lineage;
  if (lineage?.kind !== 'side-thread' || lineage.parentEngineSessionId === null || lineage.openedBy === 'fork') return null;
  return { parent: lineage.parentAppSessionId, sessionId: lineage.parentEngineSessionId, openedBy: lineage.openedBy };
}

const base = (parent: AppSessionId, sessionId: SessionId, id: string, at: string) => ({ id: `${parent}:side-thread:${id}` as EventId, sessionId, at, seq: null, agentId: null, parentToolUseId: null });

export function openedEvent(row: SideThreadRow, child: SessionRecord): SessionEvent | null {
  const thread = threadOf(child);
  if (thread === null) return null;
  return {
    ...base(thread.parent, thread.sessionId, `${row.childAppSessionId}:opened`, row.openedAt),
    kind: 'side.thread.opened',
    childAppSessionId: row.childAppSessionId,
    childEngineSessionId: child.engineSessionId,
    anchor: child.lineage?.anchor ?? null,
    openedBy: thread.openedBy,
  };
}

export function summarisedEvent(row: SideThreadRow, child: SessionRecord): SessionEvent | null {
  const thread = threadOf(child);
  if (thread === null || row.turns === 0 || row.summarisedAt === null) return null;
  return {
    ...base(thread.parent, thread.sessionId, `${row.childAppSessionId}:summarised:${row.turns}`, row.summarisedAt),
    kind: 'side.thread.summarised',
    childAppSessionId: row.childAppSessionId,
    text: row.text,
    isError: row.isError,
    turns: row.turns,
  };
}

interface Stores {
  sessions: { get(appId: AppSessionId): SessionRecord | null };
  sideThreads: SideThreadStore;
}

// What a snapshot of the parent's transcript gets from the index: per thread, its `opened` and its latest summary.
export function sideThreadEvents(stores: Stores, parent: AppSessionId): SessionEvent[] {
  return stores.sideThreads.of(parent).flatMap((row) => {
    const child = stores.sessions.get(row.childAppSessionId);
    if (child === null) return [];
    return [openedEvent(row, child), summarisedEvent(row, child)].filter((event): event is SessionEvent => event !== null);
  });
}

// A turn end the row counts: live (`seq` set; the disk follower re-emits a backfill's synthesised turn ends with none),
// the session's own (no agent), a real turn (not the echo of a frame that started none), started by the human or
// unknown (not an engine-initiated task notification).
type TurnEnded = Extract<SessionEvent, { kind: 'turn.ended' }>;
const counts = (event: SessionEvent): event is TurnEnded =>
  event.kind === 'turn.ended' && event.seq !== null && event.agentId === null && event.parentToolUseId === null && !event.isEchoReceipt && (event.origin === 'human' || event.origin === null);

export interface SideThreadsDeps extends Stores {
  onEvent: HostEvents;
  emit: Emit;
  log?: (message: string) => void;
}

// The tap on the engine host's batches: each counted turn end of a side thread updates its row and emits the summary
// into the parent's stream. A turn that ends before the launch's binding wrote the row writes it (at the turn's time),
// so the binding's `opened` then carries that time and the snapshot agrees with what was emitted.
export function startSideThreads(deps: SideThreadsDeps): () => void {
  const log = deps.log ?? ((message: string) => console.warn(`[side] ${message}`));
  return deps.onEvent('session.eventBatch', ({ appSessionId, events }) => {
    const ended = events.filter(counts);
    if (ended.length === 0) return;
    const childId = appSessionId as AppSessionId;
    try {
      const child = deps.sessions.get(childId);
      const thread = child === null ? null : threadOf(child);
      if (child === null || thread === null) return;
      const summaries: SessionEvent[] = [];
      for (const event of ended) {
        deps.sideThreads.opened(childId, thread.parent, event.at);
        const row = deps.sideThreads.summarised(childId, { id: event.id, at: event.at, text: event.resultText === null ? null : summaryText(event.resultText), isError: event.isError });
        const summary = row === null ? null : summarisedEvent(row, child);
        if (summary !== null) summaries.push(summary);
      }
      if (summaries.length > 0) deps.emit('session.eventBatch', { appSessionId: thread.parent, events: summaries });
    } catch (error) {
      log(`${childId}: the side thread's summary was not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
