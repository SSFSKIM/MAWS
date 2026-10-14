// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8; M4): what the editor needs of the deck's slides
// beyond the seam's per-slide change records (slides.ts `observeSlide`), kept beside it in the binding module.
import { SLIDES_ROOT } from './slides';
import type { Doc } from './doc';

/**
 * An opaque token of a slide's current node: the same object while the slide lives, a new one when its key is written
 * again (an undo bringing a deleted slide back, a republish recreating it). A view that observes one slide (a canvas)
 * re-mounts when its slide's token changes, since its observer is bound to the node it started on. Null: no such slide.
 */
export function slideToken(doc: Doc, slideId: string): object | null {
  return (doc.get(SLIDES_ROOT).getAttr(slideId) as object | undefined) ?? null;
}
