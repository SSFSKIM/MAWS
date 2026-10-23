// The floating card's pill (P3-G execution document, §D1.4): what Close leaves, the session's title and, while the
// session's record is unread, the sidebar's dot; a click brings the card back. The card's layer draws it at its body's
// bottom right (P4-B3, its Decision Log 9: both cards and both pills at the bottom right). Over a Browser tab the page is
// a native view drawn over the DOM, so a pill there would be under the page: the browser's chrome draws it at the right
// end of its tab row instead (`ChromePill`, the coordinator's ruling on P3-G M2), and the layer draws none while a
// chrome hosts it. The panel's pane's chrome hosts the panel card's pill, a main tab's chrome the split card's.
import { useLayoutEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { CARD_MARGIN, cardOver, cardSession, focusCompactCard, openCard, splitFloat, useFloatingCard } from './floating';
import { currentSet } from '../stores/layout-model';
import { SessionPane } from '../session/SessionPane';

export const useSessionTitle = (appSessionId: AppSessionId) => useSessions((s) => displayTitle(s.records.get(appSessionId)));

// `floating`: at its layer's bottom right, over the tool or the pane; `inline`: in a row of controls (the browser's tab row), at
// the row's chip height. The first pill to mount after the card's Close takes the keyboard (P3-F): in one commit the
// chrome's comes before the layer's, which goes once the chrome hosts the pill.
export function Pill({ appSessionId, placement }: { appSessionId: AppSessionId; placement: 'floating' | 'inline' }) {
  const title = useSessionTitle(appSessionId);
  const unread = useSessions((s) => s.records.get(appSessionId)?.unread === true);
  const self = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!useFloatingCard.getState().pillTakesFocus) return;
    useFloatingCard.setState({ pillTakesFocus: false });
    self.current?.focus();
  }, []);
  const paneIndex = useLayout((s) => splitFloat(s.main)?.pane ?? currentSet(s.main).focusedPane);
  const place = placement === 'floating' ? 'h-7 w-full rounded-t-lg' : 'h-6 shrink-0 rounded-full border border-border-strong';
  const titleButton = (
    <button
      ref={self}
      type="button"
      aria-label="Show session card"
      title={unread ? `${title} · Unread` : title}
      data-floating-pill={placement}
      onClick={openCard}
      className={`inline-flex items-center gap-2 bg-bg-raised px-3 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 ${place}`}
    >
      <span className="max-w-[220px] truncate">{title}</span>
      {unread && <span aria-label="Unread" role="img" className="block size-[5px] shrink-0 rounded-full bg-info" />}
    </button>
  );
  // Native browser surfaces keep their inline title until the shell's native-view layout is revisited.
  if (placement === 'inline') return titleButton;
  return <section
    role="region"
    aria-label="Compact session composer"
    data-pane="card"
    data-compact-session={appSessionId}
    className="pointer-events-auto absolute flex max-h-[calc(100%-32px)] flex-col overflow-hidden rounded-lg border border-border-strong bg-bg shadow-float"
    style={{ right: CARD_MARGIN, bottom: CARD_MARGIN, width: 420, maxWidth: `calc(100% - ${2 * CARD_MARGIN}px)` }}
  >
    {titleButton}
    <div className="min-h-0 overflow-y-auto" onPointerDownCapture={focusCompactCard} onFocusCapture={focusCompactCard}>
      <SessionPane key={appSessionId} appSessionId={appSessionId} paneIndex={paneIndex} compact />
    </div>
  </section>;
}

// The pill in a browser chrome's row, while the card over its surface is closed: the chrome renders it only where its
// pane holds the page. Hosting it tells the layer to draw none (before paint, so no frame shows two).
export function ChromePill({ surface }: { surface: 'panel' | 'main' }) {
  const session = useLayout((s) => (cardOver(s, surface) ? cardSession(s) : null));
  const closed = useFloatingCard((s) => s.closed);
  const shown = session !== null && closed;
  useLayoutEffect(() => (shown ? useFloatingCard.getState().hostPill() : undefined), [shown]);
  return shown ? <Pill appSessionId={session} placement="inline" /> : null;
}
