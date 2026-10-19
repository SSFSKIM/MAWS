// The quit guard's words that E10 adds (E10 execution document, §Design 5): the keep answer the question offers in
// detached mode, and the detail line saying terminals cannot be kept. The question's earlier words stay with it in
// quit-guard.ts.

export const QUIT_KEEP = {
  button: 'Quit and keep sessions running',
  // P4 (sitting candidate 70): the keep question's detail says what keeping and quitting each do, the keep button first
  detail: (verb: 'Quit' | 'Restart') => `Kept running, sessions carry on and MAWS reconnects to them when it opens again. ${verb} stops them; transcripts stay on disk and can be resumed.`,
  terminalsClose: 'Terminals close with the app.',
} as const;
