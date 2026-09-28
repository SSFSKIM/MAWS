// The frame's own action handlers: the region toggles, panel maximize and the appearance (M2), the tab and pane
// actions and Help › Diagnostics (M4), and the session actions the shell answers itself (open, open in split, pin).
// The palette and attention register theirs in M5; until then those actions stay disabled in the menu and the page.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerAction, requestCloseTab } from '../keymap/actions-runtime';
import { useLayout, whenHydrated } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { registerSessionAction } from './session-actions';

export function registerShellActions(client: MawsBridge = ipc): () => void {
  const layout = () => useLayout.getState();
  // A tab action that arrives before the persisted tabs are read (a menu click racing the first load) waits for them,
  // or hydration would replace its result.
  const tabs = (run: (arg: number | null) => void) => (arg: number | null) => whenHydrated(() => run(arg));
  const offs = [
    registerAction('sidebar.toggle', () => layout().setSidebar({ collapsed: !layout().regions.sidebar.collapsed })),
    // Hiding a maximized panel also un-maximizes it; maximizing a hidden one shows it.
    registerAction('panel.toggle', () =>
      layout().setPanel(layout().regions.panel.collapsed ? { collapsed: false } : { collapsed: true, maximized: false }),
    ),
    registerAction('panel.maximize', () =>
      layout().setPanel(layout().regions.panel.maximized ? { maximized: false } : { maximized: true, collapsed: false }),
    ),
    registerAction('theme.light', () => useSettings.getState().setTheme('light')),
    registerAction('theme.dark', () => useSettings.getState().setTheme('dark')),
    registerAction('theme.system', () => useSettings.getState().setTheme('system')),

    registerAction(
      'tab.close',
      tabs(() => {
        const tab = activeTab(layout().main);
        if (tab) void requestCloseTab(tab.id);
      }),
    ),
    registerAction('tab.reopen', tabs(() => layout().reopenClosed())),
    registerAction('tab.overview', tabs(() => layout().openTab({ kind: 'overview' }))),
    registerAction('tab.select', tabs((n) => n !== null && layout().selectTab(n))),
    registerAction('tab.next', tabs(() => layout().cycleTab(1))),
    registerAction('tab.previous', tabs(() => layout().cycleTab(-1))),
    registerAction('pane.split', tabs(() => layout().splitWithActive())),
    registerAction(
      'pane.focusOther',
      tabs(() => layout().focusPane(layout().main.focusedPane === 0 ? 1 : 0)),
    ),
    registerAction('diagnostics.open', tabs(() => layout().openTab({ kind: 'diagnostics' }))),

    registerSessionAction('open', (appSessionId) => layout().openSession(appSessionId)),
    registerSessionAction('openInSplit', (appSessionId) => layout().openSession(appSessionId, { split: true })),
    registerSessionAction('pin', async (appSessionId) => {
      const current = useSessions.getState().records.get(appSessionId);
      if (!current) return;
      const result = await client.invoke('session.update', { appSessionId, patch: { pinned: !current.pinned } });
      if (!result.ok) console.error('[shell] session.update (pin) failed', result.error);
    }),
  ];
  return () => offs.forEach((off) => off());
}
