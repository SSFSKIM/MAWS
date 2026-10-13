// The library's groups (the P3-L execution document, M4; Decision Log 14): by `updatedAt` in the owner's local time,
// Pinned first in All, then Today, Yesterday, the five days before by weekday, the months of the last twelve (with the
// year when it is not this year), then Older; By Space one group per Space by name, then No Space.
import { describe, expect, it } from 'vitest';
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { dateGroups, spaceGroups } from './groups';

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
let n = 0;
function row(updatedAt: number, over: Partial<LibraryRow> = {}): LibraryRow {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    kind: 'document',
    title: `Row ${n}`,
    createdBy: { kind: 'human' },
    createdAt: updatedAt,
    updatedAt,
    lastViewedAt: null,
    pinned: false,
    agentEditsAsSuggestions: false,
    revision: 1,
    lastEditor: { kind: 'human' },
    lastEditedAt: updatedAt,
    sessions: [],
    ...over,
  };
}
const titles = (groups: { title: string }[]) => groups.map((g) => g.title);

describe('dateGroups', () => {
  it('splits at local midnight: 00:05 today is Today, 23:55 the night before is Yesterday', () => {
    const now = at(2026, 10, 13, 0, 10);
    const groups = dateGroups([row(at(2026, 10, 13, 0, 5)), row(at(2026, 10, 12, 23, 55))], now);
    expect(groups.map((g) => [g.title, g.rows.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 1],
    ]);
  });

  it('names the five days before yesterday by weekday, and a week ago by its month', () => {
    const now = at(2026, 10, 13, 9); // a Tuesday
    const rows = [2, 3, 4, 5, 6, 7].map((daysAgo) => row(at(2026, 10, 13 - daysAgo, 9)));
    expect(titles(dateGroups(rows, now))).toEqual(['Sunday', 'Saturday', 'Friday', 'Thursday', 'Wednesday', 'October']);
  });

  it('a week that crosses a month keeps its weekdays, and the month before is named', () => {
    const now = at(2026, 11, 2, 9); // Monday 2 November
    const rows = [row(at(2026, 10, 31, 9)), row(at(2026, 10, 27, 9)), row(at(2026, 10, 26, 9)), row(at(2026, 9, 30, 9))];
    expect(titles(dateGroups(rows, now))).toEqual(['Saturday', 'Tuesday', 'October', 'September']);
  });

  it('across a year boundary names last year’s months with their year, and anything past twelve months is Older', () => {
    const now = at(2027, 1, 3, 9);
    const rows = [row(at(2026, 12, 31, 9)), row(at(2026, 12, 20, 9)), row(at(2026, 2, 10, 9)), row(at(2026, 1, 31, 9)), row(at(2020, 5, 5))];
    expect(titles(dateGroups(rows, now))).toEqual(['Thursday', 'December 2026', 'February 2026', 'Older']);
    expect(dateGroups(rows, now).at(-1)!.rows).toHaveLength(2);
  });

  it('this year’s months carry no year', () => {
    const now = at(2026, 10, 13);
    expect(titles(dateGroups([row(at(2026, 9, 1)), row(at(2026, 1, 1)), row(at(2025, 11, 1))], now))).toEqual(['September', 'January', 'November 2025']);
  });

  it('a time ahead of the clock is Today', () => {
    const now = at(2026, 10, 13, 9);
    expect(titles(dateGroups([row(at(2026, 10, 14, 9))], now))).toEqual(['Today']);
  });

  it('puts pinned rows first in a Pinned group when asked, not again under their dates', () => {
    const now = at(2026, 10, 13, 9);
    const old = row(at(2025, 1, 1), { pinned: true });
    const today = row(at(2026, 10, 13, 8));
    const pinnedToday = row(at(2026, 10, 13, 7), { pinned: true });
    const groups = dateGroups([today, pinnedToday, old], now, { pinnedFirst: true });
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.id)])).toEqual([
      ['Pinned', [pinnedToday.id, old.id]],
      ['Today', [today.id]],
    ]);
    // without it (the Pinned view itself), the pinned rows are grouped by date
    expect(titles(dateGroups([today, pinnedToday, old], now))).toEqual(['Today', 'Older']);
  });

  it('keeps each group’s rows in the order given (main’s, newest first) and the groups in time order', () => {
    const now = at(2026, 10, 13, 9);
    const a = row(at(2026, 10, 13, 8));
    const b = row(at(2026, 10, 12, 8));
    const c = row(at(2026, 10, 13, 7));
    const groups = dateGroups([a, b, c], now);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.id)])).toEqual([
      ['Today', [a.id, c.id]],
      ['Yesterday', [b.id]],
    ]);
    expect(groups.map((g) => g.key)).toEqual(['day:0', 'day:1']);
  });
});

describe('spaceGroups', () => {
  const space = (id: string, name: string, count = 0): LibrarySpace => ({ id, name, createdAt: 1, count });
  const W = '00000000-0000-4000-8000-0000000000a1';
  const H = '00000000-0000-4000-8000-0000000000a2';
  const spaces = [space(W, 'work', 1), space(H, 'Home', 0)];

  it('one group per Space by name (case-insensitively), then No Space, each with its rows', () => {
    const inWork = row(1, { space: { id: W, name: 'work' } });
    const loose = row(2);
    const groups = spaceGroups([loose, inWork], spaces, { includeEmpty: true });
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.id), g.space?.id ?? null])).toEqual([
      ['Home', [], H],
      ['work', [inWork.id], W],
      ['No Space', [loose.id], null],
    ]);
  });

  it('leaves out empty Spaces under a search or a type filter, and No Space when it has nothing', () => {
    const inWork = row(1, { space: { id: W, name: 'work' } });
    expect(titles(spaceGroups([inWork], spaces, { includeEmpty: false }))).toEqual(['work']);
    expect(titles(spaceGroups([inWork], spaces, { includeEmpty: true }))).toEqual(['Home', 'work']);
  });

  it('a row whose Space the list of Spaces does not have yet still shows, under its own Space', () => {
    const fresh = row(1, { space: { id: '00000000-0000-4000-8000-0000000000a3', name: 'New' } });
    expect(titles(spaceGroups([fresh], spaces, { includeEmpty: false }))).toEqual(['New']);
  });
});
