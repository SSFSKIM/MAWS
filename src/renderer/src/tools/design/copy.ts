// The design editor's words that its own modules draw (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md,
// "Constraints for the build": copy lives in `copy.ts`; a word kept only as an accessible name says so in its name).

export const DESIGN_COPY = {
  openingName: 'Opening the design…', // accessible name only: the quiet spinner's while the replica opens (T615, G557)
  // the fitting sheet's body: the fact in one line; the scale stays in its title and its button (T632)
  tooLarge: (format: 'png' | 'pdf') => `Too large for a ${format === 'png' ? 'PNG' : 'PDF'} at full size.`,
};
