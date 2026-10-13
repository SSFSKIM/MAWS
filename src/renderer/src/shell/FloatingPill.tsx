// The floating card's pill (P3-G execution document, §D1.4): what Close leaves, the session's title and, while the
// session's record is unread, the sidebar's dot; a click brings the card back. The card's layer draws it at the panel
// body's bottom left. Over a Browser tab in the panel the page is a native view drawn over the DOM, so a pill there would
// be under the page: the browser's chrome draws it at the right end of its tab row instead (`ChromePill`, the
// coordinator's ruling on M2), and the layer draws none while a chrome hosts it.
import { useLayoutEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { CARD_MARGIN, cardSession, openCard, useFloatingCard } from './floating';

export const useSessionTitle = (appSessionId: AppSessionId) => useSessions((s) => displayTitle(s.records.get(appSessionId)));

// `floating`: at the panel body's bottom left, over the tool; `inline`: in a row of controls (the browser's tab row), at
// the row's chip height.
export function Pill({ appSessionId, placement }: { appSessionId: AppSessionId; placement: 'floating' | 'inline' }) {
  const title = useSessionTitle(appSessionId);
  const unread = useSessions((s) => s.records.get(appSessionId)?.unread === true);
  const place = placement === 'floating' ? 'pointer-events-auto absolute h-7 shadow-float' : 'h-6 shrink-0';
  return (
    <button
      type="button"
      aria-label="Show session card"
      title={unread ? `${title} · Unread` : title}
      data-floating-pill={placement}
      onClick={openCard}
      style={placement === 'floating' ? { left: CARD_MARGIN, bottom: CARD_MARGIN } : undefined}
      className={`inline-flex items-center gap-2 rounded-full border border-border-strong bg-bg-raised px-3 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 ${place}`}
    >
      <span className="max-w-[220px] truncate">{title}</span>
      {unread && <span aria-label="Unread" role="img" className="block size-[5px] shrink-0 rounded-full bg-info" />}
    </button>
  );
}

// The pill in a browser chrome's row, while the card is closed: the chrome renders it only where its pane holds the page
// in the panel. Hosting it tells the layer to draw none (before paint, so no frame shows two).
export function ChromePill() {
  const session = useLayout(cardSession);
  const closed = useFloatingCard((s) => s.closed);
  const shown = session !== null && closed;
  useLayoutEffect(() => (shown ? useFloatingCard.getState().hostPill() : undefined), [shown]);
  return shown ? <Pill appSessionId={session} placement="inline" /> : null;
}
