// OX8, the app's own hub connection (O11 M7): what the Registry socket, `/api/registry/socket`, sends beside DX3's grid.
// On connect, after the grid: the org state's head version (`state`, when the hub holds a state) and every listing the
// hub holds (`listings`); then a `state` notice at each accepted state and a `listing` as each is stored. The notice
// carries no state: the app reads `GET /api/org/state?since=<held>` and verifies what it gets (RL §5.2), and verifies
// every listing against the state it holds (RL §6.2). A `private` session's listing is never posted to the hub, so
// every listing the hub holds is one every member may see.
import type { ListingFrame, StateNotice } from './relay.ts';
import type { Listing, Signed } from './types.ts';

/** Every listing the hub holds, once, when the socket opens. */
export type ListingsFrame = { t: 'listings'; records: Signed<Listing>[] };

export type RegistryAppFrame = StateNotice | ListingsFrame | ListingFrame;
