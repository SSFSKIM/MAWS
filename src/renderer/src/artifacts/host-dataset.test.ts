// P3-E (E2 M2; ledger X23): the renderer's `ArtifactHost.readDataset` is the host command `artifacts.readDataset`, the
// format always sent, the page bounds only when given.
import { describe, expect, it, vi } from 'vitest';
import { createArtifactHost } from './host';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';

describe('ArtifactHost.readDataset', () => {
  it('asks the host for a page of the snapshot in the format named', async () => {
    const page = { columns: [{ name: 'n', type: 'number' as const }], rows: [[1]], total: 1, truncated: false };
    const invoke = vi.fn(async () => ({ ok: true as const, value: page }));
    const host = createArtifactHost({ ipc: { invoke, on: () => () => {} } as never, ports: { take: () => Promise.reject(new Error('no ports')) } });
    expect(await host.readDataset(ARTIFACT, 'assets/a.csv', { format: 'csv' })).toEqual(page);
    await host.readDataset(ARTIFACT, 'assets/a.csv', { format: 'tsv', offset: 2_000, limit: 500 });
    expect(invoke.mock.calls).toEqual([
      ['artifacts.readDataset', { artifactId: ARTIFACT, ref: 'assets/a.csv', format: 'csv' }],
      ['artifacts.readDataset', { artifactId: ARTIFACT, ref: 'assets/a.csv', format: 'tsv', offset: 2_000, limit: 500 }],
    ]);
  });
});
