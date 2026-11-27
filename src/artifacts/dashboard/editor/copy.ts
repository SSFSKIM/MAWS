// The dashboard editor's words that the word cut wrote or changed in the source sheet and the chart tile
// (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 2; G604 to G616; "Constraints for the build": copy lives
// in `copy.ts`, and a word kept only as an accessible name or a tooltip says so in its name). The live query block's
// words are `LIVE_COPY` (live.ts); the views' states are `VIEW_STATES` and `DATASET_STATES` (states.ts).
export const SHEET_COPY = {
  closeName: 'Close', // the × glyph: accessible name and tooltip only
  noData: 'No data yet. Ask an agent to add a data file.',
  thisView: (rows: number | null) => (rows === null ? 'This view' : `This view (${rows.toLocaleString('en-US')})`),
  allRows: (rows: number) => `All rows (${rows.toLocaleString('en-US')})`,
  copy: 'Copy',
  copyName: 'Copy rows', // Copy's accessible name, which says what it copies
  notFetched: 'Not fetched yet',
  snapshotGone: 'Snapshot gone; reopen to see the current one',
  readingRowsName: 'Reading the rows…', // accessible name only: the quiet spinner's while the rows are read
};

export const TILE_COPY = {
  loadingName: (title: string) => `Loading ${title}…`, // accessible name only: the tile's quiet spinner on its first load
};
