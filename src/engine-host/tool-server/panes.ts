// The pane bridge (E1 execution document, residue 3): `show_pane` needs a window to open a pane, which the host cannot
// do itself. The host asks every window once (`maws.pane.show`, an IPC event and never an X1 one, so a reload or a disk
// replay re-opens nothing); the first `maws.pane.answer` wins and a later one is `not_pending`; silence becomes the
// timeout error after PANE_ANSWER_MS. A request the engine withdrew, or one pending when the process ended, settles at
// once with an error nobody reads (the server answers an aborted call with nothing).
import type { RequestId } from '@shared/graph/ids';
import type { MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import { PANE_ANSWER_MS, type Pane } from '@shared/maws/panes';
import { TOOL_ERRORS, type ShowPaneResult } from '@shared/maws/tools';

export interface PaneShowRequest {
  requestId: RequestId;
  pane: Pane;
  target: string | null;
  line: number | null;
}

export type PaneBridgeAnswer = ShowPaneResult | { error: string };

// What a request no window answered settles with when nobody waits for it any more (never written to the engine).
const WITHDRAWN = 'show_pane: the request was withdrawn';
const ENDED = 'show_pane: the session ended';

interface Pending {
  pane: Pane;
  settle: (answer: PaneBridgeAnswer) => void;
}

export class PaneBridge {
  private readonly requests = new Map<RequestId, Pending>();

  constructor(private readonly deps: { show: (request: PaneShowRequest) => void; answerMs?: number }) {}

  get pending(): number {
    return this.requests.size;
  }

  request(request: PaneShowRequest, signal: AbortSignal): Promise<PaneBridgeAnswer> {
    if (signal.aborted) return Promise.resolve({ error: WITHDRAWN });
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle({ error: TOOL_ERRORS.paneTimeout }), this.deps.answerMs ?? PANE_ANSWER_MS);
      (timer as { unref?: () => void }).unref?.();
      const onAbort = () => settle({ error: WITHDRAWN });
      const settle = (answer: PaneBridgeAnswer) => {
        if (this.requests.get(request.requestId)?.settle !== settle) return;
        this.requests.delete(request.requestId);
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(answer);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.requests.set(request.requestId, { pane: request.pane, settle });
      this.deps.show(request);
    });
  }

  // A window's answer: the first one settles the request.
  answer(requestId: RequestId, result: MawsPaneAnswerResult): 'delivered' | 'not_pending' {
    const pending = this.requests.get(requestId);
    if (!pending) return 'not_pending';
    pending.settle(result.ok ? { status: 'shown', pane: pending.pane, opened: result.opened } : { error: result.error });
    return 'delivered';
  }

  processExited(): void {
    for (const pending of [...this.requests.values()]) pending.settle({ error: ENDED });
  }
}
