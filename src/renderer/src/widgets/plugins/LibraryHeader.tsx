// The plugin library's head controls (P2-B execution document §5.2, §5.4, §5.8; Claude Desktop's in-dialog header, title
// and switch at the left and its actions at the right, readable/app-2.16120.0/web/app/v1/ccefd43d9-CoNZ8js5.js:18-57):
// Customize's My items | Discover switch in `WidgetFrame`'s heading slot (the session's `/plugins` has Open Discover
// there, P4-AGG Decision Log 10); in its toolbar slot, My items' search field ("Search plugins", at most 200 characters;
// Escape clears it first, `/` focuses it), Show ("All plugins / Enabled / Disabled" and MAWS's "Loaded in this session"
// and "Other projects") and Sort by ("Last updated", "Name"), and the Add menu. The choices live in the library store
// for the app run.
import { DropdownMenu, ToggleGroup } from 'radix-ui';
import type { ReactNode } from 'react';
import { IconButton, SearchIcon, SortIcon } from '../../app/IconButton';
import { LIBRARY as L } from '../copy';
import { FilterIcon } from './icons';
import type { LibraryFilter, LibrarySort } from './library';
import { useLibraryStore } from './library-store';

export type LibraryTab = 'myItems' | 'discover';

const FILTERS: readonly LibraryFilter[] = ['all', 'enabled', 'disabled', 'loaded', 'otherProjects'];
const SORTS: readonly LibrarySort[] = ['updated', 'name'];
const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover';
const LABEL = 'px-2 py-1 text-ui-sm text-fg-muted';
const set = (patch: Partial<ReturnType<typeof useLibraryStore.getState>['plugins']>) => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, ...patch } }));

// Desktop's segmented switch beside the title: My items and, second, Discover (P4-AGG M3), named by the caller.
export function LibrarySwitch({ tab, onChange, second }: { tab: LibraryTab; onChange(tab: LibraryTab): void; second: string }) {
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
      <ToggleGroup.Item value="discover" className={item}>
        {second}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}

// The libraries' search field (`/plugins`' two views and `/skills`): Escape clears it first, `/` focuses it.
export function SearchField({ label = L.searchPlugins, value, onChange }: { label?: string; value: string; onChange(value: string): void }) {
  return (
    <label className="flex h-7 w-56 min-w-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-fg-muted focus-within:border-border-strong focus-within:text-fg">
      <SearchIcon className="size-3.5" />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        maxLength={200}
        value={value}
        data-widget-search
        data-escape-clears
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Desktop's rule: Escape in a field that holds text clears it, and the dialog stays (WidgetDialog's host); an
          // Escape an input method is composing with only cancels the composition (P2-B M6)
          if (event.key !== 'Escape' || value === '' || event.nativeEvent.isComposing) return;
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

export function Choice<T extends string>({ label, icon, value, values, words, isDefault, onChange }: { label: string; icon: ReactNode; value: T; values: readonly T[]; words: Record<T, string>; isDefault: boolean; onChange(value: T): void }) {
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

