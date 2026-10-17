// The session's subagent tree in the depth column (the DC6 plan's M2): MAWS's Subagents lists as they stand —
// `tools/agents/subagents/AgentList.tsx`, copied and adapted — over the tree the main subscription gives
// (`agents/task-feed.ts`). Its sections, rows, and copy are MAWS's: **Agents**, the running roots with their subtrees
// (a running parent's finished children folded under one `Done · N`); **Done**, the finished roots newest end first,
// collapsed until opened; **On disk**, agents whose status the held rows do not say — or, from a producer of DC8 or
// later, which carries every agent's status (`agents/task-feed.ts`), **Status unavailable**: the few DX4 leaves
// unknown. What MAWS's list draws from its own host is left out, since the desk has no source for it: the team roster
// (MAWS's transcript activity of teammate listings), an agent waiting on a request (MAWS's attention store), and the
// live footer and disk-only note (MAWS's engine status). A row opens the agent's own transcript. A section's heading carries MAWS's disclosure chevron (its
// transcript's, turned while open), which MAWS's list draws without: the tree is the column's first tab, and a closed
// Done must read as closed, not as empty.
import type { TaskId } from '@shared/graph/ids';
import { SUBAGENTS_COPY } from '../../../../../src/renderer/src/tools/agents/copy';
import { elapsedOf, formatElapsed } from '../../../../../src/renderer/src/tools/agents/model/elapsed';
import { agentRows, agentTree, isEnded, outcomeSummary, rowSecondLine, rowTitle, shownRows, type TaskGraph, type TreeRow } from '../../../../../src/renderer/src/tools/agents/model/task-graph';
import { outcomeOf, refOf, SLOW_TICK_MS, useTicker } from '../../../../../src/renderer/src/tools/agents/subagents/shared';
import { Chevron } from '../../../../../src/renderer/src/transcript/view/rows/parts';
import { SubagentGlyph } from '../../../../../src/renderer/src/transcript/view/rows/Subagent';

export type TreeSection = 'agents' | 'done' | 'disk';

/** What the reader opened or closed in the tree, kept by the column so it outlives a drill-in. */
export type TreeView = {
  expanded: Record<TreeSection, boolean>;
  shown: { agents: number; done: number };
  folds: ReadonlySet<TaskId>;
};

const SECTIONS: readonly TreeSection[] = ['agents', 'done', 'disk'];
type AgentTreeRow = Extract<TreeRow, { kind: 'agent' }>;

// MAWS's defaults (`SubagentsTool.tsx`): Done collapsed, the first eight agents and ten finished ones shown.
export const INITIAL_TREE_VIEW: TreeView = { expanded: { agents: true, done: false, disk: true }, shown: { agents: 8, done: 10 }, folds: new Set() };

type Props = {
  tasks: TaskGraph;
  view: TreeView;
  onView: (view: TreeView) => void;
  onOpen: (agentId: string) => void;
  /** The machine sends each agent's status (DC8 or later): what is left unknown is said to be, not to be on disk. */
  statusesKnown?: boolean;
};

export const statusUnavailableHeading = (n: number) => `Status unavailable · ${n}`;

