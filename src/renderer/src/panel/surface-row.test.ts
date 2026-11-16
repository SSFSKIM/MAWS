// The Question sheet's row of the side column's icons (`toggleSurface`, UX wave U8b's one entry): it shows and hides
// the sheet as it does any tool's. UX wave U1b (M6) took out its call that settled the asks waiting for the automatic
// open, which is gone; this case pins that the toggle itself is unchanged.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ASK_SHEET_TOOL_ID } from '@shared/maws/panes';
import { A, panelOf, probeTool, resetPanelStores } from '../test-support/panel';
import { useLayout } from '../stores/layout';
import { registerPanelTool } from './host';
import { surfaceTabs } from './surface-model';
import { toggleSurface } from './SurfaceRow';

beforeEach(() => resetPanelStores());
afterEach(() => resetPanelStores());

it('toggling the ask sheet’s row shows the sheet, hides the column, and shows the same tab again', () => {
  const files = { id: 'files:aaaa0002', toolId: 'files', pinned: false };
  const { tool, probe } = probeTool(ASK_SHEET_TOOL_ID, { multiInstance: false, pinnable: false });
  registerPanelTool(tool);
  useLayout.setState({
    panelBySession: new Map([[A, { tabs: [files], activeTabId: files.id }]]),
    panelSurfaces: { version: 2, stacks: { [A]: [files.id] }, pinnedTools: [], contexts: {} },
  });
  const inView = () => surfaceTabs(useLayout.getState(), A).map((tab) => tab.toolId);

  toggleSurface(ASK_SHEET_TOOL_ID); // no sheet yet: one is added, in view
  expect(probe.created.map((init) => init.appSessionId)).toEqual([A]);
  expect(inView()).toEqual([ASK_SHEET_TOOL_ID]);
  expect(useLayout.getState().regions.panel.collapsed).toBe(false);
  const sheet = panelOf(A)!.tabs.find((tab) => tab.toolId === ASK_SHEET_TOOL_ID)!;

  toggleSurface(ASK_SHEET_TOOL_ID); // in view: the column hides, closing nothing
  expect(inView()).toEqual([]);
  expect(panelOf(A)?.tabs.map((tab) => tab.id)).toEqual([files.id, sheet.id]);

  toggleSurface(ASK_SHEET_TOOL_ID); // hidden: the same tab comes back
  expect(inView()).toEqual([ASK_SHEET_TOOL_ID]);
  expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.id)).toEqual([sheet.id]);
  expect(probe.created).toHaveLength(1);
});
