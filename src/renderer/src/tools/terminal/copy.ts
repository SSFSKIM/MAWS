// The Terminal tool's words (E10 execution document, §Design 5 "Terminals are lost on relaunch", §Design 11).
import type { AttachRefusal } from '../../composer/attach-pasted';
export const TERMINAL = {
  lostAtQuit: 'Previous shell closed at quit', // a restored tab whose pty did not outlive the app (the word cut, T269)
  // P5 O7 M3: a terminal of another machine's session
  lostOnMachine: (machine: string) => `Previous shell no longer runs on ${machine}`, // a restored tab its machine listed no pty for (T269)
  lostRemote: (machine: string) => `Terminal lost, this Mac can no longer reach it on ${machine}`, // the grant withdrawn, the link gone, the stream refused for good
  reconnecting: 'Reconnecting…', // a restored tab looking for its shell on its machine (the word cut, T268)
  pending: 'Open a session to start a terminal',
  lostAtQuitLabel: 'previous shell',
  dismiss: 'Dismiss',
};

// UX wave U6b-5a (M2; card K4, as the owner answered it: the cause in the sentence): what "Attach selection to chat" says,
// one line per outcome. `title` is the session's title as its tab reads; `machine` the name of its machine as the sidebar
// names it, null for this Mac. "Not added" is said only where no write of the block can still land; every other doubt
// is `unconfirmed`. `taken` (the box on screen took it, with the keyboard) says nothing.
type Said = { title: string; machine: string | null };
export const ATTACH = {
  menuItem: 'Attach selection to chat',
  added: ({ title }: Said) => `Added to ${title}`,
  unconfirmed: ({ title }: Said) => `MAWS could not confirm that the selection was added to ${title}. Open it to look before attaching again.`,
  nothing: "Nothing on this terminal's screen to attach.",
  refused: {
    'not-started': ({ title }) => `Not added: ${title} has not started.`,
    'taking-back': ({ title }) => `Not added: ${title} is taking a message back.`,
    changed: ({ title }) => `Not added: ${title}'s draft kept changing. Attach again.`,
    unknown: () => "Not added: this terminal's session is no longer known.",
    unreachable: ({ machine }) => (machine === null ? "Not added: MAWS's service on this Mac is not answering." : `Not added: ${machine} is not answering.`),
    'no-store': ({ machine }) => `Not added: ${machine ?? 'its machine'} keeps no drafts for this window.`,
    busy: ({ title }) => `Not added: ${title} is sending a message.`,
    closed: ({ title }) => `Not added: ${title} takes no typing now.`,
    failed: ({ title }) => `The selection was not added to ${title}.`,
    unsaved: ({ title }) => `${title} has the selection, but its draft could not be saved.`,
  } satisfies Record<AttachRefusal, (said: Said) => string>,
};
