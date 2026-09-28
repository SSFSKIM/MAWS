// The frame's own action handlers: the region toggles, panel maximize and the appearance (M2), the tab and pane
// actions and Help › Diagnostics (M4), and the session actions the shell answers itself (open, open in split, pin).
// The palette and attention register theirs in M5; until then those actions stay disabled in the menu and the page.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerAction, requestCloseTab } from '../keymap/actions-runtime';
import { focusPaneElement } from '../main/pane-dom';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { registerSessionAction } from './session-actions';

export function registerShellActions(client: MawsBridge = ipc): () => void {
  const layout = () => useLayout.getState();
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

    // Tab changes made before the persisted tabs are read are replayed over them by the layout store itself.
    registerAction('tab.close', () => {
      const tab = activeTab(layout().main);
      if (tab) void requestCloseTab(tab.id);
    }),
    registerAction('tab.reopen', () => layout().reopenClosed()),
    registerAction('tab.overview', () => layout().openTab({ kind: 'overview' })),
    registerAction('tab.select', (n) => {
      if (n !== null) layout().selectTab(n);
    }),
    registerAction('tab.next', () => layout().cycleTab(1)),
    registerAction('tab.previous', () => layout().cycleTab(-1)),
    registerAction('pane.split', () => layout().splitWithActive()),
    // DOM focus moves too, so a pane-scoped chord (bound to the element that holds focus) follows the pane.
    registerAction('pane.focusOther', () => {
      if (layout().main.panes.length < 2) return;
      const other = layout().main.focusedPane === 0 ? 1 : 0;
      layout().focusPane(other);
      focusPaneElement(other);
    }),
    registerAction('diagnostics.open', () => layout().openTab({ kind: 'diagnostics' })),

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
