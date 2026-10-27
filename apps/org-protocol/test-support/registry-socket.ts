// The app's Registry socket (OX8; O11 M7), `/api/registry/socket`: DX3's grid first, as desk-web reads it, then the
// org state's head version (`state {version}`, when the hub holds a state) and every listing the hub holds
// (`listings {records}`), then a `state` notice at each accepted state and a `listing {record}` as each is stored. The
// app fetches the state itself (`GET /api/org/state?since=<held>`) and verifies every listing against it; the hub only
// relays them.
import type { ListingsFrame } from '../src/app-hub.ts';
import type { ListingFrame } from '../src/relay.ts';
import type { Listing, Signed } from '../src/types.ts';
import { JsonSocket, openSocket, socketUrl, type Frame, type Headers } from './socket.ts';

export const REGISTRY_SOCKET_PATH = '/api/registry/socket';

/** A listing's key: one per machine (ref) and session. */
export const listingKey = (record: Signed<Listing>) => `${record.body.machine}/${record.body.session}`;

export class RegistrySocket extends JsonSocket {
  /** The head's version as last noticed; null until a `state` frame came (the hub holds no state yet, or has not said). */
  version: number | null = null;
  /** Every listing received, the newest revision per machine and session. */
  readonly listings = new Map<string, Signed<Listing>>();
  /** Whether the `listings` snapshot came (the socket's opening frames are all in). */
  ready = false;

  static async open(base: string, headers: Headers): Promise<RegistrySocket> {
    const socket = new RegistrySocket(await openSocket(socketUrl(base, REGISTRY_SOCKET_PATH), headers, 'Registry'));
    await socket.next((f) => f.t === 'listings', 'the listings snapshot');
    return socket;
  }

  protected override received(frame: Frame): void {
    super.received(frame);
    if (frame.t === 'state' && typeof frame.version === 'number') this.version = frame.version;
    if (frame.t === 'listings') {
      for (const record of (frame as unknown as ListingsFrame).records) this.keep(record);
      this.ready = true;
    }
    if (frame.t === 'listing') this.keep((frame as unknown as ListingFrame).record);
  }

  private keep(record: Signed<Listing>): void {
    const held = this.listings.get(listingKey(record));
    if (!held || held.body.revision < record.body.revision) this.listings.set(listingKey(record), record);
  }
}
