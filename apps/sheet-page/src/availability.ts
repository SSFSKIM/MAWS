// What stands in Send's place on a sheet (§P), and what the band under the bar says (frame 4; F4). `SessionSheet` is
// given, in this order: the connection's sentence when the page is not connected; the same sentence until the read of
// the model after the last snapshot has been applied (T14), so Send is never pressed on a model older than the
// connection; the door's reason when it is known and not available. And then the page's own rule for a Send held in
// storage that this window did not make (another tab's, or this one's before a reload): C3's sheet offers such a Send
// again at once, since this window will hear no answer to it, so while it is younger than 35 seconds (the door's own
// limit is 30) the page says it is being sent; after that it is offered again under the same keys, which the door makes
// the same act. The band speaks once a second has passed without a connection, so a load does not flash it.
import type { DoorState } from '@shared/ipc/schema/sheet';
import { SEND, VIEWS } from './copy';
import type { Connection } from './live';

export const BEING_SENT_MS = 35_000;
export const BAND_AFTER_MS = 1_000;

export function sendUnavailable(input: { connection: Connection; fresh: boolean; door: DoorState | null; elsewhereSince: number | null; now: number }): { text: string | null; until: number | null } {
  const { connection, fresh, door, elsewhereSince, now } = input;
  if (connection === 'unavailable') return { text: SEND.servicesDown, until: null };
  if (connection !== 'connected' || !fresh) return { text: SEND.notReachable, until: null };
  if (door?.known === true && !door.available) return { text: door.reason, until: null };
  if (elsewhereSince !== null && now - elsewhereSince < BEING_SENT_MS) return { text: SEND.beingSent, until: elsewhereSince + BEING_SENT_MS };
  return { text: null, until: null };
}

/** The band's sentence, for a connection in `state` since `since`, at `now`; null: no band. */
export function bandOf(state: Connection, since: number, now: number): string | null {
  if (state === 'connected' || state === 'unpaired' || now - since < BAND_AFTER_MS) return null;
  return state === 'unavailable' ? VIEWS.servicesDown : VIEWS.notConnected;
}
