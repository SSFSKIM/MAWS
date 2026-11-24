// Discover's home (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "The home"; the owner's
// approved shape: shelves): the Featured card (derived, never editorial: on Plugins and Skills the most-installed item
// listed by Anthropic and not installed here; none when nothing qualifies), "Your sources" (marketplaces the person
// added), one shelf per seed source with more than one item, up to four category shelves, then All with its sort
// control. Community items are on no shelf, only in All and search. A shelf's See all opens the grid filtered to that
// shelf, its chip removable.
// All (UX wave U11c M4, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §F): the Plugins home's Featured and
// a shelf per kind, Plugins, Skills, Connectors (main's; no community item on them), with no grid under them; a shelf's
// See all chooses its kind in Show. A shelf's cards are its kind's (a Skills card names its skills and asks as one).
import type { CatalogItem, CatalogKindTab, CatalogShelf, CatalogSort, CatalogTab } from '@shared/ipc/schema/catalog';
import { IconButton, SortIcon } from '../../app/IconButton';
import { SECONDARY } from '../../sessions/ui';
import { useLayout } from '../../stores/layout';
import { Choice } from '../../widgets/plugins/LibraryHeader';
import { OperationLine } from '../../widgets/plugins/manage';
import { ItemImage } from '../image/ItemImage';
import { catalogSeedOf } from '../image/tile';
import { catalogKey } from './add';
import { AddButton, InstalledMark, TrustLabel } from './CatalogCard';
import { DISCOVER as D } from './copy';
import { CardPlaceholders, KindLines, QueryGrid, Shelf, ShelfHeading } from './DiscoverGrid';
import { addable, componentsWords, metricWords } from './present';
import { useCatalogHome } from './read';
import { queryOf, setChoices, useDiscoverStore } from './store';

type Tab = CatalogTab; // P4-AGG M4: Connectors too
const SORTS: readonly CatalogSort[] = ['installs', 'updated', 'name'];

function Featured({ item, tab, onOpen }: { item: CatalogItem; tab: CatalogKindTab; onOpen(item: CatalogItem): void }) {
  const metric = metricWords(item);
  return (
    <section
      aria-label={D.featured}
      data-featured={item.id}
      className="relative flex min-w-0 items-center gap-5 rounded-lg bg-accent-soft px-6 py-5"
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest('button:not([data-card-open])'))) onOpen(item);
      }}
    >
      <button type="button" data-card-open aria-label={D.view(item.name)} className="absolute inset-0 rounded-lg outline-accent focus-visible:outline-2" />
      <div className="relative flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-ui-sm text-fg-muted">{D.featured}</span>
        <h3 className="m-0 truncate text-[1.375rem] leading-tight font-semibold text-fg">{item.name}</h3>
        <p className="m-0 line-clamp-2 max-w-[60ch] text-ui text-fg-muted">{item.description ?? ''}</p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-ui-sm text-fg-muted">
          {item.installed === 'here' ? <InstalledMark /> : addable(item) && <AddButton item={item} tab={tab} variant="text" />}
          {metric && <span data-catalog-metric className="tabular-nums">{metric}</span>}
          <span aria-hidden>·</span>
          <span className="truncate">{componentsWords(item)}</span>
          <TrustLabel item={item} />
        </div>
        <div className="text-ui-sm empty:hidden">
          <OperationLine opKey={catalogKey(item)} />
        </div>
      </div>
      <span className="relative hidden @md/customize:block">
        <ItemImage kind={item.kind} seed={catalogSeedOf(item)} iconUrl={item.iconUrl} size="detail" />
      </span>
    </section>
  );
}

/** All's head: the count, the sort and its direction. */
export function SortControl({ tab }: { tab: Tab }) {
  const { sort, reverse } = useDiscoverStore((s) => s[tab]);
  const words = tab === 'connectors' ? { ...D.sort, installs: D.rankSort } : D.sort; // a connector's count is its rank
  return (
    <span className="flex items-center gap-1">
      <Choice label={D.sortBy} icon={<SortIcon />} value={sort} values={SORTS} words={words} isDefault={sort === 'installs'} onChange={(next) => setChoices(tab, { sort: next })} />
      <span data-sort-shown className="text-ui-sm text-fg-muted">
        {words[sort]}
      </span>
      <IconButton label={D.reverse} pressed={reverse} onClick={() => setChoices(tab, { reverse: !reverse })}>
        <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
          <path d={reverse ? 'M8 13V3M4.5 6.5 8 3l3.5 3.5' : 'M8 3v10M4.5 9.5 8 13l3.5-3.5'} />
        </svg>
      </IconButton>
    </span>
  );
}
const KIND_OF_SHELF: Readonly<Record<string, CatalogKindTab>> = { 'kind:plugins': 'plugins', 'kind:skills': 'skills', 'kind:connectors': 'connectors' };

export function DiscoverHome({ tab, cwd, onOpen }: { tab: Tab; cwd: string | null; onOpen(item: CatalogItem, as?: CatalogKindTab): void }) {
  const home = useCatalogHome(tab, cwd);
  const choices = useDiscoverStore((s) => s[tab]);
  if (!home.data)
    return home.isError ? (
      <p role="alert" className="m-0 flex flex-wrap items-baseline gap-2 text-ui-sm text-danger">
        {D.failed} <span className="text-fg-muted">{home.error.message}</span>
        <button type="button" className={SECONDARY} onClick={() => void home.refetch()}>
          {D.retry}
        </button>
      </p>
    ) : (
      <CardPlaceholders n={6} />
    );
  const { featured, shelves } = home.data;
  if (tab === 'all')
    return (
      <div data-discover-home className="flex flex-col gap-6">
        {featured && <Featured item={featured} tab="plugins" onOpen={(item) => onOpen(item, 'plugins')} />}
        {shelves.map((shelf) => {
          const kind = KIND_OF_SHELF[shelf.key];
          // a kind with nothing at all (no copy of the directory's servers) draws no shelf; one whose cards all stand on
          // Plugins' keeps its heading and See all
          if (kind === undefined || shelf.total === 0) return null;
          return (
            <KindLines key={shelf.key} tab={kind}>
              <Shelf
                shelfKey={shelf.key}
                title={shelf.title}
                items={shelf.items}
                total={shelf.total}
                tab={kind}
                onOpen={(item) => onOpen(item, kind)}
                onSeeAll={() => useLayout.getState().openDestination({ kind: 'customize', view: 'discover', show: kind })}
              />
            </KindLines>
          );
        })}
      </div>
    );
  const seeAll = (shelf: CatalogShelf) =>
    shelf.kind === 'category' ? setChoices(tab, { category: { value: shelf.key.slice('category:'.length), title: shelf.title }, source: null }) : setChoices(tab, { source: { key: shelf.key, title: shelf.title }, category: null });
  return (
    <div data-discover-home className="flex flex-col gap-6">
      {featured && <Featured item={featured} tab={tab} onOpen={onOpen} />}
      {shelves.map((shelf) => (
        <Shelf key={shelf.key} shelfKey={shelf.key} title={shelf.title} items={shelf.items} total={shelf.total} tab={tab} onOpen={onOpen} onSeeAll={() => seeAll(shelf)} />
      ))}
      <QueryGrid
        input={queryOf(tab, cwd, choices)}
        tab={tab}
        onOpen={onOpen}
        header={(total) => <ShelfHeading title={total === null ? D.all : `${D.all} · ${total.toLocaleString('en-US')}`} action={<SortControl tab={tab} />} />}
        empty={<p className="m-0 text-ui-sm text-fg-muted">{D.nothing}</p>}
      />
    </div>
  );
}
