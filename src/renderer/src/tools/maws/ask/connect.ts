// E1 (M4): the Question sheet's connection to the engine host, mounted once from App.tsx's E1 block. Every live
// `session.eventBatch` carrying `maws.ask.*` events updates that session's store. Only live batches reach here: a
// reload's history snapshot is read by command, never re-sent as a batch, so it re-opens nothing; the sheet a reload
// restores reads the host's table instead (`ensureLoaded`). A window that does not know the session leaves it to the
// one that does, as the pane bridge does. When the engine host is back at `ready`, every session read before is read
// again.
//
// M4b (the architect's ruling 2): the sheet never switches the main view. An ask the batch opened and left pending
// opens the sheet at once only when its session is the one the window shows (the panel's session: the focused pane's
// active tab), so a blocking ask lands in front of the human who is looking at it (G3) and an async one stays there
// (G4). An ask from any other session waits, carried by its capsule, its attention item and the Overview card, and the
// sheet opens when the person goes to that session with the ask still pending; once opened, it is the sheet's. A sheet
// the person opens themselves (a card's or the capsule's `openAsk`) takes the session's waiting asks with it, so the
// deferred open never re-targets the ask they chose.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { ipc } from '../../../ipc/client';
import { panelHost, shownSession, usePanelHost } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import type { AskSheetParams } from '../actions';
import { applyAskEvents, askSheet, reloadAsks } from './store';

// With the session shown, `activate` selects the tab without opening any session (the panel host opens one only for a
// target not on screen).
function openSheet(appSessionId: AppSessionId, askId: string): void {
  if (!usePanelHost.getState().tools.has(ASK_SHEET_TOOL_ID)) return;
  panelHost.addTool<AskSheetParams>(ASK_SHEET_TOOL_ID, { appSessionId, params: { askId }, activate: true });
}

// Asks that opened while their session was not shown, oldest first. One table for the window (App.tsx connects once),
// so `openAsk` can settle it.
const waiting = new Map<AppSessionId, string[]>();

// The person opened the session's sheet themselves (`openAsk`): its waiting asks are theirs now. Called before the open,
// whose `addTool` may show the session.
export function settleWaitingAsks(appSessionId: AppSessionId): void {
  waiting.delete(appSessionId);
}

export function connectAsks(client: MawsBridge = ipc): () => void {
  let disposed = false;

  // The session just shown: the sheet for the last of its waiting asks still pending, if any. Run after the layout
  // write that showed it has finished: a panel `addTool` opens the session before writing its own tab, and the sheet
  // must land on that tab, not on a second one.
  const shown = (appSessionId: AppSessionId) => {
    const asks = waiting.get(appSessionId);
    if (disposed || asks === undefined || shownSession() !== appSessionId) return;
    waiting.delete(appSessionId);
    const held = askSheet(appSessionId).getState().asks;
    const askId = asks.findLast((id) => held.get(id)?.state === 'pending');
    if (askId !== undefined) openSheet(appSessionId, askId);
  };

  const offs = [
    client.on('session.eventBatch', ({ appSessionId, events }) => {
      const id = appSessionId as AppSessionId;
      const opened = applyAskEvents(id, events);
      if (opened.length === 0 || !useSessions.getState().records.has(id)) return;
      if (shownSession() === id) openSheet(id, opened.at(-1)!);
      else waiting.set(id, [...(waiting.get(id) ?? []), ...opened]); // every one: a later one may be settled first
    }),
    client.on('engine.hostState', (host) => {
      if (host.state === 'ready') reloadAsks(client);
    }),
    useLayout.subscribe((state, before) => {
      const now = shownSession(state.main);
      if (now !== null && now !== shownSession(before.main) && waiting.has(now)) queueMicrotask(() => shown(now));
    }),
  ];
  return () => {
    disposed = true; // a deferred open already queued does nothing
    waiting.clear();
    offs.forEach((off) => off());
  };
}
