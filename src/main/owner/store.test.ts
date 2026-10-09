// The owner channel's two tables (the P2-C document, §10; index migration 7): per session the lane's override, the
// watermark and the last decided launch with its resolved and observed style; per question and essential its state.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { LaunchRecord, OwnerMarkRow } from './store';

const launch = (over: Partial<LaunchRecord> = {}): LaunchRecord => ({
  launchId: 'l1', at: '2026-10-09T10:00:00.000Z', laneOn: true, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default', ...over,
});

describe('OwnerChannelStore', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let a: AppSessionId;
  let b: AppSessionId;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary()).record.appId;
    b = index.sessions.upsertFromSummary(summary()).record.appId;
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('answers no row and the inherited override for a session it has never heard of', () => {
    expect(index.ownerChannel.session(a)).toBeNull();
    expect(index.ownerChannel.override(a)).toBe('inherit');
  });

  it('sets the override per session, and refuses a session the index has no record of', () => {
    index.ownerChannel.setOverride(a, 'off');
    expect(index.ownerChannel.override(a)).toBe('off');
    expect(index.ownerChannel.override(b)).toBe('inherit');
    index.ownerChannel.setOverride(a, 'inherit');
    expect(index.ownerChannel.session(a)).toMatchObject({ override: 'inherit', enabledAt: null, launchId: null, applied: null });
    expect(() => index.ownerChannel.setOverride('nobody' as AppSessionId, 'on')).toThrow(/unknown app session: nobody/);
  });

  it('a fork or side thread inherits its parent’s override at creation; an unset parent leaves the child unset', () => {
    index.ownerChannel.inheritOverride(b, a);
    expect(index.ownerChannel.session(b)).toBeNull();
    index.ownerChannel.setOverride(a, 'off');
    index.ownerChannel.inheritOverride(b, a);
    expect(index.ownerChannel.override(b)).toBe('off');
  });

  it('records a decided launch, sets the watermark at the first lane-on launch, keeps it, and clears it at a lane-off one', () => {
    index.ownerChannel.recordLaunch(a, launch());
    expect(index.ownerChannel.session(a)).toEqual({
      appSessionId: a, override: 'inherit', enabledAt: '2026-10-09T10:00:00.000Z', launchId: 'l1', launchedAt: '2026-10-09T10:00:00.000Z',
      desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default', observedStyle: null, styleMismatch: false,
    });
    index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2', at: '2026-10-09T11:00:00.000Z', recorded: 'contract:1' }));
    expect(index.ownerChannel.session(a)).toMatchObject({ enabledAt: '2026-10-09T10:00:00.000Z', launchId: 'l2', launchedAt: '2026-10-09T11:00:00.000Z', recorded: 'contract:1' });
    index.ownerChannel.recordLaunch(a, launch({ launchId: 'l3', at: '2026-10-09T12:00:00.000Z', laneOn: false, desired: 'off', recorded: 'contract:1', appended: false, snapshotOff: true, applied: 'off' }));
    expect(index.ownerChannel.session(a)).toMatchObject({ enabledAt: null, launchId: 'l3', desired: 'off', snapshotOff: true, applied: 'off' });
    index.ownerChannel.recordLaunch(a, launch({ launchId: 'l3b', at: '2026-10-09T12:30:00.000Z', laneOn: false, desired: 'off', recorded: 'contract:1', appended: false, offUnavailable: true }));
    expect(index.ownerChannel.session(a)).toMatchObject({ enabledAt: null, launchId: 'l3b', snapshotOff: false, offUnavailable: true, applied: 'maws-contract' });
    index.ownerChannel.recordLaunch(a, launch({ launchId: 'l4', at: '2026-10-09T13:00:00.000Z' }));
    expect(index.ownerChannel.session(a)?.offUnavailable).toBe(false);
    expect(index.ownerChannel.session(a)?.enabledAt).toBe('2026-10-09T13:00:00.000Z');
  });

  it('keeps the override across launches, and the observed style with its mismatch until the next observation', () => {
    index.ownerChannel.setOverride(a, 'on');
    index.ownerChannel.recordLaunch(a, launch({ style: 'doperpowers:to-human' }));
    index.ownerChannel.recordObserved(a, 'Explanatory', true);
    expect(index.ownerChannel.session(a)).toMatchObject({ override: 'on', style: 'doperpowers:to-human', observedStyle: 'Explanatory', styleMismatch: true });
    index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2', style: 'Explanatory' }));
    expect(index.ownerChannel.session(a)).toMatchObject({ style: 'Explanatory', observedStyle: 'Explanatory', styleMismatch: true });
    index.ownerChannel.recordObserved(a, 'Explanatory', false);
    expect(index.ownerChannel.session(a)).toMatchObject({ observedStyle: 'Explanatory', styleMismatch: false });
  });

  describe('marks', () => {
    const mark = (over: Partial<OwnerMarkRow> = {}): OwnerMarkRow => ({
      id: `${a}:m1:0:q0`, appSessionId: a, kind: 'need-input', messageUuid: 'm1', blockIndex: 0, span: 0, grammar: 2, head: 'Which backend?', at: '2026-10-09T10:00:00.000Z',
      item: true, live: true, state: 'unanswered', answerText: null, answerOrigin: null, answerMembers: [], answeredAt: null, readAt: null, stateChangedAt: '2026-10-09T10:00:00.000Z', ...over,
    });

    it('stores a mark once by its id, answers the session’s marks in order, and updates one', () => {
      expect(index.ownerChannel.putMark(mark())).toBe(true);
      expect(index.ownerChannel.putMark(mark({ head: 'changed' }))).toBe(false); // a replay changes nothing
      const essential = mark({ id: `${a}:m1:0:e0`, kind: 'essential', state: 'unread', head: 'Must read', at: '2026-10-09T10:00:01.000Z' });
      index.ownerChannel.putMark(essential);
      expect(index.ownerChannel.marks(a)).toEqual([mark(), essential]);
      expect(index.ownerChannel.marks(b)).toEqual([]);
      const members = [{ kind: 'entry' as const, id: 'q-1', life: 'alive' as const }];
      index.ownerChannel.updateMark(mark().id, { state: 'queued', answerText: 'Answering "Which backend?": Postgres', answerOrigin: 'answer', answerMembers: members, stateChangedAt: '2026-10-09T10:01:00.000Z' });
      expect(index.ownerChannel.marks(a)[0]).toEqual(mark({ state: 'queued', answerText: 'Answering "Which backend?": Postgres', answerOrigin: 'answer', answerMembers: members, stateChangedAt: '2026-10-09T10:01:00.000Z' }));
    });

    it('M4: reads one mark by id, the open answers across sessions, and the sessions holding marks', () => {
      index.ownerChannel.putMark(mark());
      index.ownerChannel.putMark(mark({ id: `${b}:m2:0:q0`, appSessionId: b, messageUuid: 'm2', state: 'unconfirmed', answerText: 'Answering "Which backend?": Postgres', answerOrigin: 'answer' }));
      index.ownerChannel.putMark(mark({ id: `${b}:m3:0:q0`, appSessionId: b, messageUuid: 'm3', state: 'delivered', at: '2026-10-09T10:02:00.000Z' }));
      expect(index.ownerChannel.mark(mark().id)).toEqual(mark());
      expect(index.ownerChannel.mark('nothing')).toBeNull();
      expect(index.ownerChannel.openAnswers().map((m) => m.id)).toEqual([`${b}:m2:0:q0`]);
      index.ownerChannel.updateMark(mark().id, { state: 'queued' });
      expect(index.ownerChannel.openAnswers().map((m) => m.id)).toEqual([mark().id, `${b}:m2:0:q0`]);
      expect(index.ownerChannel.markedSessions()).toEqual([a, b].sort());
    });

    it('refuses a state or kind outside the table’s checks', () => {
      expect(() => index.ownerChannel.putMark(mark({ state: 'answered' as OwnerMarkRow['state'] }))).toThrow(/CHECK/);
      expect(() => index.ownerChannel.putMark(mark({ id: 'x', kind: 'insight' as OwnerMarkRow['kind'] }))).toThrow(/CHECK/);
    });

    it('goes with its session’s record, and so does the session row', () => {
      index.ownerChannel.putMark(mark());
      index.ownerChannel.setOverride(a, 'off');
      const db = new DatabaseSync(join(dir.path, 'index.sqlite'));
      try {
        db.exec('PRAGMA foreign_keys = ON');
        db.prepare('DELETE FROM sessions WHERE app_id = ?').run(a);
      } finally {
        db.close();
      }
      expect(index.ownerChannel.marks(a)).toEqual([]);
      expect(index.ownerChannel.session(a)).toBeNull();
    });
  });
});
