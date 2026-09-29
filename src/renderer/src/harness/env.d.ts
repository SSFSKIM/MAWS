// The harness's page API for Playwright and the drivers (`spikes/terminal-probe/run.mjs`, C6's transcript spec). Each
// page assigns `window.__maws_harness` on mount; only one page is mounted per load. This is the one declaration of the
// global: each page's members are optional, C6's transcript page (`HarnessApi`, `./api`) included, so no page
// redeclares `Window.__maws_harness` with a type of its own (TS2717, which `skipLibCheck` would hide in a .d.ts).
import type { HarnessApi } from './api';
import type { openTerminal } from '../tools/terminal';
import type { ProbeApi } from './terminal/Probe';
import type { KeyCounts, PanelHarnessApi } from './terminal/PanelHarness';
import type { TerminalsHarnessApi } from './terminal/terminals-api';

declare global {
  interface MawsHarnessPages extends Partial<HarnessApi> {
    // #transcript (C6): load, play, pause, step, turnId, expandAll, expandTurn, scrollToTurn, metrics
    page?: string; // which C9 page is mounted: 'probe', 'panel'
    terminals?: TerminalsHarnessApi; // #probe and #panel
    probe?: ProbeApi; // #probe
    panel?: PanelHarnessApi; // #panel
    keys?: { counts(): KeyCounts }; // #panel
    openTerminal?: typeof openTerminal; // #panel
  }
  interface Window {
    __maws_harness?: MawsHarnessPages;
    openTerminal?: typeof openTerminal; // the `#panel` page's console entry for C10's attach path (acceptance item 12)
  }
}
