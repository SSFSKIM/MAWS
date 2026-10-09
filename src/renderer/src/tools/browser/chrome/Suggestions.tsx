// E4a (Task 3.3): the address field's suggestion list (Design §4 "Address field"): a plain listbox in the chrome's own
// DOM under the field, the combobox's popup (the field keeps the keyboard and names the highlighted row through
// `aria-activedescendant`). Page strings (a history row's title and URL) render as text. The field holds the window's
// cover while the list shows, so it draws over the page's frozen picture as an omnibox popup does. cua #90: a bookmark's
// row carries the bookmark star where a history row carries the clock.
import type { AddressRow } from './address-rows';
import { BROWSER_COPY } from '../copy';
import { BookmarkIcon, ForwardIcon, HistoryIcon, SearchIcon } from '../icons';

export const optionId = (listId: string, index: number) => `${listId}-option-${index}`;

export function Suggestions({ id, rows, highlighted, onRun }: { id: string; rows: AddressRow[]; highlighted: number; onRun(row: AddressRow): void }) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={BROWSER_COPY.addressSuggestions}
      className="absolute inset-x-0 top-full z-20 m-0 mt-1 list-none overflow-hidden rounded-md border border-border-strong bg-bg-overlay p-1 text-ui-sm text-fg shadow-(--shadow-float)"
    >
      {rows.map((row, index) => (
        <li
          key={`${row.kind}:${row.url}`}
          id={optionId(id, index)}
          role="option"
          aria-selected={index === highlighted}
          // keep the field focused: the row runs on the press, before the field would blur
          onMouseDown={(event) => {
            event.preventDefault();
            onRun(row);
          }}
          className={`flex h-7 cursor-default items-center gap-2 rounded-sm px-2 ${index === highlighted ? 'bg-bg-active' : 'hover:bg-bg-hover'}`}
        >
          <Row row={row} />
        </li>
      ))}
    </ul>
  );
}

function Row({ row }: { row: AddressRow }) {
  if (row.kind === 'search') {
    return (
      <>
        <SearchIcon className="size-3.5 text-fg-muted" />
        <span className="min-w-0 truncate">{BROWSER_COPY.searchFor(row.query)}</span>
      </>
    );
  }
  if (row.kind === 'go') {
    return (
      <>
        <ForwardIcon className="size-3.5 text-fg-muted" />
        <span className="min-w-0 truncate">{BROWSER_COPY.goTo(row.url)}</span>
      </>
    );
  }
  return (
    <>
      {row.kind === 'bookmark' ? (
        <span data-suggestion-bookmark="" role="img" aria-label={BROWSER_COPY.bookmarks.suggestion} className="contents">
          <BookmarkIcon className="size-3.5 text-fg-muted" />
        </span>
      ) : (
        <HistoryIcon className="size-3.5 text-fg-muted" />
      )}
      {row.title ? (
        <>
          <span className="max-w-[60%] shrink-0 truncate">{row.title}</span>
          <span className="min-w-0 truncate text-fg-muted">{row.url}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{row.url}</span>
      )}
    </>
  );
}
