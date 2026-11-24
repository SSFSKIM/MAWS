// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): the workbench's words. The control names
// are the accessible names the e2e drives it by. The element engine's words stay C's (DECK_COPY, INSPECTOR_COPY).
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4): a word kept only as a control's name
// or a landmark's is named `…Name`; a refused board edit is said in a person's words (`refused`, ./refusals.ts).

/** The board sizes offered by Add board and the inspector (the parent's §1). */
export const BOARD_PRESETS = [
  { id: 'phone', label: 'Phone', w: 390, h: 844 },
  { id: 'tablet', label: 'Tablet', w: 834, h: 1194 },
  { id: 'desktop', label: 'Desktop', w: 1440, h: 1024 },
  { id: 'slide', label: 'Slide', w: 1920, h: 1080 },
] as const;
export type BoardPreset = (typeof BOARD_PRESETS)[number];

// one formatter for every size the chrome writes (M6, DL39: `toLocaleString` builds a formatter per call); same output
const NUMBER = new Intl.NumberFormat('en-US');
const size = (w: number, h: number) => `${NUMBER.format(w)} × ${NUMBER.format(h)}`;

export const DESIGN_COPY = {
  toolbar: 'Design',
  world: 'Design canvas',
  boards: 'Boards',
  boardsInOrder: 'Boards, back to front',
  // W1: a board in a reorder's announcements, by its position and name (an untitled one by position)
  reorderItem: (n: number, title: string) => (title ? `Board ${n}, ${title}` : `Board ${n}`),
  addBoard: 'Add board',
  preset: (label: string, w: number, h: number) => `${label} ${size(w, h)}`,
  size,
  boardTitle: (label: string) => `Board ${label}`,
  boardRow: (label: string, w: number | null, h: number | null, held: boolean, missing: boolean) =>
    `${label}${w !== null && h !== null ? `, ${size(w, h)}` : ''}${held ? ', held' : ''}${missing ? ', file not received' : ''}`,
  boardOptions: (label: string) => `Board ${label} options`,
  zoomToBoard: 'Zoom to board',
  rename: 'Rename',
  boardName: 'Board name',
  renameBoard: 'Rename board',
  duplicate: 'Duplicate', // G525
  moveUp: 'Move up',
  moveDown: 'Move down',
  deleteBoard: 'Delete', // G525
  full: (max: number) => `${max} boards is the most`, // G527
  resizeBoard: (at: string) =>
    `Resize board ${({ n: 'top', s: 'bottom', e: 'right', w: 'left', ne: 'top right', nw: 'top left', se: 'bottom right', sw: 'bottom left' } as Record<string, string>)[at] ?? at}`,
  held: 'Held',
  missing: 'File not received',
  heldBanner: 'This board’s file doesn’t load; showing its last good version.', // G533: the loader's reasons fold under it (G534)
  missingBanner: 'This board’s file hasn’t arrived yet.', // G535
  noBoards: 'This design has no boards yet.',
  // the inspector's board section
  board: 'Board',
  boardX: 'Board X',
  boardY: 'Board Y',
  boardWidth: 'Board width',
  boardHeight: 'Board height',
  boardSize: 'Size', // G538: the select's caption
  boardSizeName: 'Board size',
  custom: 'Custom',
  // M4: comments and the move across boards
  // G511, G513, G514: Add comment is a named glyph (its word and chord are the tooltip, the deck's form); with no element
  // selected its tooltip also says the board the comment goes on
  comment: 'Add comment',
  commentOn: (label: string) => `On ${label}`,
  commentUnavailable: 'Select one element or a board to comment on',
  /** P4-B2 (V15): pins merged on a zoomed-out world; the press zooms to them. G532: the tooltip is the count alone. */
  pinCluster: (n: number) => `${n} comments`,
  pinClusterName: (n: number) => `${n} comments here; zoom to them`,
  moveToBoard: 'Move to board…',
  moveToBoardTitle: 'Move to another board', // G541
  movedTo: (label: string) => `Moved to ${label}.`,
  // the comments rail's words for a design (the P3-E spec's Decision Log 29)
  commentsEmpty: 'No open comments. Select a board or an element and choose Add comment.', // G542
  threadDeletedBoard: 'A deleted board', // G543, G545: a thread is located by its board's name; a deleted board's says so once
  showBoard: (quote: string) => `Show board: ${quote}`,
  showElement: (quote: string) => `Show element: ${quote}`,
  orphanElement: 'Element deleted', // G545, as the deck's (G481)
  // M4: version history (the rail and Restore's question are B's and C's; the design's own words here)
  historyBack: 'Back to design',
  historyRestoreBody: 'The design goes back to it as a new version: its boards, their places and sizes, their content and the design’s settings. Everything since stays in history, and comment conversations are kept.',
  historyWorld: 'Design in this version',
  historyBoards: 'Boards', // G549: the preview's list heading
  historyBoardsName: 'Boards in this version',
  historyDeck: (keys: string) => `Design settings changed: ${keys}`,
  historyBoardRow: (label: string, kind: string | null) => `${label}${kind === 'added' ? ', new' : kind === 'removed' ? ', deleted' : kind === 'changed' ? ', changed' : ''}`,
  movedFrom: (label: string) => `Moved from ${label}`,
  movedAway: (label: string) => `Moved to ${label}`,
  // zoom
  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fitAll: 'Fit all',
  fitSelection: 'Fit selection',
  percent: (zoom: number) => `${Math.round(zoom * 100)}%`,
  // G518, G539: a refused board edit in a person's words (./refusals.ts); `act` is what was asked
  refused: {
    held: (act: string) => `Can’t ${act} a board that doesn’t load`,
    missing: (act: string) => `Can’t ${act} a board whose file hasn’t arrived`,
    full: (act: string, max: number) => `Can’t ${act} a board: ${max} boards is the most`,
    gone: 'That board was deleted',
    other: (act: string) => `Can’t ${act} this board`,
    moveHeld: 'Can’t move elements to a board that doesn’t load',
    moveMissing: 'Can’t move elements to a board whose file hasn’t arrived',
    moveOther: 'Can’t move these elements there',
    side: (max: string) => `At most ${max} px a side`,
    empty: 'More than 0 px a side',
    area: (max: string) => `At most ${max} px in area`,
    notNumber: 'Not a number',
  },
} as const;
