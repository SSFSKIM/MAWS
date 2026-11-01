// The Terminal tool's words (E10 execution document, §Design 5 "Terminals are lost on relaunch", §Design 11).
export const TERMINAL = {
  lostAtQuit: 'The previous shell closed when MAWS quit', // a restored tab whose pty did not outlive the app
  // P5 O7 M3: a terminal of another machine's session
  lostOnMachine: (machine: string) => `The previous shell no longer runs on ${machine}`, // a restored tab its machine listed no pty for
  lostRemote: (machine: string) => `Terminal lost, this Mac can no longer reach it on ${machine}`, // the grant withdrawn, the link gone, the stream refused for good
  reconnecting: 'Reconnecting to this tab’s shell…', // a restored tab looking for its shell on its machine
  pending: 'Open a session to start a terminal',
  lostAtQuitLabel: 'previous shell',
  dismiss: 'Dismiss',
};
