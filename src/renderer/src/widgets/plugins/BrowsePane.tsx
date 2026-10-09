// Browse (P2-B execution document §5.8): what the engine's configured sources offer, read on the click that opens it
// (never on opening `/plugins`), drawn as the bundle's Discover cards laid out as the live directory browser lays out
// its own (two columns, `grid gap-4 grid-cols-1 md:grid-cols-2`, readable/app-2.16120.0/web/app/v1/
// c99ed1520-6rNl-uN3.js:4377), sectioned by source: "From Anthropic & Partners", then one section per other marketplace.
// About 3,300 cards on a home with the official marketplace added, so the grid is virtualised by rows (a section's
// heading is a row; a row holds two cards, or one where the pane is narrow). Desktop's states: pulsing placeholder cards
// while the first read runs; "Couldn't load the plugins to browse." with the read's words and Retry; a later failed read
// keeps the last cards with one line saying so (E8's rule); "Nothing matches these filters." with Reset filters. An
// install whose card the next read no longer offers keeps its result above the grid. The pane stays mounted beneath an
// open detail and returns with its scroll and focus.
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AvailablePlugin } from '@shared/ipc/schema/plugins';
import { LIBRARY as L } from '../copy';
import type { BrowseCard as Card, BrowseViewResult } from './browse';
import { AVAILABLE_PREFIX, BrowseCard } from './BrowseCard';
import { sourceWords } from './LibraryHeader';
import { useLibraryStore } from './library-store';
import { Gone, useManage } from './manage';
import { GroupHeading } from './PluginRow';
import type { PluginsReadResult } from './read';

const SECONDARY = 'rounded-md border border-border px-3 py-1 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const TWO_COLUMNS = 600; // the pane's width from which cards sit two to a row
const HEADING_HEIGHT = 36;
const ROW_HEIGHT = 124; // a card row's first guess; rows are measured as drawn
const GAP = 'gap-3';

type Line = { kind: 'heading'; key: string; section: string; count: number } | { kind: 'cards'; key: string; cards: Card[] };

function linesOf(sections: BrowseViewResult['sections'], columns: number): Line[] {
  const lines: Line[] = [];
  for (const { section, cards } of sections) {
    lines.push({ kind: 'heading', key: `h:${section}`, section, count: cards.length });
    for (let at = 0; at < cards.length; at += columns) lines.push({ kind: 'cards', key: `c:${section}:${at}`, cards: cards.slice(at, at + columns) });
  }
  return lines;
}

function Centered({ children, role }: { children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {children}
    </div>
  );
}

// Desktop's loading cards (ca0e5677a-CC0fQ6mk.js:173-189), in the grid's shape.
function Placeholders() {
  return (
    <div aria-busy="true" className={`grid grid-cols-2 ${GAP} px-2 pt-2`}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-28 flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <div className="size-9 shrink-0 animate-pulse rounded-md bg-bg-active" />
            <div className="flex grow flex-col gap-1.5">
              <div className="h-3.5 w-1/2 animate-pulse rounded-sm bg-bg-active" />
              <div className="h-3 w-1/3 animate-pulse rounded-sm bg-bg-active" />
            </div>
          </div>
          <div className="h-3 w-full animate-pulse rounded-sm bg-bg-active" />
          <div className="h-3 w-4/5 animate-pulse rounded-sm bg-bg-active" />
        </div>
      ))}
    </div>
  );
}

export interface BrowsePaneProps {
  read: PluginsReadResult<{ plugins: AvailablePlugin[] }>;
  cards: readonly Card[]; // every card, before the view's filters
  view: BrowseViewResult;
  hidden: boolean; // a detail opened from Browse stands in its place
  onOpen(card: Card): void;
  onRetry(): void;
}

