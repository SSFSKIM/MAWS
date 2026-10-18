// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the renderer's connector surface carries the
// trusted owner's dataset sink beside a call's or a watch's request on `connectors.call` / `connectors.watch`, never
// inside it, and a call without one sends what it sent before.
import { describe, expect, it, vi } from 'vitest';
import type { CommandName, MawsBridge } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { createConnectorHost } from './connectors';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const LEASE = '22222222-2222-4222-8222-222222222222';
const WATCH = '44444444-4444-4444-8444-444444444444';
const TOOL = { server: 'fixture', tool: 'rows' };
const META = { ok: true, result: { status: 'dataset', id: 'live', rows: 2 }, fetchedAt: 5, via: { route: 'engine' } };

function bridge() {
  const sent: { name: CommandName; input: Record<string, unknown> }[] = [];
  const answers: Partial<Record<CommandName, unknown>> = { 'connectors.open': { leaseId: LEASE }, 'connectors.call': META, 'connectors.watch': { ok: true, watchId: WATCH, intervalMs: 30_000 }, 'connectors.refresh': { refreshing: true } /* E3 panel */ };
  const ipc = {
    invoke: vi.fn(async (name: CommandName, input: Record<string, unknown>) => {
      expect(validateCommandInput(name, input).ok, `${name} ${JSON.stringify(input)}`).toBe(true);
      sent.push({ name, input });
      return { ok: true, value: answers[name] ?? { ok: true } };
    }),
    on: vi.fn(() => () => {}),
  };
  return { ipc: ipc as unknown as Pick<MawsBridge, 'invoke' | 'on'>, sent };
}

describe('the connector surface’s dataset sink', () => {
  it('sends the sink beside the request of a call and a watch, and nothing more without one', async () => {
    const b = bridge();
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    expect(await surface.callTool({ ...TOOL, args: { series: 'revenue' } }, { dataset: { id: 'live', baseRevision: 4 } })).toEqual(META);
    expect(await surface.watchTool({ ...TOOL, intervalMs: 30_000 }, () => {}, { dataset: { id: 'live' } })).toMatchObject({ ok: true });
    await surface.callTool(TOOL);
    expect(b.sent.filter(({ name }) => name !== 'connectors.open').map(({ input }) => input)).toEqual([
      { leaseId: LEASE, request: { ...TOOL, args: { series: 'revenue' } }, dataset: { id: 'live', baseRevision: 4 } },
      { leaseId: LEASE, request: { ...TOOL, intervalMs: 30_000 }, dataset: { id: 'live' } },
      { leaseId: LEASE, request: TOOL },
    ]);
  });

  // E3 panel wave (Decision Log 17): the dashboard's recovery asks a watch's liveness, never forcing a refresh
  it('sends the owner’s probe beside a watch’s refresh, and H’s forced refresh as before without it', async () => {
    const b = bridge();
    const surface = createConnectorHost(b.ipc).openConnectors(ARTIFACT);
    expect(await surface.refreshWatch(WATCH, { probe: true })).toBe(true);
    expect(await surface.refreshWatch(WATCH)).toBe(true);
    expect(b.sent.filter(({ name }) => name === 'connectors.refresh').map(({ input }) => input)).toEqual([
      { leaseId: LEASE, watchId: WATCH, probe: true },
      { leaseId: LEASE, watchId: WATCH },
    ]);
  });
});
