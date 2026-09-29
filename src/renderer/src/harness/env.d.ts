// carried by C9 until the rebase over C6 (wave-2 ledger d.13)
// The harness's page API for Playwright and `spikes/terminal-probe/run.mjs` (C9 Interfaces *Harness*). Each page
// assigns `window.__maws_harness` on mount; only one page is mounted per load.
import type { openTerminal } from '../tools/terminal';
import type { ProbeApi } from './terminal/Probe';
import type { KeyCounts, PanelHarnessApi } from './terminal/PanelHarness';
import type { TerminalsHarnessApi } from './terminal/terminals-api';

declare global {
  interface Window {
    __maws_harness?:
      | { page: 'probe'; probe: ProbeApi; terminals: TerminalsHarnessApi }
      | { page: 'panel'; panel: PanelHarnessApi; terminals: TerminalsHarnessApi; keys: { counts(): KeyCounts }; openTerminal: typeof openTerminal };
    openTerminal?: typeof openTerminal; // the `#panel` page's console entry for C10's attach path (acceptance item 12)
  }
}
