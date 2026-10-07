// The quit guard's words that E10 adds (E10 execution document, §Design 5): the keep answer the question offers in
// detached mode, and the detail line saying terminals cannot be kept. The question's earlier words stay with it in
// quit-guard.ts.

export const QUIT_KEEP = {
  button: 'Quit and keep sessions running',
  terminalsClose: 'Terminals close with the app.',
} as const;
