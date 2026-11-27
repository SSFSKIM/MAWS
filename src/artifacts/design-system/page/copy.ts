// The Design System page's words that the word cut changed (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5
// task 4; "Constraints for the build": copy lives in `copy.ts`). A word kept only as an accessible name or a tooltip is
// named `…Name` or `…Tip`. The page's other words are still written where they are drawn.

export const PAGE_COPY = {
  empty: 'This design system is empty', // G562: a synced replica that holds no system, then what to do
  emptyNext: 'Ask Claude to publish a design system here.', // its first publish sets the system up (model.ts publishSystem)
  // G565: the count at rest, opening to each path and its message
  unresolved: (n: number) => `${n} ${n === 1 ? 'token doesn’t' : 'tokens don’t'} resolve`,
  // G568: a contrast pair's verdict, its tooltip and description; a failing pair's mark
  contrastTip: (passes: boolean, min: number) => `${passes ? 'Meets' : 'Below'} ${min} : 1`,
  contrastFails: '✕',
  canonEmpty: 'None yet', // G575
  noLaw: 'No law yet', // G579: the Ask button says what to do
  // G584: a passing check is a check and its count; the sentence its name and tooltip
  passed: (n: number) => `✓ ${n}`,
  passedName: (n: number) => `The canon keeps every checked rule (${n}).`,
  checkTagTip: (rule: string) => `[check: ${rule}]`, // G585: a violation's tag, on its law's words
  byHand: 'By hand', // G586, G587: the don'ts no rule checks, those whose tag MAWS cannot run among them
};
