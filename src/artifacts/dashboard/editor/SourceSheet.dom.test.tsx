// The source sheet (P3-E2 M3; parent §2 "Views"): the descriptor as captured, the columns with their types, every row of
// the captured snapshot in a virtual table (sortable, copyable, a bounded number of rows in the page whatever the
// snapshot's size), Download through main, keyboard opening and closing, and the captured snapshot kept while the
// dataset is replaced.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DatasetPage } from '../../host';
import type { DatasetDescriptor } from '../datasets';
import { SourceSheet } from './SourceSheet';
import { SourceSheetState } from './sheet';
import { SnapshotReader } from './snapshots';

const AT = Date.UTC(2026, 9, 16, 8, 30);
const descriptor = (ref: string, rows: number, over: Partial<DatasetDescriptor> = {}): DatasetDescriptor => ({
  title: '지역별 매출',
  description: 'Monthly sales by region, from the finance export.',
  source: { kind: 'file', ref, name: 'sales.tsv', format: 'tsv', sha256: 'b'.repeat(64), size: 1_234 },
  columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number', mismatches: 2 }, { name: 'month', type: 'date' }],
  rows,
  rowKey: 'region',
  updated: { at: AT, by: { kind: 'session', appSessionId: 'app-1' as AppSessionId } },
  state: { status: 'ok', at: AT },
  ...over,
});
const BIG = 50_000;
const page = (ref: string, offset = 0, limit = 2_000): DatasetPage => {
  const total = ref === 'assets/big.tsv' ? BIG : 3;
  const base = ref === 'assets/sales-2.tsv' ? 100 : 0;
  const rows = ref === 'assets/big.tsv' ? Array.from({ length: Math.min(limit, total - offset) }, (_, i) => [`r${offset + i}`, offset + i, '2026-01-01']) : [['서울', base + 12, '2026-01-01'], ['부산', base + 7, '2026-02-01'], ['제주', null, '2026-03-01']];
  return { columns: descriptor('', 0).columns, rows, total, truncated: offset + rows.length < total };
};

let sheet: SourceSheetState;
let readDataset: ReturnType<typeof vi.fn>;
let downloadAsset: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sheet = new SourceSheetState();
  readDataset = vi.fn(async (_id: string, ref: string, options: { offset?: number; limit?: number }) => page(ref, options.offset, options.limit));
  downloadAsset = vi.fn(async () => ({ path: '/Users/owner/Downloads/sales.tsv' }));
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => cleanup());

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  }
};
function mount() {
  const reader = new SnapshotReader({ readDataset } as never, 'dash1');
  return render(<SourceSheet artifactId="dash1" sheet={sheet} reader={reader} host={{ downloadAsset } as never} actorName={() => 'Claude'} />);
}
const dialog = () => screen.getByRole('dialog');
const bodyRows = () => within(dialog()).queryAllByRole('row').filter((row) => row.getAttribute('aria-rowindex') !== '1');
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent);

