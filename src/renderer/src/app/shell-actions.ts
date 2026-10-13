// The frame's own action handlers: the region toggles, panel maximize and the appearance (M2), the tab and pane
// actions and Help › Diagnostics (M4), and the session actions the shell answers itself (open, open in new tab, open in
// split, pin).
// The ⌘K palette's toggle is here too (M5); ⌘⇧J is registered with the attention wiring (`attention/navigation.ts`).
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { announceReplace, discardForReplace, isUnstarted, registerAction, replaceVerdict, requestCloseTab } from '../keymap/actions-runtime';
import { focusPaneElement } from '../main/pane-dom';
import { focusOverview } from '../overview/OverviewPanel';
import { togglePalette } from '../palette/CommandPalette';
import { registerReplaceGuard, useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { togglePanelFloat } from '../shell/floating'; // P3-G
import { startMarkup } from '../markup/session'; // P3-G
import { openArtifacts } from '../main/artifacts'; // P3-G
import { panelInMain } from './regions';
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
    // P3-G (§D1.2): the floating state; the store's `setPanel` keeps it exclusive with maximized and collapsed.
    registerAction('panel.float', togglePanelFloat),
    registerAction('markup.start', () => void startMarkup()), // P3-G (§D4.4)
    registerAction('theme.light', () => useSettings.getState().setTheme('light')),
    registerAction('theme.dark', () => useSettings.getState().setTheme('dark')),
    registerAction('theme.system', () => useSettings.getState().setTheme('system')),

    // Tab changes made before the persisted tabs are read are replayed over them by the layout store itself.
    registerAction('tab.close', () => {
      const tab = activeTab(layout().main);
      if (tab) void requestCloseTab(tab.id);
    }),
    registerAction('tab.reopen', () => layout().reopenClosed()),
    // W5: ⌘0, the View menu and the palette open the floating Overview, or bring focus back to it when it is open.
    registerAction('tab.overview', () => {
      const before = layout();
      before.setOverviewOpen(true);
      if (before.overviewOpen) {
        // An already-open dialog cannot take focus until React removes main's inert state.
        if (panelInMain(before.regions)) requestAnimationFrame(focusOverview);
        else focusOverview();
      }
    }),
    registerAction('tab.select', (n) => {
      if (n !== null) layout().selectTab(n);
    }),
    registerAction('tab.next', () => layout().cycleTab(1)),
    registerAction('tab.previous', () => layout().cycleTab(-1)),
    registerAction('pane.split', () => layout().splitWithActive()),
    // DOM focus moves too, so a pane-scoped chord (bound to the element that holds focus) follows the pane.
    registerAction('pane.focusOther', () => {
      const shown = currentSet(layout().main);
      if (shown.panes.length < 2) return;
      const other = shown.focusedPane === 0 ? 1 : 0;
      layout().focusPane(other);
      focusPaneElement(other);
    }),
    registerAction('diagnostics.open', () => layout().openTab({ kind: 'diagnostics' })),
    registerAction('artifacts.open', openArtifacts), // P3-G (§D5): a singleton, so a second open activates it
    registerAction('palette.open', togglePalette),

    registerSessionAction('open', (appSessionId) => layout().openSession(appSessionId)),
    registerSessionAction('openInNewTab', (appSessionId) => layout().openSession(appSessionId, { how: 'tab' })),
    registerSessionAction('openInSplit', (appSessionId) => layout().openSession(appSessionId, { split: true })),
    // I2: an unstarted tab a replace would take the place of passes its close guard first; E11 F2b: any other tab is
    // replaced unless its kind's verdict keeps it or sets it aside, and the owner is told which
    registerReplaceGuard({ unstarted: isUnstarted, discard: discardForReplace, verdict: replaceVerdict, announce: announceReplace }),
    registerSessionAction('pin', async (appSessionId) => {
      const current = useSessions.getState().records.get(appSessionId);
      if (!current) return;
      const result = await client.invoke('session.update', { appSessionId, patch: { pinned: !current.pinned } });
      if (!result.ok) console.error('[shell] session.update (pin) failed', result.error);
    }),
  ];
  return () => offs.forEach((off) => off());
}
