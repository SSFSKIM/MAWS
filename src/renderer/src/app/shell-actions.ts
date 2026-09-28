// The frame's own action handlers (C5 M2): the region toggles, panel maximize, the appearance, and the session actions
// the shell answers itself (open, open in split, pin). Tabs, panes, the palette and attention register theirs in the
// milestones that build them; until then those actions stay disabled in the menu and the page.
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { registerAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
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
