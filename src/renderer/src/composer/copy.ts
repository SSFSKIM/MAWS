// The composer's words that the word cut touched (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M2 task 4), kept
// here as the spec's build constraint asks ("Copy lives in copy.ts files"); words cut from view and kept only as an
// accessible name say so in their names. The composer's older words stay in the modules that draw them.

// The empty box's words once the session has a transcript; an empty new chat's box says nothing (C2)
export const FOLLOW_UP_PLACEHOLDER = 'Ask a follow-up…';

// The "+" menu's submenus (C17 to C19)
export const PLUS_MENU = {
  noPlugins: 'No plugins',
  inThisChat: 'In this chat…',
  manage: 'Manage…',
};

// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, §H's table): the "+" menu's Tools submenu. The group
// words, their facts and "Needs Artifacts" are Settings › Sessions' (`MAWS_TOOLS`, settings-tab/copy.ts), shared; the
// question tool's facts here are the submenu's own, each a row note.
export const TOOLS_MENU = {
  label: 'Tools',
  question: 'Question',
  questionFacts: { engine: "Claude Code's own question", maws: "MAWS's question" },
} as const;

// The location popover's copy glyph, its name and its tooltip (C24)
export const LOCATION_COPY = { copy: 'Copy', copied: 'Copied' };

// The `@` menu's searching row, a spinner: its name and the spinner's, not drawn (C56)
export const SEARCHING_FILES_NAME = 'Searching files…';

// Why a dropped, picked or mentioned file is refused by its path (N127; ticket 733a's grant opening)
export const PATH_REFUSAL = {
  lineBreak: (name: string) => `${name} can't be attached: its path has a line break`,
  hidden: (name: string) => `${name} can't be attached: its path has a hidden character`,
  quotesGrant: (name: string) => `${name} can't be attached; its path reads like MAWS's approval of an agent's request. Rename the file, or the folder it is in, to attach it`,
};
