import { describe, expect, it } from 'vitest';
import { methodNotAllowed, noteToggle, routeCommand, undoCommands, type AgentToggles } from './filter';

describe('the command filter (E4c bridge boundary, lifted; A-51)', () => {
  it('refuses the browser-wide domains and every Target method but the ones auto-attach and closing a tab need', () => {
    for (const method of ['Browser.getVersion', 'Storage.getCookies', 'SystemInfo.getInfo', 'Tethering.bind', 'Target.createTarget', 'Target.setDiscoverTargets', 'Target.exposeDevToolsProtocol', 'Target.createBrowserContext']) {
      expect(routeCommand(method), method).toBe('refuse');
    }
    expect(methodNotAllowed('Browser.getVersion')).toBe('Method not allowed: Browser.getVersion');
    for (const method of ['Target.setAutoAttach', 'Target.detachFromTarget', 'Target.getTargetInfo', 'Target.attachToTarget']) expect(routeCommand(method), method).toBe('target');
    expect(routeCommand('Target.getTargets')).toBe('getTargets');
    expect(routeCommand('Target.closeTarget')).toBe('closeTarget');
    for (const method of ['Input.dispatchMouseEvent', 'Runtime.evaluate', 'DOM.getDocument', 'Page.navigate', 'Network.enable', 'Fetch.enable', 'Emulation.setDeviceMetricsOverride', 'Accessibility.getFullAXTree', 'Page.handleJavaScriptDialog', 'Page.setInterceptFileChooserDialog']) {
      expect(routeCommand(method), method).toBe('pass');
    }
  });
});

describe('the agent state a lease leaves behind', () => {
  const fresh = (): AgentToggles => ({ fetch: false, autoAttach: false, deviceMetrics: false, focusEmulation: false, fileChooser: false });

  it('records each persistent toggle switched on and forgets one switched off again', () => {
    const toggles = fresh();
    noteToggle(toggles, 'Fetch.enable', {});
    noteToggle(toggles, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    noteToggle(toggles, 'Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    noteToggle(toggles, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    noteToggle(toggles, 'Page.setInterceptFileChooserDialog', { enabled: true });
    expect(toggles).toEqual({ fetch: true, autoAttach: true, deviceMetrics: true, focusEmulation: true, fileChooser: true });
    noteToggle(toggles, 'Fetch.disable', {});
    noteToggle(toggles, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false });
    noteToggle(toggles, 'Emulation.clearDeviceMetricsOverride', {});
    noteToggle(toggles, 'Emulation.setFocusEmulationEnabled', { enabled: false });
    noteToggle(toggles, 'Page.setInterceptFileChooserDialog', { enabled: false });
    expect(toggles).toEqual(fresh());
  });

  it('undoes each with its inverse, auto-attach off before the rest, and leaves focus emulation to MAWS when MAWS keeps it on', () => {
    const all: AgentToggles = { fetch: true, autoAttach: true, deviceMetrics: true, focusEmulation: true, fileChooser: true };
    expect(undoCommands(all, { mawsFocusEmulation: false })).toEqual([
      ['Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }],
      ['Page.setInterceptFileChooserDialog', { enabled: false }],
      ['Fetch.disable', {}],
      ['Emulation.clearDeviceMetricsOverride', {}],
      ['Emulation.setFocusEmulationEnabled', { enabled: false }],
    ]);
    expect(undoCommands(all, { mawsFocusEmulation: true }).map(([method]) => method)).not.toContain('Emulation.setFocusEmulationEnabled');
    expect(undoCommands(fresh(), { mawsFocusEmulation: false })).toEqual([]);
  });
});