export function BrowsePane({ read, cards, view, hidden, onOpen, onRetry }: BrowsePaneProps) {
  const { ops } = useManage();
  const offered = new Set(cards.map((c) => c.pluginId));
  // an install whose card left (the engine no longer offers it, and nothing installed it): its result above the grid
  const gone = read.data ? [...ops.entries.keys()].filter((key) => key.startsWith(AVAILABLE_PREFIX) && !offered.has(key.slice(AVAILABLE_PREFIX.length))) : [];
  const reset = () => useLibraryStore.setState((s) => ({ browse: { ...s.browse, search: '', status: { installed: true, notInstalled: true }, source: null } }));

  let body: ReactNode;
  if (!read.data) {
    body =
      read.state === 'error' ? (
        <Centered role="alert">
          <p className="m-0 text-ui font-medium text-fg">{L.browseFailed}</p>
          {read.error && <p className="m-0 max-w-md text-ui-sm text-fg-muted [overflow-wrap:anywhere]">{read.error}</p>}
          <button type="button" className={SECONDARY} onClick={onRetry}>
            {L.retry}
          </button>
        </Centered>
      ) : (
        <Placeholders />
      );
  } else if (cards.length === 0) {
    body = (
      <Centered>
        <p className="m-0 max-w-sm text-ui-sm text-fg-muted">{L.noOffers}</p>
      </Centered>
    );
  } else if (view.sections.length === 0) {
    body = (
      <Centered role="status">
        <p className="m-0 text-ui text-fg-muted">{L.noMatch}</p>
        <button type="button" className={SECONDARY} onClick={reset}>
          {L.resetFilters}
        </button>
      </Centered>
    );
  } else body = null;

  return (
    <div data-plugins-section="browse" className={hidden ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
      {read.data && read.error !== null && (
        <p role="status" className="m-0 px-3 pb-1 text-ui-sm text-warning">
          {read.error}
        </p>
      )}
      {gone.map((key) => (
        <div key={key} className="px-2">
          <Gone opKey={key} name={key.slice(AVAILABLE_PREFIX.length)} data={{ 'data-plugin-result': key.slice(AVAILABLE_PREFIX.length) }} />
        </div>
      ))}
      {body ?? <Grid sections={view.sections} hidden={hidden} onOpen={onOpen} />}
    </div>
  );
}

// The grid as one virtual list of rows. Its own component because the React Compiler skips any component that calls
// `useVirtualizer` (its API returns functions it cannot memoise).
function Grid({ sections, hidden, onOpen }: { sections: BrowseViewResult['sections']; hidden: boolean; onOpen(card: Card): void }) {
  const scroller = useRef<HTMLDivElement>(null);
  // the pane's last drawn width (none while hidden, which keeps the columns as they were)
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const columns = width >= TWO_COLUMNS ? 2 : 1;
  const lines = linesOf(sections, columns);
  const getItemKey = useCallback((index: number) => lines[index].key, [lines]);
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (lines[index].kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT),
    getItemKey,
    overscan: 4,
  });

  // the scroll and the card a detail opened from, kept before it stands in Browse's place (Chromium resets the scroll of a
  // hidden pane), and given back on its return: the keyboard on that card, else (it left) on the frame
  const left = useRef<{ scrollTop: number; id: string } | null>(null);
  const open = (card: Card) => {
    left.current = { scrollTop: scroller.current?.scrollTop ?? 0, id: card.pluginId };
    onOpen(card);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    const from = left.current;
    if (hidden || !el || from === null) return;
    left.current = null;
    el.scrollTop = from.scrollTop;
    const target = el.querySelector<HTMLElement>(`[data-browse-card="${CSS.escape(from.id)}"] [data-card-open]`) ?? el.closest<HTMLElement>('[data-widget]');
    target?.focus();
  }, [hidden]);

  return (
    <div ref={scroller} data-browse-scroller className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const line = lines[item.index];
          return (
            <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${item.start}px)` }}>
              {line.kind === 'heading' ? (
                <section aria-label={sourceWords(line.section)} data-browse-section={line.section}>
                  <GroupHeading label={sourceWords(line.section)} count={line.count} />
                </section>
              ) : (
                <ul className={`m-0 grid list-none ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'} ${GAP} p-0 pb-3`}>
                  {line.cards.map((card) => (
                    <BrowseCard key={card.pluginId} card={card} onOpen={open} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
