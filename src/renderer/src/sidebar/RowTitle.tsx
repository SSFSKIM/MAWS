// A session row's title, and after it the owners of a session you don't own alone (P5 O8 M5, docs/doperpowers/plans/
// 2026-10-28-p5-o8-org-interface.md, "The label"; Q2): first names in the machine chip's secondary style, faint while the
// machine is offline, truncated with the title so the chip after them keeps its room. Without owners, the title as it was.
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { ownersLabel } from './owners';

/** The owners label of the listing at a row's address: a listed row's own, or a record's drawn in its place. */
export const useOwnersLabel = (appId: AppSessionId): string | null =>
  useSessions((s) => {
    const listed = s.listed.get(appId);
    return listed === undefined ? null : ownersLabel(listed.owners, s.member, s.members);
  });

export function RowTitle({ title, owners, offline }: { title: string; owners: string | null; offline: boolean }) {
  const tone = offline ? 'text-fg-faint' : 'text-fg';
  if (owners === null) return <span data-session-title className={`min-w-0 flex-1 truncate text-ui ${tone}`}>{title}</span>;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-[5px]">
      <span data-session-title className={`min-w-0 truncate text-ui ${tone}`}>{title}</span>
      <span data-owners className={`min-w-0 shrink-[3] truncate text-ui-sm ${offline ? 'text-fg-faint' : 'text-fg-muted'}`}>{owners}</span>
    </span>
  );
}
