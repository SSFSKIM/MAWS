// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 *The sidebar row*; the Decision Log's "A session
// spawned from this app leads its sidebar group until its first turn ends"): which sessions this window started still
// lead their group, and when the lead ends.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { digest, humanTurn, record, remoteRow, status } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { useSessions, type ListedSession } from '../stores/sessions';
import { LISTING_LEAD_MS, markSpawnedHere, resetSpawnedHere, useSpawnedHere } from './spawned-here';
import { useSetup } from './store';

const LOCAL = 'local-1' as AppSessionId;
const REMOTE = addressOf(OTHER_MACHINE, 'remote-1') as AppSessionId;
const leading = () => useSpawnedHere.getState().leading;
const setDigest = (id: AppSessionId, over: Partial<SessionDigest>) => useSessions.setState({ digests: new Map([[id, digest(id, over)]]) });
const setListing = (state: string, revision = 1) => {
  const row: ListedSession = { ...remoteRow(OTHER_MACHINE, 'remote-1', { state, revision }), appId: REMOTE };
  useSessions.setState({ listed: new Map([[REMOTE, row]]) });
};

afterEach(() => {
  resetSpawnedHere();
  useSessions.setState({ digests: new Map(), listed: new Map(), engine: new Map(), records: new Map() });
  useSetup.setState({ phases: new Map() });
  vi.useRealTimers();
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

  // m8-4a's task review: a lead that never sees its first turn end must still end
  it('while attached, the session’s status says when its first turn ended', () => {
    markSpawnedHere(REMOTE);
    const engine = (turn: typeof humanTurn | null) => useSessions.setState({ engine: new Map([[REMOTE, { ...status(REMOTE, { engineState: turn === null ? 'idle' : 'running', turn }), appSessionId: REMOTE }]]) });
    engine(null); // ready, before the brief
    expect(leading().has(REMOTE)).toBe(true);
    engine(humanTurn);
    expect(leading().has(REMOTE)).toBe(true);
    engine(null);
    expect(leading().has(REMOTE)).toBe(false);
  });

  it('a listing never seen busy stops leading when it is issued again still resting (a short turn between its issues)', () => {
    setListing('idle', 1);
    markSpawnedHere(REMOTE);
    setListing('idle', 1);
    expect(leading().has(REMOTE)).toBe(true);
    setListing('idle', 2);
    expect(leading().has(REMOTE)).toBe(false);
  });

  it('with nothing attached, the lead ends LISTING_LEAD_MS after the spawn, whatever its listing says', () => {
    vi.useFakeTimers();
    setListing('idle');
    markSpawnedHere(REMOTE);
    vi.advanceTimersByTime(LISTING_LEAD_MS - 1);
    expect(leading().has(REMOTE)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(leading().has(REMOTE)).toBe(false);
    expect(LISTING_LEAD_MS).toBe(3 * 60_000);
  });

  it('an attached session keeps its lead past that bound until its turn ends', () => {
    vi.useFakeTimers();
    markSpawnedHere(LOCAL);
    setDigest(LOCAL, { phase: 'working', turnStartedAt: '2026-11-04T10:00:00.000Z' });
    vi.advanceTimersByTime(LISTING_LEAD_MS + 1);
    expect(leading().has(LOCAL)).toBe(true);
  });

  it('a start that fails after the mark, or whose record is rolled back, stops leading', () => {
    markSpawnedHere(LOCAL);
    useSetup.setState({ phases: new Map([[LOCAL, { appSessionId: LOCAL, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'no', resources: { worktree: null, record: 'removed', transcript: 'none' } } }]]) });
    expect(leading().has(LOCAL)).toBe(false);
    const other = 'local-2' as AppSessionId;
    useSessions.setState({ records: new Map([[other, record(other)]]) });
    markSpawnedHere(other);
    expect(leading().has(other)).toBe(true);
    useSessions.setState({ records: new Map() }); // the provisional record removed
    expect(leading().has(other)).toBe(false);
  });

  // m8-4a's review 2 (lead-review.test.ts): an attached status that never showed a turn running does not hold the lead
  describe('an attached status that never showed a turn running', () => {
    const rested = (process: 'ready' | 'exited' = 'ready') => useSessions.setState({ engine: new Map([[REMOTE, { ...status(REMOTE, { process, engineState: 'idle', turn: null }), appSessionId: REMOTE }]]) });

    it('ends the lead when its process exits, its listing stopped', () => {
      rested();
      setListing('idle');
      markSpawnedHere(REMOTE);
      expect(leading().has(REMOTE)).toBe(true);
      rested('exited');
      setListing('stopped', 2);
      expect(leading().has(REMOTE)).toBe(false);
    });

    it('ends the lead when its process exits, whatever the listing says', () => {
      rested();
      markSpawnedHere(REMOTE);
      rested('exited');
      expect(leading().has(REMOTE)).toBe(false);
    });

    it('lets a never-busy listing issued again still idle end it (a missed short turn)', () => {
      rested();
      setListing('idle', 1);
      markSpawnedHere(REMOTE);
      setListing('idle', 2);
      expect(leading().has(REMOTE)).toBe(false);
    });

    it('lets the bound end it', () => {
      vi.useFakeTimers();
      rested();
      markSpawnedHere(REMOTE);
      vi.advanceTimersByTime(LISTING_LEAD_MS);
      expect(leading().has(REMOTE)).toBe(false);
    });

    it('while the status shows a first turn running, the lead holds past the bound', () => {
      vi.useFakeTimers();
      markSpawnedHere(REMOTE);
      useSessions.setState({ engine: new Map([[REMOTE, { ...status(REMOTE, { engineState: 'running', turn: humanTurn }), appSessionId: REMOTE }]]) });
      vi.advanceTimersByTime(2 * LISTING_LEAD_MS);
      expect(leading().has(REMOTE)).toBe(true);
    });
  });

  // m8-4a's review 2: a retry's lead is its own attempt's; the failure of the attempt before it is not
  it('a retry marked over the previous attempt’s held failure leads, and its own failure ends it', () => {
    const failed = (message: string) => ({ appSessionId: LOCAL, phase: 'failed' as const, detail: null, outcome: { kind: 'error' as const, message, resources: { worktree: null, record: 'removed' as const, transcript: 'none' as const } } });
    useSetup.setState({ phases: new Map([[LOCAL, failed('old failure')]]) });
    useSetup.getState().setInvoking(LOCAL, true);
    markSpawnedHere(LOCAL); // the retry's session.start answered starting
    useSetup.getState().setInvoking(LOCAL, false);
    expect(leading().has(LOCAL), 'a new accepted start, not the old failed attempt').toBe(true);
    useSetup.setState({ phases: new Map([[LOCAL, failed('this attempt')]]) });
    expect(leading().has(LOCAL)).toBe(false);
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
