// The sidebar's hover cards (§5.1 as amended 2026-10-01, W5 and W11; residue *Hover card*). `SidebarHoverCard` is the
// shell every row's card shares: a Radix HoverCard opening after 300 ms of hover or on keyboard focus (never on a focus
// the pointer caused: a click focuses its row, and a card for it would cover the main area unasked), closing 150 ms
// after the pointer leaves, to the right of the sidebar, 342px wide; its content mounts only while open. A session
// row's card (`SessionHoverCard`) says what the one-line row leaves out: the status and age, the context used, the
// branch and worktree, who holds a foreign-live session or what a working one does, and the last assistant line; then
// the pending request, if any, through the `requestCard` slot in its `hover` placement, with the originating request
// fetched once per item through `attention.request` and cached in the attention store. Opening it answers nothing:
// approval is an explicit click inside the card, and the slot offers it only for read-only tools. The project row's
// card is `ProjectHoverCard.tsx`.
import { HoverCard as Radix } from 'radix-ui';
import { useEffect, type FocusEvent, type ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useSlot } from '../app/slots';
import { useNow } from '../app/use-now';
import { holderLine, waitingItem } from '../attention/derive';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { ipc } from '../ipc/client';
import { branchLabel, recordBranch } from '../sessions/branch-label';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { rowBranch, sessionAge } from './derive';
import { displayTitle } from '../sessions/title';
import { SIDE_COPY } from '../side/copy'; // E3

export interface SidebarHoverCardProps {
  label: string; // the card's accessible name
  children: ReactNode; // the trigger: one element that takes a ref and props
  content: ReactNode; // rendered only while open
  open?: boolean; // controlled, for a trigger whose keyboard focus sits elsewhere (a project row's line, its treeitem focused)
  onOpenChange?(open: boolean): void;
}

export function SidebarHoverCard({ label, children, content, open, onOpenChange }: SidebarHoverCardProps) {
  return (
    <Radix.Root openDelay={300} closeDelay={150} open={open} onOpenChange={onOpenChange}>
      <Radix.Trigger asChild onFocus={guardPointerFocus}>
        {children}
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          role="dialog"
          aria-label={label}
          data-hover-card
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-[342px] rounded-md border border-border-strong bg-bg-overlay p-4"
        >
          {content}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

// Radix skips its open for a prevented focus event: a focus that is not `:focus-visible` is the pointer's.
function guardPointerFocus(event: FocusEvent<HTMLElement>): void {
  if (!focusVisible(event.currentTarget)) event.preventDefault();
}

// `:focus-visible`, where the engine knows it (happy-dom does not: there every focus counts as the keyboard's).
export function focusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function SessionHoverCard({ record, children }: { record: SessionRecord; children: ReactNode }) {
  return <SidebarHoverCard label={displayTitle(record)} content={<Body appSessionId={record.appId} />}>{children}</SidebarHoverCard>;
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// Where the session runs: its branch, and the worktree's folder when it is in one (the full path as the title). W9 (H2):
// a branch the record does not name is left out, never guessed as "detached" (only git can say a checkout is).
function placeOf(record: SessionRecord): { text: string; title: string | null } | null {
  if (record.worktree !== null) {
    const branch = rowBranch(record);
    return { text: `${branch ? `⎇ ${branch} · ` : ''}worktree ${basename(record.worktree.path)}`, title: record.worktree.path };
  }
  const branch = branchLabel(recordBranch(record));
  return branch ? { text: `⎇ ${branch}`, title: null } : null;
}

function Body({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const digest = useSessions((s) => s.digests.get(appSessionId) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  const parentTitle = useSessions((s) => { // E3
    const parentId = s.records.get(appSessionId)?.lineage?.parentAppSessionId;
    const parent = parentId === undefined ? undefined : s.records.get(parentId);
    return parent === undefined ? null : displayTitle(parent);
  });
  const now = useNow();
  if (!record) return null;
  const glyph = glyphFor(record, digest, pending);
  const waiting = waitingItem(pending);
  const place = placeOf(record);
  const working = digest?.phase === 'working' || digest?.phase === 'starting';
  const doing = holderLine(record) ?? (working ? digest?.activity : null) ?? null;
  const meta = [glyph.label, sessionAge(record, digest, now), digest?.context ? `ctx ${Math.round(digest.context.percent)}%` : null].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-2 text-ui-sm text-fg">
      <div className="flex min-w-0 items-start gap-2">
        <GlyphMark glyph={glyph} className="w-[14px] shrink-0 leading-[18px]" />
        <h3 className="m-0 line-clamp-2 min-w-0 text-ui leading-[18px] font-semibold break-words">{displayTitle(record)}</h3>
      </div>
      <p data-testid="hover-meta" className="m-0 text-fg-muted tabular-nums">
        {meta}
      </p>
      {place && (
        <p data-testid="hover-place" title={place.title ?? undefined} className="m-0 truncate text-fg-muted">
          {place.text}
        </p>
      )}
      {/* E3: whose side thread or fork it is */}
      {record.lineage !== null && (
        <p data-testid="hover-lineage" className="m-0 truncate text-fg-muted">
          {SIDE_COPY.lineage.of(record.lineage.kind, parentTitle)}
        </p>
      )}
      {doing && (
        <p data-testid="hover-activity" className="m-0 truncate text-fg-muted">
          {doing}
        </p>
      )}
      {digest?.lastAssistantLine && (
        <p data-testid="hover-answer" className="m-0 line-clamp-3 break-words">
          {digest.lastAssistantLine}
        </p>
      )}
      {waiting && (
        <div className="mt-1 border-t border-border pt-3">
          <Request item={waiting.oldest} />
        </div>
      )}
    </div>
  );
}

function Request({ item }: { item: AttentionItem }) {
  const request = useAttention((s) => s.requests.get(item.id) ?? null);
  const Card = useSlot('requestCard');
  useEffect(() => void useAttention.getState().loadRequest(ipc, item), [item]);
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Card item={item} request={request} placement="hover" paneIndex={null} />;
}
