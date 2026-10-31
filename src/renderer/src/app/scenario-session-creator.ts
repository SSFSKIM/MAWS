// The scenario's stand-in for C10's `session.create` (owner design 2026-09-28; C5 execution document, Slots): in launch
// mode `scenario` a new session is an app id with no record, so "+" and "New session" open an unstarted session tab
// before C10 lands. In launch mode `index` nothing registers, and the creation controls stay disabled until C10
// registers the real creator. 2026-10-31: the mode is asked until main answers it (./launch-mode.ts).
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { onLaunchMode } from './launch-mode';

export function connectScenarioSessionCreator(client: MawsBridge = ipc): () => void {
  let off: (() => void) | null = null;
  const stop = onLaunchMode((mode) => {
    // P5 O6 M2: an id the page mints is the local machine's address, drawn once per new session
    if (mode === 'scenario') off = registerSessionCreator(async () => addressOf(client.localMachine, `app-new-${crypto.randomUUID()}` as AppSessionId));
  }, client);
  return () => {
    stop();
    off?.();
  };
}
