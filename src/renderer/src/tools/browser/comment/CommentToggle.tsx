// E4d (Task 3.1): the chrome's Comment toggle (E4d execution document, Design §2), registered into E4a's extras slot so
// it sits in the navigation row before the overflow menu in both surfaces. Pressed while main has the tab armed (the
// comment-mode store); a click asks main to arm or disarm; disabled, with the reason as its label (IconButton's label is
// its tooltip too), while the agent holds the page or there is no page to pick on.
//
// While armed, a plain Escape whose target is inside this chrome leaves the mode. The listener runs in the capture phase
// on `window`, ahead of the chrome's own handlers: the address field and the find bar take their Escape with
// `preventDefault`, and one Escape there both ends their edit and leaves the mode. An Escape inside the page is main's
// (`before-input-event`); one elsewhere in the window (the composer, a menu in a portal) is not the chrome's.
import type { BrowserTab } from '@shared/browser/tab';
import { useEffect, useRef } from 'react';
import { IconButton } from '../../../app/IconButton';
import type { ChromeExtraProps } from '../extras';
import { COMMENT_COPY } from './copy';
import { CommentIcon } from './icons';
import { setCommentMode, useCommentMode } from './store';

// Why the tab cannot be commented on now, as the toggle's label says it, or null.
export function commentUnavailable(tab: BrowserTab): string | null {
  if (tab.control === 'agent') return COMMENT_COPY.toggleAgent;
  if (tab.suspended || tab.url === '' || tab.loadError !== null || tab.crashed !== null || tab.failed !== null) return COMMENT_COPY.toggleNoPage;
  return null;
}

const plainEscape = (event: KeyboardEvent) =>
  event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.isComposing && !event.defaultPrevented;

export function CommentToggle({ tab }: ChromeExtraProps) {
  const { tabId } = tab;
  const armed = useCommentMode((s) => s.armed.has(tabId));
  const unavailable = commentUnavailable(tab);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const chrome = button.current?.closest('[data-browser-chrome]');
      if (!plainEscape(event) || !chrome || !(event.target instanceof Node) || !chrome.contains(event.target)) return;
      void setCommentMode(tabId, false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [armed, tabId]);

  return (
    <IconButton
      ref={button}
      label={unavailable ?? COMMENT_COPY.toggle}
      pressed={armed}
      disabled={unavailable !== null}
      data-browser-comment=""
      onClick={() => void setCommentMode(tabId, !armed)}
    >
      <CommentIcon />
    </IconButton>
  );
}
