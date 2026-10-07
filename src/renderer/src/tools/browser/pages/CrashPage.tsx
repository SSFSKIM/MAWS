// E4a: a page whose renderer process went away (Design §15: `crashed`, with Reload, which loads the tab's URL into a
// fresh renderer) and a tab whose view could not be created (`failed`, with Retry: `reload` again, since with no view
// main loads the tab's URL and creating the view clears the failure; Decision Log 44 (c)). Both in the error page's frame.
import { navigate } from '../actions';
import { BROWSER_COPY } from '../copy';
import { PAGE_BUTTON, PageFrame } from './PageFrame';

export function CrashPage({ tabId, reason }: { tabId: string; reason: string }) {
  return (
    <PageFrame page="crashed" heading={BROWSER_COPY.crashedHeading} summary={BROWSER_COPY.crashed(reason)}>
      <div className="mt-3">
        <button type="button" className={PAGE_BUTTON} onClick={() => navigate(tabId, 'reload')}>
          {BROWSER_COPY.reload}
        </button>
      </div>
    </PageFrame>
  );
}

export function ViewFailedPage({ tabId, message }: { tabId: string; message: string }) {
  return (
    <PageFrame page="failed" heading={BROWSER_COPY.viewFailedHeading} summary={BROWSER_COPY.viewFailed(message)}>
      <div className="mt-3">
        <button type="button" className={PAGE_BUTTON} onClick={() => navigate(tabId, 'reload')}>
          {BROWSER_COPY.retry}
        </button>
      </div>
    </PageFrame>
  );
}
