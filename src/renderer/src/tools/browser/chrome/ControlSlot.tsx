// E4a (Task 3.3): who has the page (Design §4 "Control slot", §11; A-31): nothing while idle, "Agent is browsing" with a
// pulse while the agent drives it, "You have the page" with Hand back while the human holds it after taking it over.
// E4c moves `control`; E4a only hands it back (`browser.control.handBack`), so outside tests the slot stays empty until
// E4c lands.
import type { BrowserTab } from '@shared/browser/tab';
import { handBack } from '../actions';
import { BROWSER_COPY } from '../copy';

export function ControlSlot({ tab }: { tab: BrowserTab }) {
  if (tab.control === 'idle') return null;
  if (tab.control === 'agent') {
    return (
      <span data-browser-control="agent" role="status" className="flex shrink-0 items-center gap-1.5 px-1.5 text-ui-sm text-fg-muted">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
        {BROWSER_COPY.control.agentBrowsing}
      </span>
    );
  }
  return (
    <span data-browser-control="human" className="flex shrink-0 items-center gap-1.5 pl-1.5 text-ui-sm text-fg-muted">
      {BROWSER_COPY.control.humanHasPage}
      <button
        type="button"
        onClick={() => handBack(tab.tabId)}
        className="h-6 rounded-sm border border-border-strong px-2 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
      >
        {BROWSER_COPY.control.handBack}
      </button>
    </span>
  );
}
