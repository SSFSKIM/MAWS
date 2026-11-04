// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 *The sidebar row*; the Decision Log's "A session
// spawned from this app leads its sidebar group until its first turn ends"): which sessions this window started still
// lead their group, and when the lead ends.
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { digest, remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { useSessions, type ListedSession } from '../stores/sessions';
import { markSpawnedHere, resetSpawnedHere, useSpawnedHere } from './spawned-here';

const LOCAL = 'local-1' as AppSessionId;
const REMOTE = addressOf(OTHER_MACHINE, 'remote-1') as AppSessionId;
const leading = () => useSpawnedHere.getState().leading;
const setDigest = (id: AppSessionId, over: Partial<SessionDigest>) => useSessions.setState({ digests: new Map([[id, digest(id, over)]]) });
const setListing = (state: string) => {
  const row: ListedSession = { ...remoteRow(OTHER_MACHINE, 'remote-1', { state }), appId: REMOTE };
  useSessions.setState({ listed: new Map([[REMOTE, row]]) });
};

afterEach(() => {
  resetSpawnedHere();
  useSessions.setState({ digests: new Map(), listed: new Map() });
});

describe('a session spawned from this window', () => {
  it('leads from its spawn until its digest says its first turn ended', () => {
    markSpawnedHere(LOCAL);
    expect(leading().has(LOCAL)).toBe(true);
    setDigest(LOCAL, { phase: 'working', turnStartedAt: '2026-11-04T10:00:00.000Z' });
    expect(leading().has(LOCAL)).toBe(true);
    setDigest(LOCAL, { phase: 'idle', lastTurnEndedAt: '2026-11-04T10:01:00.000Z' });
    expect(leading().has(LOCAL)).toBe(false);
    setDigest(LOCAL, { phase: 'working', turnStartedAt: '2026-11-04T10:02:00.000Z', lastTurnEndedAt: null });
    expect(leading().has(LOCAL), 'a later turn does not bring the lead back').toBe(false);
  });

  it('ends its lead when its process fails or exits before any turn ended', () => {
    markSpawnedHere(LOCAL);
    setDigest(LOCAL, { phase: 'failed' });
    expect(leading().has(LOCAL)).toBe(false);
    markSpawnedHere(REMOTE);
    useSessions.setState({ digests: new Map([[REMOTE, digest(REMOTE, { phase: 'exited' })]]) });
    expect(leading().has(REMOTE)).toBe(false);
  });

  it('a listed row with no record leads through idle before its turn, busy and waiting, and stops at its first rest after busy', () => {
    setListing('idle'); // listed before its engine took the brief
    markSpawnedHere(REMOTE);
    expect(leading().has(REMOTE)).toBe(true);
    setListing('busy');
    expect(leading().has(REMOTE)).toBe(true);
    setListing('waiting'); // a permission prompt inside the turn
    expect(leading().has(REMOTE)).toBe(true);
    setListing('busy');
    setListing('idle');
    expect(leading().has(REMOTE)).toBe(false);
  });

  it('a listed row that says its session ended stops leading at once', () => {
    markSpawnedHere(REMOTE);
    setListing('done');
    expect(leading().has(REMOTE)).toBe(false);
  });

  it('keeps the same set while nothing it marks changes', () => {
    markSpawnedHere(LOCAL);
    const before = leading();
    setDigest('someone-else' as AppSessionId, { phase: 'idle', lastTurnEndedAt: '2026-11-04T10:01:00.000Z' });
    expect(leading()).toBe(before);
  });
});
