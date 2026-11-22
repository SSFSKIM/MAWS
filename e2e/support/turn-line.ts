// A finished turn's line as the word cut draws it (docs/doperpowers/specs/2026-11-16-word-cut-design.md, T1): a
// person's turn reads its duration alone, then what it did ("3s · Ran an agent"), with no "Worked for"
// (src/renderer/src/transcript/model/copy.ts `verb`, the line's form; its durations are model/time.ts `duration`:
// "45s", "2m 14s", "1h 02m"). The engine's turn reads "Continued · 3s", a peer's "Peer session · 3s"; a stopped or
// failed turn keeps its words. The line's button is named by its words, so the pattern serves its text and its name.
export const FINISHED_TURN_LINE = /^\d+(?:s|m \d{2}s|h \d{2}m)(?= · |\s|$)/;
