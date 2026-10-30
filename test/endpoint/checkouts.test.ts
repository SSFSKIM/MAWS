// The checkouts authorization reads (O10 M5's CheckoutSource; P5 O3-D M4): RL10's projects' presences joined by MAWS's
// own projects, which `mawsd` injects from the spine's rows while its view is available. A test's own source replaces
// both, as before.
import { describe, expect, it } from 'vitest';
import { createEndpoint } from '../../src/endpoint';

describe('the checkouts a remote spawn may run in', () => {
  it('are RL10’s and MAWS’s own projects together', () => {
    const endpoint = createEndpoint({ projects: { known: (path) => path === '/work/maws' } });
    expect(endpoint.checkouts.known('/work/maws')).toBe(true);
    expect(endpoint.checkouts.known('/work/rl10')).toBe(false);
    endpoint.rl10.members.presence('proj', { checkouts: [{ path: '/work/rl10', branch: 'main' }] });
    expect(endpoint.checkouts.known('/work/rl10')).toBe(true);
    expect(endpoint.checkouts.known('/elsewhere')).toBe(false);
  });

  it('are RL10’s alone with no projects injected, and a test’s own source alone when it brings one', () => {
    expect(createEndpoint({}).checkouts.known('/work/maws')).toBe(false);
    const own = createEndpoint({ projects: { known: () => true }, authorization: { checkouts: { known: (path) => path === '/only' } } });
    expect(own.checkouts.known('/work/maws')).toBe(false);
    expect(own.checkouts.known('/only')).toBe(true);
  });
});
