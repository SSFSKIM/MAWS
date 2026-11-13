// One agent's row in the Subagents panel (C8b M2; the UX wave's U8b document, M7 decisions 4 to 6; Interfaces §F): two
// controls side by side, neither inside the other, and two keyboard stops in this order. The row itself opens that
// agent (its drill-in), whatever is under it: a button laid over the whole row, so a press anywhere else on the row is
// its press. Its disclosure, drawn while agents are under the row, opens or closes them beneath it: `(+N)` while it is
// closed and N agents run under it at any depth, then an arrow, turned while open, at the row's right end before the
// elapsed time, as tall as the row. The line under the title is the agent's own state and says nothing of what runs
// under it, except for an agent whose own run has ended while a task it started still runs (item 359): its outcome word
// without a time, then how many background tasks run under it, the part of the line that is never cut.
import { useId } from 'react';
import type { AgentId, TaskId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import { SubagentGlyph } from '../../../transcript';
import { SUBAGENTS_COPY } from '../copy';
import { elapsedOf, formatElapsed } from '../model/elapsed';
import { agentsRunningUnder, isEnded, outcomeSummary, rowSecondLine, rowTitle, runningUnder, tasksRunningUnder, type TaskGraph, type TaskNode, type TreeRow } from '../model/task-graph';
import { outcomeOf, outcomeWord, refOf } from './shared';

type AgentTreeRow = Extract<TreeRow, { kind: 'agent' }>;
export const indent = (depth: number) => ({ marginInlineStart: depth * 24 });

// The row's line: its state (cut first when the row is narrow, unless `whole`), then what still runs under an agent
// whose own run has ended.
interface Line {
  state: string;
  tone: 'muted' | 'danger' | 'warning';
  tasks: string;
  whole: boolean;
}

function lineOf(node: TaskNode, graph: TaskGraph, waiting: boolean, now: number): Line {
  const tone = node.status === 'failed' ? 'danger' : 'muted';
  const kept = isEnded(node.status) && runningUnder(graph, node.taskId) > 0;
  const tasks = tasksRunningUnder(graph, node.taskId);
  const base: Line = kept
    ? { state: outcomeWord(node), tone, tasks: tasks > 0 ? SUBAGENTS_COPY.tasksRunning(tasks) : '', whole: true }
    : node.status === 'running'
      ? { state: rowSecondLine(node), tone: 'muted', tasks: '', whole: false }
      : node.status === 'unknown'
        ? { state: SUBAGENTS_COPY.statusUnavailable, tone: 'muted', tasks: '', whole: false }
        : { state: outcomeSummary(node) ? `${outcomeOf(node, now)} · ${outcomeSummary(node)}` : outcomeOf(node, now), tone, tasks: '', whole: false };
  return waiting ? { ...base, state: SUBAGENTS_COPY.approvalNeeded, tone: 'warning' } : base;
}

const TONE = { muted: 'text-fg-muted', danger: 'text-danger', warning: 'text-warning' } as const;

export function AgentRow({
  row, graph, waiting, now, onOpen, under,
}: {
  row: AgentTreeRow;
  graph: TaskGraph;
  waiting: boolean;
  now: number;
  onOpen: (agentId: AgentId) => void;
  under: { open: boolean; onToggle: () => void } | null; // the disclosure, while agents are under the row
}) {
  const id = useId();
  const node = graph.tasks.get(row.taskId)!;
  const parent = row.parentTaskId === null ? undefined : graph.tasks.get(row.parentTaskId as TaskId);
  const listedParent = parent !== undefined && parent.kind === 'agent' && (parent.agent?.runId ?? null) === null;
  const title = rowTitle(node);
  let elapsed = '';
  if (node.status === 'running') {
    const e = elapsedOf(node, now);
    elapsed = e ? formatElapsed(e.ms) : SUBAGENTS_COPY.elapsedUnavailable;
  }
  const line = lineOf(node, graph, waiting, now);
  return (
    <div
      data-agent-row={row.taskId}
      data-depth={row.depth}
      data-waiting={waiting || undefined}
      style={indent(row.depth)}
      className={`relative flex min-h-12 items-stretch ${row.depth > 0 ? 'border-l border-border-strong' : ''}`}
    >
      <button
        type="button"
        data-part="open"
        aria-labelledby={`${id}-text ${id}-elapsed`}
        onClick={() => onOpen(row.taskId as unknown as AgentId)}
        className="absolute inset-0 outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
      />
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3.5">
        <SubagentGlyph agent={refOf(node)} className={`shrink-0 text-accent ${row.depth > 0 ? 'text-ui' : 'text-prose'}`} />
        <span id={`${id}-text`} className="min-w-0 flex-1 text-left">
          <span className="block min-w-0 truncate font-medium">
            <span data-part="title">{title}</span>
            {row.orphan && (
              <span data-part="nested" title={listedParent ? SUBAGENTS_COPY.childOf(rowTitle(parent)) : SUBAGENTS_COPY.childOfUnlisted} className="ml-1.5 text-ui-sm font-normal text-fg-muted">
                {SUBAGENTS_COPY.nested}
              </span>
            )}
          </span>
          <span data-part="line" title={`${line.state}${line.tasks}`} className="flex min-w-0 text-ui-sm text-fg-muted">
            <span data-part="state" className={`${line.whole ? 'shrink-0 whitespace-nowrap' : 'min-w-0 truncate'} ${TONE[line.tone]}`}>
              {line.state}
            </span>
            {line.tasks !== '' && (
              <span data-part="tasks" className="shrink-0 whitespace-pre">
                {line.tasks}
              </span>
            )}
          </span>
        </span>
      </span>
      {under && <Disclosure taskId={row.taskId} title={title} graph={graph} open={under.open} onToggle={under.onToggle} />}
      <span id={`${id}-elapsed`} data-part="elapsed" className="pointer-events-none relative flex shrink-0 items-center pr-3.5 pl-2 text-ui-sm whitespace-nowrap text-fg-muted tabular-nums">
        {elapsed}
      </span>
    </div>
  );
}

// `(+N)` and its arrow: N the running agents under the row at any depth, drawn while it is closed and N is above zero.
export function Disclosure({ taskId, title, graph, open, onToggle }: { taskId: TaskId; title: string; graph: TaskGraph; open: boolean; onToggle: () => void }) {
  const n = open ? 0 : agentsRunningUnder(graph, taskId);
  return (
    <button
      type="button"
      data-part="under"
      aria-expanded={open}
      aria-label={SUBAGENTS_COPY.underLabel(n, title)}
      onClick={onToggle}
      className="relative flex shrink-0 items-center gap-0.5 px-1.5 text-ui-sm text-fg-faint tabular-nums outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      {n > 0 && <span data-part="under-count">{SUBAGENTS_COPY.under(n)}</span>}
      <Chevron open={open} />
    </button>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <Icon className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`}>
      <path d="M6 4l4 4-4 4" />
    </Icon>
  );
}
