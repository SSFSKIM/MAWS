// The endpoint module's entry (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Interfaces §F): the machine's one
// door to the outside, inside `mawsd`. Nothing outside src/endpoint/ imports anything here but this file (eslint.config.js).
import { Endpoint, type EndpointOptions } from './endpoint';
import type { DelegatedInput, EnrollmentState } from './enroll';

export type { Endpoint, EndpointOptions };
export type { DelegatedInput, EnrollmentState };
export type { EndpointModule, EndpointServices } from './services';
export type { EndpointStatus } from './status';

export function createEndpoint(options?: EndpointOptions): Endpoint {
  return new Endpoint(options);
}

/**
 * Delegated enrollment (O14's provisioning code supplies `input`; P5 Decision Log 35) of a started endpoint: its state
 * and its ref are the endpoint's, which O14's code does not carry.
 */
export function enrollDelegated(input: DelegatedInput, endpoint: Endpoint): Promise<EnrollmentState> {
  return endpoint.enrollDelegated(input);
}
