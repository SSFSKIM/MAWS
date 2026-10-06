// E1 (M4): the Question sheet's connection to the engine host, mounted once from App.tsx's E1 block. Every live
// `session.eventBatch` carrying `maws.ask.*` events updates that session's store; an ask the batch opened and left
// pending opens the sheet for its session, activated, so a blocking ask lands in front of the human and an async one
// stays there (G3, G4). Only live batches reach here: a reload's history snapshot is read by command, never re-sent as a
// batch, so it re-opens nothing; the sheet a reload restores reads the host's table instead (`ensureLoaded`). A window
// that does not know the session leaves it to the one that does, as the pane bridge does. When the engine host is back
// at `ready`, every session read before is read again.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { ipc } from '../../../ipc/client';
import { panelHost, usePanelHost } from '../../../panel/host';
import { useSessions } from '../../../stores/sessions';
import type { AskSheetParams } from '../actions';
import { applyAskEvents, reloadAsks } from './store';

export function connectAsks(client: MawsBridge = ipc): () => void {
  const offs = [
    client.on('session.eventBatch', ({ appSessionId, events }) => {
      const id = appSessionId as AppSessionId;
      const opened = applyAskEvents(id, events);
      const askId = opened.at(-1);
      if (askId === undefined || !useSessions.getState().records.has(id) || !usePanelHost.getState().tools.has(ASK_SHEET_TOOL_ID)) return;
      panelHost.addTool<AskSheetParams>(ASK_SHEET_TOOL_ID, { appSessionId: id, params: { askId }, activate: true });
    }),
    client.on('engine.hostState', (host) => {
      if (host.state === 'ready') reloadAsks(client);
    }),
  ];
  return () => offs.forEach((off) => off());
}
