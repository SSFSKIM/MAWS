// The harness's page API for Playwright and the drivers (`spikes/terminal-probe/run.mjs`, C6's transcript spec). Each
// page assigns `window.__maws_harness` on mount; only one page is mounted per load. This is the one declaration of the
// global: each page's members are optional, C6's transcript page (`HarnessApi`, `./api`) included, so no page
// redeclares `Window.__maws_harness` with a type of its own (TS2717, which `skipLibCheck` would hide in a .d.ts).
import type { HarnessApi } from './api';
import type { openTerminal } from '../tools/terminal';
import type { ProbeApi } from './terminal/Probe';
import type { PanelHarnessApi } from './panel/api'; // C8a: the product host's #panel page (C9's stand-in folded in)
import type { KeyCounts } from './panel/terminalProbes';
import type { TerminalsHarnessApi } from './terminal/terminals-api';
// C8c start
import type { CodeHarnessApi } from './code/api';
// C8c end
// C8b start
import type { AgentsHarnessApi } from './agents/api';
// C8b end

declare global {
  interface MawsHarnessPages extends Partial<HarnessApi> {
    // #transcript (C6): load, play, pause, step, turnId, expandAll, expandTurn, scrollToTurn, metrics
    page?: string; // which page is mounted: 'probe' (C9), 'panel' (C8a, with C9's probes)
    terminals?: TerminalsHarnessApi; // #probe and #panel
    probe?: ProbeApi; // #probe
    panel?: PanelHarnessApi; // #panel
    keys?: { counts(): KeyCounts }; // #panel
    openTerminal?: typeof openTerminal; // #panel
    // C8c start
    code?: CodeHarnessApi; // #panel: Review, Files and the viewer
    // C8c end
    // C8b start
    agents?: AgentsHarnessApi; // #panel: Subagents, Background work and the Log over the fake agent-work client
    // C8b end
  }
  interface Window {
    __maws_harness?: MawsHarnessPages;
    openTerminal?: typeof openTerminal; // the `#panel` page's console entry for C10's attach path (acceptance item 12)
  }
}
