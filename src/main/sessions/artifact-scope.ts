// P2-E1 G4 (P2-E1 execution document, D10; P2 Decision Log 9): a side thread's artifact scope as `session.launch` carries
// it, resolved over the index at every launch (the intent's lineage, a resume's record). The chain itself is shared since
// P2-F L122 (`@shared/maws/artifact-scope`), so the window's `show_pane` resolves a deliverable target over the same
// ancestors.
import type { AppSessionId } from '@shared/graph/ids';
import type { Lineage } from '@shared/graph/session';
import { artifactScopeOf } from '@shared/maws/artifact-scope';
import type { SessionStore } from '../index/sessions';

// The `session.launch` input's scope field for a launch with this lineage: absent when the chain is empty, so every launch
// other than a side thread's sends the input it sent before.
export function launchScopeOf(sessions: Pick<SessionStore, 'get'>, lineage: Lineage | null): { artifactScope?: AppSessionId[] } {
  const artifactScope = artifactScopeOf(sessions, lineage);
  return artifactScope.length > 0 ? { artifactScope } : {};
}
