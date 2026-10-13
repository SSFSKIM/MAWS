// The scale gate's host seam (M9 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, Acceptance 6; parent Decision
// Log 37): what `e2e/document-scale.spec.ts` drives the engine host through, started only when the host runs under
// MAWS_E2E=1 and MAWS_DOCUMENT_PERF=1. It is the "test-only command" through which two agent sessions are driven by the
// host's own writer: each command names a session, and the document tools of this child run through their real `call`
// with that session as the context (the read warms the session's replica and records its view; a batch is planned and
// written by the patch writer through A's `writeAs`, its op recorded, its presence published), so what is measured is
// the path an agent's `artifact_edit` takes in the host, less the engine's wire. The host's own event-loop delay is
// sampled around each call (a histogram of this seam's, running all along, reset before the call and read once the loop
// has turned after it): the longest the call kept the loop, its first synchronous stretch included. A's `artifacts.testLoopDelay` stays the run-wide measure.
//
// Commands arrive as JSON files in `<dir>/in` (written beside and renamed in, so a file is whole when seen) and run one
// at a time in name order; each answer is written to `<dir>/out` under the command's name (again by rename). No IPC
// name is added: the channel is the profile's directory, which only the e2e that launched the app writes.
//
//   seed     {artifactId, state (base64 V2)}       the document's tabs replaced by the state's, as the human
//   call     {session, tool, args}                 artifact_read or artifact_edit as `session`; `baseRevision: 'last'`
//                                                  stands for the revision the session last saw (its read or its batch)
//   heap     {}                                    the heap after two collections
//   release  {session}                             the session's replicas closed (its end)
//   loop     {reset?}                              the loop's gaps since the last reset (a run-wide measure beside A's)
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { TABS } from '@artifacts/document/tabs';
import { applyV2 } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { artifactEditTool, documentReadTool, DocumentToolSession } from '../../tool-server/documents';
import type { McpToolDefinition } from '../../tool-server/server';
import type { ArtifactStore } from '../store';

const HUMAN: Actor = { kind: 'human' };
const LOOP_TICK_MS = 1;

/**
 * The host loop's occupancy, sampled by a 1 ms interval timer reading `performance.now()`: each gap between two ticks is
 * how long the loop could not run a timer. M9's review found `monitorEventLoopDelay` missing a block that starts in the
 * same pass of the loop as its own sampling timer (an 80 ms synchronous call read as 1.3 ms), so the gaps are measured
 * here directly; a gap includes the tick itself (about 1 to 1.5 ms when idle).
 */
class LoopSampler {
  private last = performance.now();
  private gaps: number[] = [];
  private readonly timer = setInterval(() => {
    const now = performance.now();
    this.gaps.push(now - this.last);
    this.last = now;
  }, LOOP_TICK_MS);

  constructor() {
    this.timer.unref();
  }

  reset(): void {
    this.gaps = [];
    this.last = performance.now();
  }

  stats(): LoopStats {
    if (this.gaps.length === 0) return { max: 0, p99: 0, mean: 0 };
    const sorted = [...this.gaps].sort((a, b) => a - b);
    return { max: sorted[sorted.length - 1]!, p99: sorted[Math.min(sorted.length - 1, Math.ceil(0.99 * sorted.length) - 1)]!, mean: sorted.reduce((sum, gap) => sum + gap, 0) / sorted.length };
  }

  close(): void {
    clearInterval(this.timer);
  }
}

export type PerfCommand =
  | { cmd: 'seed'; artifactId: string; state: string }
  | { cmd: 'call'; session: string; tool: 'artifact_read' | 'artifact_edit'; args: Record<string, unknown> }
  | { cmd: 'heap' }
  | { cmd: 'release'; session: string }
  | { cmd: 'loop'; reset?: boolean };

export interface LoopStats {
  max: number;
  p99: number;
  mean: number;
}

/** A tool call's answer: its result (or, refused, the tool's text), its wall time and the loop's delay around it. */
export interface CallAnswer {
  ok: true;
  isError: boolean;
  result?: unknown;
  text: string;
  wallMs: number;
  loop: LoopStats;
}

export type PerfAnswer =
  | { ok: false; error: string }
  | { ok: true; revision: number }
  | CallAnswer
  | { ok: true; heapUsed: number; rss: number; collected: boolean }
  | { ok: true; loop: LoopStats }
  | { ok: true };

export const documentPerfSeamRequested = (env: Record<string, string | undefined>): boolean => env.MAWS_E2E === '1' && env.MAWS_DOCUMENT_PERF === '1';

interface PerfSession {
  tools: Record<'artifact_read' | 'artifact_edit', McpToolDefinition>;
  calls: number;
  lastRevision: number;
}

