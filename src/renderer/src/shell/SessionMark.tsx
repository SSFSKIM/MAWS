// UX wave U10b (O-43; its execution document §F.3, M7 decision 6, B5): the session's mark on the bar's Open conversation
// and on Show chat, the one its sidebar row shows: a request waiting (the glyph of a session that needs approval), else
// unread (the row's dot). Waiting wins over unread; one mark at a time.
import type { AppSessionId } from '@shared/graph/ids';
import { waitingItem } from '../attention/derive';
import { SIDE_COPY } from '../side/copy';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';

export type SessionMarkKind = 'waiting' | 'unread';

// What the mark shows, in words for assistive technology (the architect's ruling of 2026-11-15): the side card's words
// for a session waiting on you, and the unread dot's own label.
export const SESSION_MARK_WORDS: Record<SessionMarkKind, string> = { waiting: SIDE_COPY.card.needs.other, unread: 'Unread' };

export function useSessionMark(appSessionId: AppSessionId): SessionMarkKind | null {
  const waiting = useAttention((s) => waitingItem(selectPendingOf(s, appSessionId))?.tier === 1);
  const unread = useSessions((s) => s.records.get(appSessionId)?.unread === true);
  return waiting ? 'waiting' : unread ? 'unread' : null;
}

// Drawn beside a control's own words or glyph; the control's name stays its own.
export function SessionMark({ mark, className = '' }: { mark: SessionMarkKind; className?: string }) {
  return mark === 'waiting' ? (
    <span aria-hidden data-session-mark="waiting" className={`text-ui-sm leading-none text-warning ${className}`}>
      ◐
    </span>
  ) : (
    <span aria-hidden data-session-mark="unread" className={`block size-[5px] rounded-full bg-info ${className}`} />
  );
}
