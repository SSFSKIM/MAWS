import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLayout } from '../stores/layout';
import { A, probeTool, resetPanelStores } from '../test-support/panel';
import { panelHost, registerPanelTool } from './host';
import { TabStrip } from './TabStrip';

beforeEach(() => resetPanelStores());
afterEach(() => cleanup());

function strip(toolId: string) {
  const tabs = useLayout.getState().effectivePanelTabs(A).filter((tab) => tab.toolId === toolId);
  render(<TabStrip toolId={toolId} appSessionId={A} tabs={tabs} activeTabId={tabs[0].id} onChange={(next) => useLayout.getState().setPanelTabs(A, next)} bodyId="test-body" />);
}

describe('per-tool tab creation', () => {
  it.each(['log', 'plugin-pane'])('does not offer a paramless new tab for the menu-hidden %s tool', (toolId) => {
    const { tool, probe } = probeTool(toolId, { menu: false });
    registerPanelTool(tool);
    panelHost.addTool(toolId, { appSessionId: A, params: { target: 'required-target' } });
    strip(toolId);

    expect(screen.queryByRole('button', { name: `New ${toolId} tab` })).toBeNull();
    expect(useLayout.getState().effectivePanelTabs(A)).toHaveLength(1);
    expect(probe.created[0].params).toEqual({ target: 'required-target' });
  });

  it('creates a new instance of an addable multi-instance tool', () => {
    const { tool, probe } = probeTool('terminal');
    registerPanelTool(tool);
    panelHost.addTool('terminal', { appSessionId: A });
    strip('terminal');
    fireEvent.click(screen.getByRole('button', { name: 'New terminal tab' }));
    expect(useLayout.getState().effectivePanelTabs(A)).toHaveLength(2);
    expect(probe.created).toHaveLength(2);
  });
});
