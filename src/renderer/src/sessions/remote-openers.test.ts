import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { useSessions, type ListedSession } from '../stores/sessions';
import { openListed, registerRemoteOpener, remoteOpenerFor } from './remote-openers';

// P5 O8 M2: a lane's opener, registered by the lane's owner.
describe('remote openers', () => {
  it('answers each lane’s registered opener, none before one registers, and none after it unregisters', () => {
    expect(remoteOpenerFor('A')).toBeNull();
    const openB = vi.fn();
    const off = registerRemoteOpener('B', openB);
    expect(remoteOpenerFor('B')).toBe(openB);
    expect(remoteOpenerFor('A')).toBeNull();
    off();
    expect(remoteOpenerFor('B')).toBeNull();
  });

  it('a later registration replaces the earlier, whose unregister then leaves the later in place', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerRemoteOpener('A', first);
    const offSecond = registerRemoteOpener('A', second);
    offFirst();
    expect(remoteOpenerFor('A')).toBe(second);
    offSecond();
    expect(remoteOpenerFor('A')).toBeNull();
  });

  // UX wave U7, O-38 and ticket 559: the new-tab request reaches the lane's opener
  describe('openListed', () => {
    const studio = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;
    const listing: ListedSession = { ...remoteRow(OTHER_MACHINE, 'b1'), appId: studio('b1') };
    afterEach(() => useSessions.setState({ listed: new Map() }));

    it('passes the request to the listed session’s lane opener, and answers false for an address not listed or a lane with none', () => {
      useSessions.setState({ listed: new Map([[listing.appId, listing]]) });
      expect(openListed(listing.appId, { newTab: true })).toBe(false); // lane B has no opener yet
      const open = vi.fn();
      const off = registerRemoteOpener('B', open);
      expect(openListed(studio('b2'), { newTab: true })).toBe(false);
      expect(openListed(listing.appId)).toBe(true);
      expect(openListed(listing.appId, { newTab: true })).toBe(true);
      expect(open.mock.calls).toEqual([[listing, undefined], [listing, { newTab: true }]]);
      off();
    });
  });
});
