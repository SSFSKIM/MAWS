// U11a M10 (l8-settings-06, A7; the execution document's Interfaces §G, "Search"): "Search settings" at the top of the
// index, and where a chosen result lands. While the field holds text its results take the place of the groups and
// sections in the index's list and scroll as that list scrolls; the first is preselected, Up and Down move, Enter
// chooses, and the keyboard stays in the field until a choice, which gives it to the row itself (search.ts says what
// is found). Esc in a field that holds text clears it (`data-escape-clears`, so a dialog around Settings lets it).
import { useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { KeymapOverrides } from '@shared/keymap/actions';
import { SearchIcon } from '../app/IconButton';
import { INDEX, ORG } from './copy';
import { useShownGroups, useShownRows } from './drawn';
import { keymapGroups } from './keymap';
import { sectionHeadingId } from './parts';
import { SETTINGS_ROWS } from './rows';
import { searchSettings, type SettingsResult } from './search';
import type { SettingsSection } from './SettingsView';

// The Org page's groups in its order (OrgSection.tsx), by the id each registers under (org/parts.tsx `Group`)
const ORG_GROUPS = ['you', 'people', 'machines', 'org'] as const;

// The index's list: the sections' column, a row of links in the narrow form; the results' list, one column in both,
// at most 12rem high under the field in the narrow form.
const SECTIONS_LIST = 'flex min-h-0 flex-1 flex-col overflow-y-auto @max-lg/settings:flex-row @max-lg/settings:flex-wrap @max-lg/settings:gap-0.5 @max-lg/settings:overflow-visible';
const RESULTS_LIST = 'flex min-h-0 flex-1 flex-col overflow-y-auto @max-lg/settings:max-h-48 @max-lg/settings:flex-none';

// The field and the index's list. `keymap` is null until the settings are read: the field is drawn with the rows.
export function SettingsSearch({ keymap, field, onChoose, children }: { keymap: KeymapOverrides | null; field: RefObject<HTMLInputElement | null>; onChoose(result: SettingsResult): void; children: ReactNode }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const shown = useShownRows();
  const groups = useShownGroups();
  const listId = useId();
  const bindings = keymap === null ? [] : keymapGroups(keymap).flatMap((group) => group.rows.map(({ id, title }) => ({ id, title })));
  const orgGroups = ORG_GROUPS.filter((id) => groups.has(id)).map((id) => ORG.groups[id]);
  const searching = keymap !== null && query.trim() !== '';
  const results = searching ? searchSettings(query, { rows: SETTINGS_ROWS, shown, bindings, orgGroups }) : [];
  // U11a's branch panel, finding 2: a query that leaves the results as they were (a trailing space, which the search
  // ignores) keeps the selection; other results select their first. The selected result is always the one in view: it
  // is revealed whenever the selection or the results change, not only on Up and Down.
  const resultsKey = results.map((result) => result.id).join('\n');
  const [selectedIn, setSelectedIn] = useState(resultsKey);
  if (selectedIn !== resultsKey) {
    setSelectedIn(resultsKey);
    setActive(0);
  }
  const current = Math.min(selectedIn === resultsKey ? active : 0, results.length - 1); // -1 with no results
  const listed = results.length > 0; // the field controls a listbox only while one is drawn
  const optionId = (i: number) => `${listId}-${i}`;
  useLayoutEffect(() => {
    if (current >= 0) document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: 'nearest' });
  }, [current, resultsKey, listId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return; // an input method's keys are its own
    if (event.key === 'Escape') {
      if (query === '') return; // nothing to clear: Esc is the host's
      event.preventDefault();
      setQuery('');
      return;
    }
    if (current < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(current + 1, results.length - 1) : Math.max(current - 1, 0);
      setActive(next); // revealed by the effect above
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onChoose(results[current]!);
    }
  };

  return (
    <>
      {keymap !== null && (
        <label className="mx-2 mb-2 flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-fg-muted focus-within:border-border-strong focus-within:text-fg @max-lg/settings:mx-0 @max-lg/settings:mb-1.5">
          <SearchIcon className="size-3.5 shrink-0" />
          <input
            ref={field}
            type="search"
            role="combobox"
            aria-label={INDEX.search}
            placeholder={INDEX.search}
            aria-autocomplete="list"
            aria-expanded={listed}
            aria-controls={listed ? listId : undefined}
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            maxLength={200}
            value={query}
            data-escape-clears
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-ui-sm text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      )}
      <div data-settings-index className={searching ? RESULTS_LIST : SECTIONS_LIST}>
        {!searching ? (
          children
        ) : results.length === 0 ? (
          <p role="status" className="m-0 line-clamp-2 px-2 py-1.5 text-ui-sm leading-normal text-fg-muted">
            {INDEX.noMatch}
          </p>
        ) : (
          <div role="listbox" id={listId} aria-label={INDEX.search} className="flex flex-col">
            {results.map((result, i) => (
              // the keyboard stays in the field: a press does not take it, and a click chooses
              <div
                key={result.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChoose(result)}
                className={`shrink-0 cursor-default rounded-sm px-2 py-1 text-ui-sm ${i === current ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
              >
                <div title={result.name} className="truncate text-fg">
                  {result.name}
                </div>
                <div className="truncate text-fg-muted">{result.under}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Where a chosen result lands in the body: a row (a repeating row's first item), a section's heading, a key binding's
// row, or an Org group.
export function landingOf(body: HTMLElement, target: string): HTMLElement | null {
  const [kind, name] = target.includes(':') ? [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)] : ['row', target];
  if (kind === 'section') return body.querySelector<HTMLElement>(`#${sectionHeadingId(name as SettingsSection)}`);
  if (kind === 'binding') return body.querySelector<HTMLElement>(`[data-settings-binding="${name}"]`);
  if (kind === 'org') {
    const group = ORG_GROUPS.find((id) => ORG.groups[id] === name);
    return group === undefined ? null : body.querySelector<HTMLElement>(`[data-org-group="${group}"]`);
  }
  return body.querySelector<HTMLElement>(`[data-settings-row="${name}"]`);
}

// The body's scroll that lands a row: its section's heading at the body's top where the row is then in view, else the
// row in the middle, since both cannot be. Offsets are in the body's scrolled content.
export function scrollTopToLand({ sectionTop, rowTop, rowHeight, viewHeight }: { sectionTop: number; rowTop: number; rowHeight: number; viewHeight: number }): number {
  return rowTop + rowHeight - sectionTop <= viewHeight ? sectionTop : rowTop - (viewHeight - rowHeight) / 2;
}

const MARK_MS = 1_600;
const MARK_FADE_MS = 150;
// The landed row's mark: `bg-bg-active` over its box and 8 px around it, for 1,600 ms, then cleared over 150 ms (at once
// under reduced motion). The page draws it from `data-settings-mark` (SettingsView's column), so it reaches a row of any
// kind; choosing another result takes it away at once.
export const MARK =
  '[&_[data-settings-mark=on]]:bg-bg-active [&_[data-settings-mark=on]]:shadow-[0_0_0_8px_var(--bg-active)] [&_[data-settings-mark=fading]]:shadow-[0_0_0_8px_transparent] [&_[data-settings-mark=fading]]:transition-[background-color,box-shadow] [&_[data-settings-mark=fading]]:duration-150 motion-reduce:[&_[data-settings-mark=fading]]:transition-none';

export class RowMark {
  private held: { element: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

  mark(element: HTMLElement): void {
    this.clear();
    element.dataset.settingsMark = 'on';
    const held = {
      element,
      timer: setTimeout(() => {
        element.dataset.settingsMark = 'fading';
        held.timer = setTimeout(() => this.clear(), MARK_FADE_MS);
      }, MARK_MS),
    };
    this.held = held;
  }

  clear(): void {
    if (this.held === null) return;
    clearTimeout(this.held.timer);
    delete this.held.element.dataset.settingsMark;
    this.held = null;
  }
}
