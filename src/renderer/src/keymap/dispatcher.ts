// Where keys and menu events become actions (C5 execution document, Keyboard runtime). M2: the application menu's
// `layout.action` events run their action, and main learns which actions have a handler so the menu can disable the
// rest. The renderer-sink key matching (one capture-phase `keydown` listener) arrives with M5.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { enabledActions, runAction, subscribeActions } from './actions-runtime';

export function connectActions(client: MawsBridge = ipc): () => void {
  let connected = true;
  let queued = false;
  // Registrations come in bursts (a component tree mounting); main hears the settled set once per burst.
  const report = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!connected) return;
      void client.invoke('layout.setEnabledActions', { actions: enabledActions() }).then((result) => {
        if (!result.ok) console.warn('[actions] layout.setEnabledActions failed', result.error);
      });
    });
  };
  const offEvent = client.on('layout.action', ({ action, arg }) => runAction(action, arg));
  const offRegistry = subscribeActions(report);
  report();
  return () => {
    connected = false;
    offEvent();
    offRegistry();
  };
}
