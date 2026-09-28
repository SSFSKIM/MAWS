// The right panel's host slot (C5 execution document, Slots; X5, residue *Right-panel region*). C5 owns the region,
// its width, collapse and maximize, and the persistence of panel tabs as `PanelTabRef`s split into the global pins
// (`panel.pinned`, D-10) and the session's own (`panel.<appSessionId>`); C8 owns what a tab is, its live state and its
// rendering, and reads C9's `panel/tool.ts` for the tool declaration. C8 adopts or adapts at this file.
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTabRef } from '@shared/ipc/schema/layout';

export interface PanelHostProps {
  appSessionId: AppSessionId | null; // the session the panel shows (the focused pane's session tab, else null)
  tabs: PanelTabRef[]; // effectivePanelTabs(appSessionId): the `panel.pinned` refs first, then the session's own
  activeTabId: string | null;
  maximized: boolean;
  onChange(next: { tabs: PanelTabRef[]; activeTabId: string | null }): void; // C5 splits pinned refs back into the two keys
  onTogglePinned(tabId: string): void;
  onToggleMaximize(): void;
}
