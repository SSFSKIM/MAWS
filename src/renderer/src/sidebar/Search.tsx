// The sidebar's search field (§5.1; mockup 01 `.search`): filters the tree in place, every project by its name and by
// the sessions it holds (title, project name, directory), each listed project open on its matches. Escape clears it;
// ArrowDown moves into the tree. The mockup's ⌘K hint is not shown: ⌘K is the command palette (§5.8;
// residue *Command palette*).
import { SearchIcon } from '../app/IconButton';

export function Search({ value, label, onChange, onLeave }: { value: string; label: string; onChange(value: string): void; onLeave(): void }) {
  return (
    <label className="mx-0.5 mb-2.5 flex h-8 items-center gap-2 rounded-sm border border-border px-[9px] text-fg-muted focus-within:border-accent">
      <SearchIcon />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            onChange('');
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            onLeave();
          }
        }}
        className="w-full min-w-0 border-0 bg-transparent text-ui-sm text-fg outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}
