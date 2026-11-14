// The live word (the UX wave, U9, S-05; A7; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §10
// and M5's "The live word is the window's to derive"): a session MAWS runs on another machine has no digest here, so
// every reader of its state takes its listing's word, sminos's, which trails the session by seconds. While a tab of the
// strip names its address, its machine's link is up, main still holds its status (`holdsRemoteStatus`) and the window
// holds its engine status, the listing carries that status's turn: `running` with a turn, `resting` without. The word
// rides the listing entry (the sessions store applies it there, `applyLive`), where every reader already reaches the
// listing (sessions/listed-state.ts is the one that reads it), and it is gone the moment any of those fails, so a closed
// tab's row returns to the listing's word. A session with no listing entry yet has nothing to carry it until one comes.
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { allTabs } from '../stores/layout-model';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { useSessions, type LiveWord } from '../stores/sessions';
import { holdsRemoteStatus, useRemoteLaneB } from './remote-session';

/** Every address a tab of the strip names whose session takes the live word now, with its word. */
export function liveWordsNow(): Map<AppSessionId, LiveWord> {
  const words = new Map<AppSessionId, LiveWord>();
  const { machines } = useMachines.getState();
  const { states } = useRemoteLaneB.getState();
  const { engine } = useSessions.getState();
  for (const tab of allTabs(useLayout.getState().main)) {
    if (tab.kind !== 'session' && tab.kind !== 'agent') continue;
    const id = tab.appSessionId;
    if (!isAddress(id) || machineOf(id) === ipc.localMachine || words.has(id)) continue;
    const state = states.get(id); // said only for a lane B session main follows over RL2
    const status = engine.get(id);
    if (state === undefined || !holdsRemoteStatus(state) || status === undefined) continue;
    if (machines.get(machineOf(id))?.state !== 'up') continue;
    words.set(id, status.turn != null ? 'running' : 'resting');
  }
  return words;
}

const same = (a: ReadonlyMap<AppSessionId, LiveWord>, b: ReadonlyMap<AppSessionId, LiveWord>) => a.size === b.size && [...a].every(([id, word]) => b.get(id) === word);

/** Follows the four stores the word is read from and applies each change to the listings; the returned function stops. */
export function startLiveWords(): () => void {
  const apply = () => {
    const words = liveWordsNow();
    if (!same(words, useSessions.getState().liveWords)) useSessions.getState().applyLive(words);
  };
  const offs = [useLayout.subscribe(apply), useMachines.subscribe(apply), useRemoteLaneB.subscribe(apply), useSessions.subscribe(apply)];
  apply();
  return () => offs.forEach((off) => off());
}
