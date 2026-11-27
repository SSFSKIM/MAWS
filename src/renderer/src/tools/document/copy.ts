// The document editor's words that its own modules draw (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// "Constraints for the build": copy lives in `copy.ts`; a word kept only as an accessible name says so in its name).

export const DOCUMENT_COPY = {
  openingName: 'Opening the document…', // accessible name only: the quiet spinner's while the replica opens (T615)
  empty: 'This document is empty.', // T617
  exporting: 'Exporting…', // the Export action while an export runs; the format is the one just chosen (T612)
  startingSession: 'Starting a session…', // a comment card's wait; the card it stands in for names the comment (T621)
};
