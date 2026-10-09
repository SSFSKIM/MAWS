// The plugin library's head controls (P2-B execution document §5.2, §5.4; Claude Desktop's in-dialog header, title and
// switch at the left and its actions at the right, readable/app-2.16120.0/web/app/v1/ccefd43d9-CoNZ8js5.js:18-57): the
// search field ("Search plugins", at most 200 characters; Escape clears it first, `/` focuses it), Show (Desktop's "All
// plugins / Enabled / Disabled" and MAWS's "Loaded in this session" and "Other projects") and Sort by ("Last updated",
// "Name"), drawn in `WidgetFrame`'s toolbar slot. The My items | Browse switch and the Add menu join it in M5. The
// choices live in the library store for the app run.
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconButton, SearchIcon, SortIcon } from '../../app/IconButton';
import { LIBRARY as L } from '../copy';
import { FilterIcon } from './icons';
import type { LibraryFilter, LibrarySort } from './library';
import { useLibraryStore } from './library-store';

const FILTERS: readonly LibraryFilter[] = ['all', 'enabled', 'disabled', 'loaded', 'otherProjects'];
const SORTS: readonly LibrarySort[] = ['updated', 'name'];
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover';
const set = (patch: Partial<ReturnType<typeof useLibraryStore.getState>['plugins']>) => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, ...patch } }));

function SearchField() {
  const search = useLibraryStore((s) => s.plugins.search);
  return (
    <label className="flex h-7 w-56 min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-fg-muted focus-within:border-border-strong focus-within:text-fg">
      <SearchIcon className="size-3.5" />
      <input
        type="search"
        aria-label={L.searchPlugins}
        placeholder={L.searchPlugins}
        maxLength={200}
        value={search}
        data-widget-search
        data-escape-clears
        onChange={(event) => set({ search: event.target.value })}
        onKeyDown={(event) => {
          // Desktop's rule: Escape in a field that holds text clears it, and the dialog stays (WidgetDialog's host)
          if (event.key !== 'Escape' || search === '') return;
          event.preventDefault();
          set({ search: '' });
        }}
        className="min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

function Choice<T extends string>({ label, icon, value, values, words, isDefault, onChange }: { label: string; icon: ReactNode; value: T; values: readonly T[]; words: Record<T, string>; isDefault: boolean; onChange(value: T): void }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={label} pressed={!isDefault}>
          {icon}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
          <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-muted">{label}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
            {values.map((v) => (
              <DropdownMenu.RadioItem key={v} value={v} className={ITEM}>
                <span className="w-3 text-accent">
                  <DropdownMenu.ItemIndicator>●</DropdownMenu.ItemIndicator>
                </span>
                {words[v]}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function PluginsToolbar() {
  const { filter, sort } = useLibraryStore((s) => s.plugins);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <SearchField />
      <Choice label={L.show} icon={<FilterIcon />} value={filter} values={FILTERS} words={L.filter} isDefault={filter === 'all'} onChange={(next) => set({ filter: next })} />
      <Choice label={L.sortBy} icon={<SortIcon />} value={sort} values={SORTS} words={L.sort} isDefault={sort === 'updated'} onChange={(next) => set({ sort: next })} />
    </span>
  );
}
