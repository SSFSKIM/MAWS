// The browser tools' host bridge (E4c execution document, Design §3; X13): a browser tool asks main once
// (`maws.browser.request`) and waits for `maws.browser.answer`, as E1's `HostBridge` does, with three differences.
// (1) The deadline counts only main's own work: while main reports that the action waits on the person holding the
// page or on a sheet covering it (`maws.browser.waiting`), the timer is cleared, and the end of that wait re-arms the
// whole BROWSER_ANSWER_MS; a person may hold the page for as long as they like, and the engine's interrupt (the call's
// signal) is the way out. (2) Main is told to stop (`maws.browser.cancel`) when the engine withdraws the call, when the
// deadline passes and when the process ends, so it drops a queued request, stops a wait, and never acts for a call no
// one awaits. (3) The app's presence: with no app connected nothing is sent and the call fails at once, and when the
// app goes every pending request settles `noClient` (paused ones included), so a detached host never holds a turn on a
// main that no longer exists. The outcomes are `HostBridge`'s.
import type { RequestId, ToolUseId } from '@shared/graph/ids';
import type { MawsBrowserAnswerResult } from '@shared/ipc/schema/maws';
import { BROWSER_ANSWER_MS, type BrowserToolName, type BrowserWaitReason } from '@shared/maws/browser';
import type { BridgeOutcome } from './bridge';

// What the host asks main (`maws.browser.request`, the session adding its app session id). `args` are the call's
// arguments as the tool's schema admitted them; a screenshot names its record and the `.png` path main writes.
export interface BrowserRequest {
  requestId: RequestId;
  toolUseId: ToolUseId | null;
  tool: BrowserToolName;
  args: unknown;
  deliverableId?: string;
  path?: string;
}

export type BrowserBridgeOutcome = BridgeOutcome<MawsBrowserAnswerResult>;

export interface BrowserBridgeDeps {
  send: (request: BrowserRequest) => void;
  cancel: (requestId: RequestId) => void; // main stops the request (`maws.browser.cancel`)
  connected?: () => boolean; // E10's `hasClient`: whether an app is connected; absent, always
  onClientGone?: (hook: () => void) => () => void; // the runtime's: the app went (returns the unsubscribe)
  answerMs?: number; // default BROWSER_ANSWER_MS
}

interface Pending {
  settle: (outcome: BrowserBridgeOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null; // null while main waits on the person or a cover
}

export class BrowserBridge {
  private readonly requests = new Map<RequestId, Pending>();
  private readonly answerMs: number;
  private readonly unfollow: () => void;

  constructor(private readonly deps: BrowserBridgeDeps) {
    this.answerMs = deps.answerMs ?? BROWSER_ANSWER_MS;
    this.unfollow = deps.onClientGone?.(() => this.settleAll({ kind: 'noClient' }, false)) ?? (() => {});
  }

  get pending(): number {
    return this.requests.size;
  }

  request(request: BrowserRequest, signal: AbortSignal): Promise<BrowserBridgeOutcome> {
    if (signal.aborted) return Promise.resolve({ kind: 'withdrawn' });
    if (this.deps.connected?.() === false) return Promise.resolve({ kind: 'noClient' });
    const { requestId } = request;
    return new Promise((resolve) => {
      const onAbort = () => {
        if (this.requests.get(requestId) !== entry) return;
        entry.settle({ kind: 'withdrawn' });
        this.deps.cancel(requestId);
      };
      const entry: Pending = {
        timer: null,
        settle: (outcome) => {
          if (this.requests.get(requestId) !== entry) return;
          this.requests.delete(requestId);
          if (entry.timer !== null) clearTimeout(entry.timer);
          signal.removeEventListener('abort', onAbort);
          resolve(outcome);
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.requests.set(requestId, entry);
      this.arm(requestId, entry);
      this.deps.send(request);
    });
  }

  // Main's answer: the first one settles the request.
  answer(requestId: RequestId, answer: MawsBrowserAnswerResult): 'delivered' | 'not_pending' {
    const entry = this.requests.get(requestId);
    if (!entry) return 'not_pending';
    entry.settle({ kind: 'answered', answer });
    return 'delivered';
  }

  // Main waits on the person or a cover (the deadline pauses), or no longer does (null: the whole deadline again).
  waiting(requestId: RequestId, reason: BrowserWaitReason | null): 'delivered' | 'not_pending' {
    const entry = this.requests.get(requestId);
    if (!entry) return 'not_pending';
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    if (reason === null) this.arm(requestId, entry);
    return 'delivered';
  }

  // The process is gone: every request ends, and main is told to stop each; the bridge stops following the app.
  processExited(): void {
    this.settleAll({ kind: 'ended' }, true);
    this.unfollow();
  }

  private arm(requestId: RequestId, entry: Pending): void {
    entry.timer = setTimeout(() => {
      entry.settle({ kind: 'timeout' });
      this.deps.cancel(requestId);
    }, this.answerMs);
    (entry.timer as { unref?: () => void }).unref?.();
  }

  private settleAll(outcome: BrowserBridgeOutcome, cancel: boolean): void {
    for (const [requestId, entry] of [...this.requests]) {
      entry.settle(outcome);
      if (cancel) this.deps.cancel(requestId);
    }
  }
}
