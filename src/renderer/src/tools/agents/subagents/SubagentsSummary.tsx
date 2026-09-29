// The summary's Subagents section as the tool fills it (X5 `summary`, under C8a's section heading): the agents' glyphs
// (running first, four at most, C6's marks), `N working · M done` and `<n> on disk`, and Open. A live session's counts
// are the task graph's once its wire half has loaded; before that, and for a session not live here, C5's digest
// carries them, so the line never reads zero for a graph that has not loaded. The section watches the store itself:
// the tool may not be open.
import { useEffect, useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { actionClass, Row } from '../../../panel/summary/Section';
import { useSessions } from '../../../stores/sessions';
import { SubagentGlyph } from '../../../transcript';
import { AGENTS_SUMMARY_COPY } from '../copy';
import { agentRows, counts, emptyGraph, rowTitle, type TaskGraph } from '../model/task-graph';
import { useTaskGraph } from '../store';
import { refOf } from './shared';
import type { SubagentsParams } from './SubagentsTool';

const EMPTY_GRAPH = emptyGraph();
const GLYPHS_SHOWN = 4;

const glyphNodes = (graph: TaskGraph) => [...agentRows(graph, 'active'), ...agentRows(graph, 'done')].slice(0, GLYPHS_SHOWN).map((row) => graph.tasks.get(row.taskId)!);

export function SubagentsSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: SubagentsParams): void }) {
  useEffect(() => useTaskGraph.getState().watch(appSessionId), [appSessionId]);
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const wireLoaded = useTaskGraph((s) => s.entries.get(appSessionId)?.phase === 'live');
  const diskLoaded = useTaskGraph((s) => (s.entries.get(appSessionId)?.disk.agents ?? null) !== null);
  const digest = useSessions((s) => s.digests.get(appSessionId)?.childAgents);
  const glyphs = useMemo(() => glyphNodes(graph), [graph]);

  const c = counts(graph);
  const working = wireLoaded ? c.working : (digest?.active ?? 0);
  const done = wireLoaded ? c.done : (digest?.done ?? 0);
  const onDisk = diskLoaded ? c.onDisk : 0;
  const parts = [working + done > 0 ? AGENTS_SUMMARY_COPY.agents(working, done) : null, onDisk > 0 ? AGENTS_SUMMARY_COPY.onDisk(onDisk) : null].filter((p) => p !== null);
  const line = parts.length > 0 ? parts.join(' · ') : AGENTS_SUMMARY_COPY.noAgents;
  const action = (
    <button type="button" className={actionClass} onClick={() => open()}>
      {AGENTS_SUMMARY_COPY.open}
    </button>
  );

  return (
    <div data-summary="subagents" className="flex flex-col gap-1.5">
      <Row action={action}>
        {glyphs.length > 0 ? (
          <span data-testid="agent-glyphs" role="img" aria-label={glyphs.map(rowTitle).join(', ')} className="flex gap-1.5 text-accent">
            {glyphs.map((node) => (
              <span key={node.taskId} data-part="glyph">
                <SubagentGlyph agent={refOf(node)} />
              </span>
            ))}
          </span>
        ) : (
          <span className="block truncate">{line}</span>
        )}
      </Row>
      {glyphs.length > 0 && <p className="text-ui-sm text-fg-muted">{line}</p>}
    </div>
  );
}
