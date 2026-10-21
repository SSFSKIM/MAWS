// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D14, D15; the prior art's A1 to A5,
// research/p4-ux-prior-art.md §2.4): the stage and the boards for assistive technology and the keyboard. The canvas
// already draws real, positioned DOM in the model's own tags, so its nodes are what assistive technology reads (Figma's
// mirror exists because its canvas is WebGL; Decision Log 4): they are named here (A1), focused as the selection is (A3,
// the overlay's), and the stage says only what the focus does not (A2).
import type { Describe } from '../canvas';
import { TEXT_TAGS } from '../ir';
import { DECK_COPY as C } from './copy';
import { kindName } from './names';

/**
 * A1: a stage node's role and name. Text and tables keep their native semantics (their text is their name); a picture
 * its own alt, else "Image"; a group or a box holding elements is a `group` named by what it holds; any other element
 * (a shape, an icon, a connector, a drawing, an embed, a line, an empty box) an `img` named by its kind.
 */
export const describeElement: Describe = (e, children) => {
  if (TEXT_TAGS.has(e.tag as never) || e.tag === 'table' || e.tag === 'tr') return null;
  if (e.tag === 'img') return e.attrs.alt !== undefined ? null : { label: kindName(e, children) };
  const name = kindName(e, children);
  return { role: e.tag === 'div' && (e.attrs['data-group'] !== undefined || children > 0) ? 'group' : 'img', label: name };
};

/** The stage's own focus (A3): the stage's surface itself, or one of its elements' nodes. */
export function stageFocus(surface: Element, target: EventTarget | null): boolean {
  return target === surface || (target instanceof Element && target.hasAttribute('data-eid') && surface.contains(target));
}

/** A2: what the stage's polite status says: a multi-selection's count; nothing for one element (its focus says it) or during an edit. */
export function selectionStatus(selected: number, editing: boolean): string {
  return !editing && selected > 1 ? C.selectedCount(selected) : '';
}
