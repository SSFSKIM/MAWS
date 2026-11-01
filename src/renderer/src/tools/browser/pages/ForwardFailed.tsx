// P5 O7 M3 ("Forwarding"): a forwarded link whose forward could not open (./forward.ts keeps the refusal per session),
// drawn in the pane in place of the session's page, in the error page's frame: what was refused in the machine's name,
// then Try again (the same open) and Dismiss (the pane comes back).
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../../ipc/client';
import { useMachines } from '../../../stores/machines';
import { machineName } from '../../../stores/org-projects';
import { BROWSER_COPY } from '../copy';
import { dismissForwardFailure, forwardErrorWords, retryForward, type ForwardFailure } from '../forward';
import { PAGE_BUTTON, PAGE_PRIMARY_BUTTON, PageFrame } from './PageFrame';

export function ForwardFailedPage({ appSessionId, failure }: { appSessionId: AppSessionId; failure: ForwardFailure }) {
  const name = useMachines((s) => machineName(s.machines, failure.forward.machine, ipc.localMachine));
  const copy = BROWSER_COPY.forwarded;
  return (
    <PageFrame page="forward-failed" heading={copy.failedHeading(failure.forward.port, name)} summary={forwardErrorWords(failure.error, name)}>
      <div className="mt-3 flex gap-2">
        <button type="button" className={PAGE_PRIMARY_BUTTON} onClick={() => void retryForward(ipc, appSessionId)}>
          {copy.tryAgain}
        </button>
        <button type="button" className={PAGE_BUTTON} onClick={() => dismissForwardFailure(appSessionId)}>
          {copy.dismiss}
        </button>
      </div>
    </PageFrame>
  );
}
