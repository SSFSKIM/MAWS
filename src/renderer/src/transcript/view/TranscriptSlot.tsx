// The transcript as the shell mounts it (C8's ask, Public surface): one Transcript over the session's IPC source (a
// child agent's when `agentId` is given), with the actions every child registered merged over the defaults and the
// latest registered request-card renderer (C7's), re-rendered when either changes. A session transcript gets the
// receipt's rewind over `session.rewindFiles`; a child's does not (its turns are not the session's prompts, so there is
// nothing to rewind to). C5's `transcript` slot renders it through `transcript/shell.tsx`, registered from `App.tsx`.
// W1: a session's transcript also shows the messages held in MAWS's queue at its tail, dimmed with "Sends when this
// turn ends", and hides the bubble of a steer held back into that queue. It attaches C7's queue store itself, as the
// composer does, so a session transcript shown without its composer reads the live queue.
// W8: a session's transcript names the effort the session runs at in its live thinking label, the effort the model
// selector shows (W3's `useShownEffort`); a child's names none.
// P2-E1: three additive options for a mount that shows a session in a smaller place (the comment card's thread): the
// first row to show (`startAt`), actions overriding the registered ones for this mount, and the presentation forced
// local (`Transcript`'s). Absent, the slot draws as before.
// P2-C (2026-10-09): a session's slot follows its owner channel (`stores/owner-channel.ts`) and tells the transcript
// whether the lane is on, which the report view and the report module read.
// P5 O9 M5: a terminal session driven through its bridge streams its reply into the tail (`lane-a/stream/overlay.ts`),
// and is at rest while its controls port says no main turn runs.
// L197: the slot gives the transcript the session's agents from its task graph (agent-lookup.ts), so a message to an
// agent no loaded turn launched names it.
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShownEffort } from '../../composer/effective-effort';
import { useOwnerChannel } from '../../stores/owner-channel'; // P2-C
import { attachQueue, EMPTY_QUEUE, useQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript'; // L276
import { askAnsweredHere, askSteerOf, heldRow } from '../model/derive';
import type { Row } from '../model/rows';
import { ipcRewind, ipcSource } from '../source/ipc';
import { useAgentLookup } from './agent-lookup'; // L197
import type { TranscriptActions } from './context';
import { useLaneAStreaming } from '../../lane-a/stream/use-overlay'; // P5 O9 M5
import { useSessionControls } from '../../session/controls/controls-for'; // P5 O9 M5
import { useRegisteredActions, useRegisteredRequestRenderer } from './registry';
import { storeKeyOf, Transcript } from './Transcript';

export interface TranscriptSlotProps {
  appSessionId: AppSessionId;
  agentId?: AgentId;
  className?: string;
  startAt?: (rows: readonly Row[], loaded: boolean) => number | null; // P2-E1: the first row shown; null: none yet
  presentation?: 'local'; // P2-E1: the owner channel through MAWS's presenter, whatever the surface's attachment
  actions?: Partial<TranscriptActions>; // P2-E1: merged over the registered actions, for this mount only
}

export function TranscriptSlot({ appSessionId, agentId, className, startAt, presentation, actions: overrides }: TranscriptSlotProps) {
  const registered = useRegisteredActions();
  const actions = useMemo(() => (overrides ? { ...registered, ...overrides } : registered), [registered, overrides]);
  const renderRequest = useRegisteredRequestRenderer(); // C7's card; the placeholder until it registers
  const source = ipcSource(appSessionId, agentId); // memoised per key
  const storeKey = storeKeyOf(source);
  useAgentLookup(storeKey, appSessionId); // L197: an agent no loaded turn launched, named from the session's task graph
  // P5 O9 M5: a session driven through its bridge keeps Restore files in place, disabled with its reason (acceptance 2)
  const controls = useSessionControls(appSessionId);
  const filesGap = controls !== null && controls.turn() !== null ? controls.capability('rewind-files') : null;
  // P5 O9 (the M8 sitting): such a session runs exactly while its port says a main turn is open, the one source custody
  // reads. Its disk rows leave turns open that nothing there ends (a slash command's echo, a turn the bridge
  // interrupted), so while the port says none runs those draw closed, as the desk draws a session its host calls idle.
  const atRest = agentId === undefined && controls?.turn()?.running === false;
  const filesReason = filesGap !== null && !filesGap.available ? filesGap.reason : null;
  const rewind = useMemo(() => (agentId === undefined ? { ...ipcRewind(appSessionId), unavailable: filesReason } : undefined), [appSessionId, agentId, filesReason]);
  // Where the session runs, from its record (its worktree's checkout when it has one): the engine's Bash input names no
  // cwd, so a shell call shows this, labelled as the session's directory. Not for a child agent's transcript: a
  // worktree-isolated subagent's shell ran elsewhere.
  const sessionDirectory = useSessions((state) => {
    const record = agentId === undefined ? state.records.get(appSessionId) : undefined;
    return record ? (record.worktree?.path ?? record.directory) : null;
  });
  useEffect(() => (agentId === undefined ? attachQueue(appSessionId) : undefined), [appSessionId, agentId]);
  const queue = useQueueStore((state) => (agentId === undefined ? (state.bySession.get(appSessionId) ?? EMPTY_QUEUE) : EMPTY_QUEUE));
  const held = useMemo(() => queue.entries.filter((entry) => entry.state === 'queued' && !entry.uncertain), [queue.entries]);
  // L276: an async ask's answer a Stop held back into the queue (its steer waited for the turn's next tool boundary) is
  // no bubble once the transcript recorded it answering the ask's capsule, as derive draws none for the steer; it stays
  // queued and sends as it is
  const askIds = useMemo(() => held.map((entry) => askSteerOf(entry.content)), [held]);
  const answered = useTranscriptStore(
    useShallow((store) => {
      const state = store.entries[storeKey]?.state;
      return askIds.map((askId) => askId !== null && state !== undefined && askAnsweredHere(state, askId));
    }),
  );
  // P5 O9 M5: a terminal session driven through its bridge draws its reply as it is written, after the rows on disk
  const streaming = useLaneAStreaming(agentId === undefined ? appSessionId : null, storeKey);
  const tail = useMemo(() => [...streaming, ...held.filter((_, i) => !answered[i]).map(heldRow)], [streaming, held, answered]);
  const withdrawn = useMemo(() => new Set<string>(queue.withdrawn), [queue.withdrawn]);
  const effort = useShownEffort(appSessionId);
  const ownerLane = useOwnerChannel(agentId === undefined ? appSessionId : null)?.lane.on ?? false; // P2-C: a session's, never a child's
  return (
    <Transcript
      source={source}
      variant={agentId === undefined ? 'session' : 'child'}
      actions={actions}
      rewind={rewind}
      renderRequest={renderRequest}
      className={className}
      sessionDirectory={sessionDirectory}
      tail={tail}
      withdrawn={withdrawn}
      effort={agentId === undefined ? effort : null}
      startAt={startAt}
      presentation={presentation}
      ownerLane={agentId === undefined ? ownerLane : undefined}
      atRest={atRest}
    />
  );
}