const turned = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DocumentPerfSeam {
  private readonly sessions = new Map<string, PerfSession>();
  private readonly loop = new LoopSampler();
  private readonly runLoop = new LoopSampler(); // the `loop` command's, over a whole run
  private gc: (() => void) | null = null;

  constructor(
    private readonly store: ArtifactStore,
    private readonly options: { tools?: (deps: { artifacts: () => ArtifactStore; session: DocumentToolSession }) => PerfSession['tools'] } = {},
  ) {}

  async run(command: PerfCommand): Promise<PerfAnswer> {
    try {
      switch (command.cmd) {
        case 'seed':
          return await this.seed(command.artifactId, Buffer.from(command.state, 'base64'));
        case 'call':
          return await this.call(command.session, command.tool, command.args);
        case 'heap':
          return this.heap();
        case 'loop': {
          const stats = this.runLoop.stats();
          if (command.reset) this.runLoop.reset();
          return { ok: true, loop: stats };
        }
        case 'release':
          this.store.service.closeSession(command.session as AppSessionId);
          this.sessions.delete(command.session);
          return { ok: true };
        default:
          return { ok: false, error: `unknown command ${JSON.stringify((command as { cmd: unknown }).cmd)}` };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  close(): void {
    this.loop.close();
    this.runLoop.close();
  }

  // The tabs a document has (the host's first tab) removed and the seed's applied, in one write as the human.
  private async seed(artifactId: string, state: Uint8Array): Promise<PerfAnswer> {
    await this.store.service.writeAs(artifactId, HUMAN, (doc) => {
      const tabs = doc.get(TABS);
      for (const [key] of [...tabs.attrEntries()]) tabs.deleteAttr(String(key));
      applyV2(doc, state);
    });
    return { ok: true, revision: this.store.revision(artifactId) };
  }

  private session(name: string): PerfSession {
    let session = this.sessions.get(name);
    if (!session) {
      const deps = { artifacts: () => this.store, session: new DocumentToolSession() };
      session = { tools: this.options.tools?.(deps) ?? { artifact_read: documentReadTool(deps), artifact_edit: artifactEditTool(deps) }, calls: 0, lastRevision: 0 };
      this.sessions.set(name, session);
    }
    return session;
  }

  private async call(name: string, tool: 'artifact_read' | 'artifact_edit', args: Record<string, unknown>): Promise<PerfAnswer> {
    const session = this.session(name);
    const definition = session.tools[tool];
    if (!definition) return { ok: false, error: `no tool ${JSON.stringify(tool)}` };
    const input = args.baseRevision === 'last' ? { ...args, baseRevision: session.lastRevision } : args;
    session.calls += 1;
    const ctx = { appSessionId: name as AppSessionId, cwd: '/', toolUseId: `toolu_perf_${name}_${session.calls}` as ToolUseId, requestId: `perf-${name}-${session.calls}` as RequestId, signal: new AbortController().signal };
    // the sampler runs all along, so a call blocking the loop at once is caught by the gap it leaves; the gaps before
    // the call, the command's own parsing among them, are dropped by the reset
    await turned(LOOP_TICK_MS * 3);
    this.loop.reset();
    const started = performance.now();
    const result = await definition.call(input, ctx);
    const wallMs = performance.now() - started;
    await turned(LOOP_TICK_MS * 5); // the gap the call left closes once the loop turns after it
    const loop = this.loop.stats();
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const isError = result.isError === true;
    let parsed: unknown;
    if (!isError) {
      parsed = JSON.parse(text);
      const revision = (parsed as { revision?: unknown }).revision;
      if (typeof revision === 'number') session.lastRevision = revision;
    }
    return { ok: true, isError, ...(parsed !== undefined && { result: parsed }), text: isError ? text : '', wallMs, loop };
  }

  private heap(): PerfAnswer {
    if (!this.gc) {
      setFlagsFromString('--expose-gc'); // S7b pitfall 7: `--expose-gc` in a utility process's execArgv never reaches V8
      this.gc = runInNewContext('gc') as () => void;
    }
    this.gc();
    this.gc();
    const { heapUsed, rss } = process.memoryUsage();
    return { ok: true, heapUsed, rss, collected: true };
  }
}

/** The seam over the file channel in `dir` (`in`, `out`); `close` stops it. */
export function startDocumentPerfSeam(store: ArtifactStore, dir: string, log: (line: string) => void = (line) => console.warn(`[document-perf] ${line}`)): { close(): void } {
  const inbox = join(dir, 'in');
  const outbox = join(dir, 'out');
  mkdirSync(inbox, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  const seam = new DocumentPerfSeam(store);
  let running = false;
  let again = false;
  let closed = false;
  const drain = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (const name of readdirSync(inbox).filter((file) => file.endsWith('.json')).sort()) {
          if (closed) return;
          const path = join(inbox, name);
          let command: PerfCommand;
          try {
            command = JSON.parse(readFileSync(path, 'utf8')) as PerfCommand;
          } finally {
            rmSync(path, { force: true });
          }
          const answer = await seam.run(command);
          writeFileSync(join(outbox, `${name}.tmp`), JSON.stringify(answer));
          renameSync(join(outbox, `${name}.tmp`), join(outbox, name));
        }
      } while (again && !closed);
    } catch (error) {
      log(`a command failed outside its run: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const watcher: FSWatcher = watch(inbox, () => void drain());
  watcher.unref(); // never what keeps the host running
  void drain();
  log(`listening in ${dir}`);
  return {
    close: () => {
      closed = true;
      watcher.close();
      seam.close();
    },
  };
}
