// The pane bridge (E1 execution document, residue 3): `show_pane` needs a window to open a pane, which the host cannot
// do itself. The host asks every window once (`maws.pane.show`, an IPC event and never an X1 one, so a reload or a disk
// replay re-opens nothing); the first `maws.pane.answer` wins and a later one is `not_pending`; silence becomes the
// timeout error after PANE_ANSWER_MS. A request the engine withdrew, or one pending when the process ended, settles at
// once with an error nobody reads (the server answers an aborted call with nothing). E2: a thin instance of the host
// bridge (`./bridge.ts`), which `artifact_screenshot`'s capture shares.
import type { RequestId } from '@shared/graph/ids';
import type { MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import { PANE_ANSWER_MS, type Pane } from '@shared/maws/panes';
import { TOOL_ERRORS, type ShowPaneResult } from '@shared/maws/tools';
import { HostBridge, type BridgeOutcome } from './bridge';

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

export class PaneBridge {
  private readonly bridge: HostBridge<PaneShowRequest, MawsPaneAnswerResult>;

  constructor(deps: { show: (request: PaneShowRequest) => void; answerMs?: number; hasClient?: () => boolean /* E10 */ }) {
    this.bridge = new HostBridge({ send: deps.show, answerMs: deps.answerMs ?? PANE_ANSWER_MS, hasClient: deps.hasClient });
  }

  get pending(): number {
    return this.bridge.pending;
  }

  async request(request: PaneShowRequest, signal: AbortSignal): Promise<PaneBridgeAnswer> {
    const outcome: BridgeOutcome<MawsPaneAnswerResult> = await this.bridge.request(request, signal);
    switch (outcome.kind) {
      case 'answered':
        return outcome.answer.ok ? { status: 'shown', pane: request.pane, opened: outcome.answer.opened } : { error: outcome.answer.error };
      case 'timeout':
        return { error: TOOL_ERRORS.paneTimeout };
      case 'withdrawn':
        return { error: WITHDRAWN };
      case 'ended':
        return { error: ENDED };
      case 'noClient':
        return { error: TOOL_ERRORS.appNotOpen('show_pane') }; // E10
    }
  }

  // A window's answer: the first one settles the request.
  answer(requestId: RequestId, result: MawsPaneAnswerResult): 'delivered' | 'not_pending' {
    return this.bridge.answer(requestId, result);
  }

  processExited(): void {
    this.bridge.processExited();
  }
}
