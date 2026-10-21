// The deck's scale seam (P3-C M10; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Acceptance 7): what
// `e2e/presentations-scale.spec.ts` (and, since P4-B2 M0, `e2e/presentations-drag.spec.ts`) drives the engine host
// through, started only when the host runs under MAWS_E2E=1 and MAWS_PRESENTATIONS_SCALE=1. Each command names an agent
// session, and A's own `artifact_read` and `artifact_publish` run through their real `call` with that session as the
// context, so a publish is A's `publishDoc` over the deck's
// three-way publish on the host's live document, with the session's base, its op ledger and its replica: the path an
// agent's publish takes in the host, less the engine's wire. Around each call the seam answers the host loop's longest
// gap (B's 1 ms tick sampler, which catches a call blocking the loop at once) and the loop's busy time over the call
// (the sum of the sampler's gaps beyond its tick; event-loop utilization reads 0 in Electron's utility process):
// Acceptance 7's "a publish occupies the host loop".
//
// Commands arrive as JSON files in `<dir>/in` and are answered in `<dir>/out` under the same name (B's file channel,
// `serveCommandFiles`); no IPC name is added.
//
//   call     {session, tool, args}   artifact_read or artifact_publish as `session`; `baseRevision: 'last'` stands for
//                                    the revision the session last saw (its read or its publish)
//   release  {session}               the session's replicas closed (its end)
import { performance } from 'node:perf_hooks';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { LoopSampler, serveCommandFiles, type LoopStats } from '../documents/kinds/document-perf';
import type { ArtifactStore } from '../documents/store';
import { ArtifactSession } from '../tool-server/artifact-context';
import { artifactPublishTool } from '../tool-server/artifact-publish';
import { artifactReadTool } from '../tool-server/artifact-tools';
import type { McpToolDefinition } from '../tool-server/server';

type DeckTool = 'artifact_read' | 'artifact_publish';

export type DeckScaleCommand = { cmd: 'call'; session: string; tool: DeckTool; args: Record<string, unknown> } | { cmd: 'release'; session: string };

/** A tool call's answer: its result (or, refused, the tool's text), its wall time and the host loop around it. */
export interface DeckCallAnswer {
  ok: true;
  isError: boolean;
  result?: unknown;
  text: string;
  wallMs: number;
  loop: LoopStats;
  busyMs: number;
}

export type DeckScaleAnswer = { ok: false; error: string } | { ok: true } | DeckCallAnswer;

export const presentationsScaleSeamRequested = (env: Record<string, string | undefined>): boolean => env.MAWS_E2E === '1' && env.MAWS_PRESENTATIONS_SCALE === '1';

interface ScaleSession {
  tools: Record<DeckTool, McpToolDefinition>;
  calls: number;
  lastRevision: number;
}

const LOOP_TICK_MS = 1;
const turned = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DeckScaleSeam {
  private readonly sessions = new Map<string, ScaleSession>();
  private readonly loop = new LoopSampler();

  constructor(private readonly store: ArtifactStore) {}

  async run(command: DeckScaleCommand): Promise<DeckScaleAnswer> {
    try {
      switch (command.cmd) {
        case 'call':
          return await this.call(command.session, command.tool, command.args);
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
  }

  private session(name: string): ScaleSession {
    let session = this.sessions.get(name);
    if (!session) {
      const deps = { artifacts: () => this.store, session: new ArtifactSession() };
      session = { tools: { artifact_read: artifactReadTool(deps), artifact_publish: artifactPublishTool(deps) }, calls: 0, lastRevision: 0 };
      this.sessions.set(name, session);
    }
    return session;
  }

  private async call(name: string, tool: DeckTool, args: Record<string, unknown>): Promise<DeckScaleAnswer> {
    const session = this.session(name);
    const definition = session.tools[tool];
    if (!definition) return { ok: false, error: `no tool ${JSON.stringify(tool)}` };
    const input = args.baseRevision === 'last' ? { ...args, baseRevision: session.lastRevision } : args;
    session.calls += 1;
    const ctx = { appSessionId: name as AppSessionId, cwd: '/', toolUseId: `toolu_deck_${name}_${session.calls}` as ToolUseId, requestId: `deck-${name}-${session.calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false };
    // as B's seam: the sampler runs all along and is reset just before the call, so a call blocking the loop at once
    // is caught by the gap it leaves, which closes once the loop turns after it
    await turned(LOOP_TICK_MS * 3);
    this.loop.reset();
    const started = performance.now();
    const result = await definition.call(input, ctx);
    const wallMs = performance.now() - started;
    await turned(LOOP_TICK_MS * 5);
    const busyMs = this.loop.busy();
    const loop = this.loop.stats();
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const isError = result.isError === true;
    let parsed: unknown;
    if (!isError) {
      parsed = JSON.parse(text);
      const revision = (parsed as { revision?: unknown }).revision;
      if (typeof revision === 'number') session.lastRevision = revision;
    }
    return { ok: true, isError, ...(parsed !== undefined && { result: parsed }), text: isError ? text : '', wallMs, loop, busyMs };
  }
}

/** The seam over the file channel in `dir` (`in`, `out`); `close` stops it. */
export function startPresentationsScaleSeam(store: ArtifactStore, dir: string, log: (line: string) => void = (line) => console.warn(`[presentations-scale] ${line}`)): { close(): void } {
  const seam = new DeckScaleSeam(store);
  return serveCommandFiles(dir, (command: DeckScaleCommand) => seam.run(command), log, () => seam.close());
}
