// What the page reads of the summaries (§P; F8): the sessions the overview lists, the same filter as C3's overview
// (whose own is not exported), and the browser tab's title, the place with the count of open questions before it: the
// sum of `SheetSummary.open` (open questions with no queued answer) across the sessions the page shows.
import type { SheetSummary } from '@shared/sheet/model';
import { SHEET_WORDS } from '../../../src/renderer/src/sheet';
import { PAGE } from './copy';
import type { Place } from './route';

export const listed = (summary: SheetSummary): boolean => summary.unreadable || summary.open + summary.queued + summary.pending + summary.hidden > 0;

export const titleNameOf = (summary: SheetSummary): string => summary.title ?? SHEET_WORDS.overview.untitled(summary.session);

export function titleOf(place: Place, sessions: readonly SheetSummary[] | null): string {
  const counted = (n: number, rest: string) => (n > 0 ? `(${n}) ${rest}` : rest);
  if (sessions === null) return PAGE.name;
  if (place.at === 'overview') return counted(sessions.filter(listed).reduce((sum, summary) => sum + summary.open, 0), PAGE.name);
  const summary = sessions.find((entry) => entry.session === place.session);
  return summary === undefined ? PAGE.name : counted(summary.open, `${titleNameOf(summary)} · ${PAGE.name}`);
}
