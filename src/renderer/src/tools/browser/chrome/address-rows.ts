// E4a (Task 3.3): the address field's suggestion rows (E4a execution document, Design §4 "Address field" and §14), pure.
// The typed address comes first and is what Enter runs by default, as in Chrome's and Codex's omnibox: "Go to <url>"
// when the text reads as an address, with "Search for" it second, else "Search for" alone; the partition's history rows
// follow. A refused scheme offers no row (Enter then shows the refused-scheme line). Every URL a row carries is the
// parsed form `validateBrowserUrl` answers (Decision Log 34), so no history string reaches main unchecked.
import { resolveAddress, validateBrowserUrl } from '@shared/browser/url';

export type AddressRow =
  | { kind: 'go'; url: string }
  | { kind: 'search'; url: string; query: string }
  | { kind: 'history'; url: string; title: string | null };

export interface HistorySuggestion {
  url: string;
  title: string | null;
}

export function addressRows(text: string, history: readonly HistorySuggestion[], searchUrl: string): AddressRow[] {
  const typed: AddressRow[] = [];
  if (text.trim() !== '') {
    const resolved = resolveAddress(text, searchUrl);
    if (resolved.kind === 'url') {
      const query = text.trim();
      typed.push({ kind: 'go', url: resolved.url }, { kind: 'search', url: searchUrl.replaceAll('%s', encodeURIComponent(query)), query });
    } else if (resolved.kind === 'search') {
      typed.push(resolved);
    }
  }
  const shown = new Set(typed.map((row) => row.url));
  const rows = [...typed];
  for (const { url, title } of history) {
    const checked = validateBrowserUrl(url);
    if (!checked.ok || shown.has(checked.url)) continue;
    shown.add(checked.url);
    rows.push({ kind: 'history', url: checked.url, title });
  }
  return rows;
}

// The row Enter runs before an arrow moves: the typed address, or none when the list is history alone.
export const defaultRow = (rows: readonly AddressRow[]): number => (rows.length > 0 && rows[0]!.kind !== 'history' ? 0 : -1);

// An arrow's move within `length` rows, clamped at both ends; from none, down reaches the first.
export function moveRow(index: number, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (index === -1) return delta > 0 ? 0 : -1;
  return Math.min(length - 1, Math.max(0, index + delta));
}
