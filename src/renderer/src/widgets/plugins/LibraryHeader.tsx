// The plugin library's head controls (P2-B execution document §5.2, §5.4, §5.8; Claude Desktop's in-dialog header, title
// and switch at the left and its actions at the right, readable/app-2.16120.0/web/app/v1/ccefd43d9-CoNZ8js5.js:18-57):
// the My items | Browse switch in `WidgetFrame`'s heading slot; in its toolbar slot, per tab, the search field ("Search
// plugins", at most 200 characters; Escape clears it first, `/` focuses it), then My items' Show ("All plugins /
// Enabled / Disabled" and MAWS's "Loaded in this session" and "Other projects") and Sort by ("Last updated", "Name"), or
// Browse's Filter (Desktop's directory filter: Status, at least one kept checked, and Source) and Sort by ("Most popular",
// offered only when some card has a count, and "Name"; c17e00059-BnqIc8l8.js:13-178), and the Add menu after either.
// The choices live in the library store for the app run.
import { DropdownMenu, ToggleGroup } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconButton, SearchIcon, SortIcon } from '../../app/IconButton';
import { LIBRARY as L } from '../copy';
import { sectionKey, type BrowseChoices, type BrowseSection, type BrowseSort } from './browse';
import { FilterIcon } from './icons';
import type { LibraryFilter, LibrarySort } from './library';
import { useLibraryStore } from './library-store';

export type LibraryTab = 'myItems' | 'browse';

const FILTERS: readonly LibraryFilter[] = ['all', 'enabled', 'disabled', 'loaded', 'otherProjects'];
const SORTS: readonly LibrarySort[] = ['updated', 'name'];
const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover';
const LABEL = 'px-2 py-1 text-ui-sm text-fg-muted';
const set = (patch: Partial<ReturnType<typeof useLibraryStore.getState>['plugins']>) => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, ...patch } }));
const setBrowse = (patch: Partial<BrowseChoices>) => useLibraryStore.setState((s) => ({ browse: { ...s.browse, ...patch } }));

// Desktop's segmented switch beside the title: one of two views, each open starting on My items.
export function LibrarySwitch({ tab, onChange }: { tab: LibraryTab; onChange(tab: LibraryTab): void }) {
  const item = 'h-6 rounded-sm px-2.5 text-ui text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 data-[state=on]:bg-bg data-[state=on]:text-fg data-[state=on]:ring-1 data-[state=on]:ring-border';
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={L.library}
      value={tab}
      // a click on the view shown emits '' (Radix's single group unpressing it): that view, kept and returned to its list
      onValueChange={(next) => onChange(next === '' ? tab : (next as LibraryTab))}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-bg-active p-0.5"
    >
      <ToggleGroup.Item value="myItems" className={item}>
        {L.myItems}
      </ToggleGroup.Item>
      <ToggleGroup.Item value="browse" className={item}>
        {L.browse}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}

function SearchField({ value, onChange }: { value: string; onChange(value: string): void }) {
  return (
    <label className="flex h-7 w-56 min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-fg-muted focus-within:border-border-strong focus-within:text-fg">
      <SearchIcon className="size-3.5" />
      <input
        type="search"
        aria-label={L.searchPlugins}
        placeholder={L.searchPlugins}
        maxLength={200}
        value={value}
        data-widget-search
        data-escape-clears
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Desktop's rule: Escape in a field that holds text clears it, and the dialog stays (WidgetDialog's host)
          if (event.key !== 'Escape' || value === '') return;
          event.preventDefault();
          onChange('');
        }}
        className="min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

