// The `maws` wiring of one EngineSession (E1 execution document, Interfaces "The tool server"; E2's capture bridge;
// moved out of session.ts in E11's debt wave W-A; E4c's browser bridge removed with the browser tools, P1 A-54): the
// `maws` MCP server the engine handshakes over `mcp_message`, the bridges its tools ask the app through (`show_pane`'s
// panes, `artifact_screenshot`'s capture), the asks waiting for the human and the blocking asks' attention items. The session owns
// the process, the journal and the queue; the wiring asks it through `SessionMawsHost`. P3-A (M6): the artifact tools
// write through the host's artifact store; each turn's end writes the session's `turn` versions there, and the process's
// end closes the session's agent replicas (their bases and presence with them). P4-A2 (X35): the session's events feed
// its `ProvisionalEmitter`, which shows an artifact call on the documents' ports while its input streams. P4-A3: a human
// message the queue submits carries the reads of the artifacts it links (`withLinkedReads`), read through the session's
// own `artifact_read`.
import { randomUUID } from 'node:crypto';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { MawsArtifactCapturedResult, MawsDownloadRecorded, MawsPaneAnswerResult } from '@shared/ipc/schema/maws';
import { askAnswersProblem, askSteerText, type PendingAsk } from '@shared/maws/ask';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import { EXPORT_ANSWER_MS, type AskAnswer, type AskResult } from '@shared/maws/tools';
import type { ControlRequestFrame } from '@shared/wire/frames';
import type { LinkedArtifact } from '@shared/maws/linked-read'; // P4-A3
import { recordDownload } from './library/downloads'; // E13; P3-L M6b: a File artifact
import type { WriteOptions } from './outbound-writer';
import type { MessageQueue, Prepared } from './queue'; // P4-A3: Prepared
import { AskAnswerMismatch } from './tool-server/ask';
import type { ArtifactCaptureRequest, CaptureBridge } from './tool-server/artifacts';
import { askAttentionItem, AskTable, type AskCancelReason } from './tool-server/asks';
import { HostBridge } from './tool-server/bridge';
import { PaneBridge, type PaneShowRequest } from './tool-server/panes';
import { MawsToolServer, toolText } from './tool-server/server';
import { mawsTools } from './tool-server/tools';
import { ArtifactSession } from './tool-server/artifact-context'; // P3-A
import type { ArtifactExportAnswer, ArtifactExportRequest, ExportBridge } from './tool-server/artifact-export'; // P3-A M7
import type { ArtifactStore } from './documents/store'; // P3-A
import type { DatasetRefreshRequests } from './connectors/dataset-requests'; // E3
import { ProvisionalEmitter } from './tool-server/provisional'; // P4-A2 (X35)
import { withLinkedReads, type Admission, type ReadAnswer } from './linked-reads'; // P4-A3
import type { SendContent } from '@shared/engine/session-state-store'; // P4-A3
import type { McpToolDefinition } from './tool-server/server';

type AppSessionIdOf = LaunchSpec['appSessionId'];

// The session's events the wiring raises, each relayed to the windows or to main by the engine ipc.
export interface MawsListeners {
  paneShow: (request: PaneShowRequest & { appSessionId: AppSessionIdOf }) => void; // E1: `show_pane` asks the windows (maws.pane.show)
  artifactCapture: (request: ArtifactCaptureRequest & { appSessionId: AppSessionIdOf }) => void; // E2: `artifact_screenshot` asks main to capture (maws.artifact.capture)
  artifactExport: (request: ArtifactExportRequest) => void; // P3-A M7: `artifact_export` asks main to export (maws.artifact.export)
}

export interface SessionMawsHost {
  appSessionId: AppSessionIdOf;
  appVersion?: string;
  hasClient?: () => boolean; // E10: whether an app is connected
  artifactScope?: readonly AppSessionIdOf[]; // P2-E1: EngineSessionOptions.artifactScope, handed to the artifact tools
  artifacts?: () => ArtifactStore | null; // P3-A (M6): EngineSessionOptions.artifacts
  datasetRefresh?: Pick<DatasetRefreshRequests, 'ask'>; // E3: EngineSessionOptions.datasetRefresh
  emit<K extends keyof MawsListeners>(name: K, payload: Parameters<MawsListeners[K]>[0]): void;
  respond(requestId: RequestId, response: unknown, opts?: WriteOptions): Promise<void>;
  cwd(): string; // the engine's working directory as the frames report it, else the launch's
  sessionId(): SessionId | null;
  fromSubagent?(toolUseId: ToolUseId | null): boolean; // P2-C3: whether a `maws` call is a subagent's (Normalizer.fromSubagent)
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
  private readonly exports: ExportBridge; // P3-A M7: the bridge `artifact_export` asks main through
  private readonly askTable: AskTable; // E1 M2: the asks waiting for the human (host memory, G6)
  private readonly provisional: ProvisionalEmitter; // P4-A2 (X35): the session's artifact calls shown as they stream
  private readonly read: McpToolDefinition; // P4-A3: the session's `artifact_read`, as the server serves it, for the linked reads
  private readonly artifactSession = new ArtifactSession(); // P3-A: what the artifact tools remember between calls (P4-A3: read here too)
  private askItems = new Map<string, AttentionItem>(); // E1 M4b: the asks' attention items (P2-C2: async ones too), published with the broker's

