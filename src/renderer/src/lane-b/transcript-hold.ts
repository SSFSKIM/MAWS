// A remote lane B session's tab holds its transcript's key while it is mounted (P5 O15 M2b, docs/doperpowers/plans/
// 2026-11-10-p5-o15-recomposition.md, Decision Log 39), so a pane unmounted while its tab stays (the floating card taking
// the session; the offline placeholder until the UX wave's U9 M3, which keeps a pane with something to keep mounted
// through an outage) leaves the key attached, its subscription live through the link's loss. At `up` the pane joins that
// attachment and nothing hydrates: a `replay` opening delivers what the loss held back into the subscription, and the
// whole-launch read that contended with B's stream openings is not made. The armed gap (a `missing` or `snapshot`
// opening, a relaunch) and a return whose stream first says neither `live` nor `gap` (`idle`, `ended`: B lost or ended
// the launch meanwhile) re-read, staged, in the source (../transcript/source/ipc.ts).
//
// - The hold keeps an attachment and never makes one: it joins only what a pane attached while the roster says the
//   machine is `up`. A tab that has only shown the phase's words (restored at launch, opened while offline) holds nothing,
//   and its pane hydrates at `up` as before.
// - A held key not whole at the return (its hydration failed, or was still out at the loss and fails) is read again,
//   as a remount used to. The UX wave, U9 (M5, the ticket on history read after a link's return): decided at the return's settled word, main's `remote.settled` for
//   the roster's generation after the loss, or SETTLE_BACKSTOP_MS after that `up` (./remote-session.ts'
//   `whenHistoryReads`), whether or not anything resubscribes; never beside the live sessions' resumes, and never
//   before the machine is back. A hydration still out waits first.
// - With the pane kept mounted through an outage (U9 M3) the hold no longer has to keep an attachment alive across the
//   loss; it still joins the pane's attachment, since a pane can leave its tab otherwise (the floating card), and a key
//   detached to nothing is released and read whole again at the next mount.
// - A socket-linked profile's sessions are no lane B session here (./remote-session.ts) and a local session's never are:
//   their tabs hold nothing.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import { useMachines } from '../stores/machines';
import { useTranscriptStore } from '../stores/transcript';
import { ipcSource } from '../transcript/source/ipc';
import { useIsRemoteLaneB, useRemoteLaneB, whenHistoryReads } from './remote-session';

/** Holds the session's transcript key from when a pane attached it with the machine `up`; the returned function lets go. */
export function holdRemoteTranscript(appSessionId: AppSessionId): () => void {
  const source = ipcSource(appSessionId);
  const key = source.key!;
  const machine = machineOf(appSessionId);
  const transcripts = () => useTranscriptStore.getState();
  const up = () => useMachines.getState().machines.get(machine)?.state === 'up';
  const generation = () => useMachines.getState().machines.get(machine)?.generation ?? 0;
  const said = () => useRemoteLaneB.getState().states.get(appSessionId);
  let lostIn = 0; // the roster's generation at main's word of the loss: the return's is a later one
  let settling = false; // the return's settled word (or its backstop) is waited for
  let linkWas = said()?.link.state ?? null; // the link as main last said it for the session
  const phase = () => transcripts().entries[key]?.phase;
  let held = false;
  let ended = false;
  let losses = 0; // each loss of the pane's key heard, held or not yet
  let returning = false; // a loss whose return has not yet been met
  // At the stream's return: a hydration still out settles first (its successor too, should one replace it); then a
  // failed key hydrates again, once. A later loss, or the hold's end, stops it there.
  const readAgainIfNotWhole = async (loss: number) => {
    const current = () => !ended && loss === losses && up();
    let waited: Promise<void> | null = null;
    // a key with no attachment left answers a new settled promise at each ask: nothing hydrates it, so nothing to wait on
    while (current() && phase() === 'hydrating' && transcripts().attached(key)) {
      const settled = transcripts().retry(key); // a key still hydrating answers its hydration's settlement
      if (settled === waited) return;
      waited = settled;
      await settled;
    }
    if (current() && phase() === 'failed') void transcripts().retry(key);
  };
  const check = () => {
    if (ended) return;
    // the loss is main's own word (the link `down` after `up`), in main's order with its answers; the roster says when
    // the pane may join and when the machine is back
    const link = said()?.link.state ?? null;
    const lost = link === 'down' && linkWas === 'up';
    linkWas = link;
    // a loss of the pane's key counts whether or not the hold has acquired it: the store counts a pane's attachment
    // after it publishes `hydrating`, and main says the roster's `down` before the session's, so a hold mounted before
    // its pane may hear neither word of the loss with the roster up and acquire only at the return
    if (lost && !returning && (held || transcripts().attached(key))) {
      losses += 1;
      lostIn = generation();
      returning = true;
    }
    if (!held) {
      if (!up() || !transcripts().attached(key)) return;
      held = true;
      offTranscripts();
      void transcripts().attach(key, source); // the same source: the pane's attachment, counted once more
    }
    if (returning && !settling && up() && generation() > lostIn) {
      settling = true;
      const loss = losses;
      void whenHistoryReads(machine).then(() => {
        settling = false;
        if (ended || loss !== losses || !up()) return check(); // a later loss, or gone again: the next return decides
        returning = false;
        void readAgainIfNotWhole(loss);
      });
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
