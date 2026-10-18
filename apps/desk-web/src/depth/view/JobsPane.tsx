// The column's jobs view (DC9; the composite's §9.4, the owner's 4A): the loop's background shells and monitors from the
// main subscription's `jobs`, drawn with MAWS's `ShellRow` and `MonitorRow` (`tools/agents/background/TaskRows.tsx`)
// under MAWS's Background work headings (`Group`), then the MCP servers by name. A shell's Output asks the machine for
// its file's tail and opens it under its row, a few lines high, the list staying in view; the answer is drawn by its
// variant (`jobs/output-requests.ts`), the tail as plain text only (a row's text is untrusted, and so is a file's). A
// job's summary, which MAWS's row does not draw, stands under it.
//
// Stop is MAWS's row as it stands, drawn on every running job (DC10): it sends DX6 `stop`, reads `stopping…` until the
// session's own body says the job no longer runs, and a failure stands under the row while the job keeps its status
// (`jobs/job-stops.ts`). Where §5's table says the session cannot stop a job — no bridge, its machine offline or
// read-only, the session not running, the desk not connected — Stop is drawn disabled with the reason on hover. MAWS's
// button takes no such prop, and MAWS is not edited for it: the desk sets `disabled` and the title on the drawn button
// after each render, and its handler sends nothing besides.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { McpServer } from 'desk-hub/protocol';
import { capabilities, type Capability } from '../../conversation/capabilities';
import type { DeskSession } from '../../shell/sessions';
import { useConnected, useDesk } from '../../views/conversation/desk-context';
import { RpcStatus } from '../../views/conversation/RpcStatus';
import { BACKGROUND_COPY } from '../../../../../src/renderer/src/tools/agents/copy';
import { Group, type BackgroundSection } from '../../../../../src/renderer/src/tools/agents/background/Group';
import { MonitorRow, ShellRow } from '../../../../../src/renderer/src/tools/agents/background/TaskRows';
import type { TaskNode } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import { useTicker } from '../../../../../src/renderer/src/tools/agents/subagents/shared';
import { jobLists } from '../jobs/job-nodes';
import { jobStop, latestStops, type JobStop } from '../jobs/job-stops';
import { JOBS_COPY, noFileNote, shortPath } from '../jobs/jobs-copy';
import type { OutputView } from '../jobs/output-requests';
import type { DeskTranscript, DepthTranscriptState } from '../source/desk-transcript';

type Section = 'shells' | 'monitors' | 'mcp';

/**
 * `agent`: a subagent's own jobs over its own subscription (DC10: a subagent's shells and monitors are stopped as the
 * main loop's are), drawn above its transcript in the drill-in, a few rows high, and only while it has any: no MCP
 * names, no note for an empty list or an older daemon.
 */
