// The quit guard's words that E10 adds (E10 execution document, §Design 5): the keep answer the question offers in
// detached mode, and the detail line saying terminals cannot be kept (P5 O2 M7: or, on the daemon shape, that they keep
// running). The question's earlier words stay with it in
// quit-guard.ts.

export const QUIT_KEEP = {
  button: 'Quit and keep sessions running',
  // P4 (sitting candidate 70): the keep question's detail says what keeping and quitting each do, the keep button first
  detail: (verb: 'Quit' | 'Restart') => `Kept running, sessions carry on and MAWS reconnects to them when it opens again. ${verb} stops them; transcripts stay on disk and can be resumed.`,
  terminalsClose: 'Terminals close with the app.',
  // P5 O2 M7: on the daemon shape the terminals run under the machine daemon and outlive the app, whatever the answer
  terminalsKeep: (busy: number | null) =>
    busy === null ? 'Terminals keep running; MAWS shows them again when it opens.' : busy === 1 ? '1 terminal running a command keeps running; MAWS shows it again when it opens.' : `${busy} terminals running a command keep running; MAWS shows them again when it opens.`,
} as const;
