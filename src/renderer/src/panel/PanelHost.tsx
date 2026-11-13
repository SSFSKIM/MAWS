// The slot component C8a registers into C5's `panelHost` slot (C8a execution document, M1). What the strip is about to
// show is decided here: restored Log refs are dropped before it renders them (and pruned from the store once), and a tab
// appearing for the first time gets its instance (`createState` with the shown session and, P4-B3, the params its tool
// persisted). UX wave U8b (M2 and M3; its execution document, Interfaces §B): the side column draws each group of
// `sideGroups`, one or two, one above the other: the group's strip, the tool's own header row only for a tab that
// registers one (X32), then the body of its one tab in view. Between two groups a bar shares the height (`groupSplit`).
// Nothing is drawn while the column is hidden for the scope (the cards show).
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { useLayout } from '../stores/layout';
import { Resizer } from '../app/Resizer';
import { COPY } from './copy';
import { GROUP_BAR_PX, groupSplit } from './group-split';
import { sideGroups, type SideGroup, type SideGroupName } from './surface-model';
import { PanelHeader, StripControls } from './PanelHeader';
import { ensureShownInstances, isRestoredLog, pruneRestoredLogs, setMountedHost, usePanelHost } from './host';
import type { PanelHostProps } from './host-slot';
// Summary cards live over main; the panel never reserves a summary column.
import { TabStrip } from './TabStrip';
import { ToolBody } from './ToolBody';

export const PANEL_BODY_ID = 'panel-host-body';
const groupId = (name: SideGroupName) => `panel-host-group-${name}`;
// Before the column has a height (a first render, a test), a nominal one stands in.
const NOMINAL_HEIGHT_PX = 806;

export function PanelHost({ appSessionId, tabs, activeTabId, onChange, onTogglePinned }: PanelHostProps) {
  const tools = usePanelHost((s) => s.tools);
  const groups = sideGroups(useLayout(), appSessionId);
  const drawn = groups.hidden ? [] : ([['upper', groups.upper], ['lower', groups.lower]] as const).flatMap(([name, group]) => shownGroup(name, group));
  const stack = useRef<HTMLDivElement>(null);
  const height = useHeight(stack);
  const room = (height > 0 ? height : NOMINAL_HEIGHT_PX) - GROUP_BAR_PX;
  const split = drawn.length === 2 && groups.lower !== null ? groupSplit(room, groups.lower.share) : null;

  useLayoutEffect(() => {
    setMountedHost({ appSessionId, onChange, onTogglePinned });
    return () => setMountedHost(null);
  }, [appSessionId, onChange, onTogglePinned]);

  // Before paint: prune what must not show, then give every shown tab of a registered tool its instance (a tool that
  // registers later than the tab appeared gets it here too, since `tools` changes).
  useLayoutEffect(() => {
    const visible = tabs.filter((t) => !isRestoredLog(t.id)); // before the prune forgets which ids were restored Logs
    pruneRestoredLogs({ tabs, activeTabId, onChange });
    ensureShownInstances(visible, appSessionId);
  }, [appSessionId, tabs, activeTabId, onChange, tools]);

  const hide = () => useLayout.getState().hideSurfaces(appSessionId);
  return (
    <div ref={stack} className="flex h-full min-h-0 flex-col" data-surface-stack>
      {drawn.flatMap(({ name, tabs: strip, shown }, index) => {
        const title = tools.get(shown.toolId)?.title ?? shown.toolId;
        const bodyId = `${PANEL_BODY_ID}-${name}`;
        const below = split !== null && index === 1;
        return [
          ...(below ? [
            <Resizer
              key="bar"
              label={COPY.resizeGroups}
              controls={groupId('lower')}
              orientation="horizontal"
              value={split.lower}
              min={split.min}
              max={split.max}
              defaultValue={Math.round(room / 2)}
              grow={-1}
              percentOf={room}
              onChange={(px) => useLayout.getState().setGroupShare(appSessionId, px / room)}
              onReset={() => useLayout.getState().setGroupShare(appSessionId, 0.5)}
              className="shrink-0"
            />,
          ] : []),
          <section
            key={name}
            id={groupId(name)}
            data-side-group={name}
            aria-label={title}
            style={below ? { height: split.lower } : undefined}
            className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-raised ${below ? 'shrink-0' : 'flex-1'}`}
          >
            <TabStrip appSessionId={appSessionId} group={name} tabs={strip} activeTabId={shown.id} bodyId={bodyId} trailing={<StripControls tab={shown} hide={index === 0 ? hide : undefined} />} />
            <div data-surface={shown.toolId} aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <PanelHeader tab={shown} />
              <div id={bodyId} role="tabpanel" aria-label={title} className="min-h-0 flex-1 overflow-auto wrap-anywhere">
                <ToolBody key={shown.id} tab={shown} appSessionId={appSessionId} />
              </div>
            </div>
          </section>,
        ];
      })}
    </div>
  );
}

// The column's height, followed through its resizes (0 until the observer first reports it, which it does on observing).
function useHeight(element: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setHeight(Math.round(entries?.[0]?.contentRect.height ?? node.clientHeight)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

// A group as the strip draws it: its tabs less the restored Logs about to be pruned, and its tab in view, when that is
// not one of them.
function shownGroup(name: 'upper' | 'lower', group: SideGroup | null): { name: 'upper' | 'lower'; tabs: PanelTabRef[]; shown: PanelTabRef }[] {
  if (group === null || group.shown === null || isRestoredLog(group.shown.id)) return [];
  return [{ name, tabs: group.tabs.filter((t) => !isRestoredLog(t.id)), shown: group.shown }];
}
