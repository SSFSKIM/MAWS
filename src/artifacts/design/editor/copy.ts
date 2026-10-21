// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): the workbench's words. The control names
// are the accessible names the e2e drives it by. The element engine's words stay C's (DECK_COPY, INSPECTOR_COPY).

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
  showBoards: 'Show boards',
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
  duplicate: 'Duplicate board',
  moveUp: 'Move up',
  moveDown: 'Move down',
  deleteBoard: 'Delete board',
  full: (max: number) => `A design holds at most ${max} boards: delete one to add another.`,
  resizeBoard: (at: string) =>
    `Resize board ${({ n: 'top', s: 'bottom', e: 'right', w: 'left', ne: 'top right', nw: 'top left', se: 'bottom right', sw: 'bottom left' } as Record<string, string>)[at] ?? at}`,
  held: 'Held',
  missing: 'File not received',
  heldBanner: 'This board’s file does not load, so it shows its last good version, read-only. The agent’s next valid file for it clears this.',
  missingBanner: 'The design names this board but its file never arrived, so it has nothing to edit yet. The agent’s file for it fills it.',
  noBoards: 'This design has no boards yet.',
  // the inspector's board section
  board: 'Board',
  boardX: 'Board X',
  boardY: 'Board Y',
  boardWidth: 'Board width',
  boardHeight: 'Board height',
  boardSize: 'Board size',
  custom: 'Custom',
  // M4: comments and the move across boards
  commentTitle: 'Comment on the selected element, or on the board when no element is selected (⌥⌘M)',
  commentBoard: (label: string) => `Comment on board ${label} (⌥⌘M)`,
  /** P4-B2 (V15): pins merged on a zoomed-out world; the press zooms to them. */
  pinCluster: (n: number) => `${n} comments here; zoom to them`,
  moveToBoard: 'Move to board…',
  moveToBoardTitle: 'Move the selected elements to another board (they take new ids there; their comments go with them)',
  movedTo: (label: string) => `Moved to ${label}.`,
  // the comments rail's words for a design (the P3-E spec's Decision Log 29)
  commentsEmpty: 'No open comments. Select a board or an element and choose Comment.',
  threadBoard: (label: string) => `Board ${label}`,
  threadDeletedBoard: 'A deleted board',
  showBoard: (quote: string) => `Show board: ${quote}`,
  showElement: (quote: string) => `Show element: ${quote}`,
  orphanBoard: 'The commented board was deleted.',
  orphanElement: 'The commented element was deleted.',
  // M4: version history (the rail and Restore's question are B's and C's; the design's own words here)
  historyBack: 'Back to design',
  historyRestoreBody: 'The design goes back to it as a new version: its boards, their places and sizes, their content and the design’s settings. Everything since stays in history, and comment conversations are kept.',
  historyWorld: 'Design in this version',
  historyBoards: 'Boards in this version',
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
} as const;
