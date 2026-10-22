// P4-A2 G2.3 (X35): a publish's slides drawn as they stream, on the deck's stage and filmstrip and (G2.4) a design's
// boards: the model over the layers' store (deck.ts), the imperative layers (slide.ts) and their React mounts.
export { DECK_FILES, DeckProvisional, writtenOrder, type DeckProvisionalSnapshot, type ProvisionalFiles, type ProvisionalFrame, type StreamedIndex, type WrittenSlide } from './deck';
export { protectedIds, sessionProtection, SlideProvisional, ThumbnailProvisional, type Protection } from './slide';
export { NewSlideEntry, SlideLayer, ThumbnailLayer, useDeckProvisional, useProvisionalZoom, useWrittenOrder, type ScreenZoom } from './layers';
