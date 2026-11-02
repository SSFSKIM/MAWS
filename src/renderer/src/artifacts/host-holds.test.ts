// E3 M1 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b; the ledger's E3 hold-IPC row): the renderer's
// `ArtifactHost.holdDatasets` is main's `artifacts.holdDatasets`, all or none over the refs named, and its release
// main's `artifacts.releaseDatasets` with the window's handle, sent once however often it is called.
import { describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createArtifactHost } from './host';
import { recordArtifactMachine, resetArtifactMachines } from './machines';

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

// E3 M1 fix wave (task review finding 6; the architect's ruling on `invalidated`): a window's hold is backed by the engine
// host's, which a host restart takes away. The window hears it as `artifacts.resync` (main's, each time the host's
// connection streams again): every hold taken before it is invalidated, one asked for across it is invalidated as soon as
// it is answered, and a released hold stops listening.
function resyncing() {
  const listeners = new Set<(payload: unknown, from: { machine: MachineRef }) => void>();
  let answer: (() => void) | null = null;
  const invoke = vi.fn(async (name: string) => {
    if (name === 'artifacts.holdDatasets' && answer === null) {
      await new Promise<void>((resolve) => (answer = resolve));
    }
    return { ok: true as const, value: name === 'artifacts.holdDatasets' ? { holdId: HOLD } : { released: true } };
  });
  const on = vi.fn((name: string, listener: (payload: unknown, from: { machine: MachineRef }) => void) => {
    if (name !== 'artifacts.resync') return () => {};
    listeners.add(listener);
    return () => void listeners.delete(listener);
  });
  const host = createArtifactHost({ ipc: { invoke, on, localMachine: TEST_MACHINE } as never, ports: { take: () => Promise.reject(new Error('no ports')) } });
  return { host, resync: (machine: MachineRef = TEST_MACHINE) => [...listeners].forEach((listener) => listener({}, { machine })), answerNow: () => (answer ? answer() : (answer = () => {})) };
}
const settled = async (promise: Promise<void>) => {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

describe('ArtifactHost.holdDatasets across a host restart (E3)', () => {
  it('invalidates every hold taken before a resync, and none taken after it', async () => {
    const r = resyncing();
    r.answerNow();
    const before = await r.host.holdDatasets(ARTIFACT, ['assets/a.json']);
    expect(await settled(before.invalidated)).toBe(false);
    r.resync();
    expect(await settled(before.invalidated)).toBe(true);
    const after = await r.host.holdDatasets(ARTIFACT, ['assets/a.json']);
    expect(await settled(after.invalidated)).toBe(false);
  });

  it('a hold asked for across a resync is invalidated as soon as it is answered', async () => {
    const r = resyncing();
    const asking = r.host.holdDatasets(ARTIFACT, ['assets/a.json']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.resync(); // the host restarted while main was asking it
    r.answerNow();
    expect(await settled((await asking).invalidated)).toBe(true);
  });

  it('a released hold stops listening: a later resync does not invalidate it', async () => {
    const r = resyncing();
    r.answerNow();
    const hold = await r.host.holdDatasets(ARTIFACT, ['assets/a.json']);
    hold.release();
    r.resync();
    expect(await settled(hold.invalidated)).toBe(false);
  });
});

// P5 O7 M5a (M5a-b's report, "Scope every artifacts.resync listener by from.machine"): a machine's artifacts feed says
// `artifacts.resync` at each opening; a hold is invalidated by its own machine's resync alone.
describe('ArtifactHost.holdDatasets and another machine’s resync (P5 O7 M5a)', () => {
  it('keeps this Mac’s hold through another machine’s resync, and drops it at this Mac’s', async () => {
    const { host, resync, answerNow } = resyncing();
    answerNow();
    const hold = await host.holdDatasets(ARTIFACT, ['assets/a.json']);
    resync(OTHER_MACHINE);
    expect(await settled(hold.invalidated)).toBe(false);
    resync(TEST_MACHINE);
    expect(await settled(hold.invalidated)).toBe(true);
  });

  it('drops another machine’s artifact’s hold at that machine’s resync, not at this Mac’s', async () => {
    recordArtifactMachine(ARTIFACT, OTHER_MACHINE, TEST_MACHINE);
    const { host, resync, answerNow } = resyncing();
    answerNow();
    const hold = await host.holdDatasets(ARTIFACT, ['assets/a.json']);
    resync(TEST_MACHINE);
    expect(await settled(hold.invalidated)).toBe(false);
    resync(OTHER_MACHINE);
    expect(await settled(hold.invalidated)).toBe(true);
    resetArtifactMachines();
  });
});
