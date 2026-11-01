// E4a: a page whose renderer process went away (Design §15: `crashed`, with Reload, which loads the tab's URL into a
// fresh renderer) and a tab whose view could not be created (`failed`, with Retry: `reload` again, since with no view
// main loads the tab's URL and creating the view clears the failure; Decision Log 44 (c)). Both in the error page's frame.
// P5 O7 M3 (fix wave 1): a tab of a forward whose forward main could not open again (a restored tab's first load) fails
// the same way with main's words; its heading names the port and machine, and Retry's reload opens the forward again.
import type { BrowserTabForward } from '@shared/browser/tab';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { machineName } from '../../../stores/org-projects';
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

export function ViewFailedPage({ tabId, message, forward }: { tabId: string; message: string; forward?: BrowserTabForward }) {
  const machine = useMachines((s) => (forward ? machineName(s.machines, forward.machine, ipc.localMachine) : null));
  const heading = forward && machine !== null ? BROWSER_COPY.forwarded.failedHeading(forward.port, machine) : BROWSER_COPY.viewFailedHeading;
  return (
    <PageFrame page={forward ? 'forward-failed' : 'failed'} heading={heading} summary={BROWSER_COPY.viewFailed(message)}>
      <div className="mt-3">
        <button type="button" className={PAGE_BUTTON} onClick={() => navigate(tabId, 'reload')}>
          {BROWSER_COPY.retry}
        </button>
      </div>
    </PageFrame>
  );
}
