// The lane A streaming overlay for a session's transcript (P5 O9 M5): while the session's bridge is live or starting, the
// pane's watch (replayed from its snapshot, so a pane opened mid-reply draws what already streamed) feeds a
// `LaneAOverlay`, settled against the transcript store's entry `storeKey`; its rows, under the turn the store's rows
// end in, are the transcript's tail. Null `appSessionId` (a child's transcript) or no bridge draws nothing.
//
// The M8 sitting: what a step streamed before an interrupt cut it is kept (`kept`), settled, each under the disk turn
// running at the bridge's time of the cut once the store shows which that is, else in no turn (`placeCuts`), for the
// mount to place. Read again as the store moves, so a cut waits for its turn rather than taking the latest one. Kept rows
// outlast the watch (a bridge gone or restarted, the session ended) while the mount shows the same transcript, as lane
// B's store keeps a stopped reply's partial text.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import type { Row } from '../../transcript/model/rows';
import { useLaneAState } from '../../stores/lane-a';
import { useTranscriptStore } from '../../stores/transcript';
import { latestTurn } from '../view/streaming-rows';
import { watchLaneA } from '../watches';
import { LaneAOverlay, placeCuts, type Cut } from './overlay';

const NONE: Row[] = [];
const NO_CUTS: Cut[] = [];

export interface LaneAStreaming {
  tail: Row[]; // the reply as it streams, after the rows on disk
  kept: Row[]; // what an interrupt cut before the engine wrote it, each under its turn
}

export function useLaneAStreaming(appSessionId: AppSessionId | null, storeKey: string): LaneAStreaming {
  const bridge = useLaneAState(appSessionId)?.bridge;
  const watchable = appSessionId !== null && (bridge === 'live' || bridge === 'starting');
  const [drawn, setDrawn] = useState<Row[]>(NONE); // the overlay's rows, under no turn
  const [kept, setKept] = useState<{ key: string; cuts: Cut[] }>({ key: storeKey, cuts: NO_CUTS });
  useEffect(() => {
    if (!watchable || appSessionId === null) return;
    const landed = (uuid: string) => useTranscriptStore.getState().entries[storeKey]?.state.seen.has(uuid as EventId) ?? false;
    const keeping = {
      // by its rows' ids: a replayed watch (opened again on the same log) meets the same step's end again
      keep: (cut: Cut) =>
        setKept((prior) => {
          const before = prior.key === storeKey ? prior.cuts : NO_CUTS;
          const rows = cut.rows.filter((row) => !before.some((held) => held.rows.some((r) => r.id === row.id)));
          return rows.length === 0 && prior.key === storeKey ? prior : { key: storeKey, cuts: [...before, { ...cut, rows }] };
        }),
    };
    const overlay: LaneAOverlay = new LaneAOverlay(landed, () => setDrawn(overlay.rows(null)), keeping);
    const off = watchLaneA(appSessionId, (event) => overlay.receive(event), { replay: true });
    const offStore = useTranscriptStore.subscribe((state, before) => {
      if (state.entries[storeKey] !== before.entries[storeKey] && overlay.settleLanded()) setDrawn(overlay.rows(null));
    });
    return () => {
      off();
      offStore();
      overlay.dispose();
      setDrawn(NONE);
    };
  }, [watchable, appSessionId, storeKey]);
  const turn = useTranscriptStore((s) => (drawn.length === 0 ? null : latestTurn(s.entries[storeKey]?.rows ?? NONE)));
  const tail = useMemo(() => (drawn.length === 0 || turn === null ? drawn : drawn.map((row) => ({ ...row, turnId: turn }))), [drawn, turn]);
  const cuts = kept.key === storeKey ? kept.cuts : NO_CUTS;
  const state = useTranscriptStore((s) => (cuts.length === 0 ? undefined : s.entries[storeKey]?.state));
  const placed = useMemo(() => (cuts.length === 0 ? NONE : placeCuts(state, cuts)), [cuts, state]);
  return useMemo(() => ({ tail, kept: placed }), [tail, placed]);
}
