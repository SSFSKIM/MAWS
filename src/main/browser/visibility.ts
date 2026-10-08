// Focus emulation for the browser views (E4a execution document, Design §3; A-33; Decision Log 1). A-33 asked whether
// a child `WebContentsView` on an unlocked display is hidden to its page (no animation frames, timers at one tick a
// second); if it were, each tab's TabDebugger would attach at view creation and keep
// `Emulation.setFocusEmulationEnabled` on while the view shows. M0 ran the check on screen on 2026-10-06 and read the
// child view **visible** (`spikes/browser-probe/findings-pass2-onscreen.txt`), so the default is off.
// `MAWS_BROWSER_FOCUS_EMULATION=1` turns the remedy on without a build, `=0` keeps it off; `startBrowser` reads it from
// the environment it is given.
//
// Under 'on', the tab's TabDebugger attaches at view creation and stays attached (never detached on idle); the view
// manager decides when a page should have the emulation (shown, uncovered, placed, its window visible and not minimized)
// and calls `setFocusEmulation` on each change, and each committed navigation re-enables it while it should hold. A
// renderer crash ends the attachment (the store detaches it); the next committed navigation attaches again, wanted or
// not (Design §15), so the debugger is attached under 'on' whenever the tab has a live page.
import type { TabEntry } from './tabs';

export type FocusEmulationMode = 'off' | 'on';

export const FOCUS_EMULATION_DEFAULT: FocusEmulationMode = 'off'; // M0's verdict

export function focusEmulationMode(env: NodeJS.ProcessEnv): FocusEmulationMode {
  const value = env.MAWS_BROWSER_FOCUS_EMULATION;
  return value === '1' ? 'on' : value === '0' ? 'off' : FOCUS_EMULATION_DEFAULT;
}

// The view manager's `setFocusEmulation` hook: the command goes through the tab's TabDebugger, the one CDP path.
// Every change goes through `send`, which keeps the order of the calls: a disable that follows an enable while the attach
// is still settling goes out after it, so the last wanted value wins. Only a disable with no attachment made or being
// made is dropped: a gone attachment took its emulation with it.
export function setFocusEmulation(entry: TabEntry, enabled: boolean): void {
  const tabDebugger = entry.debugger;
  if (!tabDebugger || (!enabled && !tabDebugger.attached && !tabDebugger.attaching)) return;
  tabDebugger.send('Emulation.setFocusEmulationEnabled', { enabled }).catch(failed);
}

// Under 'on', at view creation (the store's `onViewCreated`): attached at once; after each committed navigation attached
// again if a crash ended it (a no-op otherwise), and re-enabled while the page should have it.
export function attachFocusEmulation(entry: TabEntry, wanted: (entry: TabEntry) => boolean): void {
  const view = entry.view!;
  entry.debugger!.attach('focus').catch(failed);
  view.webContents.on('did-navigate', () => {
    if (entry.view !== view || !entry.debugger) return;
    entry.debugger.attach('focus').catch(failed);
    if (wanted(entry)) setFocusEmulation(entry, true);
  });
}

function failed(error: unknown): void {
  console.warn('[browser] focus emulation failed:', error instanceof Error ? error.message : error);
}
