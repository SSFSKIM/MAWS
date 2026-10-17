// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; the ledger's E3 hold-IPC row): the renderer's
// `ArtifactHost.holdDatasets` is main's `artifacts.holdDatasets`, all or none over the refs named, and its release
// main's `artifacts.releaseDatasets` with the window's handle, sent once however often it is called.
import { describe, expect, it, vi } from 'vitest';
import { createArtifactHost } from './host';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const HOLD = '22222222-2222-4222-8222-222222222222';

describe('ArtifactHost.holdDatasets', () => {
  it('asks main for one hold over the refs, and releases its handle once', async () => {
    const invoke = vi.fn(async (name: string) => ({ ok: true as const, value: name === 'artifacts.holdDatasets' ? { holdId: HOLD } : { released: true } }));
    const host = createArtifactHost({ ipc: { invoke, on: () => () => {} } as never, ports: { take: () => Promise.reject(new Error('no ports')) } });
    const hold = await host.holdDatasets(ARTIFACT, ['assets/a.json', 'assets/b.csv']);
    hold.release();
    hold.release();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls).toEqual([
      ['artifacts.holdDatasets', { artifactId: ARTIFACT, refs: ['assets/a.json', 'assets/b.csv'] }],
      ['artifacts.releaseDatasets', { holdId: HOLD }],
    ]);
  });

  it('rejects with main’s refusal, holding nothing', async () => {
    const invoke = vi.fn(async () => ({ ok: false as const, error: { code: 'invalid_input', message: 'the snapshot assets/a.json is unavailable', issues: { reason: 'notFound', data: { snapshotUnavailable: true } } } }));
    const host = createArtifactHost({ ipc: { invoke, on: () => () => {} } as never, ports: { take: () => Promise.reject(new Error('no ports')) } });
    await expect(host.holdDatasets(ARTIFACT, ['assets/a.json'])).rejects.toThrow(/unavailable/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