describe('the source sheet', () => {
  it('shows the captured descriptor, the columns with their types, and every row of its snapshot', async () => {
    mount();
    act(() => sheet.open([{ id: 'sales', descriptor: descriptor('assets/sales.tsv', 3) }]));
    await until(() => screen.queryAllByRole('row').length > 1, 'the rows');
    expect(dialog().getAttribute('aria-label')).toBe('Source of 지역별 매출');
    expect(within(dialog()).getByText('지역별 매출 · from sales.tsv · updated 2026-10-16 08:30 UTC by Claude')).toBeTruthy();
    expect(within(dialog()).getByText('Monthly sales by region, from the finance export.')).toBeTruthy();
    expect(within(dialog()).getByText('2 of 3 values in sales are not number')).toBeTruthy();
    const columns = within(dialog()).getByRole('list', { name: 'Columns' });
    expect(within(columns).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['region text · row key', 'sales number', 'month date']);
    expect(within(dialog()).getByRole('table').getAttribute('aria-rowcount')).toBe('4');
    expect(bodyRows().map(cells)).toEqual([['서울', '12', '2026-01-01'], ['부산', '7', '2026-02-01'], ['제주', '', '2026-03-01']]);
    expect(readDataset).toHaveBeenCalledWith('dash1', 'assets/sales.tsv', { format: 'tsv' });
  });

  it('sorts by a column, ascending then descending then as written, and copies the rows in that order as TSV', async () => {
    mount();
    act(() => sheet.open([{ id: 'sales', descriptor: descriptor('assets/sales.tsv', 3) }]));
    await until(() => screen.queryAllByRole('row').length > 1, 'the rows');
    const sortBy = (name: string) => act(() => void fireEvent.click(within(dialog()).getByRole('button', { name: `Sort by ${name}` })));
    sortBy('sales');
    expect(within(dialog()).getAllByRole('columnheader')[1].getAttribute('aria-sort')).toBe('ascending');
    expect(bodyRows().map((row) => cells(row)[0])).toEqual(['부산', '서울', '제주']);
    sortBy('sales');
    expect(bodyRows().map((row) => cells(row)[0])).toEqual(['서울', '부산', '제주']); // nulls last either way
    await act(async () => void fireEvent.click(within(dialog()).getByRole('button', { name: 'Copy rows' })));
    expect(writeText).toHaveBeenCalledWith('region\tsales\tmonth\n서울\t12\t2026-01-01\n부산\t7\t2026-02-01\n제주\t\t2026-03-01\n');
    sortBy('sales');
    expect(within(dialog()).getAllByRole('columnheader')[1].getAttribute('aria-sort')).toBe('none');
    expect(bodyRows().map((row) => cells(row)[0])).toEqual(['서울', '부산', '제주']);
  });

  it('keeps a bounded number of rows in the page for 50,000 rows, and reaches the last one by scrolling', async () => {
    mount();
    act(() => sheet.open([{ id: 'big', descriptor: descriptor('assets/big.tsv', BIG) }]));
    await until(() => screen.queryAllByRole('row').length > 1, 'the rows');
    expect(readDataset).toHaveBeenCalledTimes(25); // 2,000 rows a page
    expect(bodyRows().length).toBeLessThanOrEqual(60);
    const scroller = within(dialog()).getByRole('table', { name: 'Rows' });
    scroller.scrollTop = BIG * 28;
    act(() => void fireEvent.scroll(scroller));
    expect(bodyRows().length).toBeLessThanOrEqual(60);
    expect(bodyRows().at(-1)?.getAttribute('aria-rowindex')).toBe(String(BIG + 1));
    expect(cells(bodyRows().at(-1)!)[0]).toBe(`r${BIG - 1}`);
  });

  it('downloads the captured snapshot by its ref under its own source name', async () => {
    mount();
    act(() => sheet.open([{ id: 'sales', descriptor: descriptor('assets/sales.tsv', 3) }]));
    await act(async () => void fireEvent.click(within(dialog()).getByRole('button', { name: 'Download sales.tsv' })));
    expect(downloadAsset).toHaveBeenCalledWith('dash1', 'assets/sales.tsv', { name: 'sales.tsv' });
    expect(within(dialog()).getByRole('status').textContent).toBe('Saved to sales.tsv');
    downloadAsset.mockResolvedValueOnce({ path: null });
    await act(async () => void fireEvent.click(within(dialog()).getByRole('button', { name: 'Download sales.tsv' })));
    expect(within(dialog()).getByRole('status').textContent).toBe('');
  });

  it('stays on the snapshot it opened on while the dataset is replaced, until it is opened again', async () => {
    mount();
    const first = descriptor('assets/sales.tsv', 3);
    act(() => sheet.open([{ id: 'sales', descriptor: first }]));
    await until(() => screen.queryAllByRole('row').length > 1, 'the rows');
    first.source = { ...first.source, ref: 'assets/sales-2.tsv' } as typeof first.source; // the caller's value moves on
    act(() => void fireEvent.click(within(dialog()).getByRole('button', { name: 'Sort by region' })));
    expect(bodyRows().map((row) => cells(row)[1])).toEqual(['7', '12', '']);
    expect(readDataset.mock.calls.every(([, ref]) => ref === 'assets/sales.tsv')).toBe(true);
    act(() => sheet.open([{ id: 'sales', descriptor: descriptor('assets/sales-2.tsv', 3) }]));
    await until(() => bodyRows().some((row) => cells(row)[1] === '112'), 'the replacement');
  });

  it('opens on a chosen dataset among several, and closes on Escape, giving the focus back', async () => {
    mount();
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    act(() => sheet.open([{ id: 'costs', descriptor: descriptor('assets/sales.tsv', 3, { title: 'Costs' }) }, { id: 'sales', descriptor: descriptor('assets/sales.tsv', 3) }], 'sales'));
    const picker = within(dialog()).getByRole('combobox', { name: 'Dataset' }) as HTMLSelectElement;
    expect(picker.value).toBe('sales');
    expect(dialog().contains(document.activeElement)).toBe(true);
    act(() => void fireEvent.change(picker, { target: { value: 'costs' } }));
    expect(dialog().getAttribute('aria-label')).toBe('Source of Costs');
    act(() => void fireEvent.keyDown(dialog(), { key: 'Escape' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('says so when the dashboard has no dataset', () => {
    mount();
    act(() => sheet.open([]));
    expect(within(dialog()).getByText('No data is bound to this dashboard yet. An agent binds a file with artifact_dataset.')).toBeTruthy();
  });
});
