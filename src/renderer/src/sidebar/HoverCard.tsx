// A session row's hover card (§5.1 as amended 2026-10-01, W5; residue *Hover card*): a Radix HoverCard opening after
// 300 ms of hover or on focus, to the right of the sidebar. It says what the one-line row leaves out: the status and
// age, the context used, the branch and worktree, who holds a foreign-live session or what a working one does, and the
// last assistant line; then the pending request, if any, through the `requestCard` slot in its `hover` placement, with
// the originating request fetched once per item through `attention.request` and cached in the attention store. Opening
// it answers nothing: approval is an explicit click inside the card, and the slot offers it only for read-only tools.
// The card's body mounts only while it is open, so the tree's rows subscribe to nothing extra.
import { HoverCard as Radix } from 'radix-ui';
import { useEffect, type ReactNode } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useSlot } from '../app/slots';
import { useNow } from '../app/use-now';
import { holderLine, waitingItem } from '../attention/derive';
import { GlyphMark } from '../attention/GlyphMark';
import { glyphFor } from '../attention/glyph';
import { ipc } from '../ipc/client';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { rowBranch, sessionAge } from './derive';
import { displayTitle } from '../sessions/title';

export function SessionHoverCard({ record, children }: { record: SessionRecord; children: ReactNode }) {
  return (
    <Radix.Root openDelay={300} closeDelay={150}>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          role="dialog"
          aria-label={displayTitle(record)}
          data-hover-card
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-[342px] rounded-md border border-border-strong bg-bg-overlay p-4"
        >
          <Body appSessionId={record.appId} />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// Where the session runs: its branch, and the worktree's folder when it is in one (the full path as the title).
function placeOf(record: SessionRecord): { text: string; title: string | null } | null {
  if (record.worktree !== null) {
    const branch = rowBranch(record);
    return { text: `${branch ? `⎇ ${branch}` : 'detached'} · worktree ${basename(record.worktree.path)}`, title: record.worktree.path };
  }
  return record.branch ? { text: `⎇ ${record.branch}`, title: null } : null;
}

function Body({ appSessionId }: { appSessionId: AppSessionId }) {
  const record = useSessions((s) => s.records.get(appSessionId));
  const digest = useSessions((s) => s.digests.get(appSessionId) ?? null);
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
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
