// The Subagents lists (C8b execution document, M2; mockup 03 study 01), as E7 makes them a tree (E7 execution document,
// Design §3 and §5; G2): **Agents**, the running roots in first-seen order with their subtrees (a running parent's
// finished children folded under one `Done · N`, the running teammates grouped first under the team header, in one
// labelled group), **Done**, the finished roots newest end first with their children, collapsed by default, and
// **On disk** as before (status unknown, `agentRows`). A child whose parent the tree does not hold reads `· nested` at
// depth 0 with a tooltip naming the parent. A workflow's agents are in no list. A row reads by its own status wherever
// it sits: a running one ticks its elapsed once a second while shown and the tool visible, a finished one its `<ago>`
// on the slow tick.
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import { Icon } from '../../../app/IconButton';
import type { PanelToolContext } from '../../../panel/tool';
import { selectPendingOf, useAttention } from '../../../stores/attention';
import { SubagentGlyph, useTranscriptStore } from '../../../transcript';
import { SUBAGENTS_COPY } from '../copy';
import { elapsedOf, formatAgo, formatElapsed } from '../model/elapsed';
import { agentRows, agentTree, emptyGraph, isEnded, outcomeSummary, rowSecondLine, rowTitle, shownRows, type TaskGraph, type TreeRow } from '../model/task-graph';
import { teammatesOf, withTeam } from '../model/teammates';
import { useTaskGraph } from '../store';
import { outcomeOf, refOf, SLOW_TICK_MS, useTicker } from './shared';
import type { ListSection, SubagentsHandle, SubagentsState } from './SubagentsTool';

const EMPTY_GRAPH = emptyGraph();
const SECTIONS: readonly ListSection[] = ['agents', 'done', 'disk'];
type AgentTreeRow = Extract<TreeRow, { kind: 'agent' }>;

interface Props {
  appSessionId: AppSessionId;
  handle: SubagentsHandle;
  expanded: SubagentsState['expanded'];
  shown: SubagentsState['shown'];
  expandedFolds: SubagentsState['expandedFolds'];
  scrollTop: number;
  ctx: PanelToolContext;
}

