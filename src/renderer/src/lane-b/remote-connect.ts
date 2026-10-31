// Another machine's lane B sessions in this window (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Subscriptions follow the tabs", "The record"; Interfaces §J, §K).
// - A click on a listed lane B row opens the session's tab (lane B's opener in O8's registry). The renderer asks main for
//   nothing else: main subscribes to a remote lane B session while a tab holds its address, reads its record (emitted as
//   `session.changed`, so the pane takes its started branch) and streams it as the events a local session's pane reads.
//   A session main could not place ("<machine> can't place this session") is tried again by a click, or the pane's Try
//   again: any write of `main.tabs` makes main open every held address again (M2b's "as built", item 3).
// - A pane's opening read. Main says what it holds of a session (its record, its last parts, its `remote.session`) once,
//   to the windows open then; a page that reloads, or a second window, would have none of it. A pane's own `session.get`
//   of a held remote session makes main say it all again (M2b's fix wave, item 4), so the pane asks only once this page
//   listens for every event the answer is followed by: `connectShell` subscribes them (`ipc/events.ts`, `remote.session`
//   into ./remote-session.ts's store), and this connection is mounted after it. A pane announced before then waits.
// - Its read marks, in this app's memory (./read-marks.ts), shown on the records the stores hold.
// - `remote.gap` is the transcript's own (transcript/source/ipc.ts), heard in order with the session's event batches.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerRemoteOpener } from '../sessions/remote-openers';
import { useLayout } from '../stores/layout';
import { connectRemoteReadMarks } from './read-marks';
import { remoteLaneBStateOf, useIsRemoteLaneB } from './remote-session';

let connected: MawsBridge | null = null;
const waiting = new Set<AppSessionId>(); // panes announced before the page listened

function readSession(client: MawsBridge, appSessionId: AppSessionId): void {
  // The answer is not applied here: main says the record as `session.changed` (with its revision), now or once it has read
  // it; the read is the pane's announcement.
  void client.invoke('session.get', { appSessionId });
}

/** A pane of a remote lane B session is open: main is asked for its session, for what it says again. */
export function announceRemotePane(appSessionId: AppSessionId): void {
  if (connected === null) waiting.add(appSessionId);
  else readSession(connected, appSessionId);
}

/** The pane's announcement, once per session it shows while that session is lane B on another machine. */
export function useRemotePaneOpening(appSessionId: AppSessionId): void {
  const remote = useIsRemoteLaneB(appSessionId);
  useEffect(() => {
    if (remote) announceRemotePane(appSessionId);
  }, [appSessionId, remote]);
}

/** Try again for a session main could not place: the tabs written again, which makes main open every held address. */
export function retryRemoteSession(client: MawsBridge = connected ?? ipc): void {
  const layout = useLayout.getState();
  if (!layout.hydrated) return; // nothing is written before hydration; the tabs main has are the persisted ones
  void client.invoke('layout.set', { key: 'main.tabs', value: layout.main }).then((result) => {
    if (!result.ok) console.error('[lane B] could not ask main to open the session again', result.error);
  });
}

export function connectRemoteLaneB(client: MawsBridge = ipc): () => void {
  const offOpener = registerRemoteOpener('B', (listed) => {
    useLayout.getState().openSession(listed.appId);
    if (remoteLaneBStateOf(listed.appId)?.stream === 'ended') retryRemoteSession(client);
  });
  const offReadMarks = connectRemoteReadMarks();
  connected = client;
  for (const appSessionId of waiting) readSession(client, appSessionId);
  waiting.clear();
  return () => {
    offOpener();
    offReadMarks();
    if (connected === client) connected = null;
  };
}
