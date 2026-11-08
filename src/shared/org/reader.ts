// A session another member owns, as its reader's app learns what it may do there (board #525; P5 O8 M6b's shares,
// docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, §Q). A listing never says what the reader holds on a session:
// the machine says it only by refusing, `grade`, a read below View and a send below Converse.

/**
 * Main's reason for a lane B session on another machine whose record read the machine refused `grade`: the signed-in
 * member holds less than View there, or the machine hasn't placed a just-started session yet (the endpoint says the one
 * word for both). The renderer knows these words, and says them with whom to ask.
 */
export const READ_REFUSED = "You can't read this session";
