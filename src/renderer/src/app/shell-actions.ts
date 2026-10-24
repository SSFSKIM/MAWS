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
import { activeTab, currentSet, floatingPane } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { useSettings } from '../stores/settings';
import { expandPane, focusSplitCard, togglePanelFloat } from '../shell/floating'; // P3-G; P4-B3: expandPane, focusSplitCard
import { startMarkup } from '../markup/session'; // P3-G
import { openArtifacts } from '../main/artifacts'; // P3-G
import { moveFocusedArtifactToPanel, moveShownRecordToTab } from '../shell/transfer'; // P4-B3 M4
import { panelInMain } from './regions';
import { setSessionUnread, visibleSessionStep } from '../keymap/session-navigation';
import { registerSessionAction } from './session-actions';
import { focusRegion, focusSidebar, stepMainTab } from '../keymap/shell-navigation';
import { toggleKeyboardShortcuts } from '../keymap/KeyboardShortcuts';
import { toggleSidebar } from './shell-view';
import { toggleSessionCards, toggleSurface } from '../panel/SurfaceRow';

export function registerShellActions(client: MawsBridge = ipc): () => void {
  const layout = () => useLayout.getState();
  const offs = [
    registerAction('sidebar.toggle', toggleSidebar),
    // Hiding a maximized panel also un-maximizes it; maximizing a hidden one shows it.
    registerAction('panel.toggle', toggleSessionCards),
    ...(['terminal', 'review', 'browser', 'files', 'source-control', 'subagents', 'background', 'session-info', 'ask-sheet'] as const).map((id) => registerAction(`surface.${id}`, () => toggleSurface(id))),
    registerAction('panel.maximize', () =>
      layout().setPanel(layout().regions.panel.maximized ? { maximized: false } : { maximized: true, collapsed: false }),
    ),
    // P3-G (§D1.2): the floating state; the store's `setPanel` keeps it exclusive with maximized and collapsed.
    registerAction('panel.float', togglePanelFloat),
    registerAction('main.expandArtifactPane', () => expandPane()), // P4-B3 (its Decision Log 12)
    registerAction('artifact.moveToPanel', moveFocusedArtifactToPanel), // P4-B3 (its Decision Log 21)
    registerAction('artifact.moveToTab', moveShownRecordToTab),
    registerAction('markup.start', () => void startMarkup()), // P3-G (§D4.4)
    registerAction('theme.light', () => useSettings.getState().setTheme('light')),
    registerAction('theme.dark', () => useSettings.getState().setTheme('dark')),
    registerAction('theme.system', () => useSettings.getState().setTheme('system')),

    // Tab changes made before the persisted tabs are read are replayed over them by the layout store itself.
    registerAction('tab.close', () => {
      const tab = activeTab(layout().main);
      if (tab) void requestCloseTab(tab.id);
    }),
    ...([1, -1] as const).map((delta) => registerAction(delta === 1 ? 'session.next' : 'session.previous', () => {
      const tab = activeTab(layout().main);
      const next = visibleSessionStep(tab?.kind === 'session' ? tab.appSessionId : null, delta);
      if (next !== null) layout().openSession(next);
    })),
    registerAction('session.markUnread', async () => {
      const tab = activeTab(layout().main);
      if (tab?.kind === 'session') await setSessionUnread(tab.appSessionId, true, client);
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
    registerAction('tab.stripNext', () => stepMainTab(1)),
    registerAction('tab.stripPrevious', () => stepMainTab(-1)),
    registerAction('region.focusNext', () => focusRegion(1)),
    registerAction('region.focusPrevious', () => focusRegion(-1)),
    registerAction('sidebar.focus', focusSidebar),
    registerAction('pane.split', () => layout().splitWithActive()),
    // DOM focus moves too, so a pane-scoped chord (bound to the element that holds focus) follows the pane. P4-B3 (its
    // Decision Log 7): a pane that floats is its card's, which opens if it is a pill, its composer taking the keyboard.
    registerAction('pane.focusOther', () => {
      const shown = currentSet(layout().main);
      if (shown.panes.length < 2) return;
      const other = shown.focusedPane === 0 ? 1 : 0;
      if (floatingPane(shown) === other) return focusSplitCard();
      layout().focusPane(other);
      focusPaneElement(other);
    }),
    registerAction('diagnostics.open', () => layout().openTab({ kind: 'diagnostics' })),
    registerAction('artifacts.open', openArtifacts), // P3-G (§D5): a singleton, so a second open activates it
    registerAction('palette.open', togglePalette),
    registerAction('shortcuts.open', toggleKeyboardShortcuts),

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
