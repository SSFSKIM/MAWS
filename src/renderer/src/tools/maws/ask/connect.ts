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
import { useLayout, type LayoutState } from '../../../stores/layout';
import { groupOf, sideGroups, surfaceRefs, surfaceTabs, type SideGroupName } from '../../../panel/surface-model';
import { useSessions } from '../../../stores/sessions';
import type { AskSheetParams } from '../actions';
import { applyAskEvents, askSheet, reloadAsks } from './store';

// With the session shown, `activate` selects the tab without opening any session (the panel host opens one only for a
// target not on screen).
function openSheet(appSessionId: AppSessionId, askId: string): void {
  if (!usePanelHost.getState().tools.has(ASK_SHEET_TOOL_ID)) return;
  const layout = useLayout.getState();
  const visible = layout.regions.panel.collapsed ? [] : surfaceTabs(layout, appSessionId);
  const opened = !visible.some((tab) => tab.toolId === ASK_SHEET_TOOL_ID) && !automatic.has(appSessionId) ? { inViewBefore: null as string | null, stop: () => {} } : null;
  const before = opened && shownBefore(layout, appSessionId);
  if (opened) {
    opened.stop = askSheet(appSessionId).subscribe((state, prev) => {
      // Submit and Dismiss change the store without an engine batch. Check after any whole batch has finished too.
      if (state.asks !== prev.asks && state.asks.size === 0) queueMicrotask(() => closeEmptyAutomatic(appSessionId));
    });
    automatic.set(appSessionId, opened);
  }
  // UX wave U7b (Interfaces §F): the sheet opening by itself is not the person's act, and leaves a page or the Settings
  // dialog open (it opens for the session in front, or once the person has shown it).
  const tabId = panelHost.addTool<AskSheetParams>(ASK_SHEET_TOOL_ID, { appSessionId, params: { askId }, activate: true, asked: 'agent' });
  // The branch review's finding 1: the sheet's group is the one the host put it in (its one resolver, which reads the
  // keyboard too), read back from where its tab now is; the tab it displaced in that group is the one it gives back.
  if (opened && before) {
    const group = groupOf(sideGroups(useLayout.getState(), appSessionId), tabId);
    opened.inViewBefore = group === null ? null : before[group];
  }
}

// Asks that opened while their session was not shown, oldest first. One table for the window (App.tsx connects once),
// so `openAsk` can settle it.
const waiting = new Map<AppSessionId, string[]>();
// Only an automatically revealed surface relinquishes its space once all questions and cancellation notices are gone.
// UX wave U8b (M2; the architect's ruling of 2026-11-13, transitional until U1 removes the automatic open, O-17): with one
// tab in view the sheet takes the place of its group's tab, which it gives back then (null: the column was hidden).
const automatic = new Map<AppSessionId, { stop: () => void; inViewBefore: string | null }>();

// Each group's tab in view before the sheet opens; null while the column is hidden or the right side collapsed.
function shownBefore(layout: LayoutState, appSessionId: AppSessionId): Record<SideGroupName, string | null> | null {
  const groups = sideGroups(layout, appSessionId);
  if (layout.regions.panel.collapsed || groups.hidden) return null;
  return { upper: groups.upper.shown?.id ?? null, lower: groups.lower?.shown?.id ?? null };
}

function stopAutomatic(appSessionId: AppSessionId): void {
  automatic.get(appSessionId)?.stop();
  automatic.delete(appSessionId);
}

function closeEmptyAutomatic(appSessionId: AppSessionId): void {
  const opened = automatic.get(appSessionId);
  if (!opened || askSheet(appSessionId).getState().asks.size !== 0) return;
  stopAutomatic(appSessionId);
  const state = useLayout.getState();
  if (!surfaceTabs(state, appSessionId).some((tab) => tab.toolId === ASK_SHEET_TOOL_ID)) return; // the person chose another tab
  const back = opened.inViewBefore;
  if (back !== null && surfaceRefs(state, appSessionId).some((tab) => tab.id === back)) state.showSurfaceTab(appSessionId, back);
  else state.hideSurfaces(appSessionId);
}

// The person opened the session's sheet themselves (`openAsk`): its waiting asks are theirs now. Called before the open,
// whose `addTool` may show the session.
export function settleWaitingAsks(appSessionId: AppSessionId): void {
  waiting.delete(appSessionId);
  stopAutomatic(appSessionId);
}

export function connectAsks(client: MawsBridge = ipc): () => void {
  let disposed = false;

  // The session just shown: the sheet for the last of its waiting asks still pending, if any. Run after the layout
  // write that showed it has finished, outside that write's subscribers.
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
      closeEmptyAutomatic(id);
      if (opened.length === 0 || !useSessions.getState().records.has(id)) return;
      if (shownSession() === id) openSheet(id, opened.at(-1)!);
      else waiting.set(id, [...(waiting.get(id) ?? []), ...opened]); // every one: a later one may be settled first
    }),
    client.on('engine.hostState', (host, from) => {
      if (host.state === 'ready') reloadAsks(client, from.machine);
    }),
    useLayout.subscribe((state, before) => {
      const now = shownSession(state.main);
      if (now !== null && now !== shownSession(before.main) && waiting.has(now)) queueMicrotask(() => shown(now));
    }),
  ];
  return () => {
    disposed = true; // a deferred open already queued does nothing
    waiting.clear();
    automatic.forEach(({ stop }) => stop());
    automatic.clear();
    offs.forEach((off) => off());
  };
}
