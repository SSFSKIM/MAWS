// The summary's Background work section as the tool fills it (X5 `summary`, under C8a's section heading): what runs now
// by kind, `N shell(s) · N workflow(s) · N monitor(s)` from the task graph's counts (agents are Subagents'), or, for a
// session with no ready process here (P2-A: an exited one included; "Resumes with the session" stays), its workflow runs on disk (or why they could not be read) with the sentence that shells and
// monitors are known only while it runs; and Open. The reader sees what C8a's baseline showed; the source is the graph.
// The section watches the store itself: the tool may not be open.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { actionClass, Row } from '../../../panel/summary/Section';
import { useSessions } from '../../../stores/sessions';
import { AGENTS_SUMMARY_COPY, BACKGROUND_COPY } from '../copy';
import { counts, emptyGraph, workflows } from '../model/task-graph';
import { useTaskGraph } from '../store';
import type { BackgroundParams } from './BackgroundTool';

const EMPTY_GRAPH = emptyGraph();

export function BackgroundSummary({ appSessionId, open }: { appSessionId: AppSessionId; open(params?: BackgroundParams): void }) {
  useEffect(() => useTaskGraph.getState().watch(appSessionId), [appSessionId]);
  const graph = useTaskGraph((s) => s.entries.get(appSessionId)?.graph ?? EMPTY_GRAPH);
  const runsLoaded = useTaskGraph((s) => (s.entries.get(appSessionId)?.disk.runs ?? null) !== null);
  const runsError = useTaskGraph((s) => s.entries.get(appSessionId)?.disk.runsError ?? null);
  const live = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready'); // P2-A: an exited status is not live; nothing here acquires
  const action = (
    <button type="button" className={actionClass} onClick={() => open()}>
      {AGENTS_SUMMARY_COPY.open}
    </button>
  );
  return (
    <div data-summary="background">
      <Row action={action}>
        {live ? (
          <span className="block truncate">{AGENTS_SUMMARY_COPY.background(counts(graph))}</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            {runsError !== null ? (
              <span className="text-danger">{BACKGROUND_COPY.runsUnavailable(runsError)}</span>
            ) : (
              runsLoaded && <span>{AGENTS_SUMMARY_COPY.runsOnDisk(workflows(graph).length)}</span>
            )}
            <span className="text-ui-sm text-fg-muted">{BACKGROUND_COPY.shellsDiskOnly}</span>
          </div>
        )}
      </Row>
    </div>
  );
}
