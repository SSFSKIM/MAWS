// E4a: the chrome's mount point (Design §4), above the pane in both surfaces. Until the chrome lands (Task 3.3: the tab
// strip, the navigation row with the address field, the zoom banner, the find bar, the notices) it names the shown tab
// in one row, so the surface keeps its shape.
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_COPY } from '../copy';
import { BrowserIcon } from '../icons';
import { tabTitle } from '../store';

export interface ChromeProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  tab: BrowserTab | null; // the tab the pane shows; null for the empty state
  tabs: BrowserTab[]; // the session's tabs, in main's order
}

export function Chrome({ tab }: ChromeProps) {
  return (
    <div data-browser-chrome="" className="flex h-(--row-h) shrink-0 items-center gap-2 border-b border-border bg-bg-raised px-2 text-ui-sm text-fg-muted">
      <BrowserIcon className="size-3.5" />
      <span className="min-w-0 truncate">{tab ? tabTitle(tab) || BROWSER_COPY.newTab : BROWSER_COPY.title}</span>
    </div>
  );
}
