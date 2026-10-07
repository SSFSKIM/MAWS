// The `maws` wiring of one EngineSession (E1 execution document, Interfaces "The tool server"; E2's capture bridge;
// E4c's browser bridge; moved out of session.ts in E11's debt wave W-A, unchanged): the `maws` MCP server the engine
// handshakes over `mcp_message`, the bridges its tools ask the app through (`show_pane`'s panes, `artifact_screenshot`'s
// capture, the browser tools'), the asks waiting for the human and the blocking asks' attention items. The session owns
// the process, the journal and the queue; the wiring asks it through `SessionMawsHost`.
import { tmpdir } from 'node:os';
import type { AttentionItem } from '@shared/graph/attention';
import type { RequestId, SessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { MawsArtifactCapturedResult, MawsBrowserAnswerResult, MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import { askAnswersProblem, askSteerText, type PendingAsk } from '@shared/maws/ask';
import type { BrowserWaitReason } from '@shared/maws/browser';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import type { AskAnswer, AskResult } from '@shared/maws/tools';
import type { ControlRequestFrame } from '@shared/wire/frames';
import { MemoryDeliverableStore, type DeliverableChange, type DeliverableWriter, type OnDeliverableWritten } from './deliverables/store';
import type { WriteOptions } from './outbound-writer';
import type { MessageQueue } from './queue';
import { AskAnswerMismatch } from './tool-server/ask';
import type { ArtifactCaptureRequest, CaptureBridge } from './tool-server/artifacts';
import { askAttentionItem, AskTable, type AskCancelReason } from './tool-server/asks';
import { HostBridge } from './tool-server/bridge';
import { BrowserBridge, type BrowserRequest } from './tool-server/browser-bridge';
import { PaneBridge, type PaneShowRequest } from './tool-server/panes';
import { MawsToolServer, toolText } from './tool-server/server';
import { mawsTools } from './tool-server/tools';

type AppSessionIdOf = LaunchSpec['appSessionId'];

// The session's events the wiring raises, each relayed to the windows or to main by the engine ipc.
export interface MawsListeners {
  paneShow: (request: PaneShowRequest & { appSessionId: AppSessionIdOf }) => void; // E1: `show_pane` asks the windows (maws.pane.show)
  // E2 start: the store wrote a record (deliverables.changed); `artifact_screenshot` asks main to capture (maws.artifact.capture)
  deliverableChanged: (change: { appSessionId: AppSessionIdOf; id: string; change: DeliverableChange }) => void;
  artifactCapture: (request: ArtifactCaptureRequest & { appSessionId: AppSessionIdOf }) => void;
  // E2 end
  // E4c start: a browser tool asks main (maws.browser.request); the host tells main to stop one (maws.browser.cancel)
  browserRequest: (request: BrowserRequest & { appSessionId: AppSessionIdOf }) => void;
  browserCancel: (cancel: { appSessionId: AppSessionIdOf; requestId: RequestId }) => void;
  // E4c end
}

export interface SessionMawsHost {
  appSessionId: AppSessionIdOf;
  appVersion?: string;
  // E1: where the `maws` tools record deliverables (EngineSessionOptions.deliverables); E10: whether an app is connected;
  // E4c: where main writes a browser screenshot, and the runtime's notice that the app went
  deliverables?: (onWritten: OnDeliverableWritten) => DeliverableWriter;
  hasClient?: () => boolean;
  userData?: string;
  onClientGone?: (hook: () => void) => () => void;
  emit<K extends keyof MawsListeners>(name: K, payload: Parameters<MawsListeners[K]>[0]): void;
  respond(requestId: RequestId, response: unknown, opts?: WriteOptions): Promise<void>;
  cwd(): string; // the engine's working directory as the frames report it, else the launch's
  sessionId(): SessionId | null;
  publishAttention(): void; // the session's attention list again (the broker's items, then the blocking asks')
  steer: MessageQueue['steer'];
  meta(frame: Record<string, unknown>): void; // journals a meta row; throws when the journal refuses it
  journalFailed(error: unknown): boolean; // the error is the session's live journal refusing a row
  markUsed(): void;
  touch(): void;
  log(message: string): void;
}

export class SessionMaws {
  // E1: the `maws` MCP server the engine handshakes over `mcp_message`, and the bridge `show_pane` opens panes through
  private readonly toolServer: MawsToolServer;
  private readonly panes: PaneBridge;
  private readonly captures: CaptureBridge; // E2: the bridge `artifact_screenshot` asks main through
  private readonly browser: BrowserBridge; // E4c: the bridge the browser tools ask main through
  private readonly askTable: AskTable; // E1 M2: the asks waiting for the human (host memory, G6)
  private askItems = new Map<string, AttentionItem>(); // E1 M4b: the blocking asks' attention items, published with the broker's

  constructor(private readonly host: SessionMawsHost) {
    // E1 start: served from construction on, since the engine's MCP handshake begins before initialize is answered (E0a Q1)
    this.panes = new PaneBridge({ show: (request) => host.emit('paneShow', { appSessionId: host.appSessionId, ...request }), hasClient: host.hasClient /* E10 */ });
    this.captures = new HostBridge({ send: (request) => host.emit('artifactCapture', { appSessionId: host.appSessionId, ...request }), answerMs: CAPTURE_ANSWER_MS, hasClient: host.hasClient /* E10 */ }); // E2
    const announce: OnDeliverableWritten = (record, change) => host.emit('deliverableChanged', { appSessionId: record.appSessionId, id: record.id, change }); // E2
    // E4c start: a deadline paused while main waits on the person or a cover; main told to stop what no one awaits
    this.browser = new BrowserBridge({
      send: (request) => host.emit('browserRequest', { appSessionId: host.appSessionId, ...request }),
      cancel: (requestId) => host.emit('browserCancel', { appSessionId: host.appSessionId, requestId }),
      connected: host.hasClient,
      onClientGone: host.onClientGone,
    });
    // E4c end
    this.askTable = new AskTable({
      onChange: () => {
        this.publishAsks(); // E1 M4b
        host.touch();
      },
    });
    this.toolServer = new MawsToolServer({
      tools: mawsTools({
        deliverables: host.deliverables?.(announce) ?? new MemoryDeliverableStore({ onWritten: announce }), bridge: this.panes, capture: this.captures /* E2 */,
        asks: this.askTable, askCancelled: (ask, reason) => this.askCancelled(ask, reason),
        browser: this.browser, userData: host.userData ?? tmpdir() /* E4c */,
      }),
      respond: (requestId, response, writeOpts) => host.respond(requestId, response, writeOpts),
      cwd: () => host.cwd(),
      appSessionId: host.appSessionId,
      version: host.appVersion ?? 'unknown',
      log: host.log,
      onChange: () => host.touch(),
    });
    // E1 end
  }

  // The `maws` server's JSON-RPC traffic (the server answers another server's name itself).
  accept(req: ControlRequestFrame): void {
    this.toolServer.accept(req);
  }

  // The engine withdrew a tool call.
  cancel(requestId: RequestId): void {
    this.toolServer.cancel(requestId);
  }

  // The blocking asks' attention items, published after the broker's (E1 M4b).
  attention(): Iterable<AttentionItem> {
    return this.askItems.values();
  }

  // What process exit would lose here (`EngineSessionStatus.pendingRequests`): tool calls in flight and async asks.
  get pending(): number {
    return this.toolServer.inFlight + this.askTable.asyncCount;
  }

  // E1: a window's answer to a `show_pane` (`maws.pane.answer`); the first one wins.
  answerPane(requestId: RequestId, result: MawsPaneAnswerResult): 'delivered' | 'not_pending' {
    return this.panes.answer(requestId, result);
  }

  // E2: main's answer to an `artifact_screenshot` capture (`maws.artifact.captured`); the first one wins.
  answerCapture(requestId: RequestId, result: MawsArtifactCapturedResult): 'delivered' | 'not_pending' {
    return this.captures.answer(requestId, result);
  }

  // E4c start: main's answer to a browser tool's request (`maws.browser.answer`), the first one wins; and its report
  // that the request waits on the person or a cover, or no longer does (`maws.browser.waiting`), which pauses or
  // re-arms the request's deadline.
  answerBrowser(requestId: RequestId, result: MawsBrowserAnswerResult): 'delivered' | 'not_pending' {
    return this.browser.answer(requestId, result);
  }

  browserWaiting(requestId: RequestId, waiting: BrowserWaitReason | null): 'delivered' | 'not_pending' {
    return this.browser.waiting(requestId, waiting);
  }
  // E4c end

  // E1 M2: the asks waiting for the human (`maws.asks.list`), pending or being answered.
  asks(): PendingAsk[] {
    return this.askTable.list();
  }

  // E1 M2 (residue 12): the human's answers to one ask (`maws.ask.answer`), checked against its questions first (a
  // mismatch throws AskAnswerMismatch and writes nothing), then claimed, written, and committed only once the write
  // settled: a blocking ask's call is answered with the AskResult (committed at the flushed row), an async ask's answers
  // go as a `next` steer whose write carries `maws_ask_answered` as its preface. A refused write releases the ask
  // (`write_failed`, still pending, so the human can retry); a live journal failure does not (answerNotWritten); an exit
  // meanwhile cancels it with the rest.
  async answerAsk(askId: string, answers: AskAnswer[]): Promise<'delivered' | 'not_pending' | 'write_failed'> {
    const held = this.askTable.get(askId);
    if (held === null) return 'not_pending';
    const problem = askAnswersProblem(held.questions, answers);
    if (problem !== null) throw new AskAnswerMismatch(`ask ${askId}: ${problem}`);
    const ask = this.askTable.claim(askId);
    if (ask === null) return 'not_pending';
    this.host.markUsed();
    if (ask.blocking) {
      const result: AskResult = { status: 'answered', askId, answers };
      const written = toolText(result);
      try {
        await this.toolServer.reply(ask.requestId, written, { flushed: () => this.askTable.commit(askId, written) });
      } catch (error) {
        return this.answerNotWritten(askId, error);
      }
      this.askTable.commit(askId, written); // a client that does not call `flushed` still ends committed
      return 'delivered';
    }
    // the meta row rides the steer's own write as its preface: journaled just before the steer's row, and only if the
    // write succeeded, under the writer's journal-failure handling
    try {
      await this.host.steer(askSteerText(askId, ask.questions, answers), { priority: 'next', preface: [{ event: 'maws_ask_answered', askId, toolUseId: ask.toolUseId, answers }] });
    } catch (error) {
      return this.answerNotWritten(askId, error);
    } finally {
      this.host.touch();
    }
    this.askTable.commit(askId);
    return 'delivered';
  }

  // The process is gone. Answers the blocking asks still published, counted before the tool server aborts them (E1 M5
  // fix: attention lost like a pending AskUserQuestion, the architect's ruling 1).
  processExited(): number {
    const lostAsks = this.askItems.size;
    // E1: every tool call in flight is aborted (no pipe takes its answer) and every pane request settles
    this.toolServer.processExited(); // a blocking ask's call aborts with it, cancelling the ask (meta row)
    this.panes.processExited();
    this.captures.processExited(); // E2
    this.browser.processExited(); // E4c: main told to stop each; the bridge stops following the app
    for (const ask of this.askTable.cancelAll('exit')) this.askCancelled(ask, 'exit'); // E1 M2: the async asks, before the exit row
    return lostAsks;
  }

  // E1 M2: an answer whose write failed. A refused write releases the ask for a retry. A journal failure while live
  // (the frame may have reached the engine, only its row is missing) leaves it claimed: the writer has already ended
  // the process through the journal-failure path, a retry could deliver the answers twice, and the exit cancels it.
  private answerNotWritten(askId: string, error: unknown): 'write_failed' {
    if (!this.host.journalFailed(error)) this.askTable.release(askId);
    return 'write_failed';
  }

  // E1 M2: an ask nobody will answer any more (the engine withdrew its call, or the process ended): journaled, since no
  // frame carries the fact.
  private askCancelled(ask: PendingAsk, reason: AskCancelReason): void {
    try {
      this.host.meta({ event: 'maws_ask_cancelled', askId: ask.askId, toolUseId: ask.toolUseId, reason });
    } catch (error) {
      this.host.log(`maws_ask_cancelled for ${ask.askId} not journaled: ${messageOf(error)}`);
    }
  }

  // E1 M4b (the architect's ruling 1): the attention list again whenever the blocking asks held changed (one opened,
  // was answered or was cancelled); an async ask, or a claim or release that leaves the set alone, publishes nothing.
  // An item is built once per ask, so its fields never move between publications.
  private publishAsks(): void {
    const blocking = this.askTable.list().filter((ask) => ask.blocking);
    if (blocking.length === this.askItems.size && blocking.every((ask) => this.askItems.has(ask.askId))) return;
    this.askItems = new Map(blocking.map((ask) => [ask.askId, this.askItems.get(ask.askId) ?? askAttentionItem(ask, this.host.appSessionId, this.host.sessionId())]));
    this.host.publishAttention();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
