// E4a (Task 3.3): who has the page (Design §4 "Control slot", §11; A-31): nothing while idle, "Agent is browsing" with a
// pulse while the agent drives it, "You have the page" with Hand back while the human holds it after taking it over.
// cua #103: human ownership is a separate accent strip below navigation; the takeover grace releases commands without
// hiding it. Below 480 px the label collapses to the person icon; Hand back is always present.
import { useLayoutEffect, useRef, useState } from 'react';
import type { BrowserTab } from '@shared/browser/tab';
import { handBack } from '../actions';
import { BROWSER_COPY } from '../copy';
import { PersonIcon } from '../icons';

export function ControlSlot({ tab }: { tab: BrowserTab }) {
  const root = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const chrome = root.current?.closest('[data-browser-chrome]');
    if (!chrome) return;
    const measure = () => {
      const width = chrome.getBoundingClientRect().width;
      setCompact(width > 0 && width < 480);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(chrome);
    return () => observer?.disconnect();
  }, [tab.control]);
  if (tab.control === 'idle') return null;
  if (tab.control === 'agent') {
    return (
      <span ref={root} data-browser-control="agent" role="status" className="flex shrink-0 items-center gap-1.5 px-1.5 text-ui-sm text-fg-muted">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
        {BROWSER_COPY.control.agentBrowsing}
      </span>
    );
  }
  return (
    <span ref={root} data-browser-control="human" role="status" aria-label={BROWSER_COPY.control.humanHasPage} className="flex shrink-0 items-center gap-2 border-t border-l-2 border-accent bg-accent-soft px-2 py-1 text-ui font-medium text-fg">
      <PersonIcon className="size-4 shrink-0" />
      {!compact && <span>{BROWSER_COPY.control.humanHasPage}</span>}
      <button
        type="button"
        onClick={() => handBack(tab.tabId)}
        className="ml-auto h-6 shrink-0 rounded-sm border border-accent px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
      >
        {BROWSER_COPY.control.handBack}
      </button>
    </span>
  );
}
