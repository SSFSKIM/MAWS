// P5 Decision Log 45: `mawsd`'s seam and O10's endpoint module agree field for field, and O10 M10 binds the module.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EndpointModule as O10Module, EndpointServices } from '../endpoint/index';
import { loadEndpointModule, type DaemonServices, type EndpointModule } from './endpoint-seam';

describe('the endpoint seam', () => {
  it('DaemonServices is O10’s EndpointServices, and the two EndpointModule shapes are one', () => {
    expectTypeOf<DaemonServices>().toEqualTypeOf<EndpointServices>();
    expectTypeOf<EndpointModule>().toEqualTypeOf<O10Module>();
  });

  it('binds O10’s endpoint module: a fresh, unstarted one for each daemon', async () => {
    const endpoint = loadEndpointModule('0123456789abcdef');
    expect(endpoint).not.toBeNull();
    expect(loadEndpointModule('0123456789abcdef')).not.toBe(endpoint);
    // Unstarted: nothing enrolled, no link, no channel, no listener, and its commands wait for the start.
    expect(endpoint.status()).toMatchObject({ enrollment: 'none', hub: { connected: false }, channels: { relayed: 0, direct: 0 }, rl10: { connected: false }, listener: { bound: false } });
    await expect(endpoint.cli('keys', [])).resolves.toEqual({ code: 3, out: 'the endpoint has not started' });
  });
});
