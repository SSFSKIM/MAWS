import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { mountPanelHost, panelHost, registerPanelTool, type PanelHostImplementation } from './host';
import type { PanelTool } from './tool';

const A = 'A' as AppSessionId;

function tool(id: string): PanelTool<{ n: number }> {
  return {
    id,
    title: id,
    icon: () => null,
    pinnable: true,
    multiInstance: true,
    createState: () => ({ n: 1 }),
    beforeClose: async () => true,
    dispose: () => {},
    render: () => null,
  };
}

function implementation(): PanelHostImplementation {
  return {
    addTool: vi.fn(() => 'terminal:1'),
    selectTab: vi.fn(),
    closeTab: vi.fn(async () => true),
    showSummary: vi.fn(),
    closeToolTabs: vi.fn(),
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((cleanup) => cleanup()));

describe('panel host registry', () => {
  it('lists registered tools, the last registration of an id winning', () => {
    const first = tool('x');
    const second = tool('x');
    cleanups.push(registerPanelTool(first), registerPanelTool(second));
    expect(panelHost.tools().filter((t) => t.id === 'x')).toEqual([second]);
  });

  it('closes a tool’s tabs through the mounted host when the tool is unregistered, and only the current registration', () => {
    const host = implementation();
    cleanups.push(mountPanelHost(host));
    const stale = registerPanelTool(tool('y'));
    const current = registerPanelTool(tool('y'));
    stale();
    expect(panelHost.tools().some((t) => t.id === 'y')).toBe(true);
    expect(host.closeToolTabs).not.toHaveBeenCalled();
    current();
    expect(panelHost.tools().some((t) => t.id === 'y')).toBe(false);
    expect(host.closeToolTabs).toHaveBeenCalledWith('y');
  });

  it('forwards addTool, selectTab, closeTab and showSummary to the mounted host', async () => {
    const host = implementation();
    cleanups.push(mountPanelHost(host));
    expect(panelHost.addTool('terminal', { appSessionId: A, params: { cwd: '/tmp' } })).toBe('terminal:1');
    expect(host.addTool).toHaveBeenCalledWith('terminal', { appSessionId: A, params: { cwd: '/tmp' } });
    panelHost.selectTab('terminal:1');
    expect(host.selectTab).toHaveBeenCalledWith('terminal:1');
    await expect(panelHost.closeTab('terminal:1')).resolves.toBe(true);
    panelHost.showSummary();
    expect(host.showSummary).toHaveBeenCalled();
  });

  it('refuses a call when no host is mounted, and unmounting leaves a newer host in place', () => {
    expect(() => panelHost.addTool('terminal', { appSessionId: A })).toThrow(/no panel host is mounted/);
    const older = mountPanelHost(implementation());
    const newer = implementation();
    cleanups.push(mountPanelHost(newer));
    older();
    panelHost.showSummary();
    expect(newer.showSummary).toHaveBeenCalled();
  });
});