  constructor(private readonly host: SessionMawsHost) {
    // E1 start: served from construction on, since the engine's MCP handshake begins before initialize is answered (E0a Q1)
    this.panes = new PaneBridge({ show: (request) => host.emit('paneShow', { appSessionId: host.appSessionId, ...request }), hasClient: host.hasClient /* E10 */ });
    this.captures = new HostBridge({ send: (request) => host.emit('artifactCapture', { appSessionId: host.appSessionId, ...request }), answerMs: CAPTURE_ANSWER_MS, hasClient: host.hasClient /* E10 */ }); // E2
    this.exports = new HostBridge({ send: (request) => host.emit('artifactExport', request), answerMs: EXPORT_ANSWER_MS, hasClient: host.hasClient }); // P3-A M7
    this.askTable = new AskTable({
      onChange: () => {
        this.publishAsks(); // E1 M4b
        host.touch();
      },
    });
    this.provisional = new ProvisionalEmitter({ store: () => host.artifacts?.() ?? null, appSessionId: host.appSessionId, artifactScope: host.artifactScope, log: host.log });
    const tools = mawsTools({
      bridge: this.panes, capture: this.captures /* E2 */,
      asks: this.askTable, askCancelled: (ask, reason) => this.askCancelled(ask, reason),
      artifactScope: host.artifactScope, // P2-E1
      artifacts: host.artifacts, session: this.artifactSession, log: host.log, // P3-A (M6)
      exporter: this.exports, // P3-A M7
      datasetRefresh: host.datasetRefresh, // E3
      provisional: this.provisional, // P4-A2
    });
    this.read = tools.find((tool) => tool.name === 'artifact_read')!;
    this.toolServer = new MawsToolServer({
      tools,
      respond: (requestId, response, writeOpts) => host.respond(requestId, response, writeOpts),
      cwd: () => host.cwd(),
      appSessionId: host.appSessionId,
      version: host.appVersion ?? 'unknown',
      log: host.log,
      onChange: () => host.touch(),
      fromSubagent: host.fromSubagent && ((toolUseId) => host.fromSubagent!(toolUseId)), // P2-C3
    });
    // E1 end
  }

  // P4-A3: a human message the queue submits, with the reads of the artifacts its words link (link order, within the
  // cap; `../linked-reads`), and what keeps or undoes those reads once the queue knows whether the frame was written;
  // content linking nothing readable comes back as it was, and so does any content when the reads fail. A read is the
  // session's own `artifact_read` answer at this moment (no tool-use id: it joins no call's operation), so it resolves,
  // migrates and answers exactly as the agent's read would.
  async withLinkedReads(content: SendContent): Promise<Prepared> {
    try {
      const outcome = await withLinkedReads(content, (link, admit) => this.readLinked(link, admit));
      return { content: outcome.content, settle: (written) => outcome.settle(written) };
    } catch (error) {
      this.host.log(`linked reads not attached: ${error instanceof Error ? error.message : String(error)}`); // the message goes as written
      return { content, settle: () => {} };
    }
  }

  // A read changes the session's memory of the artifact: an html page's byte base, a file kind's replica base (what its
  // publish merges from). The agent must hold every read its memory reflects, so a read not attached puts both back at
  // once, and an attached one hands back `undo`, for a frame that is then not written; either puts back only what the
  // read itself left, never a later change. A maws call of the session's that ran beside the read (a background
  // agent's, the main turn idle) may have set the same memory, which nothing here can tell apart from the read's: then
  // the memory of that artifact is cleared instead, so the agent's next publish of it is refused as never read and it
  // reads again, never a publish judged from a view the agent does not hold. A document's read records its view too, which only validates an edit from
  // that revision; the agent learns a revision only from a read it does see, so that record is left. A read that throws
  // is one not attached.
  private async readLinked(link: LinkedArtifact, admit: (text: string | null) => Admission): Promise<ReadAnswer> {
    const { artifactId } = link;
    const sessionId = this.host.appSessionId;
    const service = () => this.host.artifacts?.()?.service ?? null;
    const before = { byteBase: this.artifactSession.byteBases.get(artifactId), base: service()?.existingReplica(sessionId, artifactId)?.base ?? null };
    const calls = this.toolServer.inFlight === 0 ? this.toolServer.started : -1; // -1: a call was already running
    let text: string | null = null;
    try {
      const result = await this.read.call(
        { artifact: artifactId, ...(link.tab !== undefined && { tab: link.tab }) },
        { appSessionId: sessionId, cwd: this.host.cwd(), toolUseId: null, requestId: `linked-read-${randomUUID()}` as RequestId, signal: new AbortController().signal, fromSubagent: false },
      );
      const block = result.content.find((b) => b.type === 'text');
      text = result.isError || !block || block.type !== 'text' ? null : block.text;
    } catch (error) {
      this.host.log(`linked read of ${artifactId} not attached: ${error instanceof Error ? error.message : String(error)}`);
    }
    const after = { byteBase: this.artifactSession.byteBases.get(artifactId), base: service()?.existingReplica(sessionId, artifactId)?.base ?? null };
    const alone = this.toolServer.started === calls && this.toolServer.inFlight === 0;
    const undo = () => {
      if (!alone) {
        this.artifactSession.byteBases.delete(artifactId);
        const replica = service()?.existingReplica(sessionId, artifactId);
        if (replica) replica.base = null;
        return;
      }
      if (this.artifactSession.byteBases.get(artifactId) === after.byteBase) {
        if (before.byteBase === undefined) this.artifactSession.byteBases.delete(artifactId);
        else this.artifactSession.byteBases.set(artifactId, before.byteBase);
      }
      const replica = service()?.existingReplica(sessionId, artifactId);
      if (replica && replica.base === after.base) replica.base = before.base;
    };
    const admitted = admit(text);
    if (!admitted.ok) undo();
    return admitted.ok ? { ...admitted, undo } : admitted;
  }

