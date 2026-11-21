// The remote drill-in (2026-11-06): one subagent's own transcript of another machine's terminal session, from that
// machine's plane through the page's watch of the agent (`../remote-source.ts`, `rl2.agent-scope`), as the drill-in
// draws a child: older rows paged in at the top as the reader reaches it, the agent's own blocks streaming beneath.
// What the machine serves of an agent is what this draws: a running agent's rows and its live part; an ended one's, or
// one of an earlier launch's, from its transcript on that machine's disk. Where it gives nothing, the pane says so in
// words: while the first snapshot is on its way, while the machine isn't giving it (a watch main refused, or one it
// paused: the link down, or a subscription the machine ended, which main asks again), and when what it gave holds no
// rows. The word cut (C133): three states in a person's words, "Reading from <machine>…" (a pause main asks again
// after reads as the read it is), "<machine> isn't reachable" and "Nothing from this agent yet"; an agent the session's
// tree here doesn't name (sminos serves one it doesn't know as an empty stream) reads the last. Nothing here asks the
// agent's subscription a read: every read is the session's, which sminos refuses on an agent's (`unsupported`).
// `tools/agents/subagents/DrillIn.tsx` loads this module only for such a session, so the plane transcript stays out of
// the chunk every local drill-in loads.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { LANE_A_WORDS } from '../../session/controls/lane-a';
import { QuietSpinner } from '../../ui/spinner';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import type { TranscriptActions } from '../../transcript/view/context';
import { Transcript, type TranscriptListHandle, type TranscriptProps } from '../../transcript/view/Transcript';
import { useRemoteAgentTranscript, type Unserved } from '../remote-source';
import { remoteMachineName } from '../remote-session';
import type { StreamBlock } from '../stream/layer';
import { drawnRows } from './drawn-rows';
import { useKeepPlaceThroughOlderRows } from './keep-place';
import { useOlderPages } from './older-pages';
import { streamingRows } from './streaming-rows';

const NO_ROWS: readonly Row[] = [];

interface Props {
  appSessionId: AppSessionId;
  agentId: AgentId;
  actions: Partial<TranscriptActions>;
  renderRequest?: TranscriptProps['renderRequest'];
  className?: string;
}

// What the pane says where nothing of the agent's is held, and whether a read is under way: the first, or main asking
// again after a pause other than the link going down (the word cut, C133), which has the quiet spinner (Acceptance 5).
function emptyWords(why: Unserved | null, live: boolean, machine: string): { words: string; reading: boolean } {
  const reading = { words: LANE_A_WORDS.agentReading(machine), reading: true };
  if (why === null) return live ? { words: LANE_A_WORDS.agentNoRows, reading: false } : reading;
  if (why.kind === 'refused') return { words: why.reason, reading: false };
  return why.reason === 'offline' ? { words: LANE_A_WORDS.agentOffline(machine), reading: false } : reading;
}

/** When this pane first drew each streaming block, on its clock: a live thinking label ticks from it. */
function useSince(): (block: StreamBlock) => string {
  const [seen] = useState(() => new WeakMap<StreamBlock, string>());
  return useCallback(
    (block: StreamBlock) => {
      let at = seen.get(block);
      if (!at) seen.set(block, (at = new Date().toISOString()));
      return at;
    },
    [seen],
  );
}

export function RemoteAgentTranscript({ appSessionId, agentId, actions, renderRequest, className }: Props) {
  const { transcript, unserved } = useRemoteAgentTranscript(appSessionId, agentId);
  const state = useStore(transcript.state);
  const why = useStore(unserved, (s) => s.why);
  const machine = remoteMachineName(appSessionId);
  const since = useSince();
  const tail = useMemo(() => streamingRows(state.streaming, since), [state.streaming, since]);
  const list = useRef<TranscriptListHandle>(null);
  const rows = useTranscriptStore((s) => s.entries[transcript.key]?.rows ?? NO_ROWS);
  const drawnTail = useRef(tail);
  useLayoutEffect(() => {
    drawnTail.current = tail;
  }, [tail]);
  const indexOf = useCallback((id: string) => drawnRows(transcript.key, drawnTail.current).findIndex((row) => row.id === id), [transcript.key]);
  useKeepPlaceThroughOlderRows(list, rows, state.loadingOlder, indexOf);
  useOlderPages(transcript, list, state);
  // Words only where nothing of the agent's transcript is held: what was drawn stays drawn through a pause or a reset.
  const empty = state.held.length === 0 && state.streaming.length === 0;
  const shown = empty ? emptyWords(why, state.phase === 'live', machine) : null;
  return (
    <>
      {state.olderFailed !== null && (
        <div role="status" data-testid="older-failed" className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-ui-sm text-fg-muted">
          <span className="min-w-0 flex-1">{LANE_A_WORDS.olderFailed(state.olderFailed)}</span>
          <button type="button" onClick={() => transcript.loadOlder()} className="shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
            {LANE_A_WORDS.retry}
          </button>
        </div>
      )}
      {shown !== null && (
        <p role="status" data-testid="subagent-rows-status" className="m-0 flex shrink-0 items-center gap-2 px-4 py-3 text-ui-sm text-fg-muted">
          {/* the word cut (Acceptance 5): a read under way has the app's quiet spinner beside its words, in a place kept for it */}
          {shown.reading && (
            <span className="inline-flex size-3 shrink-0">
              <QuietSpinner label={shown.words} />
            </span>
          )}
          {shown.words}
        </p>
      )}
      <Transcript source={state.source} variant="child" actions={actions} renderRequest={renderRequest} className={className} handle={list} tail={tail} />
    </>
  );
}
