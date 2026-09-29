// One Needs-you row (§5.1; mockup 01 `.need-row`): the session's project and title, the glyph and line of its oldest
// waiting item, how long it has waited, and a count when more items wait. A click deep-links to the session's Overview
// card (§5.2), a double-click opens the session tab; hovering or focusing it opens the hover card. It is a button, so
// Enter activates the deep link and never answers anything (§5.1: approval by explicit click only).
import { useNow } from '../app/use-now';
import { GlyphMark } from '../attention/GlyphMark';
import type { NeedsYouRow as Row } from '../attention/derive';
import { glyphFor } from '../attention/glyph';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { needsYouAge } from './derive';
import { HoverCard } from './HoverCard';

export function NeedsYouRow({ row }: { row: Row }) {
  const id = row.appSessionId;
  const record = useSessions((s) => s.records.get(id));
  const project = useSessions((s) => (record?.projectId ? (s.projects.get(record.projectId)?.name ?? null) : null));
  const digest = useSessions((s) => s.digests.get(id));
  const pending = useAttention((s) => selectPendingOf(s, id));
  const now = useNow();
  if (!record) return null;
  const title = record.title.text;

  const toCard = () => {
    const layout = useLayout.getState();
    layout.openTab({ kind: 'overview' });
    layout.focusCard(id);
  };

  return (
    <li data-title={title} className="list-none">
      <HoverCard item={row.oldest} title={title}>
        <button
          type="button"
          data-menu={`session:${id}`}
          onClick={toCard}
          onDoubleClick={() => useLayout.getState().openSession(id)}
          className="my-px flex w-full flex-col gap-[7px] rounded-sm px-2.5 py-2 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 data-[state=open]:bg-bg-active"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 text-ui-sm whitespace-nowrap">
            {project && <span className="shrink-0 text-fg-muted">{project} ·</span>}
            <span className="truncate text-fg">{title}</span>
            {row.count > 1 && <span className="ml-auto shrink-0 rounded-sm bg-bg-active px-1 text-fg-muted tabular-nums">{row.count}</span>}
          </span>
          <span className="flex w-full min-w-0 items-center gap-1.5 text-ui-sm text-fg-muted">
            <GlyphMark glyph={glyphFor(record, digest ?? null, pending)} className="shrink-0" />
            <span className="truncate">{row.oldest.summary}</span>
            <span className="ml-auto shrink-0 tabular-nums">{needsYouAge(row.oldest, now)}</span>
          </span>
        </button>
      </HoverCard>
    </li>
  );
}
