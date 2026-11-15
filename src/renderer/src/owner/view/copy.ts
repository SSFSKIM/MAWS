// The words of the to-human view where MAWS draws it (the U2b execution document, Interfaces §D): the only place they
// are written, each exactly as the to-human mod draws it (read at 0.8.2, `to-human/hooks/mods/to-human.tsx`: the
// marks `UNFOLD` and `FOLD`, lines 563 and 564, set before their label as `control` sets them; the label of a closed
// run's line is `foldLabel`'s fallback under any advertisement, `folds.tsx` being quiet there; `'fold to report'`,
// line 1218).
export const RECORD = {
  closed: '› working record',
  open: '‹ fold to report',
} as const;

// A message's label (`STYLE.message`, 555; `spanRows`, 1411): the bullet `● ` before the first message of a text block
// and before a message-tool call, so that it reads `● message`; a later message of the same block reads `message`, its
// bullet's two columns left empty; while a message streams (`isOpen`) its label is followed by ` …`.
export const MESSAGE = {
  bullet: '● ',
  label: 'message',
  streaming: ' …',
} as const;

// The switch above the composer (the band's `control`, 1957 to 1963): its dim caption, then the button that names the
// other view, its mark after it (`isMarkLast`).
export const SWITCH = {
  caption: 'to-human view · ',
  toTranscript: 'full transcript ›', // in the report
  toReport: 'report only ›', // in the full transcript
} as const;

// Kept for the desk web app's own bar (`apps/desk-web/src/views/project/ReportToggle.tsx`; the execution document, §L)
// and for the mods list's style-mismatch note (`widgets/plugins/BuiltInMods.tsx`), as they read before the bar went.
export const REPORT = {
  view: 'Session view',
  report: 'Report',
  transcript: 'Transcript',
  mismatch: (observed: string, resolved: string) => `The engine uses the output style “${observed}”, not “${resolved}” as MAWS read it. The next start follows the engine.`,
} as const;
