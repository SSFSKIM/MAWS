// A file outside a session's folders on another machine (UX wave U6f,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §B): read, listed, chosen and saved
// over the machine link by four acts that take the terminal's own offer row and grade, so whoever may open a terminal
// on that machine reaches no more than the terminal already reaches. The endpoint, the services, main and the page read
// these names from here alone.

/** The act whose offer row and grade the four outside acts take, by reference (condition (a)). */
export const TERMINAL_ACT = 'pty.spawn';

/** The open, the chooser's listing, the pick and the save of a file outside a session's folders. */
export const OUTSIDE_ACTS = ['files.readOutside', 'files.listOutside', 'files.chooseOutside', 'files.writeOutside'] as const;

/** What an endpoint lists in its handshake once it serves the four acts; the device sends none of them to one that does not. */
export const OUTSIDE_FILES_CAPABILITY = 'rl2.outside-files';
