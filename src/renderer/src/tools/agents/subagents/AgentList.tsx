// The Subagents lists (C8b execution document, M2; mockup 03 study 01; E7's tree, Design §3 and §5; the UX wave's U8b
// document, M7): **Running N**, the first-level agents that run or have running work under them, in the order they
// started (N every running agent at any depth, the card's number; no number while none runs), the running teammates
// grouped first under the team header in one labelled group; **Done N**, the other first-level agents, newest end first,
// folded at first, its heading naming the failed and the stopped; **On disk N**, folded, as before (status unknown,
// `agentRows`). A row with agents under it has its own disclosure, `(+N)` and an arrow, which shows them beneath it one
// level at a time (`panel-rows.ts`; the set the Subagents card shares). A child whose parent the tree does not hold reads
// `· nested` at depth 0 with a tooltip naming the parent. A workflow's agents are in no list. A row reads by its own
// status wherever it sits: a running one ticks its elapsed once a second while shown and the tool visible, a finished
// one its `<ago>` on the slow tick.
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { PanelToolContext } from '../../../panel/tool';
import { useSessionControls } from '../../../session/controls/controls-for'; // P5 O9
import { selectPendingOf, useAttention } from '../../../stores/attention';
import { useTranscriptStore } from '../../../transcript';
import { HeadingParts, headingText } from '../background/Group';
import { SUBAGENTS_COPY, type PanelHeading } from '../copy';
import { elapsedOf, formatAgo } from '../model/elapsed';
import { agentRows, doneByOutcome, emptyGraph, firstLevelAgents, isEnded, rowTitle, runningAgents, type TaskGraph, type TreeRow } from '../model/task-graph';
import { teammatesOf, withTeam } from '../model/teammates';
import { openOf, useOpenAgents } from '../open-agents';
import { useTaskGraph } from '../store';
import { AgentRow, Chevron, indent } from './AgentRow';
import { hasAgentsUnder, panelRows } from './panel-rows';
import { SLOW_TICK_MS, useTicker } from './shared';
import type { ListSection, SubagentsHandle, SubagentsState } from './SubagentsTool';

const EMPTY_GRAPH = emptyGraph();
const SECTIONS: readonly ListSection[] = ['running', 'done', 'disk'];

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
  const open = useOpenAgents((s) => openOf(s, appSessionId));
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  // An agent with an open request of its own (the child's permission, answered in its drill-in).
  const waiting = useMemo(() => new Set<string>(pending.flatMap((item) => [item.request.agentId, item.request.taskId].filter((id): id is NonNullable<typeof id> => id !== null))), [pending]);
  // P5 O9: a session a terminal drives through its bridge is not live here, whatever engine status MAWS kept from an
  // earlier run of it
  const controls = useSessionControls(appSessionId);
  const live = (controls === null || controls.turn() === null) && ctx.status !== null;
  // The roster: the newest listing's Teammates, from the transcript's activity (both paths, every launch).
  const activity = useTranscriptStore((s) => s.activity(appSessionId));
  const roster = useMemo(() => teammatesOf(activity), [activity]);

  const rows = useMemo((): Record<ListSection, TreeRow[]> => {
    const { running, done } = panelRows(graph, open, expandedFolds);
    return {
      running: withTeam({ agents: running, done: [], running: 0 }, graph, roster).agents,
      done,
      disk: agentRows(graph, 'disk').map((row): TreeRow => ({ kind: 'agent', ...row, foldedUnder: null })),
    };
  }, [graph, open, expandedFolds, roster]);
  const doneIds = firstLevelAgents(graph).done;
  const headings: Record<ListSection, PanelHeading> = {
    running: SUBAGENTS_COPY.running(runningAgents(graph)),
    done: SUBAGENTS_COPY.doneHeading(doneIds.length, doneByOutcome(graph, doneIds)),
    disk: SUBAGENTS_COPY.onDisk(rows.disk.length),
  };
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

  const props: RowProps = { graph, waiting, now, handle, open, appSessionId };
  const any = SECTIONS.some((name) => rows[name].length > 0);
  return (
    <div data-view="lists" ref={scroller} onScroll={(e) => handle.setScrollTop(e.currentTarget.scrollTop)} className="flex h-full min-h-0 flex-col overflow-auto">
      {!live && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-fg-muted">{SUBAGENTS_COPY.diskOnly}</p>}
      {sidecarsError !== null && <p className="shrink-0 px-3.5 pt-3 text-ui-sm text-danger">{SUBAGENTS_COPY.sidecarsUnavailable(sidecarsError)}</p>}
      {SECTIONS.filter((name) => rows[name].length > 0).map((name) => (
        <section key={name} data-section={name} aria-label={headingText(headings[name])} className="flex shrink-0 flex-col border-b border-border pb-1 last-of-type:border-b-0">
          <h3 className="flex h-9 items-center px-3.5 text-ui font-semibold">
            <button type="button" aria-expanded={expanded[name]} onClick={() => handle.toggle(name)} className="rounded-sm outline-accent focus-visible:outline-2">
              <HeadingParts heading={headings[name]} />
            </button>
          </h3>
          {expanded[name] && (
            <>
              {grouped(rows[name].slice(0, boundOf(name))).map((part) =>
                Array.isArray(part) ? <TeamGroup key="team" rows={part} {...props} /> : <TreeRowView key={keyOf(part)} row={part} disclosure={name !== 'disk'} {...props} />,
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

type RowProps = { graph: TaskGraph; waiting: ReadonlySet<string>; now: number; handle: SubagentsHandle; open: ReadonlySet<TaskId>; appSessionId: AppSessionId };

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
        <TreeRowView key={keyOf(row)} row={row} disclosure {...props} />
      ))}
    </div>
  );
}

const keyOf = (row: TreeRow) =>
  row.kind === 'agent' ? row.taskId : row.kind === 'done-fold' ? `fold:${row.parentTaskId}` : row.kind === 'roster' ? `roster:${row.name}` : 'team';

// `disclosure`: the row's agents under it are opened from the row (Running and Done); On disk nests them as before.
function TreeRowView({ row, graph, waiting, now, handle, open, appSessionId, disclosure }: RowProps & { row: TreeRow; disclosure: boolean }) {
  if (row.kind === 'agent') {
    const under = disclosure && hasAgentsUnder(graph, row.taskId) ? { open: open.has(row.taskId), onToggle: () => useOpenAgents.getState().toggle(appSessionId, row.taskId) } : null;
    return <AgentRow row={row} graph={graph} waiting={waiting.has(row.taskId as string)} now={now} onOpen={handle.openAgent} under={under} />;
  }
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
        <Chevron open={row.expanded} />
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
