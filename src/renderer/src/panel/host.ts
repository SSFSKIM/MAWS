// X5, the panel host's registry and entry points. Owner: C8 (C8a). Written by C9 from C8's "X5, final" with the names
// C8a keeps (`registerPanelTool`, `panelHost`); until C8a lands, the host that answers `panelHost` is the `#panel`
// harness, which mounts itself here through `mountPanelHost`. C8a replaces the mounting with its own host.
import type { AppSessionId } from '@shared/graph/ids';
import type { PanelTool } from './tool';

export interface AddToolOptions<P> {
  appSessionId: AppSessionId | null;
  params?: P;
  pin?: boolean;
  activate?: boolean;
}

// What a mounted host implements; `panelHost` forwards to it.
export interface PanelHostImplementation {
  addTool(toolId: string, opts: AddToolOptions<unknown>): string; // returns the new (or re-targeted) tab's id
  selectTab(tabId: string): void;
  closeTab(tabId: string): Promise<boolean>; // runs the tool's beforeClose; false when it vetoed
  showSummary(): void;
  closeToolTabs(toolId: string): void; // the tool was unregistered: its tabs close without asking
}

// Tools are stored without their state and params types: the host only moves a tool's state between its own calls.
const tools = new Map<string, PanelTool<unknown, unknown>>();
let mounted: PanelHostImplementation | null = null;

// Last registration wins; the returned function unregisters (if still current) and closes the tool's tabs.
export function registerPanelTool<S, P>(tool: PanelTool<S, P>): () => void {
  const stored = tool as unknown as PanelTool<unknown, unknown>;
  tools.set(tool.id, stored);
  return () => {
    if (tools.get(tool.id) !== stored) return;
    tools.delete(tool.id);
    mounted?.closeToolTabs(tool.id);
  };
}

export function mountPanelHost(host: PanelHostImplementation): () => void {
  mounted = host;
  return () => {
    if (mounted === host) mounted = null;
  };
}

function host(): PanelHostImplementation {
  if (!mounted) throw new Error('no panel host is mounted');
  return mounted;
}

export const panelHost = {
  addTool<P>(toolId: string, opts: AddToolOptions<P>): string {
    return host().addTool(toolId, opts);
  },
  selectTab(tabId: string): void {
    host().selectTab(tabId);
  },
  closeTab(tabId: string): Promise<boolean> {
    return host().closeTab(tabId);
  },
  showSummary(): void {
    host().showSummary();
  },
  tools(): PanelTool<unknown, unknown>[] {
    return [...tools.values()];
  },
};
