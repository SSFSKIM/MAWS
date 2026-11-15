// UX wave U10b (M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.1 and §C.2): the mark an agent's delete
// of its own draft rests on. One key per artifact a session made, `agentDraft:<artifactId>` in the store's `meta` table,
// written in the batch that inserts the artifact (store.ts) and kept in step, in the batch of each content row of the
// artifact's own document or of its suggestion document, by the two places a row is appended (storage.ts). Nothing stored
// elsewhere says durably that no person wrote to an artifact (the log is pruned, a deletion alone binds no client), so
// the mark fails closed: a person's row breaks it for good, and so does any row it did not account for, which is what a
// stay under an older build leaves (that build appends rows and never reads or writes the key: it reads `meta` by key
// only). An artifact with no mark, or a mark that lags its newest row, is not deletable by an agent.
//
// The prune never removes a document's newest row (`pruneLog`), so whether the mark names the pair's newest row stays
// checkable after a checkpoint and a prune. The agent's delete records itself in the same key (`deleted`), which the
// undelete requires and removes. Entity changes (a rename, a move, a pin) append no content row and are not counted.
import * as z from 'zod';
import { actorKey, type Actor } from '@shared/artifacts/actor';

export const agentDraftKey = (artifactId: string): string => `agentDraft:${artifactId}`;

const AgentDraftMarkSchema = z.looseObject({
  by: z.string(), // the creating session's actor key, `session:<id>`
  seq: z.number().int().min(0), // the sequence of the last content row the mark accounts for; 0 before the first
  broken: z.enum(['person', 'unaccounted']).optional(), // set once and never cleared
  deleted: z.strictObject({ at: z.number(), by: z.string() }).optional(), // set by the agent's delete, removed by the undelete
});
export type AgentDraftMark = z.infer<typeof AgentDraftMarkSchema>;

// The mark a session's create writes.
export const newMark = (creator: Actor): AgentDraftMark => ({ by: actorKey(creator), seq: 0 });

// The stored mark, or null when there is none or it cannot be read (an unreadable mark accounts for nothing: it fails
// closed, as no mark does).
export function readMark(raw: string | null): AgentDraftMark | null {
  if (raw === null) return null;
  try {
    const parsed = AgentDraftMarkSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The mark after one content row of the pair, given `newest`, the pair's newest sequence before the row: broken
// `unaccounted` when the mark does not name that row, else broken `person` for a person's row, else at the row.
export function markAfterRow(mark: AgentDraftMark, newest: number, row: { actor: Actor; seq: number }): AgentDraftMark {
  if (mark.broken !== undefined) return mark;
  if (mark.seq !== newest) return { ...mark, broken: 'unaccounted' };
  if (row.actor.kind === 'human') return { ...mark, broken: 'person' };
  return { ...mark, seq: row.seq };
}

// Whether the mark stands against the pair's newest sequence now (0 when it has no rows); no mark never does.
export const markStands = (mark: AgentDraftMark, newest: number): boolean => mark.broken === undefined && mark.seq === newest;
