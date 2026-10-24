import { afterEach, beforeEach, expect, it } from 'vitest';
import { A, probeTool, resetPanelStores } from '../test-support/panel';
import { connectPanelHost, panelHost, registerPanelTool } from './host';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { surfaceSession, surfaceTabs } from './surface-model';

let dispose: (() => void)[] = [];
beforeEach(() => { resetPanelStores(); });
afterEach(() => { dispose.forEach((off) => off()); dispose = []; });
it('opens a session surface beside a document without replacing that document tab', () => {
  dispose.push(registerPanelTool(probeTool('terminal').tool), connectPanelHost());
  useLayout.getState().openTab({ kind: 'artifact', artifactId: 'memo' });
  expect(surfaceSession(useLayout.getState())).toBe(A);
  panelHost.addTool('terminal', { appSessionId: A });
  expect(activeTab(useLayout.getState().main)?.id).toBe('artifact:memo');
  expect(surfaceTabs(useLayout.getState(), A).map((tab) => tab.toolId)).toEqual(['terminal']);
});
