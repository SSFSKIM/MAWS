// A remote lane B session's tab holds its transcript's key while it is mounted (P5 O15 M2b, docs/doperpowers/plans/
// 2026-11-10-p5-o15-recomposition.md, Decision Log 39), so the pane the offline placeholder replaces (P5 Decision Log
// 28, T5) leaves the key attached, its subscription live through the link's loss. At `up` the pane joins that
// attachment and nothing hydrates: a `replay` opening delivers what the loss held back into the subscription, and the
// whole-launch read that contended with B's stream openings is not made. The armed gap (a `missing` or `snapshot`
// opening, a relaunch) and a return whose stream first says neither `live` nor `gap` (`idle`, `ended`: B lost or ended
// the launch meanwhile) re-read, staged, in the source (../transcript/source/ipc.ts).
//
// - The hold keeps an attachment and never makes one: it joins only what a pane attached while the roster says the
//   machine is `up`. A tab that has only shown the placeholder (restored at launch, opened while offline) holds nothing,
//   and its pane hydrates at `up` as before.
// - A held key not whole at the return (its hydration failed, or was still out at the loss and fails) is read again,
//   as a remount used to: once the machine is `up` and main says the session's stream is back (its `remote.session` past
//   `paused` and `opening`, said at the stream's `subbed` or its end), never before; a hydration still out waits first.
// - A socket-linked profile's sessions are no lane B session here (./remote-session.ts) and a local session's never are:
//   their tabs hold nothing.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { useMachines } from '../stores/machines';
import { useTranscriptStore } from '../stores/transcript';
import { ipcSource } from '../transcript/source/ipc';
import { useIsRemoteLaneB, useRemoteLaneB } from './remote-session';

/** The stream not yet back from a loss: paused (the link offline), or opening. */
const NOT_BACK: ReadonlySet<string> = new Set(['paused', 'opening']);

/** Holds the session's transcript key from when a pane attached it with the machine `up`; the returned function lets go. */
export function holdRemoteTranscript(appSessionId: AppSessionId): () => void {
  const source = ipcSource(appSessionId);
  const key = source.key!;
  const machine = machineOf(appSessionId);
  const transcripts = () => useTranscriptStore.getState();
  const up = () => useMachines.getState().machines.get(machine)?.state === 'up';
  const back = () => {
    const stream = useRemoteLaneB.getState().states.get(appSessionId)?.stream;
    return stream !== undefined && !NOT_BACK.has(stream);
  };
  const phase = () => transcripts().entries[key]?.phase;
  let held = false;
  let ended = false;
  let losses = 0; // each loss heard while held
  let returning = false; // a loss whose return has not yet been met
  // At the stream's return: a hydration still out settles first (its successor too, should one replace it); then a
  // failed key hydrates again, once. A later loss, or the hold's end, stops it there.
  const readAgainIfNotWhole = async (loss: number) => {
    const current = () => !ended && loss === losses && up();
    let waited: Promise<void> | null = null;
    while (current() && phase() === 'hydrating') {
      const settled = transcripts().retry(key); // a key still hydrating answers its hydration's settlement
      if (settled === waited) return;
      waited = settled;
      await settled;
    }
    if (current() && phase() === 'failed') void transcripts().retry(key);
  };
  const check = () => {
    if (ended) return;
    if (!held) {
      if (!up() || !transcripts().attached(key)) return;
      held = true;
      offTranscripts();
      void transcripts().attach(key, source); // the same source: the pane's attachment, counted once more
      return;
    }
    if (!up()) {
      if (!returning) losses += 1;
      returning = true;
      return;
    }
    if (returning && back()) {
      returning = false;
      void readAgainIfNotWhole(losses);
    }
  };
  const offTranscripts = useTranscriptStore.subscribe(check);
  const offMachines = useMachines.subscribe(check);
  const offStreams = useRemoteLaneB.subscribe(check);
  check();
  return () => {
    ended = true;
    offTranscripts();
    offMachines();
    offStreams();
    if (held) transcripts().detach(key);
  };
}

/** The tab's hold, while it is mounted and its session is lane B on another machine. */
export function useRemoteTranscriptHold(appSessionId: AppSessionId): void {
  const remote = useIsRemoteLaneB(appSessionId);
  useEffect(() => (remote ? holdRemoteTranscript(appSessionId) : undefined), [appSessionId, remote]);
}
