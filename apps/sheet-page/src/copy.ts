// The page's own words (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, "The look"; the word cut's
// rules, docs/doperpowers/specs/2026-11-16-word-cut-design.md). The composite fixes the command `mawsd sheet pair` and
// the two addresses; the rest is the look's, settled on the drawn example (F1 to F9), but for the lines marked as this
// child's own, which the owner sees with the built look (M5).
export const PAGE = {
  name: 'Sheet', // F2: the app's tab's name; the bar and the browser tab's title
  thisMac: 'This Mac', // where the person is, on the overview
  allSessions: 'All sessions', // F6: the link back, on a sheet
  stopped: 'stopped', // F7: in the bar, on a stopped session's sheet
  showQuestions: 'Show questions', // F9: the outline's button, closed
  hideQuestions: 'Hide questions', // F9: open
  menu: 'Menu',
  unpair: 'Unpair this browser', // F4: the menu's one entry
} as const;

export const PAIRING = {
  notPaired: 'This browser is not paired.', // this child's own: above the heading, after an unpairing or a refusal
  // this child's own: after the person's Unpair, when mawsd refused the browser but could not save the change (T10)
  unpairNotSaved: 'MAWS could not save the change, so the old pairing may be accepted again if mawsd restarts before a save succeeds.',
  // this child's own: after the person's Unpair, when mawsd did not confirm it (no proven connection, no answer, or a
  // refusal), which can also mean the pairing was already gone, so the line does not say it is still listed
  unpairLocal: 'This browser forgot its pairing, and MAWS did not confirm the removal. Run mawsd sheet browsers, and if the old entry still appears, mawsd sheet unpair <id>.',
  heading: 'Pair this browser',
  what: 'This page shows the open questions of the sessions on this Mac. A browser has to be paired once before it can read and answer them.',
  run: 'Run this in a terminal on this Mac:',
  command: 'mawsd sheet pair', // F5: the command alone, never a path
  type: 'Then type the code it prints:',
  field: 'Pairing code',
  placeholder: 'XXXX-XXXX',
  pair: 'Pair',
  note: 'The link in your terminal carries no secret. Pairing lasts until this browser is unpaired.',
  wrong: (left: number) => `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
  expired: 'That code has expired. Run the command again.',
  tooMany: 'Too many tries. Run the command again for a new code.',
  busy: 'Too many tries. Wait a minute, then try again.', // this child's own: ten exchanges a minute, the code still live
  notSaved: 'MAWS could not save the pairing. Try again.', // this child's own: the browsers' file could not be replaced
  failed: 'MAWS did not answer. Try again.', // this child's own: no answer, or not one of the exchange's
} as const;

// What the page says while it cannot send, and of a Send or an image that did not reach MAWS ("The look", frame 4; §P)
export const SEND = {
  notReachable: 'Answers cannot be sent while MAWS is not reachable.', // frame 4: where Send was
  servicesDown: 'Answers cannot be sent right now.', // this child's own: where Send was while MAWS's session services are not available
  beingSent: 'Your answers are being sent.', // the composite's writer's words: a Send this window did not make, younger than the door's limit
  noAnswer: 'MAWS did not answer.', // this child's own: under "Not sent." for a Send with no answer, or not one of the door's
  notConnected: 'Not connected to MAWS.', // this child's own: under "Not sent." for a Send made while no connection was proven
  imageNotSaved: 'The image could not be saved.', // this child's own: a paste that did not reach MAWS
} as const;

// The page's own parts around the sheet ("The look", M4: frames 2 to 4)
export const VIEWS = {
  notConnected: 'Not connected to MAWS on this Mac. Trying again.', // frame 4: the band
  servicesDown: 'MAWS is running, but its session services are not available right now.', // frame 4: the band's other sentence
  noQuestions: 'No open questions on this Mac', // frame 2: the empty overview
  noQuestionsNote: 'A session’s questions appear here when it asks.', // frame 2, in --fg-muted (F7)
  noSession: 'No open questions for this session', // frame 3: a session with no record, or a path that names none
} as const;

// The outline (F9)
export const OUTLINE = {
  name: 'Questions', // the panel's accessible name
  count: (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`,
  drafted: (n: number) => `${n} drafted`,
  queued: 'queued', // before a stopped session's queued answer
} as const;