export function AgentList({ appSessionId, handle, expanded, shown, expandedFolds, scrollTop, ctx }: Props) {
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const sidecarsError = useTaskGraph((s) => s.entries.get(appSessionId)?.disk.error ?? null);
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  // An agent with an open request of its own (the child's permission, answered in its drill-in).
  const waiting = useMemo(() => new Set<string>(pending.flatMap((item) => [item.request.agentId, item.request.taskId].filter((id): id is NonNullable<typeof id> => id !== null))), [pending]);
  const live = ctx.status !== null;
  // The roster: the newest listing's Teammates, from the transcript's activity (both paths, every launch).
  const activity = useTranscriptStore((s) => s.activity(appSessionId));
  const roster = useMemo(() => teammatesOf(activity), [activity]);
  const tree = useMemo(() => withTeam(agentTree(graph), graph, roster), [graph, roster]);

  const rows = useMemo(
    (): Record<ListSection, TreeRow[]> => ({
      agents: shownRows(tree.agents, expandedFolds),
      done: tree.done,
      disk: agentRows(graph, 'disk').map((row): TreeRow => ({ kind: 'agent', ...row, foldedUnder: null })),
    }),
    [tree, graph, expandedFolds],
  );
  const headings: Record<ListSection, string> = { agents: SUBAGENTS_COPY.agents(tree.running), done: SUBAGENTS_COPY.done(rows.done.length), disk: SUBAGENTS_COPY.onDisk(rows.disk.length) };
  const boundOf = (name: ListSection) => (name === 'disk' ? rows.disk.length : shown[name]);
  const visible = SECTIONS.flatMap((name) => (expanded[name] ? rows[name].slice(0, boundOf(name)) : []));
  // A shown running agent's elapsed ticks once a second; a shown finished one's (and a roster teammate's) `<ago>` on
  // the slow tick. Neither ticks while nothing of its kind is shown or the tool is hidden.
  const nodeOf = (row: TreeRow) => (row.kind === 'agent' ? graph.tasks.get(row.taskId) : undefined);
  const ticks = (row: TreeRow) => {
    const node = nodeOf(row);
    return node !== undefined && elapsedOf(node, 0)?.live === true;
  };
  const ages = (row: TreeRow) => {
    const node = nodeOf(row);
    return row.kind === 'roster' || (node !== undefined && isEnded(node.status));
  };
  const fast = useTicker(visible.some(ticks) && ctx.visible);
  const slow = useTicker(visible.some(ages) && ctx.visible, SLOW_TICK_MS);
  const now = Math.max(fast, slow);

  const scroller = useRef<HTMLDivElement>(null);
  const [restoreTo] = useState(scrollTop); // Back and a remount return to where the lists were
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restoreTo;
  }, [restoreTo]);

  const any = SECTIONS.some((name) => rows[name].length > 0);
  return (
    <div data-view="lists" ref={scroller} onScroll={(e) => handle.setScrollTop(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto">
      {!live && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-fg-muted">{SUBAGENTS_COPY.diskOnly}</p>}
      {sidecarsError !== null && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-danger">{SUBAGENTS_COPY.sidecarsUnavailable(sidecarsError)}</p>}
      {SECTIONS.filter((name) => rows[name].length > 0).map((name) => (
        <section key={name} data-section={name} aria-label={headings[name]} className="flex shrink-0 flex-col border-b border-border pb-1 last-of-type:border-b-0">
          <h3 className="flex h-9 items-center px-3.5 text-ui font-semibold">
            <button type="button" aria-expanded={expanded[name]} onClick={() => handle.toggle(name)} className="rounded-sm outline-accent focus-visible:outline-2">
              {headings[name]}
            </button>
          </h3>
          {expanded[name] && (
            <>
              {grouped(rows[name].slice(0, boundOf(name))).map((part) =>
                Array.isArray(part) ? (
                  <TeamGroup key="team" rows={part} graph={graph} waiting={waiting} now={now} handle={handle} />
                ) : (
                  <TreeRowView key={keyOf(part)} row={part} graph={graph} waiting={waiting} now={now} handle={handle} />
                ),
              )}
              {rows[name].length > boundOf(name) && name !== 'disk' && (
                <button type="button" onClick={() => handle.showMore(name, rows[name].length)} className="ml-12 h-7 self-start rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
                  {SUBAGENTS_COPY.showMore(rows[name].length - boundOf(name))}
                </button>
              )}
            </>
          )}
        </section>
      ))}
      {!any && sidecarsError === null && <p className="flex flex-1 items-center justify-center p-4 text-ui text-fg-muted">{SUBAGENTS_COPY.empty}</p>}
      {live && any && (
        <footer className="mt-auto flex shrink-0 items-center gap-2 border-t border-border px-3.5 py-2.5 text-ui-sm text-fg-muted">
          <span aria-hidden className="size-1.5 rounded-full bg-success" />
          {SUBAGENTS_COPY.footer}
        </footer>
      )}
    </div>
  );
}

// The rows as drawn: the team header and its members (the deeper rows after it) as one part, every other row alone.
function grouped(rows: TreeRow[]): (TreeRow | TreeRow[])[] {
  const out: (TreeRow | TreeRow[])[] = [];
  for (const row of rows) {
    const last = out.at(-1);
    if (row.kind === 'team') out.push([row]);
    else if (Array.isArray(last) && row.depth > 0) last.push(row);
    else out.push(row);
  }
  return out;
}

type RowProps = { graph: TaskGraph; waiting: ReadonlySet<string>; now: number; handle: SubagentsHandle };

// The team header and its rows in one group named by the header.
function TeamGroup({ rows, ...props }: RowProps & { rows: TreeRow[] }) {
  const id = useId();
  const [header, ...members] = rows;
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <div id={id} data-team data-depth={header!.depth} className="flex h-8 items-center px-3.5 text-ui-sm font-medium text-fg-muted">
        {SUBAGENTS_COPY.team}
      </div>
      {members.map((row) => (
        <TreeRowView key={keyOf(row)} row={row} {...props} />
      ))}
    </div>
  );
}

const keyOf = (row: TreeRow) =>
  row.kind === 'agent' ? row.taskId : row.kind === 'done-fold' ? `fold:${row.parentTaskId}` : row.kind === 'roster' ? `roster:${row.name}` : 'team';
const indent = (depth: number) => ({ marginInlineStart: depth * 24 });

function TreeRowView({ row, graph, waiting, now, handle }: RowProps & { row: TreeRow }) {
  if (row.kind === 'agent') return <AgentRowButton row={row} graph={graph} waiting={waiting.has(row.taskId as string)} now={now} onOpen={handle.openAgent} />;
  if (row.kind === 'done-fold') {
    const parent = graph.tasks.get(row.parentTaskId);
    return (
      <button
        type="button"
        data-fold={row.parentTaskId}
        data-depth={row.depth}
        aria-expanded={row.expanded}
        aria-label={SUBAGENTS_COPY.foldLabel(row.count, parent ? rowTitle(parent) : (row.parentTaskId as string))}
        onClick={() => handle.toggleFold(row.parentTaskId)}
        style={indent(row.depth)}
        className="flex h-8 items-center gap-1.5 self-start border-l border-border-strong pr-2 pl-3.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2"
      >
        <Icon className={`size-3 transition-transform ${row.expanded ? 'rotate-90' : ''}`}>
          <path d="M6 4l4 4-4 4" />
        </Icon>
        {SUBAGENTS_COPY.done(row.count)}
      </button>
    );
  }
  if (row.kind === 'team') return null; // drawn by TeamGroup
  return (
    <div data-roster={row.name} data-depth={row.depth} title={SUBAGENTS_COPY.teammateNoTranscript} style={indent(row.depth)} className="flex min-h-12 items-center gap-2.5 border-l border-border-strong px-3.5 py-2">
      <span aria-hidden className="size-4 shrink-0 rounded-full border border-dashed border-border-strong" />
      <span className="min-w-0 flex-1">
        <span data-part="title" className="block truncate font-medium">
          {row.name}
        </span>
        <span data-part="line" className="block truncate text-ui-sm text-fg-muted">
          {SUBAGENTS_COPY.teammateListed(row.extras, formatAgo(now - Date.parse(row.at)))}
        </span>
      </span>
    </div>
  );
}

function AgentRowButton({ row, graph, waiting, now, onOpen }: { row: AgentTreeRow; graph: TaskGraph; waiting: boolean; now: number; onOpen: (agentId: AgentId) => void }) {
  const node = graph.tasks.get(row.taskId)!;
  const parent = row.parentTaskId === null ? undefined : graph.tasks.get(row.parentTaskId as TaskId);
  const listedParent = parent !== undefined && parent.kind === 'agent' && (parent.agent?.runId ?? null) === null;
  let elapsed = '';
  let line: string;
  if (node.status === 'running') {
    const e = elapsedOf(node, now);
    elapsed = e ? formatElapsed(e.ms) : SUBAGENTS_COPY.elapsedUnavailable;
    line = rowSecondLine(node);
  } else if (node.status === 'unknown') {
    line = SUBAGENTS_COPY.statusUnavailable;
  } else {
    const summary = outcomeSummary(node);
    line = summary ? `${outcomeOf(node, now)} · ${summary}` : outcomeOf(node, now);
  }
  if (waiting) line = `${SUBAGENTS_COPY.approvalNeeded} · ${line}`;
  const failed = node.status === 'failed';
  return (
    <button
      type="button"
      data-agent-row={row.taskId}
      data-depth={row.depth}
      onClick={() => onOpen(row.taskId as unknown as AgentId)}
      style={indent(row.depth)}
      className={`flex min-h-12 items-center gap-2.5 px-3.5 py-2 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 ${row.depth > 0 ? 'border-l border-border-strong' : ''}`}
    >
      <SubagentGlyph agent={refOf(node)} className={`shrink-0 text-accent ${row.depth > 0 ? 'text-ui' : 'text-prose'}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium">
            <span data-part="title">{rowTitle(node)}</span>
            {waiting && (
              <span data-part="waiting" className="ml-1.5 text-ui-sm font-normal text-warning">
                {SUBAGENTS_COPY.waiting}
              </span>
            )}
            {row.orphan && (
              <span data-part="nested" title={listedParent ? SUBAGENTS_COPY.childOf(rowTitle(parent)) : SUBAGENTS_COPY.childOfUnlisted} className="ml-1.5 text-ui-sm font-normal text-fg-muted">
                {SUBAGENTS_COPY.nested}
              </span>
            )}
          </span>
          <span data-part="elapsed" className="shrink-0 text-ui-sm whitespace-nowrap text-fg-muted tabular-nums">
            {elapsed}
          </span>
        </span>
        <span data-part="line" title={line} className={`block truncate text-ui-sm ${failed ? 'text-danger' : 'text-fg-muted'}`}>
          {line}
        </span>
      </span>
    </button>
  );
}
