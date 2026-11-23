// The sessions module's words that the word cut wrote (docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// "Constraints for the build": copy lives in copy.ts files beside each module).

// The relay card's (W96, W97, W98): when the relay was checked, the address and its answer that line's tooltip, and what
// each button does, that button's tooltip and description.
export const RELAY_WORDS = {
  checked: (age: string) => `Checked ${age}`,
  where: (url: string, reason: string) => `${url}/api/hello · ${reason}`,
  open: (onThisRoute: boolean) => `Starts ${onThisRoute ? 'on this route' : 'routed'} as soon as the relay answers.`,
  direct: 'The engine’s own login for this session; no gateway models, and switching back later restarts the session.',
  anyway: 'This machine’s own settings send it there; the session starts and says what it reached.',
  directRefused: 'Pick a Claude model first',
} as const;

// The archived sessions window's (W151: each row's "…" menu; N172: the read's quiet spinner, named by `reading`).
export const ARCHIVED_WORDS = {
  actions: (title: string) => `Actions for ${title}`,
  removeWorktree: 'Remove worktree…',
  delete: 'Delete…',
  reading: 'Loading archived sessions',
} as const;
