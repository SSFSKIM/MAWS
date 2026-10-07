// The host bridge (E2 execution document, Design §7; E1 residue 3 generalised): a tool that needs something only main
// or a window can do asks once over an IPC event and waits for the answer a host command brings back. The first answer
// wins and a later one is `not_pending`; silence settles as a timeout after `answerMs`; a request the engine withdrew,
// or one pending when the process ended, settles at once (the server answers an aborted call with nothing). Nothing
// here waits on a window: every request has its deadline (X13). `show_pane`'s pane bridge and `artifact_screenshot`'s
// capture bridge are instances. E10: the host may run with no app connected (the detached supervisor), and then nothing
// can answer; a request made while `hasClient()` is false settles `noClient` at once and is never sent.
import type { RequestId } from '@shared/graph/ids';

export type BridgeOutcome<Answer> = { kind: 'answered'; answer: Answer } | { kind: 'timeout' } | { kind: 'withdrawn' } | { kind: 'ended' } | { kind: 'noClient' };

export class HostBridge<Request extends { requestId: RequestId }, Answer> {
  private readonly requests = new Map<RequestId, (outcome: BridgeOutcome<Answer>) => void>();

  constructor(private readonly deps: { send: (request: Request) => void; answerMs: number; hasClient?: () => boolean /* E10: absent, always */ }) {}

  get pending(): number {
    return this.requests.size;
  }

  request(request: Request, signal: AbortSignal): Promise<BridgeOutcome<Answer>> {
    if (signal.aborted) return Promise.resolve({ kind: 'withdrawn' });
    if (this.deps.hasClient?.() === false) return Promise.resolve({ kind: 'noClient' }); // E10
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle({ kind: 'timeout' }), this.deps.answerMs);
      (timer as { unref?: () => void }).unref?.();
      const onAbort = () => settle({ kind: 'withdrawn' });
      const settle = (outcome: BridgeOutcome<Answer>) => {
        if (this.requests.get(request.requestId) !== settle) return;
        this.requests.delete(request.requestId);
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(outcome);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.requests.set(request.requestId, settle);
      this.deps.send(request);
    });
  }

  // The answer from outside: the first one settles the request.
  answer(requestId: RequestId, answer: Answer): 'delivered' | 'not_pending' {
    const settle = this.requests.get(requestId);
    if (!settle) return 'not_pending';
    settle({ kind: 'answered', answer });
    return 'delivered';
  }

  processExited(): void {
    for (const settle of [...this.requests.values()]) settle({ kind: 'ended' });
  }
}
