// The released mark (C12 execution document, Interfaces "Surfaces of the budget"; charter §4.4 as amended by D1): one
// muted word beside an idle session's title on its sidebar row and its Overview card, with when and why in its title.
// A release is quiet: the glyph, the unread dot and Needs you are untouched.
import type { SessionDigest } from '@shared/ipc/schema';
import { BUDGET } from './copy';

export function ReleasedMark({ released }: { released: SessionDigest['released'] }) {
  if (released === undefined) return null;
  return (
    <span title={BUDGET.markTitle(released)} data-released-mark className="shrink-0 text-ui-sm text-fg-muted">
      {BUDGET.mark}
    </span>
  );
}
