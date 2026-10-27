// The app's Registry socket (OX8; O11 M7), `/api/registry/socket?app=1`: DX3's grid first, as desk-web reads it, then
// the org state's head version (`state {version}`, when the hub holds a state) and every listing the hub holds
// (`listings {records, last}` pages, the last marked), then a `state` notice at each accepted state and a
// `listing {record}` as each is stored, a withdrawn one (`LISTING_GONE`) dropping its session. The app fetches the state itself (`GET /api/org/state?since=<held>`) and
// verifies every listing against it; the hub only relays them.
import { REGISTRY_APP_PARAM, type ListingsFrame } from '../src/app-hub.ts';
import type { ListingFrame } from '../src/relay.ts';
import { isListingGone, type Listing, type Signed } from '../src/types.ts';
import { JsonSocket, openSocket, socketUrl, type Frame, type Headers } from './socket.ts';

export const REGISTRY_SOCKET_PATH = `/api/registry/socket?${REGISTRY_APP_PARAM}=1`;

/** A listing's key: one per machine (ref) and session. */
export const listingKey = (record: Signed<Listing>) => `${record.body.machine}/${record.body.session}`;

export class RegistrySocket extends JsonSocket {
  /** The head's version as last noticed; null until a `state` frame came (the hub holds no state yet, or has not said). */
  version: number | null = null;
  /** Every listing received, the newest revision per machine and session, but for a session withdrawn since. */
  readonly listings = new Map<string, Signed<Listing>>();
  /** Whether the last `listings` page came (the socket's opening frames are all in). */
  ready = false;

  /** Opens the socket and resolves once its opening frames are in (`readyMs` at most, the upgrade included; a socket
   * that times out is closed). */
  static async open(base: string, headers: Headers, readyMs = 10_000): Promise<RegistrySocket> {
    const deadline = Date.now() + readyMs;
    const socket = new RegistrySocket(await openSocket(socketUrl(base, REGISTRY_SOCKET_PATH), headers, 'Registry', readyMs));
    await socket.untilReady((f) => f.t === 'listings' && f.last === true, 'the last listings page', deadline - Date.now());
    return socket;
  }

  protected override received(frame: Frame): void {
    super.received(frame);
    if (frame.t === 'state' && typeof frame.version === 'number') this.version = frame.version;
    if (frame.t === 'listings') {
      const page = frame as unknown as ListingsFrame;
      for (const record of page.records) this.keep(record);
      if (page.last) this.ready = true;
    }
    if (frame.t === 'listing') this.keep((frame as unknown as ListingFrame).record);
  }

  private keep(record: Signed<Listing>): void {
    const key = listingKey(record);
    const held = this.listings.get(key);
    if (held && held.body.revision >= record.body.revision) return;
    if (isListingGone(record.body)) this.listings.delete(key);
    else this.listings.set(key, record);
  }
}
