// P2-E1 G4 (P2-E1 execution document, D10; P2 Decision Log 9): the sessions whose artifacts a side thread sees besides
// its own. A-39's tab-sharing rule applied to artifacts: a side thread reaches its parent's, and a thread of a thread
// reaches every side-thread ancestor up to the family root, nearest first, so the root's artifact is found through the
// chain. Main resolves it at every launch over the index (`session.launch {spec, artifactScope}`, never stored by the
// host); P2-F L122: the window resolves the same chain over its session records for `show_pane`'s deliverable target.
import type { AppSessionId } from '../graph/ids';
import type { Lineage } from '../graph/session';

// As many links as `session.launch` admits (its `artifactScope` is capped at the same count).
export const ARTIFACT_SCOPE_MAX_LINKS = 16;

// Where a session's lineage is read: main's index, or the window's session records.
export interface LineageSource {
  get(appSessionId: AppSessionId): { lineage: Lineage | null } | null | undefined;
}

// The ancestors of a session with this lineage, nearest first: each side thread's parent, continuing while that parent is
// itself a side thread, so the first parent that is not (the family root) ends the chain, included. A root or a fork
// answers []; a parent missing from the source, or a source that cannot be read, ends the chain with the last one found;
// a repeated id and the link cap end it too.
export function artifactScopeOf(sessions: LineageSource, lineage: Lineage | null): AppSessionId[] {
  const chain: AppSessionId[] = [];
  let link = lineage;
  while (link?.kind === 'side-thread' && chain.length < ARTIFACT_SCOPE_MAX_LINKS && !chain.includes(link.parentAppSessionId)) {
    const parent = link.parentAppSessionId;
    chain.push(parent);
    try {
      link = sessions.get(parent)?.lineage ?? null;
    } catch {
      break; // the source cannot be read: the chain so far
    }
  }
  return chain;
}
