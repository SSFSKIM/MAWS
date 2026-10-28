// P5 Decision Log 45: `mawsd`'s seam and O10's endpoint module agree field for field, and O2 binds no module yet.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EndpointModule as O10Module, EndpointServices } from '../endpoint/index';
import { loadEndpointModule, type DaemonServices, type EndpointModule } from './endpoint-seam';

describe('the endpoint seam', () => {
  it('DaemonServices is O10’s EndpointServices, and the two EndpointModule shapes are one', () => {
    expectTypeOf<DaemonServices>().toEqualTypeOf<EndpointServices>();
    expectTypeOf<EndpointModule>().toEqualTypeOf<O10Module>();
  });

  it('binds no module at O2', () => {
    expect(loadEndpointModule()).toBeNull();
  });
});
