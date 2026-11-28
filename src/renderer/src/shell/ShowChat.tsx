// UX wave U10b (O-43; its execution document §F.1, M7 decision 7, B9): "Show chat", while the chat over an artifact is
// hidden. A labelled button, words at every width, with the session's mark; in the artifact's header directly before
// Restore split (`main/Pane.tsx`, for the split's float) and in the side column's controls directly before the float
// control (`panel/PanelHeader.tsx`, for the panel's float). It brings the bar back (`showChat`); after Hide chat it has
// the keyboard. Absent while the chat is the bar or the card. Its description says what the mark shows.
import { useLayoutEffect, useRef } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useLayout } from '../stores/layout';
import { cardHost, cardSession, chatPresentation, showChat, useFloatingCard, type CardHost } from './floating';
import { SESSION_MARK_WORDS, SessionMark, useSessionMark, useSessionMarkCalm } from './SessionMark';

export function ShowChat({ host }: { host: CardHost }) {
  const session = useLayout((s) => (cardHost(s) === host ? cardSession(s) : null));
  const hidden = useFloatingCard((s) => chatPresentation(s) === 'hidden');
  return session !== null && hidden ? <ShowChatButton appSessionId={session} /> : null;
}

function ShowChatButton({ appSessionId }: { appSessionId: AppSessionId }) {
  const mark = useSessionMark(appSessionId);
  const calm = useSessionMarkCalm(appSessionId); // L5
  const self = useRef<HTMLButtonElement>(null);
  // Hide chat unmounted the focused bar: the Show chat that mounts next takes the keyboard, once
  useLayoutEffect(() => {
    if (!useFloatingCard.getState().showChatTakesFocus) return;
    useFloatingCard.setState({ showChatTakesFocus: false });
    self.current?.focus();
  }, []);
  return (
    <button
      ref={self}
      type="button"
      data-show-chat=""
      aria-description={mark ? SESSION_MARK_WORDS[mark] : undefined}
      onClick={showChat}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-ui-sm whitespace-nowrap text-fg outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover focus-visible:outline-2"
    >
      Show chat
      {mark && <SessionMark mark={mark} calm={calm} />}
    </button>
  );
}
