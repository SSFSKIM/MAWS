// Where a session's `/btw` card is drawn (UX wave U4b, M2; docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md,
// decision 4, Interfaces B; the child's O-20, "Where"): the card column's foot exactly while the column is shown for this
// session and the session is not the one the floating card, its pill or the bar draws; the session's own pane otherwise.
// It reads the column's one source (`useCardColumn`: `shown`, not `placed`, so a page sends the card back to the pane it
// covers) and the floated session (`cardSession`), and decides nothing they do not. It does not read the shell's edge
// drag: for the drag's length the column is hidden, still mounted, with the card inside it.
import type { AppSessionId } from '@shared/graph/ids';
import { useCardColumn, type CardColumn } from '../app/shell-view';
import { cardSession } from '../shell/floating';
import { useLayout } from '../stores/layout';

export type BtwPlace = 'foot' | 'pane';

/** Where a session's `/btw` card is drawn: the card column's foot, or the session's own pane. */
export function btwPlace(column: Pick<CardColumn, 'shown' | 'session'>, floated: AppSessionId | null, appSessionId: AppSessionId): BtwPlace {
  return column.shown && column.session === appSessionId && floated !== appSessionId ? 'foot' : 'pane';
}

/** The same, followed in a render: `useCardColumn()` and `useLayout(cardSession)`. */
export function useBtwPlace(appSessionId: AppSessionId): BtwPlace {
  const column = useCardColumn();
  const floated = useLayout(cardSession);
  return btwPlace(column, floated, appSessionId);
}
