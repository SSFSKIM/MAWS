// The Subagents card (UX wave U8b, M8; its execution document, decisions 1 to 6 and 8, Interfaces §D, §E and §F): drawn
// while an agent of the session runs. Its heading counts every running agent (`runningAgents`, the panel's `Running N`)
// and opens the Subagents panel. Its rows are the first-level agents that run or have a running agent under them
// (`onCard`), four at most and then `N more`; each row is the agent's mark, its name, one line of its own state and a
// coarse elapsed time. A row with running agents under it shows `(+N)` and an arrow, a control of its own that opens
// them beneath the row, one level at a time, by the set the panel shares (`useOpenAgents`); a press anywhere else on a
// row opens that agent in the panel. `N finished`, the panel's Done count, is its last line and opens that fold.
import { useId, useMemo } from 'react';
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { SubagentGlyph } from '../../transcript';
import { SUBAGENTS_COPY } from '../../tools/agents/copy';
import { agentsRunningUnder, emptyGraph, firstLevelAgents, isEnded, listedAgent, nestedOf, onCard, rowSecondLine, rowTitle, runningAgents, type TaskGraph, type TaskNode } from '../../tools/agents/model/task-graph';
import { openOf, useOpenAgents } from '../../tools/agents/open-agents';
import { useTaskGraph } from '../../tools/agents/store';
import { Disclosure } from '../../tools/agents/subagents/AgentRow';
import { outcomeWord, refOf } from '../../tools/agents/subagents/shared';
import { AGENT_TOOL_IDS } from '../../tools/agents/tool-ids';
import { SUMMARY_COPY } from '../copy';
import { panelHost } from '../host';
import { CARD_ROWS, coarseElapsed, RunningCard, useCardClock } from './RunningCard';

const EMPTY_GRAPH = emptyGraph();

export interface CardAgentRow {
  taskId: TaskId;
  depth: number;
  orphan: boolean; // a first-level row whose parent the session does not list (`· nested`)
}

// The card's rows: the first four first-level agents `onCard` keeps, each followed, while the person has opened it, by
// its direct children by the same rule, and theirs under an opened child. Pure.
export function cardAgentRows(graph: TaskGraph, open: ReadonlySet<TaskId>): { rows: CardAgentRow[]; more: number } {
  const rows: CardAgentRow[] = [];
  const seen = new Set<TaskId>(); // a parent cycle the engine cannot make lists nobody twice
  const visit = (taskId: TaskId, depth: number) => {
    if (seen.has(taskId)) return;
    seen.add(taskId);
    rows.push({ taskId, depth, orphan: depth === 0 && (graph.tasks.get(taskId)?.agent?.parentAgentId ?? null) !== null });
    if (open.has(taskId)) for (const child of onCard(graph, nestedOf(graph, taskId).active)) visit(child, depth + 1);
  };
  const first = onCard(graph, firstLevelAgents(graph).running);
  first.slice(0, CARD_ROWS).forEach((taskId) => visit(taskId, 0));
  return { rows, more: Math.max(0, first.length - CARD_ROWS) };
}

// The Subagents panel through the host (M8 decision 4: it comes into view in place of the tab in view), a pinned tab
// on another session following this one first.
const openPanel = (appSessionId: AppSessionId, params: { agentId?: AgentId; section?: 'done' } = {}) =>
  panelHost.addTool(AGENT_TOOL_IDS.subagents, { appSessionId, params: { ...params, appSessionId } });

