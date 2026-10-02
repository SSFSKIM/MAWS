// A plugin's toast (R1; charter D-9 as amended 2026-10-01): the engine's `ui_toast`, decoded as `plugin.toast`, shows
// through the app's toast host as "<plugin>: <text>", dismissible, for the plugin's own time. It belongs to the surface
// showing its session, as in the terminal, so a window toasts only for a session that is the active tab of one of its
// panes, and only as the event arrives (`session.eventBatch`): no snapshot carries it again, so a reload or a reopened
// transcript never repeats a toast. The engine itself spaces one plugin's toasts 2 s apart.
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { toast } from '../stores/notices';
import { PLUGIN } from '../transcript';

// Whether a pane of this window shows the session as its active tab (R2's prompt requests read it too).
export function shownHere(appSessionId: AppSessionId): boolean {
  return currentSet(useLayout.getState().main).panes.some((pane) => pane.tabs.some((tab) => tab.id === pane.activeTabId && tab.kind === 'session' && tab.appSessionId === appSessionId));
}

export function connectPluginToasts(client: MawsBridge = ipc): () => void {
  return client.on('session.eventBatch', ({ appSessionId, events }) => {
    for (const event of events) {
      if (event.kind !== 'plugin.toast' || !shownHere(appSessionId as AppSessionId)) continue;
      toast({ id: `plugin:${event.id}`, level: 'info', text: PLUGIN.toast(event.plugin, event.text), actions: [], dismissible: true, durationMs: event.timeoutMs });
    }
  });
}
