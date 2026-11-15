// Skeleton (UX wave U5b, M3 red): the stack's toolbar, written in M3's next commit. The totals as today's header words.
import { REVIEW_COPY } from '../copy';

export const totalsWords = (sum: { files: number; added: number; removed: number }): string => REVIEW_COPY.header(sum.files, sum.added, sum.removed, '');

export function Toolbar(_props: Record<string, unknown>) {
  return null;
}