function Menu({ label, icon, pressed, children }: { label: string; icon: ReactNode; pressed: boolean; children: ReactNode }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={label} pressed={pressed}>
          {icon}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const Dot = () => (
  <span aria-hidden className="w-3 text-accent">
    <DropdownMenu.ItemIndicator>●</DropdownMenu.ItemIndicator>
  </span>
);

function Radios<T extends string>({ value, values, words, onChange }: { value: T; values: readonly T[]; words: (value: T) => string; onChange(value: T): void }) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
      {values.map((v) => (
        <DropdownMenu.RadioItem key={v} value={v} className={ITEM}>
          <Dot />
          {words(v)}
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

function Choice<T extends string>({ label, icon, value, values, words, isDefault, onChange }: { label: string; icon: ReactNode; value: T; values: readonly T[]; words: Record<T, string>; isDefault: boolean; onChange(value: T): void }) {
  return (
    <Menu label={label} icon={icon} pressed={!isDefault}>
      <DropdownMenu.Label className={LABEL}>{label}</DropdownMenu.Label>
      <Radios value={value} values={values} words={(v) => words[v]} onChange={onChange} />
    </Menu>
  );
}

export function PluginsToolbar({ add }: { add: ReactNode }) {
  const { search, filter, sort } = useLibraryStore((s) => s.plugins);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SearchField value={search} onChange={(next) => set({ search: next })} />
      <Choice label={L.show} icon={<FilterIcon />} value={filter} values={FILTERS} words={L.filter} isDefault={filter === 'all'} onChange={(next) => set({ filter: next })} />
      <Choice label={L.sortBy} icon={<SortIcon />} value={sort} values={SORTS} words={L.sort} isDefault={sort === 'updated'} onChange={(next) => set({ sort: next })} />
      {add}
    </span>
  );
}

// A source's name in the filter: Anthropic's section by its heading, a marketplace by its own name.
export const sourceWords = (source: BrowseSection): string => (source.kind === 'anthropic' ? L.group.anthropic : source.name);

const ALL_SOURCES = '\u0000all'; // the radio value of All sources (no section key can be it)

export function BrowseToolbar({ sources, hasCounts, sort, add }: { sources: readonly BrowseSection[]; hasCounts: boolean; sort: BrowseSort; add: ReactNode }) {
  const { search, status, source } = useLibraryStore((s) => s.browse);
  // Desktop's Status: both checked by default, and the last checked one cannot be unchecked
  const toggle = (which: keyof BrowseChoices['status']) => {
    const next = { ...status, [which]: !status[which] };
    if (next.installed || next.notInstalled) setBrowse({ status: next });
  };
  const sorts: readonly BrowseSort[] = hasCounts ? ['popular', 'name'] : ['name'];
  const byKey = new Map(sources.map((s) => [sectionKey(s), s]));
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SearchField value={search} onChange={(next) => setBrowse({ search: next })} />
      <Menu label={L.filterBy} icon={<FilterIcon />} pressed={!(status.installed && status.notInstalled) || source !== null}>
        <DropdownMenu.Label className={LABEL}>{L.status}</DropdownMenu.Label>
        {(['installed', 'notInstalled'] as const).map((which) => (
          <DropdownMenu.CheckboxItem
            key={which}
            checked={status[which]}
            onSelect={(event) => {
              event.preventDefault(); // Desktop keeps the menu open while Status is chosen
              toggle(which);
            }}
            className={ITEM}
          >
            <span aria-hidden className="w-3 text-accent">
              <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
            </span>
            {L.statusWords[which]}
          </DropdownMenu.CheckboxItem>
        ))}
        <DropdownMenu.Separator className="my-1 h-px bg-border" />
        <DropdownMenu.Label className={LABEL}>{L.source}</DropdownMenu.Label>
        <Radios
          value={source === null ? ALL_SOURCES : sectionKey(source)}
          values={[ALL_SOURCES, ...byKey.keys()]}
          words={(v) => {
            const section = byKey.get(v);
            return section ? sourceWords(section) : L.allSources;
          }}
          onChange={(next) => setBrowse({ source: byKey.get(next) ?? null })}
        />
      </Menu>
      <Choice label={L.sortBy} icon={<SortIcon />} value={sort} values={sorts} words={L.browseSort} isDefault={sort === (hasCounts ? 'popular' : 'name')} onChange={(next) => setBrowse({ sort: next })} />
      {add}
    </span>
  );
}
