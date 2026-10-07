// Focus emulation for the browser views (E4a execution document, Design §3; A-33; Decision Log 1). A-33 asked whether
// a child `WebContentsView` on an unlocked display is hidden to its page (no animation frames, timers at one tick a
// second); if it were, each tab's TabDebugger would attach at view creation and keep
// `Emulation.setFocusEmulationEnabled` on while the view shows. M0 ran the check on screen on 2026-10-06 and read the
// child view **visible** (`spikes/browser-probe/findings-pass2-onscreen.txt`), so the default is off.
// `MAWS_BROWSER_FOCUS_EMULATION=1` turns the remedy on without a build, `=0` keeps it off.
export type FocusEmulationMode = 'off' | 'on';

const M0_VERDICT: FocusEmulationMode = 'off';

export function focusEmulationMode(env: NodeJS.ProcessEnv): FocusEmulationMode {
  const value = env.MAWS_BROWSER_FOCUS_EMULATION;
  return value === '1' ? 'on' : value === '0' ? 'off' : M0_VERDICT;
}

export const FOCUS_EMULATION: FocusEmulationMode = focusEmulationMode(process.env);
