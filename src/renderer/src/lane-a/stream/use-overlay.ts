// The lane A streaming overlay for a session's transcript (P5 O9 M5): while the session's bridge is live or starting, the
// pane's watch (replayed from its snapshot, so a pane opened mid-reply draws what already streamed) feeds a
// `LaneAOverlay`, settled against the transcript store's entry `storeKey`; its rows, under the turn the store's rows
// end in, are the transcript's tail. Null `appSessionId` (a child's transcript) or no bridge draws nothing.
//
// The M8 sitting: what a step streamed before an interrupt cut it is kept (`kept`), settled, under the turn it was
// answering, for the mount to place in that turn. Kept rows outlast the watch (a bridge gone or restarted, the session
// ended) while the mount shows the same transcript, as lane B's store keeps a stopped reply's partial text.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import type { Row } from '../../transcript/model/rows';
import { useLaneAState } from '../../stores/lane-a';
import { useTranscriptStore } from '../../stores/transcript';
import { latestTurn } from '../view/streaming-rows';
import { watchLaneA } from '../watches';
import { LaneAOverlay } from './overlay';

const NONE: Row[] = [];

export interface LaneAStreaming {
  tail: Row[]; // the reply as it streams, after the rows on disk
  kept: Row[]; // what an interrupt cut before the engine wrote it, each under its turn
}

export function useLaneAStreaming(appSessionId: AppSessionId | null, storeKey: string): LaneAStreaming {
  const bridge = useLaneAState(appSessionId)?.bridge;
  const watchable = appSessionId !== null && (bridge === 'live' || bridge === 'starting');
  const [drawn, setDrawn] = useState<Row[]>(NONE); // the overlay's rows, under no turn
  const [kept, setKept] = useState<{ key: string; rows: Row[] }>({ key: storeKey, rows: NONE });
  useEffect(() => {
    if (!watchable || appSessionId === null) return;
    const landed = (uuid: string) => useTranscriptStore.getState().entries[storeKey]?.state.seen.has(uuid as EventId) ?? false;
    const keeping = {
      turn: () => latestTurn(useTranscriptStore.getState().entries[storeKey]?.rows ?? NONE),
      // by id: a replayed watch (opened again on the same log) meets the same step's end again
      keep: (rows: Row[]) =>
        setKept((prior) => {
          const before = prior.key === storeKey ? prior.rows : NONE;
          const fresh = rows.filter((row) => !before.some((held) => held.id === row.id));
          return fresh.length === 0 && prior.key === storeKey ? prior : { key: storeKey, rows: [...before, ...fresh] };
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
  return useMemo(() => ({ tail, kept: kept.key === storeKey ? kept.rows : NONE }), [tail, kept, storeKey]);
}
