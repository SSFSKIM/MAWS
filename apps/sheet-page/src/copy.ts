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
