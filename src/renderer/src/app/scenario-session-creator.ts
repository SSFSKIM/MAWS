// The scenario's stand-in for C10's `session.create` (owner design 2026-09-28; C5 execution document, Slots): in launch
// mode `scenario` a new session is an app id with no record, so "+" and "New session" open an unstarted session tab
// before C10 lands. In launch mode `index` nothing registers, and the creation controls stay disabled until C10
// registers the real creator.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { registerSessionCreator } from '../keymap/actions-runtime';

export function connectScenarioSessionCreator(client: MawsBridge = ipc): () => void {
  let live = true;
  let off: (() => void) | null = null;
  void client.invoke('session.launchMode', undefined).then((result) => {
    if (!live) return;
    if (!result.ok) {
      console.warn('[shell] session.launchMode unavailable; new sessions stay disabled', result.error);
      return;
    }
    // P5 O6 M2: an id the page mints is the local machine's address, drawn once per new session
    if (result.value.mode === 'scenario') off = registerSessionCreator(async () => addressOf(client.localMachine, `app-new-${crypto.randomUUID()}` as AppSessionId));
  });
  return () => {
    live = false;
    off?.();
  };
}
