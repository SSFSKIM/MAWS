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

// A New chat's model list for another machine (the UX wave, obs 4), where it can't be read: that machine's MAWS predates
// the read, or the read failed (the machine offline, its engine host away). The menu says it in place of "No models".
export const LAUNCH_MODELS_WORDS = {
  olderMachine: (machine: string) => `Update MAWS on ${machine} to list its models here.`,
  unreadable: (machine: string) => `${machine}’s models can’t be read right now.`,
} as const;

// The archived sessions window's (W151: each row's "…" menu; N172: the read's quiet spinner, named by `reading`).
export const ARCHIVED_WORDS = {
  actions: (title: string) => `Actions for ${title}`,
  removeWorktree: 'Remove worktree…',
  delete: 'Delete…',
  reading: 'Loading archived sessions',
} as const;

// The rename sheet's Regenerate (N176): its word, and its wait's words (the quiet spinner's name beside it).
export const RENAME_WORDS = {
  regenerate: 'Regenerate',
  regenerating: 'Regenerating the title',
} as const;

// The archive sheet's paragraph (W146): what archiving does and where the session is found again; the machine that stops
// it, when it is another (rule 2), and nothing of the engine process, the transcript's place, `claude --resume` or the
// worktree.
export const ARCHIVE_WORDS = {
  body: (machine: string | null) => `Stops it${machine !== null ? ` on ${machine}` : ''} and hides it. Find it again under Archived sessions.`,
} as const;

// The delete sheet's read of what would move (N180): the quiet spinner's name. The destructive-step text stays in
// DeleteDialog.tsx as it reads.
export const DELETE_WORDS = {
  reading: 'Reading what would move',
} as const;
