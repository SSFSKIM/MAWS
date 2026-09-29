// carried by C9 until the rebase over C6 (wave-2 ledger d.13)
// The harness's page API for Playwright and `spikes/terminal-probe/run.mjs` (C9 Interfaces *Harness*). Each page
// assigns `window.__maws_harness` on mount; only one page is mounted per load. One global interface with each page's
// members optional, so another page (C6's transcript) adds its members by declaration merging into
// `MawsHarnessPages` instead of redeclaring `Window.__maws_harness` with a different type (TS2717).
import type { openTerminal } from '../tools/terminal';
import type { ProbeApi } from './terminal/Probe';
import type { KeyCounts, PanelHarnessApi } from './terminal/PanelHarness';
import type { TerminalsHarnessApi } from './terminal/terminals-api';

declare global {
  interface MawsHarnessPages {
    page?: string; // which page is mounted: 'probe', 'panel'
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
