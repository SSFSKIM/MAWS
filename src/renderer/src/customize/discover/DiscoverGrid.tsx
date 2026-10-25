// Discover's grids (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "The home"): a shelf (one row,
// as many fixed-height cards as fit, See all for the rest) and a query's grid (All, search results, a shelf's See all),
// whose pages main answers in a deterministic order (`catalog.query`: ties by id, a cursor per page) and which asks for
// the next page when its end scrolls into view or Show more is pressed. Keyboard: a shelf is a row of cards reachable by
// Tab; the arrow keys move between its cards; Enter opens a card's detail; + is its own focus stop.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { CatalogItem, CatalogQueryInput, CatalogTab } from '@shared/ipc/schema/catalog';
import { SECONDARY } from '../../sessions/ui';
import { CARD_HEIGHT, CatalogCard } from './CatalogCard';
import { DISCOVER as D } from './copy';
import { useCatalogQuery } from './read';

const CARD_MIN = 272; // px: a card's narrowest; two to a row in a narrow Customize, four at 1512
const GAP = 12;
const UNMEASURED = 4;
export const GRID = 'm-0 grid list-none grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3 p-0';

/** How many cards of at least CARD_MIN fit across `ref`'s width (one at least); 0 until it is measured. */
function useColumns(ref: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (width: number) => width > 0 && setColumns(Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP))));
    measure(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return columns;
}

// The arrow keys between the cards of one row or grid: the focus moves to the next or previous card's open target.
function arrows(event: KeyboardEvent<HTMLUListElement>) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card-open]')];
  const at = targets.indexOf(event.target as HTMLElement);
  if (at < 0) return;
  const next = targets[at + (event.key === 'ArrowRight' ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export function ShelfHeading({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-2 flex min-w-0 items-baseline gap-2">
      <h3 className="m-0 truncate text-ui font-semibold text-fg">{title}</h3>
      {count !== undefined && <span className="shrink-0 text-ui-sm text-fg-muted tabular-nums">{count.toLocaleString('en-US')}</span>}
      {action && <span className="ml-auto shrink-0">{action}</span>}
    </div>
  );
}

/** One shelf: its first row of cards and See all. */
export function Shelf({ shelfKey, title, items, total, tab, onOpen, onSeeAll }: { shelfKey: string; title: string; items: readonly CatalogItem[]; total: number; tab: CatalogTab; onOpen(item: CatalogItem): void; onSeeAll(): void }) {
  const row = useRef<HTMLUListElement>(null);
  const columns = useColumns(row) || UNMEASURED; // before the first measure (and where nothing lays out), a row of four
  return (
    <section aria-label={title} data-shelf={shelfKey} className="flex flex-col">
      <ShelfHeading
        title={title}
        action={
          <button type="button" aria-label={D.seeAllOf(title)} data-see-all onClick={onSeeAll} className="rounded-sm px-1 text-ui-sm text-fg-muted outline-accent hover:text-fg hover:underline focus-visible:outline-2">
            {D.seeAll}
            {total > 0 && <span className="ml-1 tabular-nums">{total.toLocaleString('en-US')}</span>}
          </button>
        }
      />
      <ul ref={row} onKeyDown={arrows} className="m-0 grid list-none gap-3 p-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.slice(0, columns).map((item) => (
          <CatalogCard key={item.id} item={item} tab={tab} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function Placeholders({ n = 4 }: { n?: number }) {
  return (
    <ul aria-busy="true" className={GRID}>
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className={`${CARD_HEIGHT} animate-pulse rounded-lg border border-border bg-bg-active`} />
      ))}
    </ul>
  );
}
export { Placeholders as CardPlaceholders };

/** A query's grid: its pages so far, and the next asked at the end. */
export function QueryGrid({ input, tab, onOpen, header, empty }: { input: Omit<CatalogQueryInput, 'cursor'>; tab: CatalogTab; onOpen(item: CatalogItem): void; header(total: number | null): ReactNode; empty: ReactNode }) {
  const { query, items, total, restarted, more } = useCatalogQuery(input);
  const end = useRef<HTMLButtonElement>(null);
  const { hasNextPage, isFetchingNextPage } = query;
  useEffect(() => {
    const el = end.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && !isFetchingNextPage && void more());
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, more]);

  let body: ReactNode;
  if (items === undefined)
    body = query.isError ? (
      <p role="alert" className="m-0 flex flex-wrap items-baseline gap-2 text-ui-sm text-danger">
        {D.failed} <span className="text-fg-muted">{query.error.message}</span>
        <button type="button" className={SECONDARY} onClick={() => void query.refetch()}>
          {D.retry}
        </button>
      </p>
    ) : (
      <Placeholders />
    );
  else if (items.length === 0) body = empty;
  else
    body = (
      <>
        <ul data-catalog-grid onKeyDown={arrows} className={GRID}>
          {items.map((item) => (
            <CatalogCard key={item.id} item={item} tab={tab} onOpen={onOpen} />
          ))}
        </ul>
        {hasNextPage && (
          <button ref={end} type="button" data-show-more disabled={isFetchingNextPage} onClick={() => void more()} className={`${SECONDARY} self-center`}>
            {D.showMore}
          </button>
        )}
      </>
    );
  return (
    <section data-catalog-results className="flex flex-col gap-3">
      {header(total)}
      {restarted && (
        <p role="status" className="m-0 text-ui-sm text-fg-muted">
          {D.restarted}
        </p>
      )}
      {body}
    </section>
  );
}
