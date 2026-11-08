// A row's reach mark (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's "A row's mark"; Q4): a
// small lock for a Private session, a people mark for one whose access is wider than Listed or that has shares, nothing
// for the default (stores/policies.ts's `reachOf`). Its access in words is the hover card's (`ReachLine`).
import { Icon } from '../app/IconButton';
import { SHARE } from '../sessions/share/copy';
import { useReach, type Reach } from '../stores/policies';

export const LockIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
    <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
  </Icon>
);

export const PeopleIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="6" cy="5.5" r="2.2" />
    <path d="M2 13.5c0-2.3 1.8-4 4-4s4 1.7 4 4" />
    <path d="M10.5 3.6a2 2 0 0 1 0 3.8M12 9.8c1.2.5 2 1.8 2 3.7" />
  </Icon>
);

export function ReachMark({ address }: { address: string }) {
  const reach = useReach(address);
  if (reach === null) return null;
  const label = reach.mark === 'private' ? SHARE.mark.private : SHARE.mark.shared;
  return (
    <span role="img" aria-label={label} title={reachWords(reach)} data-reach={reach.mark} className="shrink-0 text-fg-faint">
      {reach.mark === 'private' ? <LockIcon className="size-[11px]" /> : <PeopleIcon className="size-[11px]" />}
    </span>
  );
}

export const reachWords = (reach: Reach): string => ('sharedWithYou' in reach ? SHARE.sharedWithYou : SHARE.reach(reach.access, reach.shares));

/** The hover card's line: the session's access, and how many it is shared with. */
export function ReachLine({ address }: { address: string }) {
  const reach = useReach(address);
  if (reach === null) return null;
  return (
    <p data-testid="hover-reach" className="m-0 flex min-w-0 items-center gap-1.5 text-fg-muted">
      {reach.mark === 'private' ? <LockIcon className="size-[11px]" /> : <PeopleIcon className="size-[11px]" />}
      <span className="min-w-0 truncate">{reachWords(reach)}</span>
    </p>
  );
}
