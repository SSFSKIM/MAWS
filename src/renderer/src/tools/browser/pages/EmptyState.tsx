// E4a: the pane with no page to show (Design §4 "The pane"; X14): the globe alone for a session with no tab or a tab
// that never navigated (the word cut, T409 and T410: the address field's placeholder says what to do), headed "That tab
// was closed" for a main tab whose tab is gone (Decision Log 21), and a suspended tab's page offering Load, which loads
// its last URL only when asked (G4: every tab restores unloaded), the URL its tooltip and description (T412, T413).
import type { BrowserTab } from '@shared/browser/tab';
import { validateBrowserUrl } from '@shared/browser/url';
import { Tip } from '../../../ui/tip';
import { navigate } from '../actions';
import { BROWSER_COPY } from '../copy';
import { BrowserIcon } from '../icons';
import { tabTitle } from '../store';
import { PAGE_PRIMARY_BUTTON } from './PageFrame';

export function EmptyState({ notice }: { notice?: string }) {
  return (
    <div data-browser-page="empty" className="absolute inset-0 flex flex-col items-center justify-center gap-1 overflow-auto bg-bg p-6 text-center">
      {notice !== undefined && <p className="m-0 mb-3 text-ui text-fg-muted">{notice}</p>}
      <BrowserIcon className="mb-2 size-6 text-fg-faint" />
    </div>
  );
}

export function SuspendedPage({ tab }: { tab: BrowserTab }) {
  const checked = validateBrowserUrl(tab.url);
  if (!checked.ok) return <EmptyState />;
  const title = tabTitle(tab);
  return (
    <div data-browser-page="suspended" className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-bg p-6 text-center">
      <div className="flex max-w-full min-w-0 items-center gap-2 text-ui text-fg">
        {tab.favicon ? <img alt="" src={tab.favicon} className="size-4 shrink-0" /> : <BrowserIcon className="text-fg-faint" />}
        <span className="min-w-0 truncate">{title}</span>
      </div>
      <Tip content={checked.url} description={checked.url}>
        <button type="button" className={PAGE_PRIMARY_BUTTON} onClick={() => navigate(tab.tabId, { url: checked.url })}>
          {BROWSER_COPY.load}
        </button>
      </Tip>
    </div>
  );
}
