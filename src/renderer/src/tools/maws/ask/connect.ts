// E1 (M4): the Question sheet's connection to the engine host, mounted once from App.tsx's E1 block. Every live
// `session.eventBatch` carrying `maws.ask.*` events updates that session's store. Only live batches reach here: a
// reload's history snapshot is read by command, never re-sent as a batch; the sheet a reload restores reads the host's
// table instead (`ensureLoaded`). When the engine host is back at `ready`, every session read before is read again.
//
// UX wave U1b (M6; O-17): an ask opens, activates and closes nothing. Its form is drawn in its capsule's row; the sheet
// opens only when the person opens it (the capsule's "Open beside" or "View answers", a card's button, the tool's icon).
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../../ipc/client';
import { applyAskEvents, reloadAsks } from './store';

export function connectAsks(client: MawsBridge = ipc): () => void {
  const offs = [
    client.on('session.eventBatch', ({ appSessionId, events }) => {
      applyAskEvents(appSessionId as AppSessionId, events);
    }),
    client.on('engine.hostState', (host, from) => {
      if (host.state === 'ready') reloadAsks(client, from.machine);
    }),
  ];
  return () => offs.forEach((off) => off());
}