export function JobsPane({ controller, state, session, scope = 'session' }: { controller: DeskTranscript; state: DepthTranscriptState; session: DeskSession; scope?: 'session' | 'agent' }) {
  const { machine } = session;
  // The session's process is gone (its presence says no process), so no job of it will name a file now.
  const ended = session.presence?.record === null;
  const outputs = useStore(controller.outputs.state, (s) => s.open);
  const { connection, member } = useDesk();
  const can = capabilities(session, useConnected()).stop;
  const stops = latestStops(
    useStore(connection.conversation.store, (s) => s.rpcs),
    machine,
    session.session,
  );
  const onStop = (taskId: string) => {
    if (can.can) void connection.rpc(member, machine, 'stop', { session: session.session, taskId });
  };
  const stopOf = (node: TaskNode) => jobStop(stops.get(node.taskId), node.status === 'running');
  const [collapsed, setCollapsed] = useState<ReadonlySet<Section>>(new Set());
  const { jobs, mcp } = state;
  const now = useTicker(jobs?.some((job) => job.status === 'running') ?? false);
  const toggle = (id: BackgroundSection) => {
    const next = new Set(collapsed);
    if (!next.delete(id as Section)) next.add(id as Section);
    setCollapsed(next);
  };
  const group = (id: Section, heading: string, children: ReactNode) => (
    // MCP is not one of MAWS's Background sections; `Group` reads its id only as `data-section` and the toggle's key.
    <Group id={id as BackgroundSection} heading={heading} expanded={!collapsed.has(id)} onToggle={toggle}>
      {children}
    </Group>
  );

  // No jobs before the first snapshot (a disruption keeps the last ones); a served snapshot without them is an older
  // daemon's.
  if (scope === 'agent' && (jobs === null || jobs.length === 0)) return null;
  if (jobs === null) return state.phase === 'live' ? <p className="m-0 p-4 text-ui-sm text-fg-muted">{JOBS_COPY.olderDaemon(machine)}</p> : null;
  const lists = jobLists(jobs);
  const running = (nodes: TaskNode[]) => nodes.filter((node) => node.status === 'running').length;
  const empty = lists.shells.length === 0 && lists.monitors.length === 0 && (mcp ?? []).length === 0;
  const showMcp = scope === 'session' && mcp !== null && mcp.length > 0;
  return (
    <div
      data-testid={scope === 'agent' ? 'depth-agent-jobs' : 'depth-jobs'}
      className={scope === 'agent' ? 'flex max-h-48 shrink-0 flex-col overflow-auto border-b border-border py-1' : 'flex min-h-0 flex-1 flex-col overflow-auto'}
    >
      {lists.shells.length > 0 &&
        group(
          'shells',
          BACKGROUND_COPY.shellsRunning(running(lists.shells)),
          lists.shells.map((node) => {
            const view = outputs.get(node.taskId);
            const stop = stopOf(node);
            return (
              <JobRow key={node.taskId} open={view !== undefined} can={can} stop={stop}>
                <ShellRow node={{ ...node, stopping: stop.stopping }} now={now} selected={false} stopError={stop.error} onStop={onStop} onOutput={() => (view ? controller.outputs.close(node.taskId) : controller.outputs.open(node.taskId))} />
                <JobSummary node={node} />
                {view && <OutputPanel taskId={node.taskId} path={node.outputFile} view={view} machine={machine} final={ended || node.status !== 'running'} controller={controller} />}
              </JobRow>
            );
          }),
        )}
      {lists.monitors.length > 0 &&
        group(
          'monitors',
          BACKGROUND_COPY.monitors(lists.monitors.length),
          lists.monitors.map((node) => {
            const stop = stopOf(node);
            return (
              <JobRow key={node.taskId} can={can} stop={stop}>
                <MonitorRow node={{ ...node, stopping: stop.stopping }} now={now} selected={false} stopError={stop.error} onStop={onStop} />
                <JobSummary node={node} />
                {node.outputFile === null && <p className="m-0 mx-3 px-2 pb-1 pl-[22px] text-ui-sm text-fg-muted">{JOBS_COPY.monitorNoFile}</p>}
              </JobRow>
            );
          }),
        )}
      {showMcp && group('mcp', JOBS_COPY.mcp(mcp.length), <McpList servers={mcp} />)}
      {empty && <p className="m-0 flex flex-1 items-center justify-center p-4 text-ui text-fg-muted">{JOBS_COPY.none}</p>}
    </div>
  );
}

/**
 * One job's row and what opens under it. MAWS's Stop is disabled while the job is stopping, and where the session
 * cannot stop a job, saying why (§5); a stop whose fate is unknown draws the desk's RPC status under the row, with its
 * Retry. An open output draws inside the row's selected border (the owner's 4A), so the border is the row's wrapper's
 * and MAWS's row gives up its margin.
 */
function JobRow({ open = false, can, stop, children }: { open?: boolean; can: Capability; stop: JobStop; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const button of ref.current?.querySelectorAll('button') ?? []) {
      if (button.textContent !== BACKGROUND_COPY.stop && button.textContent !== BACKGROUND_COPY.stopping) continue;
      // Set every time: React writes `disabled` only when its own prop (`stopping`) changes, so a reason that went
      // away would otherwise leave the button disabled.
      button.disabled = stop.stopping || !can.can;
      if (can.reason === null) {
        button.removeAttribute('title');
        button.removeAttribute('aria-description');
      } else {
        button.title = can.reason;
        button.setAttribute('aria-description', can.reason);
      }
    }
  });
  return (
    <div ref={ref} data-job-row="" data-open={open} data-stop={stop.stopping ? 'stopping' : stop.error !== null ? 'failed' : undefined} className={open ? 'mx-3 flex flex-col rounded-sm border border-accent [&>[data-task-id]]:mx-0' : undefined}>
      {children}
      {stop.status !== null && <RpcStatus nonce={stop.status} className="mx-3 block px-2 pb-1 pl-[22px]" />}
    </div>
  );
}

