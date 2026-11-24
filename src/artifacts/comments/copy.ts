// The shared comment card's words that the word cut wrote (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5
// task 2; G385, G388; "Constraints for the build": copy lives in `copy.ts`, and a word kept only as an accessible name
// or a tooltip says so in its name).
export const THREAD_CARD_COPY = {
  removed: 'Removed', // the tag on a card whose passage is gone, where it draws no quote
  removedTip: 'The commented passage was removed.', // the struck quote's or the tag's tooltip and description
  replyName: 'Reply', // the send glyph: accessible name and tooltip only
  replyUnavailable: 'Write a reply first', // why the send glyph is greyed: its tooltip and description
};
