// The document editor's words that the word cut wrote or changed (docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// M5 task 2; "Constraints for the build": copy lives in `copy.ts`, and a word kept only as an accessible name or a
// tooltip says so in its name).

// The formatting toolbar (G331 to G337).
export const TOOLBAR_COPY = {
  table: 'Table', // the Table menu's button and the menu's name; the button shows "Table ▾"
  addCommentName: 'Add comment', // a glyph: accessible name and tooltip only
  commentsName: (open: number) => `Comments (${open} open)`, // a glyph with the open count beside it: name and tooltip only
  versionHistoryName: 'Version history', // a glyph: name and tooltip only
  findName: 'Find', // a glyph: name and tooltip only
  // why Add comment is greyed: its tooltip and description
  commentReadOnly: 'Read-only',
  commentNoSelection: 'Select text to comment on',
};

// The page (G345, G347, G330, G351).
export const PAGE_COPY = {
  loadingName: 'Loading…', // accessible name only: the quiet spinner's while the first tab arrives
  newChanges: (count: number | null) => (count === null ? 'New changes' : `${count} new ${count === 1 ? 'change' : 'changes'}`),
  pasteReadOnly: 'Couldn’t paste: the document is read-only',
  suggestionElsewhere: 'This change can’t be accepted or rejected here.',
};

// The version history: the rail, the preview bar and Show editors (G359 to G379).
export const HISTORY_COPY = {
  closeTip: 'Close', // the rail's ×, tooltip only (its name is "Close version history")
  compareTip: 'Shift-click to compare', // a version row's tooltip
  loadingVersionName: 'Loading the version…', // accessible name only: the status line's quiet spinner
  loadingVersionsName: 'Loading versions…', // accessible name only: the list's quiet spinner
  noVersions: 'No versions',
  noNamedVersions: 'No named versions',
  namePlaceholder: 'Name',
  notePlaceholder: 'Note (optional)',
  restore: 'Restore', // the bar's button; its name stays restoreName
  restoreName: 'Restore this version',
  actionsName: 'Actions for this version', // the "…" glyph and its menu: name and tooltip only
  makeCopy: 'Make a copy',
  nameVersion: 'Name this version',
  backName: 'Back to document', // the × glyph: name and tooltip only
  editors: 'Editors', // Show editors' heading and name
  readingHistoryName: 'Reading the history…', // accessible name only: Show editors' quiet spinner
  noEdits: 'No edits recorded',
};

// The comments panel (G391 to G398).
export const COMMENTS_PANEL_COPY = {
  closeTip: 'Close', // the panel's ×, tooltip only (its name is "Close comments")
  searchPlaceholder: 'Search',
  deleted: (count: number) => `Deleted (${count})`,
  deletedTip: 'Comments on deleted text', // the toggle's tooltip and description
  noMatches: 'No matches',
  noResolved: 'No resolved comments',
  noOpen: 'No open comments. Select text and choose Add comment.',
};
