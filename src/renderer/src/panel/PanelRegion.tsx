// The right region (C5 execution document, M2; residue *Right-panel region*): its width (with the resizer on its left
// edge), collapse and maximize, the pane header (P3-G §D2.2: the selected tab's title or an editor's X32 registration,
// then the region's own controls), and the `panelHost` slot below it. The host is handed the session the focused pane
// shows and that session's effective panel tabs (the global pins first, D-10); its changes are split back by pin into
// `panel.pinned` and `panel.<appSessionId>`. What a panel tab is and how it renders is C8's. P3-G (§D1): the fourth state, floating: the divider dragged past the panel's maximum, ⌥⌘B or the
// Float button floats it (the panel stands in the main column as maximized does and hands its host `maximized`, X5 as
// amended) and the floating card draws the shown session over the panel body. P4-B3 (X38): while a main tab is dragged,
// the region (header and body) is covered by one drop target, which moves in an artifact the panel can take and refuses
// (no drop cursor) everything else.
import { useEffect, useRef, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { surfaceSession } from './surface-model';
import { shellGeometryOf, useShellGeometry } from '../app/shell-view';
import { focusPaneElement } from '../main/pane-dom';
import { currentSet } from '../stores/layout-model';
import { COLLAPSE_THRESHOLD_PX, PANEL_BOUNDS } from '../app/regions';
import { Resizer } from '../app/Resizer';
import { useSlot } from '../app/slots';
import { FloatingCardLayer } from '../shell/FloatingCard'; // P3-G
import { floatPanel } from '../shell/floating'; // P3-G
import { DropOverlay } from '../shell/DropOverlay'; // P4-B3 M4
import { moveArtifactToPanel, TAB_DRAG_TYPE, useCoverState } from '../shell/transfer'; // P4-B3 M4
import { TRANSFER_COPY } from '../tools/artifacts/copy'; // P4-B3 M4

export const PANEL_REGION_ID = 'region-panel';

export function PanelRegion() {
  const { maximized, floating } = useLayout((s) => s.regions.panel);
  const geometry = useShellGeometry();
  const collapsed = geometry.panel === 0;
  const width = geometry.panel;
  const max = geometry.panelMax;
  const persisted = useLayout((s) => s.regions.panel.width);
  const setPanel = useLayout((s) => s.setPanel);
  const body = useRef<HTMLDivElement>(null); // P3-G: the floating card's layer starts at the host's tool body
  const shown = useShownPanel(); // P3-G: the header and the host read one selection
  const cover = useCoverState('panel'); // P4-B3 (Z3): the panel is one target for an artifact main tab

  return (<>
    {geometry.sheet && <SurfaceSheetDismissal />}
    <section
      id={PANEL_REGION_ID}
      data-region="panel"
      aria-label="Panel"
      inert={collapsed}
      className={`col-start-3 ${geometry.mainHidden ? 'row-start-3' : 'row-span-3 row-start-1'} flex min-h-0 min-w-0 ${geometry.sheet ? 'absolute inset-y-0 top-(--toolbar-h) right-0 z-30 shadow-float' : 'relative'} ${collapsed ? 'overflow-hidden' : 'py-1.5 pr-1.5 pl-1'}`}
      style={geometry.sheet ? { width } : undefined}
    >
      {!collapsed && !maximized && !floating && !geometry.sheet && (
        <Resizer
          label="Resize right panel"
          controls={PANEL_REGION_ID}
          value={width}
          min={PANEL_BOUNDS.min}
          max={max}
          defaultValue={PANEL_BOUNDS.default}
          grow={-1}
          collapseThreshold={COLLAPSE_THRESHOLD_PX}
          restoreValue={persisted}
          onChange={(next) => setPanel({ width: next })}
          onCollapse={(restore) => setPanel({ collapsed: true, width: restore })}
          expandThreshold={COLLAPSE_THRESHOLD_PX}
          onExpand={(restore) => floatPanel({ width: restore })}
          className="absolute inset-y-0 -left-0.75"
        />
      )}
      {/* The contents clip here, not on the region, so the resizer can straddle the region's edge. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div ref={body} data-panel-content className="min-h-0 flex-1 overflow-auto">
          <Host maximized={maximized || floating} shown={shown} />
        </div>
      </div>
      {floating && !collapsed && <FloatingCardLayer body={body} />}
      {cover !== null && !collapsed && (
        <DropOverlay
          data-testid="panel-drop-target"
          accepts={cover === 'accepted'}
          label={TRANSFER_COPY.moveToPanel}
          onDrop={(event) => void moveArtifactToPanel(event.dataTransfer.getData(TAB_DRAG_TYPE))}
        />
      )}
    </section>
  </>);
}

function availableFocus(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element !== document.body && element.isConnected
    && !element.matches(':disabled, [aria-disabled="true"]')
    && !element.closest('[inert], [hidden], [aria-hidden="true"]');
}

function dismissSheet(opener: HTMLElement | null): void {
  useLayout.getState().setPanel({ collapsed: true });
  requestAnimationFrame(() => {
    // Main must have left inert before focus returns. Do not undo a deliberate focus move or a reopened sheet.
    if (shellGeometryOf(useLayout.getState(), window.innerWidth).sheet || availableFocus(document.activeElement)) return;
    if (availableFocus(opener)) opener.focus({ preventScroll: true });
    else focusPaneElement(currentSet(useLayout.getState().main).focusedPane);
  });
}

function SurfaceSheetDismissal() {
  // Mount only for a sheet: snapshot before an autoFocus child takes the keyboard during the same commit.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      dismissSheet(opener);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [opener]);
  return <button aria-label="Close surface sheet" onClick={() => dismissSheet(opener)} className="absolute inset-0 top-(--toolbar-h) z-30 bg-fg/10" />;
}

interface ShownPanel {
  appSessionId: AppSessionId | null;
  tabs: PanelTabRef[];
  activeTabId: string | null;
}

// The session the focused pane shows and that session's effective panel tabs (the global pins first) with its selection.
function useShownPanel(): ShownPanel {
  const appSessionId = useLayout(surfaceSession);
  const pinned = useLayout((s) => s.panelPinned);
  const own = useLayout((s) => (appSessionId ? s.panelBySession.get(appSessionId) : undefined));
  const activeNoSession = useLayout((s) => s.panelActiveNoSession);
  const tabs = own ? [...pinned, ...own.tabs] : pinned;
  // A session's selection lives in its own key; with no session in view, the pin selection (P4-B3: persisted too).
  const activeTabId = appSessionId ? (own?.activeTabId ?? null) : activeNoSession;
  return { appSessionId, tabs, activeTabId };
}

function Host({ maximized, shown: { appSessionId, tabs, activeTabId } }: { maximized: boolean; shown: ShownPanel }) {
  const Panel = useSlot('panelHost');
  return (
    // The slot's component is registered once at composition and read from a store, not created during render.
    // eslint-disable-next-line react-hooks/static-components
    <Panel
      appSessionId={appSessionId}
      tabs={tabs}
      activeTabId={activeTabId}
      maximized={maximized}
      onChange={(next) => useLayout.getState().setPanelTabs(appSessionId, next)}
      onTogglePinned={(tabId) => {
        const tab = tabs.find((t) => t.id === tabId);
        // A pin moves a tab between the session's own key and the global one, so it needs a session to move to or from.
        if (tab && appSessionId) useLayout.getState().setPanelTabPinned(appSessionId, tabId, !tab.pinned);
      }}
      onToggleMaximize={() => runAction('panel.maximize')}
    />
  );
}
