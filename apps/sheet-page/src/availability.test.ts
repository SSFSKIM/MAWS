// What stands in Send's place on the page (§P; T14, the 35-second rule) and what the band says (frame 4; F4).
import { describe, expect, it } from 'vitest';
import { bandOf, BEING_SENT_MS, sendUnavailable } from './availability';
import { SEND, VIEWS } from './copy';

const base = { connection: 'connected' as const, fresh: true, door: { known: true as const, available: true as const }, elsewhereSince: null, now: 100_000 };

describe('Send’s place', () => {
  it('is Send itself on a fresh model, a connection that holds and a door that is available', () => {
    expect(sendUnavailable(base)).toEqual({ text: null, until: null });
    expect(sendUnavailable({ ...base, door: { known: false } })).toEqual({ text: null, until: null }); // not known until a record is read
  });

  it('says the connection’s sentence first, whatever else holds', () => {
    for (const connection of ['connecting', 'lost', 'unpaired'] as const) expect(sendUnavailable({ ...base, connection, fresh: false, door: { known: true, available: false, reason: 'no sminos' } }).text).toBe(SEND.notReachable);
    expect(sendUnavailable({ ...base, connection: 'unavailable' }).text).toBe(SEND.servicesDown);
  });

  it('says the same sentence until the read after the snapshot has been applied, then the door’s reason', () => {
    expect(sendUnavailable({ ...base, fresh: false }).text).toBe(SEND.notReachable);
    expect(sendUnavailable({ ...base, door: { known: true, available: false, reason: 'sminos was not found on this Mac.' } }).text).toBe('sminos was not found on this Mac.');
  });

  it('says a Send of another window is being sent while it is younger than 35 seconds, and stands aside after', () => {
    expect(sendUnavailable({ ...base, elsewhereSince: base.now - 1_000 })).toEqual({ text: SEND.beingSent, until: base.now - 1_000 + BEING_SENT_MS });
    expect(sendUnavailable({ ...base, elsewhereSince: base.now - BEING_SENT_MS })).toEqual({ text: null, until: null });
    expect(BEING_SENT_MS).toBe(35_000);
  });
});

describe('the band', () => {
  it('says nothing while connected or unpaired, and nothing in the first second', () => {
    expect(bandOf('connected', 0, 5_000)).toBeNull();
    expect(bandOf('unpaired', 0, 5_000)).toBeNull();
    expect(bandOf('lost', 1_000, 1_999)).toBeNull();
  });

  it('says MAWS is not reachable once a second has passed without a connection, and the services’ sentence when they are down', () => {
    expect(bandOf('lost', 1_000, 2_000)).toBe(VIEWS.notConnected);
    expect(bandOf('connecting', 0, 1_000)).toBe(VIEWS.notConnected);
    expect(bandOf('unavailable', 0, 1_000)).toBe(VIEWS.servicesDown);
  });
});
