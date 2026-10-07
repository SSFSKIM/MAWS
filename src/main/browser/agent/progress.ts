// A browser request's waits, told outward (E4c execution document, Design §6, §8, §10; Interfaces IPC): while an action
// waits on the person (`human`, at its pause point) or on a cover (`cover`, in its readiness wait), and again when the
// wait ends (null). The engine host hears `maws.browser.waiting` for a request of its own (a reason pauses the call's
// deadline, null re-arms the whole BROWSER_ANSWER_MS); every window hears `maws.browser.progress`, which draws the row's
// waiting line for any request, the e2e seam's included. The live wait is not an X1 event (it would re-deliver on a
// reload).
import type { RequestId } from '@shared/graph/ids';
import type { BrowserWaitReason } from '@shared/maws/browser';
import type { HostSupervisor } from '../../hosts/supervisor';
import type { BrowserEmit } from '../tabs';
import type { BrowserCall } from './handlers';

// Where a request came from: the engine host, or the e2e seam (no host to tell).
export type Via = 'host' | 'seam';

export function waitingReporter({ hosts, emit, now = Date.now }: { hosts: Pick<HostSupervisor, 'dispatch'>; emit: BrowserEmit; now?(): number }) {
  return (call: BrowserCall, tabId: string, reason: BrowserWaitReason | null, via: Via): void => {
    const { appSessionId, requestId, toolUseId, tool } = call;
    if (via === 'host') {
      hosts
        .dispatch('engine-host', 'maws.browser.waiting', { appSessionId, requestId: requestId as RequestId, waiting: reason })
        .catch((error: unknown) => console.error('[browser] could not report a wait to the engine host', error));
    }
    emit('maws.browser.progress', { appSessionId, toolUseId: toolUseId as never, tabId, tool, waiting: reason, since: new Date(now()).toISOString() });
  };
}