export function SubagentTree({ tasks, view, onView, onOpen, statusesKnown = false }: Props) {
  const tree = agentTree(tasks);
  const rows: Record<TreeSection, TreeRow[]> = {
    agents: shownRows(tree.agents, view.folds),
    done: tree.done,
    disk: agentRows(tasks, 'disk').map((row): TreeRow => ({ kind: 'agent', ...row, foldedUnder: null })),
  };
  const headings: Record<TreeSection, string> = { agents: SUBAGENTS_COPY.agents(tree.running), done: SUBAGENTS_COPY.done(rows.done.length), disk: (statusesKnown ? statusUnavailableHeading : SUBAGENTS_COPY.onDisk)(rows.disk.length) };
  const boundOf = (name: TreeSection) => (name === 'disk' ? rows.disk.length : view.shown[name]);
  const visible = SECTIONS.flatMap((name) => (view.expanded[name] ? rows[name].slice(0, boundOf(name)) : []));
  const nodeOf = (row: TreeRow) => (row.kind === 'agent' ? tasks.tasks.get(row.taskId) : undefined);
  // A shown running agent's elapsed ticks once a second; a shown finished one's `<ago>` on the slow tick.
  const ticks = (row: TreeRow) => {
    const node = nodeOf(row);
    return node !== undefined && elapsedOf(node, 0)?.live === true;
  };
  const ages = (row: TreeRow) => {
    const node = nodeOf(row);
    return node !== undefined && isEnded(node.status);
  };
  const fast = useTicker(visible.some(ticks));
  const slow = useTicker(visible.some(ages), SLOW_TICK_MS);
  const now = Math.max(fast, slow);

  const toggle = (name: TreeSection) => onView({ ...view, expanded: { ...view.expanded, [name]: !view.expanded[name] } });
  const toggleFold = (parent: TaskId) => {
    const folds = new Set(view.folds);
    if (!folds.delete(parent)) folds.add(parent);
    onView({ ...view, folds });
  };

  const any = SECTIONS.some((name) => rows[name].length > 0);
  return (
    <div data-view="lists" data-testid="depth-subagents" className="flex min-h-0 flex-1 flex-col overflow-auto">
      {SECTIONS.filter((name) => rows[name].length > 0).map((name) => (
        <section key={name} data-section={name} aria-label={headings[name]} className="flex shrink-0 flex-col border-b border-border pb-1 last-of-type:border-b-0">
          <h3 className="m-0 flex h-9 items-center px-3.5 text-ui font-semibold">
            <button type="button" aria-expanded={view.expanded[name]} onClick={() => toggle(name)} className="inline-flex items-center gap-1.5 rounded-sm outline-accent focus-visible:outline-2">
              <Chevron />
              {headings[name]}
            </button>
          </h3>
          {view.expanded[name] && (
            <>
              {rows[name].slice(0, boundOf(name)).map((row) =>
                row.kind === 'agent' ? (
                  <AgentRowButton key={row.taskId} row={row} tasks={tasks} now={now} onOpen={onOpen} />
                ) : row.kind === 'done-fold' ? (
                  <FoldButton key={`fold:${row.parentTaskId}`} row={row} tasks={tasks} onToggle={toggleFold} />
                ) : null,
              )}
              {name !== 'disk' && rows[name].length > boundOf(name) && (
                <button
                  type="button"
                  onClick={() => onView({ ...view, shown: { ...view.shown, [name]: rows[name].length } })}
                  className="ml-12 h-7 self-start rounded-sm px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2"
                >
                  {SUBAGENTS_COPY.showMore(rows[name].length - boundOf(name))}
                </button>
              )}
            </>
          )}
        </section>
      ))}
      {!any && <p className="m-0 flex flex-1 items-center justify-center p-4 text-ui text-fg-muted">{SUBAGENTS_COPY.empty}</p>}
    </div>
  );
}

const indent = (depth: number) => ({ marginInlineStart: depth * 24 });

function FoldButton({ row, tasks, onToggle }: { row: Extract<TreeRow, { kind: 'done-fold' }>; tasks: TaskGraph; onToggle: (parent: TaskId) => void }) {
  const parent = tasks.tasks.get(row.parentTaskId);
  return (
    <button
      type="button"
      data-fold={row.parentTaskId}
      data-depth={row.depth}
      aria-expanded={row.expanded}
      aria-label={SUBAGENTS_COPY.foldLabel(row.count, parent ? rowTitle(parent) : (row.parentTaskId as string))}
      onClick={() => onToggle(row.parentTaskId)}
      style={indent(row.depth)}
      className="flex h-8 items-center gap-1.5 self-start border-l border-border-strong pr-2 pl-3.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2"
    >
      <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`size-3 transition-transform ${row.expanded ? 'rotate-90' : ''}`}>
        <path d="M6 4l4 4-4 4" />
      </svg>
      {SUBAGENTS_COPY.done(row.count)}
    </button>
  );
}

function AgentRowButton({ row, tasks, now, onOpen }: { row: AgentTreeRow; tasks: TaskGraph; now: number; onOpen: (agentId: string) => void }) {
  const node = tasks.tasks.get(row.taskId)!;
  const parent = row.parentTaskId === null ? undefined : tasks.tasks.get(row.parentTaskId);
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
  return (
    <button
      type="button"
      data-agent-row={row.taskId}
      data-depth={row.depth}
      data-status={node.status}
      onClick={() => onOpen(row.taskId as string)}
      style={indent(row.depth)}
      className={`flex min-h-12 items-center gap-2.5 px-3.5 py-2 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 ${row.depth > 0 ? 'border-l border-border-strong' : ''}`}
    >
      <SubagentGlyph agent={refOf(node)} className={`shrink-0 text-accent ${row.depth > 0 ? 'text-ui' : 'text-prose'}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium">
            <span data-part="title">{rowTitle(node)}</span>
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
        <span data-part="line" title={line} className={`block truncate text-ui-sm ${node.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>
          {line}
        </span>
      </span>
    </button>
  );
}
