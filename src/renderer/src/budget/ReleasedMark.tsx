// The released mark (C12 execution document, Interfaces "Surfaces of the budget"; charter §4.4 as amended by D1): one
// muted word beside an idle session's title on its sidebar row and its Overview card, with when and why in its title.
// A release is quiet: the glyph, the unread dot and Needs you are untouched. Board ticket 815: where the row it sits in
// tells when and why itself, in the tip its keyboard focus opens (`toldByRow`: the Overview card's), the mark has no title.
// A sidebar row still has the system's (the mark sits in a tree item, which owns the keyboard).
import type { SessionDigest } from '@shared/ipc/schema';
import { BUDGET } from './copy';

export function ReleasedMark({ released, toldByRow = false }: { released: SessionDigest['released']; toldByRow?: boolean }) {
  if (released === undefined) return null;
  return (
    <span title={toldByRow ? undefined : BUDGET.markTitle(released)} data-released-mark className="shrink-0 text-ui-sm text-fg-muted">
      {BUDGET.mark}
    </span>
  );
}
