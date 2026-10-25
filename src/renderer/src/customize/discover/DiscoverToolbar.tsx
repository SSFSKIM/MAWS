// Discover's head controls (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "The home" and
// "Failure handling"): the search over every source and both names, Refresh (every source fetched again; main runs one
// refresh at a time), the catalog's age, and the Sources popover with each source's state ("offline, from 2 days ago",
// "unavailable", the records it could not read). Below them, the filter row: the class chips (Anthropic, Partner,
// Community, Added by you: the trust label's class), the Category menu, Not installed, and a removable chip for a shelf's
// See all.
import { Popover } from 'radix-ui';
import type { CatalogChip, CatalogSourceStatus, CatalogTab } from '@shared/ipc/schema/catalog';
import { formatAgo } from '@shared/app/date-format';
import { SECONDARY } from '../../sessions/ui';
import { FilterIcon } from '../../widgets/plugins/icons';
import { Choice, SearchField } from '../../widgets/plugins/LibraryHeader';
import { useNow } from '../../app/use-now';
import { DISCOVER as D } from './copy';
import { useCatalogHome, useCatalogRefresh, useCatalogSources } from './read';
import { NO_CHOICES, setChoices, useDiscoverStore } from './store';

type Tab = CatalogTab; // P4-AGG M4: Connectors too
const CHIPS: readonly CatalogChip[] = ['anthropic', 'partner', 'community', 'added'];
const ANY = '';
const QUIET = 'inline-flex h-7 items-center gap-1 rounded-md px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint';

const ageOf = (iso: string | null, now: number): string | null => {
  const t = iso === null ? NaN : Date.parse(iso);
  return Number.isFinite(t) ? formatAgo(Math.max(0, now - t)) : null;
};

/** The words for one source's state in the popover. */
export function sourceWords(status: CatalogSourceStatus, now: number): string {
  const age = ageOf(status.fetchedAt, now) ?? D.neverUpdated;
  switch (status.state) {
    case 'fresh':
      return D.sourceState.fresh(age);
    case 'stale':
      return D.sourceState.stale(age);
    case 'offline':
      return D.sourceState.offline(age);
    case 'unavailable':
      return D.sourceState.unavailable;
  }
}

export function DiscoverToolbar({ tab, add }: { tab: Tab; add?: React.ReactNode }) {
  const text = useDiscoverStore((s) => s[tab].text);
  const sources = useCatalogSources();
  const { refresh, running } = useCatalogRefresh();
  const now = useNow();
  const statuses = sources.data ?? [];
  const fetched = statuses.flatMap((s) => (s.fetchedAt === null ? [] : [s.fetchedAt])).sort();
  const age = ageOf(fetched[0] ?? null, now);
  const troubled = statuses.some((s) => s.state === 'offline' || s.state === 'unavailable' || s.dropped > 0);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      <SearchField label={D.search} value={text} onChange={(next) => setChoices(tab, { text: next })} />
      <button type="button" data-catalog-refresh disabled={running} onClick={refresh} className={QUIET}>
        {running ? D.refreshing : D.refresh}
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" aria-label={D.sources} data-catalog-sources-trigger className={QUIET}>
            {troubled && <span aria-hidden className="size-1.5 rounded-full bg-warning" />}
            {age === null ? D.neverUpdated : D.updated(age)}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content aria-label={D.sources} align="end" sideOffset={4} data-catalog-sources className="z-50 w-80 rounded-md border border-border-strong bg-bg-overlay p-2 text-ui text-fg shadow-float">
            <p className="m-0 mb-1 px-1 text-ui-sm text-fg-muted">{D.sources}</p>
            <ul className="m-0 flex max-h-80 list-none flex-col gap-1 overflow-y-auto p-0">
              {statuses.map((status) => (
                <li key={status.key} data-source={status.key} data-source-state={status.state} className="flex flex-col px-1 text-ui-sm">
                  <span className="text-fg">{status.label}</span>
                  <span className={status.state === 'offline' || status.state === 'unavailable' ? 'text-warning' : 'text-fg-muted'}>
                    {status.state === 'unavailable' ? `${status.label} ${D.sourceState.unavailable}` : sourceWords(status, now)}
                    {status.dropped > 0 && ` · ${D.dropped(status.dropped)}`}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" disabled={running} onClick={refresh} className={`${SECONDARY} mt-2 w-full`}>
              {running ? D.refreshing : D.refresh}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {add}
    </span>
  );
}

function Removable({ name, onRemove }: { name: string; onRemove(): void }) {
  return (
    <span data-filter-chip={name} className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong bg-bg-raised pr-1 pl-2 text-ui-sm text-fg">
      {name}
      <button type="button" aria-label={D.removeFilter(name)} onClick={onRemove} className="inline-flex size-5 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
        ×
      </button>
    </span>
  );
}

export function FilterRow({ tab, cwd }: { tab: Tab; cwd: string | null }) {
  const choices = useDiscoverStore((s) => s[tab]);
  const home = useCatalogHome(tab, cwd);
  const categories = home.data?.categories ?? [];
  const words: Record<string, string> = { [ANY]: D.anyCategory, ...Object.fromEntries(categories.map((c) => [c.value, `${c.title} · ${c.total}`])) };
  const toggle = (chip: CatalogChip) => setChoices(tab, { chips: choices.chips.includes(chip) ? choices.chips.filter((c) => c !== chip) : [...choices.chips, chip] });
  return (
    <div data-discover-filters className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span role="group" aria-label={D.chipsLabel} className="flex flex-wrap gap-1.5">
        {CHIPS.filter((chip) => tab !== 'connectors' || chip !== 'added').map((chip) => ( // nobody adds a connector source
          <button
            key={chip}
            type="button"
            aria-pressed={choices.chips.includes(chip)}
            data-chip={chip}
            onClick={() => toggle(chip)}
            className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-bg"
          >
            {D.chip[chip]}
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1">
        <Choice
          label={D.category}
          icon={<FilterIcon />}
          value={choices.category?.value ?? ANY}
          values={[ANY, ...categories.map((c) => c.value)]}
          words={words}
          isDefault={choices.category === null}
          onChange={(value) => setChoices(tab, { category: value === ANY ? null : { value, title: categories.find((c) => c.value === value)?.title ?? value } })}
        />
        <span className="text-ui-sm text-fg-muted">{choices.category ? null : D.category}</span>
      </span>
      <label className="inline-flex h-7 items-center gap-1.5 px-1 text-ui-sm text-fg-muted">
        <input type="checkbox" checked={choices.notInstalled} onChange={(event) => setChoices(tab, { notInstalled: event.target.checked })} className="accent-accent" />
        {D.notInstalled}
      </label>
      {choices.source && <Removable name={choices.source.title} onRemove={() => setChoices(tab, { source: null })} />}
      {choices.category && <Removable name={choices.category.title} onRemove={() => setChoices(tab, { category: null })} />}
      {(choices.chips.length > 0 || choices.notInstalled || choices.source || choices.category) && (
        <button type="button" onClick={() => setChoices(tab, { ...NO_CHOICES, text: choices.text, sort: choices.sort, reverse: choices.reverse })} className={QUIET}>
          {D.clearFilters}
        </button>
      )}
    </div>
  );
}
