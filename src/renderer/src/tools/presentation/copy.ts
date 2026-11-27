// The deck editor's words that its own modules draw (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// "Constraints for the build": copy lives in `copy.ts`; a word kept only as an accessible name says so in its name).

export const DECK_COPY = {
  openingName: 'Opening the presentation…', // accessible name only: the quiet spinner's while the replica opens (T615)
  checkDesign: 'Check design', // the header's Check entry (T636)
  nothingToPresent: 'No slide to show', // ticket 815: why Present is greyed (no slide, or every slide hidden)
};
