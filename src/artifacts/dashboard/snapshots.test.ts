// The editor's reach to a snapshot's rows (P3-E2 M3; XE5): every row of one immutable snapshot, read page by page through
// `ArtifactHost.readDataset` by ref and format, continuing at the rows each page answered; one read per snapshot while
// cached (bounded), shared by every view and the source sheet; a failed read is not kept.
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactHost, DatasetPage } from '../host';
import { SnapshotReader } from './snapshots';

const columns = [{ name: 'n', type: 'number' as const }];
/** A host holding `total` rows under `assets/a.csv`, answering at most `perPage` per page whatever the limit asked. */
function fakeHost(total: number, perPage: number) {
  const readDataset = vi.fn(async (artifactId: string, ref: string, options: { format: string; offset?: number; limit?: number }): Promise<DatasetPage> => {
    if (artifactId !== 'd1' || ref !== 'assets/a.csv') throw new Error('notFound');
    const offset = options.offset ?? 0;
    const count = Math.min(perPage, options.limit ?? 2_000, total - offset);
    const base = options.format === 'tsv' ? 1_000_000 : 0;
    return { columns, rows: Array.from({ length: Math.max(0, count) }, (_, i) => [base + offset + i]), total, truncated: offset + count < total };
  });
  return { host: { readDataset } as unknown as Pick<ArtifactHost, 'readDataset'>, readDataset };
}

describe('SnapshotReader', () => {
  it('reads every row, continuing at the rows each short page answered', async () => {
    const { host, readDataset } = fakeHost(4_500, 1_300);
    const table = await new SnapshotReader(host, 'd1').read({ ref: 'assets/a.csv', format: 'csv' });
    expect(table.columns).toEqual(columns);
    expect(table.rows).toHaveLength(4_500);
    expect(table.rows.at(-1)).toEqual([4_499]);
    expect(readDataset.mock.calls.map(([, , options]) => options.offset ?? 0)).toEqual([0, 1_300, 2_600, 3_900]);
  });

  it('reads one snapshot once while cached, concurrent readers included, and keys it by ref and format', async () => {
    const { host, readDataset } = fakeHost(10, 2_000);
    const reader = new SnapshotReader(host, 'd1');
    const [a, b] = await Promise.all([reader.read({ ref: 'assets/a.csv', format: 'csv' }), reader.read({ ref: 'assets/a.csv', format: 'csv' })]);
    expect(a).toBe(b);
    await reader.read({ ref: 'assets/a.csv', format: 'csv' });
    expect(readDataset).toHaveBeenCalledTimes(1);
    const tsv = await reader.read({ ref: 'assets/a.csv', format: 'tsv' });
    expect(tsv.rows[0]).toEqual([1_000_000]);
    expect(readDataset).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently read snapshot past its bound, and keeps no failed read', async () => {
    const { host, readDataset } = fakeHost(3, 2_000);
    const reader = new SnapshotReader(host, 'd1', 1);
    await reader.read({ ref: 'assets/a.csv', format: 'csv' });
    await reader.read({ ref: 'assets/a.csv', format: 'tsv' });
    await reader.read({ ref: 'assets/a.csv', format: 'csv' });
    expect(readDataset).toHaveBeenCalledTimes(3);
    await expect(reader.read({ ref: 'assets/gone.csv', format: 'csv' })).rejects.toThrow('notFound');
    await expect(reader.read({ ref: 'assets/gone.csv', format: 'csv' })).rejects.toThrow('notFound');
    expect(readDataset).toHaveBeenCalledTimes(5);
  });

  it('refuses a page that answers no row before the snapshot\'s end, rather than asking forever', async () => {
    const readDataset = vi.fn(async (): Promise<DatasetPage> => ({ columns, rows: [], total: 5, truncated: true }));
    await expect(new SnapshotReader({ readDataset } as never, 'd1').read({ ref: 'assets/a.csv', format: 'csv' })).rejects.toThrow(/no rows at 0 of 5/);
  });
});