export function SubagentsCard({ appSessionId }: { appSessionId: AppSessionId }) {
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const open = useOpenAgents((s) => openOf(s, appSessionId));
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  // An agent with an open request of its own: the panel's source (Interfaces §C.6).
  const waiting = useMemo(() => new Set<string>(pending.flatMap((item) => [item.request.agentId, item.request.taskId].filter((id): id is NonNullable<typeof id> => id !== null))), [pending]);
  const { rows, more } = useMemo(() => cardAgentRows(graph, open), [graph, open]);
  const nodes = rows.map((row) => graph.tasks.get(row.taskId)!);
  const now = useCardClock(nodes);
  const running = runningAgents(graph);
  if (running === 0) return null;
  return (
    <RunningCard
      title={SUMMARY_COPY.sections.subagents}
      running={running}
      more={more}
      finished={firstLevelAgents(graph).done.length}
      onOpen={() => openPanel(appSessionId)}
      onFinished={() => openPanel(appSessionId, { section: 'done' })}
    >
      {rows.map((row, i) => (
        <CardAgentRowView
          key={row.taskId}
          row={row}
          node={nodes[i]!}
          graph={graph}
          waiting={waiting.has(row.taskId as string)}
          now={now}
          onOpen={() => openPanel(appSessionId, { agentId: row.taskId as unknown as AgentId })}
          under={agentsRunningUnder(graph, row.taskId) > 0 ? { open: open.has(row.taskId), onToggle: () => useOpenAgents.getState().toggle(appSessionId, row.taskId) } : null}
        />
      ))}
    </RunningCard>
  );
}

// The row's one line: `Approval needed` while a request of its own waits; else its activity (`Working` without one); for
// an agent whose own run has ended, kept by an agent running under it, its outcome word without a time. Never what runs
// under it.
function stateOf(node: TaskNode, waiting: boolean): { text: string; tone: string } {
  if (waiting) return { text: SUBAGENTS_COPY.approvalNeeded, tone: 'text-warning' };
  if (isEnded(node.status)) return { text: outcomeWord(node), tone: node.status === 'failed' ? 'text-danger' : 'text-fg-muted' };
  return { text: rowSecondLine(node), tone: 'text-fg-muted' };
}

// Two sibling controls, as the panel's row (`AgentRow`): the row's own button laid over the whole row, its content drawn
// above it with pointer events passing through, and the disclosure between the content and the elapsed time; two
// keyboard stops, the row first. A nested row is indented 16 px with a rule at its left.
function CardAgentRowView({ row, node, graph, waiting, now, onOpen, under }: {
  row: CardAgentRow;
  node: TaskNode;
  graph: TaskGraph;
  waiting: boolean;
  now: number;
  onOpen: () => void;
  under: { open: boolean; onToggle: () => void } | null;
}) {
  const id = useId();
  const title = rowTitle(node);
  const state = stateOf(node, waiting);
  const parent = row.orphan ? graph.tasks.get(node.agent!.parentAgentId as unknown as TaskId) : undefined;
  return (
    <div
      data-agent-row={row.taskId}
      data-depth={row.depth}
      data-waiting={waiting || undefined}
      style={{ marginInlineStart: row.depth * 16 }}
      className={`relative flex min-h-10 items-stretch ${row.depth > 0 ? 'border-l border-border-strong' : ''}`}
    >
      <button
        type="button"
        data-part="open"
        aria-labelledby={`${id}-text ${id}-elapsed`}
        onClick={onOpen}
        className="absolute inset-0 outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
      />
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3">
        <SubagentGlyph agent={refOf(node)} className="shrink-0 text-ui text-accent" />
        <span id={`${id}-text`} className="min-w-0 flex-1 text-left">
          <span className="block min-w-0 truncate font-medium">
            <span data-part="title">{title}</span>
            {row.orphan && (
              <span data-part="nested" title={parent !== undefined && listedAgent(parent) ? SUBAGENTS_COPY.childOf(rowTitle(parent)) : SUBAGENTS_COPY.childOfUnlisted} className="ml-1.5 text-ui-sm font-normal text-fg-muted">
                {SUBAGENTS_COPY.nested}
              </span>
            )}
          </span>
          <span data-part="line" title={state.text} className={`block min-w-0 truncate text-ui-sm ${state.tone}`}>
            {state.text}
          </span>
        </span>
      </span>
      {under && <Disclosure taskId={row.taskId} title={title} graph={graph} open={under.open} onToggle={under.onToggle} />}
      <span id={`${id}-elapsed`} data-part="elapsed" className="pointer-events-none relative flex shrink-0 items-center pr-3 pl-2 text-ui-sm whitespace-nowrap text-fg-muted tabular-nums">
        {coarseElapsed(node, now)}
      </span>
    </div>
  );
}
