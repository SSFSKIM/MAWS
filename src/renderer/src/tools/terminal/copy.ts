// The Terminal tool's words (E10 execution document, §Design 5 "Terminals are lost on relaunch", §Design 11).
export const TERMINAL = {
  lostAtQuit: 'The previous shell closed when MAWS quit', // a restored tab whose pty did not outlive the app
  lostAtQuitLabel: 'previous shell',
  dismiss: 'Dismiss',
};
