// The harness's page API for Playwright and `spikes/terminal-probe/run.mjs` (C9 Interfaces *Harness*). Each page
// assigns `window.__maws_harness` on mount; only one page is mounted per load.
import type { ProbeApi } from './terminal/Probe';

declare global {
  interface Window {
    __maws_harness?: { page: 'probe'; probe: ProbeApi };
  }
}
