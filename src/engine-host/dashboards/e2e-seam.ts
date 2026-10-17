// The dashboard's acceptance seam (P3-E2 M6 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md; P3-E Decision Log
// 36 (1)): what `e2e:dashboard` and `e2e:dashboard-scale` drive the agent's half through, started only when the host
// runs under both MAWS_E2E=1 and MAWS_DASHBOARD_E2E=1. Each command names an agent session (its name is the app session
// id the tools credit, so a session of the e2e's stub scenario is named by its title), and the session's tools are the
// `maws` server's own list (`mawsTools`, the composition a session's server serves: B's kind-aware create and read, the
// legacy guard, `artifact_dataset`, B's thread tools under the dashboard kind), called through their real `call` with a
// real scratch working directory as the context's cwd (never `/`): a file the e2e writes there is a file under the
// session's directory, as an agent's Write leaves it. No engine, no renderer shortcut: the path an agent's call takes in
// the host, less the engine's wire. Around each call the host loop is sampled as the deck's seam samples it.
//
// Commands arrive as JSON files in `<dir>/in` and are answered in `<dir>/out` under the same name (B's file channel,
// `serveCommandFiles`); no IPC name is added.
//
//   cwd      {session}                                  the session's working directory, made if absent
//   call     {session, tool, args, toolUseId?}          a tool of the session's list as `session`; `baseRevision:
//                                                       'last'` stands for the revision the session last saw; a
//                                                       given `toolUseId` repeats a call (a replay), else a fresh one
//   release  {session}                                  the session's replicas closed (its end)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { LoopSampler, serveCommandFiles, type LoopStats } from '../documents/kinds/document-perf';
import type { ArtifactStore } from '../documents/store';
import { ArtifactSession } from '../tool-server/artifact-context';
import { AskTable } from '../tool-server/asks';
import { HostBridge } from '../tool-server/bridge';
import { PaneBridge } from '../tool-server/panes';
import type { McpToolDefinition } from '../tool-server/server';
import { mawsTools } from '../tool-server/tools';

/** The tools the seam serves: the agent's dashboard path, nothing that shows a pane, asks or captures. */
export const DASHBOARD_SEAM_TOOLS = ['artifact_create', 'artifact_read', 'artifact_edit', 'artifact_dataset', 'artifact_list_assets', 'artifact_comments', 'artifact_reply', 'artifact_resolve'] as const;
export type DashboardSeamTool = (typeof DASHBOARD_SEAM_TOOLS)[number];

export type DashboardSeamCommand =
  | { cmd: 'cwd'; session: string }
  | { cmd: 'call'; session: string; tool: DashboardSeamTool; args: Record<string, unknown>; toolUseId?: string }
  | { cmd: 'release'; session: string };

/** A tool call's answer: its result (or, refused, the tool's text), its wall time and the host loop around it. */
export interface DashboardCallAnswer {
  ok: true;
  isError: boolean;
  result?: unknown;
  text: string;
  toolUseId: string;
  wallMs: number;
  /** When the call answered, in epoch ms (the host's clock): its commit had landed, so a view's redraw is timed from it. */
  endedAt: number;
  loop: LoopStats;
  busyMs: number;
}

export type DashboardSeamAnswer = { ok: false; error: string } | { ok: true; cwd?: string } | DashboardCallAnswer;

export const dashboardE2eSeamRequested = (env: Record<string, string | undefined>): boolean => env.MAWS_E2E === '1' && env.MAWS_DASHBOARD_E2E === '1';

interface SeamSession {
  tools: Map<string, McpToolDefinition>;
  cwd: string;
  calls: number;
  lastRevision: number;
}

const LOOP_TICK_MS = 1;
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // a directory name under the seam's own
const turned = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DashboardE2eSeam {
  private readonly sessions = new Map<string, SeamSession>();
  private readonly loop = new LoopSampler();

  /** `root`: the directory under which each session's working directory is made (`<root>/<session>`). */
  constructor(
    private readonly store: ArtifactStore,
    private readonly root: string,
  ) {}

  async run(command: DashboardSeamCommand): Promise<DashboardSeamAnswer> {
    try {
      switch (command.cmd) {
        case 'cwd':
          return { ok: true, cwd: this.session(command.session).cwd };
        case 'call':
          return await this.call(command);
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

  private session(name: string): SeamSession {
    if (!SESSION.test(name)) throw new Error(`a session is named in letters, digits, "-" and "_" (at most 64), not ${JSON.stringify(name)}`);
    let session = this.sessions.get(name);
    if (!session) {
      const cwd = join(this.root, name);
      mkdirSync(cwd, { recursive: true });
      const list = mawsTools({
        bridge: new PaneBridge({ show: () => {} }),
        capture: new HostBridge({ send: () => {}, answerMs: 1_000 }),
        asks: new AskTable(),
        askCancelled: () => {},
        artifacts: () => this.store,
        session: new ArtifactSession(),
      });
      session = { tools: new Map(list.filter((tool) => (DASHBOARD_SEAM_TOOLS as readonly string[]).includes(tool.name)).map((tool) => [tool.name, tool])), cwd, calls: 0, lastRevision: 0 };
      this.sessions.set(name, session);
    }
    return session;
  }

  private async call({ session: name, tool, args, toolUseId }: Extract<DashboardSeamCommand, { cmd: 'call' }>): Promise<DashboardSeamAnswer> {
    const session = this.session(name);
    const definition = session.tools.get(tool);
    if (!definition) return { ok: false, error: `no tool ${JSON.stringify(tool)} at the dashboard seam` };
    const input = args.baseRevision === 'last' ? { ...args, baseRevision: session.lastRevision } : args;
    session.calls += 1;
    const use = toolUseId ?? `toolu_dash_${name}_${session.calls}`;
    const ctx = { appSessionId: name as AppSessionId, cwd: session.cwd, toolUseId: use as ToolUseId, requestId: `dash-${name}-${session.calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false };
    // as the deck's seam: the sampler runs all along and is reset just before the call
    await turned(LOOP_TICK_MS * 3);
    this.loop.reset();
    const started = performance.now();
    const result = await definition.call(input, ctx);
    const wallMs = performance.now() - started;
    const endedAt = Date.now();
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
    return { ok: true, isError, ...(parsed !== undefined && { result: parsed }), text: isError ? text : '', toolUseId: use, wallMs, endedAt, loop, busyMs };
  }
}

/** The seam over the file channel in `dir` (`in`, `out`; the sessions' directories under `cwd`); `close` stops it. */
export function startDashboardE2eSeam(store: ArtifactStore, dir: string, log: (line: string) => void = (line) => console.warn(`[dashboard-e2e] ${line}`)): { close(): void } {
  const seam = new DashboardE2eSeam(store, join(dir, 'cwd'));
  return serveCommandFiles(dir, (command: DashboardSeamCommand) => seam.run(command), log, () => seam.close());
}
