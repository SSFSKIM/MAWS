// OX8, the app's own hub connection (O11 M7): what the Registry socket, `/api/registry/socket?app=1`, sends an app
// after DX3's grid: on connect the org state's head version (`state`, when the hub holds a state) and every listing the
// hub holds (`listings`, in pages); then a `state` notice at each accepted state and a `listing` as each is stored. The
// notice carries no state: the app reads `GET /api/org/state?since=<held>` and verifies what it gets (RL §5.2), and
// verifies every listing against the state it holds (RL §6.2). A `private` session's listing is never posted to the
// hub, so every listing the hub holds is one every member may see. A withdrawn listing (`LISTING_GONE`) is never in the
// `listings` pages; a `listing` frame may carry one, and the app drops the session it names.
import type { ListingFrame, StateNotice } from './relay.ts';
import type { Listing, Signed } from './types.ts';

/**
 * The query an app opens the Registry socket with (`/api/registry/socket?app=1`). A socket without it — desk-web's grid —
 * gets the grid alone: the listings are no use to it, and every reconnect of every phone would carry them all.
 */
export const REGISTRY_APP_PARAM = 'app';

/**
 * Every listing the hub holds, when the socket opens, in pages: each page's records come to at most
 * `LISTINGS_PAGE_BYTES` of JSON (a record larger than that goes alone), so no page needs a frame's parts unless one
 * record does, and however many listings the hub holds no frame grows with them. `last` marks the final page (an empty
 * one when the hub holds none).
 */
export type ListingsFrame = { t: 'listings'; records: Signed<Listing>[]; last: boolean };

/** The most bytes of JSON the records of one `listings` page come to, but for a page of one larger record. */
export const LISTINGS_PAGE_BYTES = 256 * 1024;

export type RegistryAppFrame = StateNotice | ListingsFrame | ListingFrame;