/**
 * The job's summary, as its notification or `task_status` gave it, under MAWS's row, which draws none: what a job did
 * stays readable when its output file is gone (DX4: `missing` leaves the row's own summary standing). Plain text.
 */
function JobSummary({ node }: { node: TaskNode }) {
  if (!node.summary) return null;
  return (
    <p data-part="summary" title={node.summary} className="m-0 mx-3 truncate px-2 pb-1 pl-[22px] text-ui-sm text-fg-muted">
      {node.summary}
    </p>
  );
}

function McpList({ servers }: { servers: McpServer[] }) {
  return (
    <>
      <ul data-testid="depth-mcp" className="m-0 flex list-none flex-col gap-0.5 py-0 pr-3.5 pb-1 pl-[26px] font-mono text-ui-sm leading-6">
        {servers.map(({ name }) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p className="m-0 px-3.5 pb-1 pl-[26px] text-ui-sm text-fg-faint">{JOBS_COPY.mcpNote}</p>
    </>
  );
}

const ACTION = 'rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

/** A shell's output under its row: its path, Refresh and Close, then the machine's answer by its variant. */
function OutputPanel({ taskId, path, view, machine, final, controller }: { taskId: string; path: string | null; view: OutputView; machine: string; final: boolean; controller: DeskTranscript }) {
  const shown = view.phase === 'ok' ? view.answer : view.phase === 'asking' ? view.last : null;
  const named = shown?.path ?? (view.phase === 'refused' ? view.path : view.phase === 'missing' ? view.path : null) ?? path;
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight; // a log is read from its end
  }, [shown?.text]);
  return (
    <div data-testid="job-output" data-task={taskId} data-phase={view.phase} className="mx-2 mb-2 ml-[22px] flex flex-col overflow-hidden rounded-sm border border-border bg-bg">
      <div className="flex items-center gap-1 border-b border-border px-2 py-0.5">
        <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-fg-muted" title={named ?? undefined}>
          {named === null ? '' : shortPath(named)}
        </span>
        {view.phase !== 'refused' && (
          <button type="button" className={ACTION} disabled={view.phase === 'asking'} onClick={() => controller.outputs.refresh(taskId)}>
            {JOBS_COPY.refresh}
          </button>
        )}
        <button type="button" className={ACTION} onClick={() => controller.outputs.close(taskId)}>
          {JOBS_COPY.close}
        </button>
      </div>
      {shown ? (
        <>
          {shown.truncated && <p className="m-0 px-2 pt-1 text-ui-sm text-fg-faint">{JOBS_COPY.before(shown.from)}</p>}
          {shown.text === '' ? (
            <p className="m-0 px-2 py-1.5 text-ui-sm text-fg-muted">{JOBS_COPY.empty}</p>
          ) : (
            <pre ref={pre} data-part="tail" className={`m-0 max-h-48 overflow-auto px-2 py-1.5 font-mono text-ui-sm leading-5 break-all whitespace-pre-wrap ${view.phase === 'asking' ? 'text-fg-muted' : 'text-fg'}`}>
              {shown.text}
            </pre>
          )}
        </>
      ) : (
        <OutputNote view={view} machine={machine} final={final} />
      )}
    </div>
  );
}

/** `final`: the job has ended or its session has, so a file not named yet never will be. */
function OutputNote({ view, machine, final }: { view: OutputView; machine: string; final: boolean }) {
  const note = (main: string, why?: string, tone = 'text-fg') => (
    <p className={`m-0 px-2 py-1.5 text-ui-sm ${tone}`}>
      {main}
      {why && <span className="text-fg-muted"> {why}</span>}
    </p>
  );
  switch (view.phase) {
    case 'asking':
      return note(JOBS_COPY.asking(machine), undefined, 'text-fg-muted');
    case 'missing': {
      if (view.path !== null) return note(JOBS_COPY.gone(machine), JOBS_COPY.goneWhy);
      const { main, why } = noFileNote(final);
      return note(main, why);
    }
    case 'refused':
      return (
        <p role="alert" className="m-0 bg-warning/10 px-2 py-1.5 text-ui-sm text-warning">
          {JOBS_COPY.refused(machine, view.reason)}
        </p>
      );
    case 'checking':
      return note(JOBS_COPY.checking(machine), undefined, 'text-fg-muted');
    case 'unknown':
      return note(JOBS_COPY.unknown(machine));
    case 'ok':
      return null;
  }
}
