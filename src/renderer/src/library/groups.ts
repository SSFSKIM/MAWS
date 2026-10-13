// The library's groups (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 14). All and Pinned group
// rows by `updatedAt` in the owner's local time: Pinned first in All, then Today, Yesterday, each of the five days
// before by its weekday, each month of the last twelve (this month included) by name, with the year when it is not
// this year, then Older. By Space shows one group per Space, by name, then No Space. Rows keep the order main answered
// (newest first); a group is present only when it has rows, but By Space can keep a Space that has none, so the owner
// sees and manages every Space.
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { GROUP_COPY } from './copy';

export interface RowGroup {
  key: string;
  title: string;
  rows: LibraryRow[];
  space?: { id: string; name: string } | null; // By Space: the group's Space, null for No Space
}

const LOCALE = 'en-US'; // the group titles sit among English copy
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const month = new Intl.DateTimeFormat(LOCALE, { month: 'long' });
const monthYear = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });

const midnight = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// Where a time falls, as a group key, its title and its rank (lower first).
function dateSlot(t: number, now: number): { key: string; title: string; rank: number } {
  // whole calendar days between the two midnights; rounding absorbs a 23- or 25-hour day at a daylight-saving change
  const days = Math.round((midnight(now) - midnight(t)) / 86_400_000);
  if (days <= 0) return { key: 'day:0', title: GROUP_COPY.today, rank: 0 };
  if (days === 1) return { key: 'day:1', title: GROUP_COPY.yesterday, rank: 1 };
  if (days <= 6) return { key: `day:${days}`, title: weekday.format(t), rank: days };
  const date = new Date(t);
  const today = new Date(now);
  const monthsAgo = today.getFullYear() * 12 + today.getMonth() - (date.getFullYear() * 12 + date.getMonth());
  if (monthsAgo <= 11) {
    const title = date.getFullYear() === today.getFullYear() ? month.format(t) : monthYear.format(t);
    return { key: `month:${date.getFullYear()}-${date.getMonth() + 1}`, title, rank: 10 + monthsAgo };
  }
  return { key: 'older', title: GROUP_COPY.older, rank: 100 };
}

export function dateGroups(rows: readonly LibraryRow[], now: number, opts: { pinnedFirst?: boolean } = {}): RowGroup[] {
  const groups = new Map<string, RowGroup & { rank: number }>();
  const add = (slot: { key: string; title: string; rank: number }, row: LibraryRow) => {
    let group = groups.get(slot.key);
    if (!group) groups.set(slot.key, (group = { ...slot, rows: [] }));
    group.rows.push(row);
  };
  for (const row of rows) {
    if (opts.pinnedFirst && row.pinned) add({ key: 'pinned', title: GROUP_COPY.pinned, rank: -1 }, row);
    else add(dateSlot(row.updatedAt, now), row);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank).map(({ key, title, rows }) => ({ key, title, rows }));
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// `includeEmpty`: every Space, with or without rows (the view unfiltered); otherwise only the Spaces the rows are in.
export function spaceGroups(rows: readonly LibraryRow[], spaces: readonly LibrarySpace[], opts: { includeEmpty: boolean }): RowGroup[] {
  const known = new Map<string, { id: string; name: string }>(spaces.map((s) => [s.id, { id: s.id, name: s.name }]));
  for (const row of rows) if (row.space && !known.has(row.space.id)) known.set(row.space.id, row.space); // the Spaces read lags the list
  const bySpace = new Map<string, LibraryRow[]>();
  const loose: LibraryRow[] = [];
  for (const row of rows) {
    if (!row.space) loose.push(row);
    else {
      const rows = bySpace.get(row.space.id);
      if (rows) rows.push(row);
      else bySpace.set(row.space.id, [row]);
    }
  }
  const groups: RowGroup[] = [...known.values()]
    .sort(byName)
    .map((space) => ({ key: `space:${space.id}`, title: space.name, rows: bySpace.get(space.id) ?? [], space }))
    .filter((group) => opts.includeEmpty || group.rows.length > 0);
  if (loose.length > 0) groups.push({ key: 'space:none', title: GROUP_COPY.noSpace, rows: loose, space: null });
  return groups;
}
