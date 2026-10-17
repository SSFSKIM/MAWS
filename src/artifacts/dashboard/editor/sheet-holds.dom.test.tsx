// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; E's Decision Log 48 (3)): the source sheet holds
// every snapshot it captured before it shows any of them, and keeps the hold until it closes or opens anew. Until the
// hold is in place nothing is read and nothing downloads; a capture whose hold cannot be had is never shown, saying the
// snapshot is no longer available.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatasetPage } from '../../host';
import type { DatasetDescriptor } from '../datasets';
import { SnapshotReader, type SnapshotLease } from '../snapshots';
import { SourceSheet } from './SourceSheet';
import { SourceSheetState } from './sheet';

const AT = Date.UTC(2026, 9, 17, 9, 0);
const fetched = (ref: string): DatasetDescriptor => ({
  title: 'Live sales',
  source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at: AT } },
  columns: [{ name: 'v', type: 'number' }],
  rows: 1,
  updated: { at: AT, by: { kind: 'human' } },
  state: { status: 'ok', at: AT },
});
const page: DatasetPage = { columns: [{ name: 'v', type: 'number' }], rows: [[7]], total: 1, truncated: false };
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};
afterEach(() => cleanup());

function mount() {
  const sheet = new SourceSheetState();
  const readDataset = vi.fn(async () => page);
  const downloadAsset = vi.fn(async () => ({ path: null }));
  render(<SourceSheet artifactId="dash1" sheet={sheet} reader={new SnapshotReader({ readDataset }, 'dash1')} host={{ downloadAsset }} actorName={() => 'You'} />);
  return { sheet, readDataset, downloadAsset };
}
function lease(): SnapshotLease & { resolve(): void; reject(error: Error): void; released: number } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => ((resolve = yes), (reject = no)));
  const out = { ready, resolve: () => resolve(), reject: (error: Error) => reject(error), released: 0, release: () => void (out.released += 1) };
  return out;
}

describe('the source sheet’s hold (E3)', () => {
  it('shows nothing of the snapshot until its hold is in place, then reads it', async () => {
    const m = mount();
    const held = lease();
    act(() => m.sheet.open([{ id: 'live', descriptor: fetched('assets/q1.json') }], 'live', held));
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Reading the rows…')).toBeTruthy();
    expect(m.readDataset).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: /Download/ }).hasAttribute('disabled')).toBe(true);
    held.resolve();
    await settle();
    expect(m.readDataset).toHaveBeenCalledWith('dash1', 'assets/q1.json', { format: 'json' });
    expect(within(dialog).getByRole('button', { name: /Download/ }).hasAttribute('disabled')).toBe(false);
    expect(within(dialog).queryAllByRole('row')).toHaveLength(2);
  });

  it('never shows a capture whose hold failed: the snapshot is no longer available', async () => {
    const m = mount();
    const held = lease();
    act(() => m.sheet.open([{ id: 'live', descriptor: fetched('assets/q1.json') }], 'live', held));
    held.reject(new Error('the snapshot assets/q1.json is unavailable'));
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toBe('This snapshot is no longer available; open the source again to see the current one.');
    expect(m.readDataset).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('keeps the hold until it closes, and lets the earlier one go when it opens anew', async () => {
    const m = mount();
    const first = lease();
    act(() => m.sheet.open([{ id: 'live', descriptor: fetched('assets/q1.json') }], 'live', first));
    first.resolve();
    await settle();
    expect(first.released).toBe(0);
    const second = lease();
    act(() => m.sheet.open([{ id: 'live', descriptor: fetched('assets/q2.json') }], 'live', second));
    expect(first.released).toBe(1);
    second.resolve();
    await settle();
    act(() => m.sheet.close());
    expect(second.released).toBe(1);
    first.resolve();
  });
});
