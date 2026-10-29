// The lane A streaming overlay for a session's transcript (P5 O9 M5): while the session's bridge is live or starting, the
// pane's watch (replayed from its snapshot, so a pane opened mid-reply draws what already streamed) feeds a
// `LaneAOverlay`, settled against the transcript store's entry `storeKey`; its rows, under the turn the store's rows
// end in, are the transcript's tail. Null `appSessionId` (a child's transcript) or no bridge draws nothing.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import type { Row } from '../../transcript/model/rows';
import { useLaneAState } from '../../stores/lane-a';
import { useTranscriptStore } from '../../stores/transcript';
import { latestTurn } from '../view/streaming-rows';
import { watchLaneA } from '../watches';
import { LaneAOverlay } from './overlay';

const NONE: Row[] = [];

export function useLaneAStreaming(appSessionId: AppSessionId | null, storeKey: string): Row[] {
  const bridge = useLaneAState(appSessionId)?.bridge;
  const watchable = appSessionId !== null && (bridge === 'live' || bridge === 'starting');
  const [drawn, setDrawn] = useState<Row[]>(NONE); // the overlay's rows, under no turn
  useEffect(() => {
    if (!watchable || appSessionId === null) return;
    const landed = (uuid: string) => useTranscriptStore.getState().entries[storeKey]?.state.seen.has(uuid as EventId) ?? false;
    const overlay: LaneAOverlay = new LaneAOverlay(landed, () => setDrawn(overlay.rows(null)));
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
  return useMemo(() => (drawn.length === 0 || turn === null ? drawn : drawn.map((row) => ({ ...row, turnId: turn }))), [drawn, turn]);
}
