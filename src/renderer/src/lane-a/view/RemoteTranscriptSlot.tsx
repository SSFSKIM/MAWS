// P5 O9 M9: the transcript slot of another machine's terminal session (a listed lane A row). It draws from its machine's
// plane through the page's watch (`../remote-source.ts`), older rows paged in at the top as the reader reaches it, and
// streams and rests by its controls port as a local one does. `transcript/view/TranscriptSlot.tsx` loads this module
// only when such a session is shown, so the plane transcript stays out of the transcript chunk every local tab loads.
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { useSessionControls } from '../../session/controls/controls-for';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { ipcRewind } from '../../transcript/source/ipc';
import { useAgentLookup } from '../../transcript/view/agent-lookup';
import { useRegisteredActions, useRegisteredRequestRenderer } from '../../transcript/view/registry';
import { Transcript, type TranscriptListHandle } from '../../transcript/view/Transcript';
import type { TranscriptSlotProps } from '../../transcript/view/TranscriptSlot';
import { useRemoteTranscript } from '../remote-source';
import { useLaneAStreaming } from '../stream/use-overlay';
import { drawnRows } from './drawn-rows';
import { useKeepPlaceThroughOlderRows } from './keep-place';
import { useOlderPages } from './older-pages';

const NO_ROWS: readonly Row[] = [];

export function RemoteTranscriptSlot({ appSessionId, className, startAt, presentation, actions: overrides }: TranscriptSlotProps) {
  const registered = useRegisteredActions();
  const actions = useMemo(() => (overrides ? { ...registered, ...overrides } : registered), [registered, overrides]);
  const renderRequest = useRegisteredRequestRenderer();
  const transcript = useRemoteTranscript(appSessionId)!;
  const state = useStore(transcript.state);
  const storeKey = transcript.key;
  useAgentLookup(storeKey, appSessionId);
  const controls = useSessionControls(appSessionId);
  const atRest = controls?.turn()?.running === false;
  const filesGap = controls?.capability('rewind-files') ?? null;
  const filesReason = filesGap !== null && !filesGap.available ? filesGap.reason : null;
  const rewind = useMemo(() => ({ ...ipcRewind(appSessionId), unavailable: filesReason }), [appSessionId, filesReason]);
  const streaming = useLaneAStreaming(appSessionId, storeKey);
  // Older rows when the reader reaches the top, while what is drawn does not fill the pane, and after a page that drew
  // nothing new; the reader's place kept through each (the desk's own rules, lifted with the plane transcript).
  const list = useRef<TranscriptListHandle>(null);
  const rows = useTranscriptStore((s) => s.entries[storeKey]?.rows ?? NO_ROWS);
  const tail = useRef(streaming.tail);
  useLayoutEffect(() => {
    tail.current = streaming.tail;
  }, [streaming.tail]);
  const indexOf = useCallback((id: string) => drawnRows(storeKey, tail.current, atRest).findIndex((row) => row.id === id), [storeKey, atRest]);
  useKeepPlaceThroughOlderRows(list, rows, state.loadingOlder, indexOf);
  useOlderPages(transcript, list, state, atRest);
  return (
    <Transcript
      source={state.source}
      variant="session"
      actions={actions}
      rewind={rewind}
      renderRequest={renderRequest}
      className={className}
      handle={list}
      tail={streaming.tail}
      startAt={startAt}
      presentation={presentation}
      atRest={atRest}
      placed={streaming.kept}
    />
  );
}
