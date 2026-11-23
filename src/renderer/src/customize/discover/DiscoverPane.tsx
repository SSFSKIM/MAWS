// Discover for Plugins and Skills (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M3): the filter row,
// then the home (Featured, the shelves, All) or, while a search, chip, category, shelf or Not installed narrows it, the
// grid of results; and a card's detail in the list's place, the list kept mounted beneath it so Back returns to it with
// its scroll and focus. Discover reads only `catalog.*`, with the Customize page's cwd (null: the user configuration).
// Skills lists the plugins whose skills are known, with a note that the rest are under Plugins. A card installed here
// opens the item in My items (`onOpenInstalled`). The install sheet and the operations are the page's (`useManage`).
// `catalog.changed` is heard for the window's life (read.ts's connectCatalogEvents, mounted by App.tsx), not here.
// All (UX wave U11c M4, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §F): the home of a shelf per kind, or
// one grid across kinds with no sort control (main answers it in one order); a card opens its detail as the kind it was
// drawn as (a Skills shelf's card as a Skills card).
import { useLayoutEffect, useRef, useState } from 'react';
import type { CatalogItem, CatalogKindTab, CatalogTab } from '@shared/ipc/schema/catalog';
import { isMcpAction } from '@shared/plugins/cli';
import { SECONDARY } from '../../sessions/ui';
import { CatalogDetail } from './CatalogDetail';
import { DISCOVER as D } from './copy';
import { cardTabOf, KindLines, QueryGrid, ShelfHeading } from './DiscoverGrid';
import { DiscoverHome, SortControl } from './DiscoverHome';
import { FilterRow } from './DiscoverToolbar';
import { useCatalogItem } from './read';
import { filtering, NO_CHOICES, queryOf, setChoices, useDiscoverStore } from './store';
import { OperationLine, useManage } from '../../widgets/plugins/manage';
import { factsOf } from '../../widgets/plugins/operation';
import { CATALOG_KEY } from './add';

type Tab = CatalogTab; // P4-AGG M4: Connectors too

// A change's result whose item the catalog no longer lists (an install the marketplace withdrew, an uninstall that
// dropped a plugin nobody else lists): its card is gone, so its line stays at the head, by the item's name.
function LeftResults({ cwd }: { cwd: string | null }) {
  const { ops } = useManage();
  const keys = [...ops.entries.keys()].filter((key) => key.startsWith(CATALOG_KEY));
  return keys.length === 0 ? null : (
    <div className="flex flex-col gap-1 empty:hidden">
      {keys.map((key) => (
        <LeftResult key={key} opKey={key} cwd={cwd} />
      ))}
    </div>
  );
}

function LeftResult({ opKey, cwd }: { opKey: string; cwd: string | null }) {
  const { ops } = useManage();
  const id = opKey.slice(CATALOG_KEY.length);
  const read = useCatalogItem(id, cwd);
  const entry = ops.entries.get(opKey);
  if (!read.isError || entry === undefined) return null;
  const facts = factsOf(entry);
  return (
    <p data-catalog-result={id} className="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-sm">
      <span className="font-medium text-fg">{facts.catalogName ?? id}</span>
      <KindLines tab={isMcpAction(facts.action) ? 'connectors' : 'plugins'}>
        <OperationLine opKey={opKey} />
      </KindLines>
    </p>
  );
}

// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D): on Customize's page a card's detail is
// told to the head (`onDetail`: no tools while it is open), and a press of the view shown or a Show value (`toList`, a
// count the page raises) returns it to the list, with the list's scroll and the card's focus as Back returns them.
export function DiscoverPane({ tab, cwd, onOpenInstalled, onDetail, toList = 0 }: { tab: Tab; cwd: string | null; onOpenInstalled(item: CatalogItem): void; onDetail?(open: boolean): void; toList?: number }) {
  const choices = useDiscoverStore((s) => s[tab]);
  const [opened, setDetail] = useState<{ item: CatalogItem; as: CatalogKindTab } | null>(null);
  const detail = opened?.item ?? null;
  const [listed, setListed] = useState(toList);
  if (listed !== toList) {
    setListed(toList);
    if (detail !== null) setDetail(null);
  }
  const pane = useRef<HTMLDivElement>(null);
  const left = useRef<{ id: string; scrollTop: number } | null>(null);
  const open = (item: CatalogItem, as: CatalogKindTab = cardTabOf(tab, item)) => {
    if (item.installed === 'here') return onOpenInstalled(item);
    left.current = { id: item.id, scrollTop: pane.current?.scrollTop ?? 0 };
    setDetail({ item, as });
  };
  const showing = detail !== null;
  useLayoutEffect(() => {
    const from = left.current;
    if (showing || from === null || pane.current === null) return;
    left.current = null;
    pane.current.scrollTop = from.scrollTop;
    const target = pane.current.querySelector<HTMLElement>(`[data-catalog-card="${CSS.escape(from.id)}"] [data-card-open], [data-featured="${CSS.escape(from.id)}"] [data-card-open]`);
    target?.focus();
  }, [showing]);
  useLayoutEffect(() => onDetail?.(showing), [showing, onDetail]);
  useLayoutEffect(() => () => onDetail?.(false), [onDetail]);

  const narrowed = filtering(choices);
  return (
    <div data-discover={tab} data-plugins-section="discover" className="flex min-h-0 flex-1 flex-col">
      {opened && (
        <KindLines tab={opened.as}>
          <CatalogDetail key={opened.item.id} item={opened.item} tab={opened.as} cwd={cwd} onBack={() => setDetail(null)} />
        </KindLines>
      )}
      <div ref={pane} data-discover-pane className={showing ? 'hidden' : 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1 pb-4'}>
        <FilterRow tab={tab} cwd={cwd} />
        <LeftResults cwd={cwd} />
        {narrowed ? (
          <QueryGrid
            input={queryOf(tab, cwd, choices)}
            tab={tab}
            onOpen={(item) => open(item)}
            header={(total) => <ShelfHeading title={total === null ? D.all : D.results(total)} action={tab === 'all' ? undefined : <SortControl tab={tab} />} />}
            empty={
              <div role="status" className="flex flex-col items-start gap-2">
                <p className="m-0 text-ui-sm text-fg-muted">{D.nothing}</p>
                <button type="button" className={SECONDARY} onClick={() => setChoices(tab, { ...NO_CHOICES, sort: choices.sort, reverse: choices.reverse })}>
                  {D.clearFilters}
                </button>
              </div>
            }
          />
        ) : (
          <DiscoverHome tab={tab} cwd={cwd} onOpen={open} />
        )}
      </div>
    </div>
  );
}
