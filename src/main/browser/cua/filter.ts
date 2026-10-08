// What a cua connection may send through its lease (the in-app browser spec of 2026-10-08, "Debugger leases, automation
// ownership and the command filter"; P1 A-51): E4c's bridge boundary (`src/main/browser/agent/bridge.ts`) lifted into the
// server. Electron's debugger client is trusted, so a page session's own Target domain could reach every target in the
// process (MAWS's renderer among them): no `Browser.*`, `Storage.*`, `SystemInfo.*`, `Tethering.*`; of `Target.*` only
// what auto-attach needs, `getTargets` answered from MAWS's own inventory, and `closeTarget` emulated as closing the tab.
// Everything else passes unchanged, Chromium's own error strings included.
//
// The agent's persistent CDP state: the attachment is shared (focus emulation may keep it after the agent lets go), so
// every toggle the connection switched on is undone before its lease is released, and a handed-back page never stalls on
// an interception nobody consumes.

export type CommandRoute = 'pass' | 'refuse' | 'target' | 'getTargets' | 'closeTarget';

const REFUSED_DOMAINS = new Set(['Browser', 'Storage', 'SystemInfo', 'Tethering']);
const TARGET_ALLOWED = new Set(['Target.setAutoAttach', 'Target.detachFromTarget', 'Target.getTargetInfo', 'Target.attachToTarget']);

export const methodNotAllowed = (method: string) => `Method not allowed: ${method}`;

export function routeCommand(method: string): CommandRoute {
  const domain = method.split('.', 1)[0]!;
  if (REFUSED_DOMAINS.has(domain)) return 'refuse';
  if (domain !== 'Target') return 'pass';
  if (method === 'Target.getTargets') return 'getTargets';
  if (method === 'Target.closeTarget') return 'closeTarget';
  return TARGET_ALLOWED.has(method) ? 'target' : 'refuse';
}

export interface AgentToggles {
  fetch: boolean;
  autoAttach: boolean;
  deviceMetrics: boolean;
  focusEmulation: boolean;
  fileChooser: boolean;
}

export const noToggles = (): AgentToggles => ({ fetch: false, autoAttach: false, deviceMetrics: false, focusEmulation: false, fileChooser: false });

// Notes a root-session command that switches persistent state on or off (child sessions end with auto-attach).
export function noteToggle(toggles: AgentToggles, method: string, params: Record<string, unknown>): void {
  switch (method) {
    case 'Fetch.enable':
    case 'Fetch.disable':
      toggles.fetch = method === 'Fetch.enable';
      return;
    case 'Target.setAutoAttach':
      toggles.autoAttach = params.autoAttach === true;
      return;
    case 'Emulation.setDeviceMetricsOverride':
    case 'Emulation.clearDeviceMetricsOverride':
      toggles.deviceMetrics = method === 'Emulation.setDeviceMetricsOverride';
      return;
    case 'Emulation.setFocusEmulationEnabled':
      toggles.focusEmulation = params.enabled === true;
      return;
    case 'Page.setInterceptFileChooserDialog':
      toggles.fileChooser = params.enabled === true;
  }
}

// The commands that undo what is on, auto-attach first (no new frame or worker waits on a debugger nobody runs).
// `mawsFocusEmulation`: MAWS's own focus emulation holds the tab (visibility.ts), so the emulation stays its to set.
export function undoCommands(toggles: AgentToggles, { mawsFocusEmulation }: { mawsFocusEmulation: boolean }): [string, Record<string, unknown>][] {
  const out: [string, Record<string, unknown>][] = [];
  if (toggles.autoAttach) out.push(['Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }]);
  if (toggles.fileChooser) out.push(['Page.setInterceptFileChooserDialog', { enabled: false }]);
  if (toggles.fetch) out.push(['Fetch.disable', {}]);
  if (toggles.deviceMetrics) out.push(['Emulation.clearDeviceMetricsOverride', {}]);
  if (toggles.focusEmulation && !mawsFocusEmulation) out.push(['Emulation.setFocusEmulationEnabled', { enabled: false }]);
  return out;
}