  // The `maws` server's JSON-RPC traffic (the server answers another server's name itself).
  accept(req: ControlRequestFrame): void {
    this.toolServer.accept(req);
  }

  // P4-A2 (X35): the session's events, every lane: an artifact call's input as it streams, and the engine's results.
  observe(events: readonly SessionEvent[]): void {
    this.provisional.observe(events);
  }

  // The engine withdrew a tool call.
  cancel(requestId: RequestId): void {
    this.toolServer.cancel(requestId);
  }

  // The asks' attention items, published after the broker's (E1 M4b; P2-C2: an async ask's is `async_input`).
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

  // P3-A M7: main's answer to an `artifact_export` (`maws.artifact.exported`); the first one wins.
  answerExport(requestId: RequestId, answer: ArtifactExportAnswer): 'delivered' | 'not_pending' {
    return this.exports.answer(requestId, answer);
  }

  // E13: an agent's download through cua finished (`maws.download.recorded`): P3-L M6b, a File artifact of the session,
  // once per path; a write that fails (or no store this run) is logged and leaves the saved file as it is.
  async recordDownload(download: MawsDownloadRecorded): Promise<'recorded' | 'duplicate'> {
    try {
      const store = this.host.artifacts?.() ?? null;
      if (store === null) throw new Error('the artifact store is unavailable in this run of MAWS');
      return await recordDownload(store, download);
    } catch (error) {
      this.host.log(`could not record the download of tab ${download.tabId} as an artifact: ${(error as Error).message}`);
      throw error;
    }
  }

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

  // P3-A (M6; Decision Log 23d, 23f): the session's turn ended: one `turn` version per artifact it edited, its presence
  // cleared. A failure is logged; the edits themselves are already durable.
  turnEnded(): void {
    this.provisional.turnEnded(); // P4-A2 (R8): a layer whose call never arrived ends with the turn
    const store = this.host.artifacts?.() ?? null;
    store?.endTurn(this.host.appSessionId).catch((error: unknown) => this.host.log(`the turn's artifact versions were not written: ${messageOf(error)}`));
  }

  // The process is gone. Answers the blocking asks still published, counted before the tool server aborts them (E1 M5
  // fix: attention lost like a pending AskUserQuestion, the architect's ruling 1).
  processExited(): number {
    const lostAsks = [...this.askItems.values()].filter((item) => item.kind === 'question').length; // the blocking asks
    // E1: every tool call in flight is aborted (no pipe takes its answer) and every pane request settles
    this.toolServer.processExited(); // a blocking ask's call aborts with it, cancelling the ask (meta row)
    this.panes.processExited();
    this.captures.processExited(); // E2
    this.exports.processExited(); // P3-A M7
    for (const ask of this.askTable.cancelAll('exit')) this.askCancelled(ask, 'exit'); // E1 M2: the async asks, before the exit row
    this.provisional.processExited(); // P4-A2 (R8): every layer dropped, while the session's replicas are still open
    this.host.artifacts?.()?.service.closeSession(this.host.appSessionId); // P3-A: its agent replicas (Decision Log 9)
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

  // E1 M4b (the architect's ruling 1): the attention list again whenever the asks held changed (one opened, was
  // answered or was cancelled); a claim or release that leaves the set alone publishes nothing, so an ask's item stays
  // until its answer is committed. An item is built once per ask, so its fields never move between publications.
  // P2-C2 (Decision Log 32): async asks too, as `async_input` items; no watermark, since asks are host memory, never
  // replayed.
  private publishAsks(): void {
    const asks = this.askTable.list();
    if (asks.length === this.askItems.size && asks.every((ask) => this.askItems.has(ask.askId))) return;
    this.askItems = new Map(asks.map((ask) => [ask.askId, this.askItems.get(ask.askId) ?? askAttentionItem(ask, this.host.appSessionId, this.host.sessionId())]));
    this.host.publishAttention();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
