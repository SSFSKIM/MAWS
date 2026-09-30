// The Subagents lists (C8b execution document, M2; mockup 03 study 01): Active, Done and On disk, each rendered flat
// from one `agentRows(graph, section)` selector with a depth per row, so nesting is one rule across the three and a
// child whose parent sits in another list (or in none) reads `· nested` at depth 0 with a tooltip naming the parent.
// A workflow's agents are in no list. Active ticks its elapsed once a second while one is live and the tool visible.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentId, AppSessionId, TaskId } from '@shared/graph/ids';
import type { PanelToolContext } from '../../../panel/tool';
import { selectPendingOf, useAttention } from '../../../stores/attention';
import { SubagentGlyph } from '../../../transcript';
import { SUBAGENTS_COPY } from '../copy';
import { elapsedOf, formatElapsed } from '../model/elapsed';
import { agentRows, emptyGraph, outcomeSummary, rowSecondLine, rowTitle, type AgentRow, type TaskGraph } from '../model/task-graph';
import { useTaskGraph } from '../store';
import { outcomeOf, refOf, SLOW_TICK_MS, useTicker } from './shared';
import type { ListSection, SubagentsHandle, SubagentsState } from './SubagentsTool';

const EMPTY_GRAPH = emptyGraph();
const SECTIONS: readonly ListSection[] = ['active', 'done', 'disk'];
const HEADINGS: Record<ListSection, (n: number) => string> = { active: SUBAGENTS_COPY.active, done: SUBAGENTS_COPY.done, disk: SUBAGENTS_COPY.onDisk };

interface Props {
  appSessionId: AppSessionId;
  handle: SubagentsHandle;
  expanded: SubagentsState['expanded'];
  shown: SubagentsState['shown'];
  scrollTop: number;
  ctx: PanelToolContext;
}

export function AgentList({ appSessionId, handle, expanded, shown, scrollTop, ctx }: Props) {
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const sidecarsError = useTaskGraph((s) => s.entries.get(appSessionId)?.disk.error ?? null);
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  // An agent with an open request of its own (the child's permission, answered in its drill-in).
  const waiting = useMemo(() => new Set<string>(pending.flatMap((item) => [item.request.agentId, item.request.taskId].filter((id): id is NonNullable<typeof id> => id !== null))), [pending]);
  const live = ctx.status !== null;

  const rows = useMemo(() => Object.fromEntries(SECTIONS.map((name) => [name, agentRows(graph, name)])) as Record<ListSection, AgentRow[]>, [graph]);
  const boundOf = (name: ListSection) => (name === 'disk' ? rows.disk.length : shown[name]);
  // Active's elapsed ticks once a second while a shown row is live; Done's `<ago>` on the slow tick while it is shown.
  // Neither ticks while its section is collapsed or the tool hidden.
  const ticking = expanded.active && rows.active.slice(0, shown.active).some((row) => elapsedOf(graph.tasks.get(row.taskId)!, 0)?.live === true);
  const fast = useTicker(ticking && ctx.visible);
  const slow = useTicker(expanded.done && rows.done.length > 0 && ctx.visible, SLOW_TICK_MS);
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
        <section key={name} data-section={name} aria-label={HEADINGS[name](rows[name].length)} className="flex shrink-0 flex-col border-b border-border pb-1 last-of-type:border-b-0">
          <h3 className="flex h-9 items-center px-3.5 text-ui font-semibold">
            <button type="button" aria-expanded={expanded[name]} onClick={() => handle.toggle(name)} className="rounded-sm outline-accent focus-visible:outline-2">
              {HEADINGS[name](rows[name].length)}
            </button>
          </h3>
          {expanded[name] && (
            <>
              {rows[name].slice(0, boundOf(name)).map((row) => (
                <AgentRowButton key={row.taskId} row={row} graph={graph} section={name} waiting={waiting.has(row.taskId as string)} now={now} onOpen={handle.openAgent} />
              ))}
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

function AgentRowButton({ row, graph, section, waiting, now, onOpen }: { row: AgentRow; graph: TaskGraph; section: ListSection; waiting: boolean; now: number; onOpen: (agentId: AgentId) => void }) {
  const node = graph.tasks.get(row.taskId)!;
  const parent = row.parentTaskId === null ? undefined : graph.tasks.get(row.parentTaskId as TaskId);
  const listedParent = parent !== undefined && parent.kind === 'agent' && (parent.agent?.runId ?? null) === null;
  let elapsed = '';
  let line: string;
  if (section === 'active') {
    const e = elapsedOf(node, now);
    elapsed = e ? formatElapsed(e.ms) : SUBAGENTS_COPY.elapsedUnavailable;
    line = rowSecondLine(node);
  } else if (section === 'done') {
    const summary = outcomeSummary(node);
    line = summary ? `${outcomeOf(node, now)} · ${summary}` : outcomeOf(node, now);
  } else {
    line = SUBAGENTS_COPY.statusUnavailable;
  }
  if (waiting) line = `${SUBAGENTS_COPY.approvalNeeded} · ${line}`;
  const failed = node.status === 'failed';
  return (
    <button
      type="button"
      data-agent-row={row.taskId}
      data-depth={row.depth}
      onClick={() => onOpen(row.taskId as unknown as AgentId)}
      style={{ marginInlineStart: row.depth * 24 }}
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
