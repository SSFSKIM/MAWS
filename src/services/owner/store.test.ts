// The owner channel's two tables (the P2-C document, §10; index migration 8): per session the lane's override, the
// watermark and the last decided launch with its resolved and observed style; per question and essential its state.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { advertisementOf, type Reservation } from '@shared/owner/draws';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import type { StoredAnswer } from './answers';
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
      desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default', observedStyle: null, styleMismatch: false, advertised: null,
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

  // The UX wave, U2b (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §A and §F): a launch's
  // advertisement, reserved before the launch is sent and bound to its id after, in one added column.
  describe('the reservation', () => {
    const reserved = (over: Partial<Reservation> = {}): Reservation => ({ launchId: null, number: 9, plugin: true, at: '2026-11-16T10:00:00.000Z', ...over });
    const raw = (run: (db: DatabaseSync) => void) => {
      const db = new DatabaseSync(join(dir.path, 'index.sqlite'));
      try {
        run(db);
      } finally {
        db.close();
      }
    };

    it('is written unbound before the send, and bound by the launch’s record; a record of no reservation binds none', () => {
      index.ownerChannel.reserveLaunch(a, reserved());
      expect(index.ownerChannel.session(a)).toMatchObject({ launchId: null, advertised: reserved() });
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l1', reserved: true }));
      expect(index.ownerChannel.session(a)).toMatchObject({ launchId: 'l1', advertised: reserved({ launchId: 'l1' }) });
      // a resume's second attempt reuses the reservation and binds it again
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l1b', reserved: true }));
      expect(index.ownerChannel.session(a)?.advertised).toEqual(reserved({ launchId: 'l1b' }));
      // a launch whose reservation could not be written binds nothing: the stored one stays another launch's
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2' }));
      expect(index.ownerChannel.session(a)).toMatchObject({ launchId: 'l2', advertised: reserved({ launchId: 'l1b' }) });
    });

    // §A, "Two slots": the reservation last bound to a launch, and at most one not yet bound, kept as the unbound one's
    // `prior`. A new reservation replaces only the unbound one; binding moves it into the bound slot.
    it('keeps the bound reservation through relaunches reserved and never accepted, as the unbound one’s prior', () => {
      index.ownerChannel.reserveLaunch(a, reserved({ number: 9 }));
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l1', reserved: true }));
      index.ownerChannel.reserveLaunch(a, reserved({ number: 8, plugin: false, at: '2026-11-16T10:01:00.000Z' })); // refused
      expect(index.ownerChannel.session(a)?.advertised).toEqual(reserved({ number: 8, plugin: false, at: '2026-11-16T10:01:00.000Z', prior: { launchId: 'l1', number: 9, plugin: true } }));
      index.ownerChannel.reserveLaunch(a, reserved({ number: null, plugin: true, at: '2026-11-16T10:02:00.000Z' })); // refused again: the prior carried forward
      expect(index.ownerChannel.session(a)).toMatchObject({ launchId: 'l1', advertised: reserved({ number: null, at: '2026-11-16T10:02:00.000Z', prior: { launchId: 'l1', number: 9, plugin: true } }) });
      // the next accepted launch binds its own: the bound slot moves, and no prior is kept
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l3', reserved: true }));
      expect(index.ownerChannel.session(a)?.advertised).toEqual(reserved({ launchId: 'l3', number: null, at: '2026-11-16T10:02:00.000Z' }));
    });

    it('a first reservation has no prior, and one that never ran is overwritten by the next with none', () => {
      index.ownerChannel.reserveLaunch(a, reserved({ number: 9 }));
      index.ownerChannel.reserveLaunch(a, reserved({ number: 8, plugin: false }));
      expect(index.ownerChannel.session(a)?.advertised).toEqual(reserved({ number: 8, plugin: false }));
    });

    it('a launch whose reservation could not be written leaves both slots as they were', () => {
      index.ownerChannel.reserveLaunch(a, reserved({ number: 9 }));
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l1', reserved: true }));
      index.ownerChannel.reserveLaunch(a, reserved({ number: 8 }));
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l2' })); // its own write failed: it sent 8 or nothing
      expect(index.ownerChannel.session(a)).toMatchObject({ launchId: 'l2', advertised: reserved({ number: 8, prior: { launchId: 'l1', number: 9, plugin: true } }) });
    });

    it('refuses a session the index has no record of', () => {
      expect(() => index.ownerChannel.reserveLaunch('nobody' as AppSessionId, reserved())).toThrow(/unknown app session: nobody/);
    });

    it('reads a value that does not parse as no reservation', () => {
      index.ownerChannel.reserveLaunch(a, reserved());
      for (const value of [
        '{"launchId":null,"number":10,"plugin":true,"at":"x"}', 'not json', '{"number":9}', '[]',
        '{"launchId":null,"number":9,"plugin":true,"at":"x","prior":{"launchId":null,"number":9,"plugin":true}}', // a prior is a bound slot
        '{"launchId":null,"number":9,"plugin":true,"at":"x","prior":{"launchId":"l1","number":7,"plugin":true}}',
        '{"launchId":"l2","number":9,"plugin":true,"at":"x","prior":{"launchId":"l1","number":9,"plugin":true}}', // a bound reservation has none
      ]) {
        raw((db) => db.prepare('UPDATE owner_channel_sessions SET advertised = ? WHERE app_session_id = ?').run(value, a));
        expect(index.ownerChannel.session(a)?.advertised, value).toBeNull();
      }
    });

    // §F: build F and the installed build read the row with SELECT * by column name and write the columns they name
    it('survives an earlier build’s launch, which leaves the column as it was; the advertisement is then read from desired', () => {
      index.ownerChannel.recordLaunch(a, launch({ launchId: 'l1', desired: 'external-style-plus-supplement', applied: 'external-style-plus-supplement' }));
      index.ownerChannel.reserveLaunch(a, reserved({ number: 9 })); // this build reserved a launch and never bound it (it never ran)
      raw((db) =>
        db.prepare("UPDATE owner_channel_sessions SET launch_id = ?, launched_at = ?, desired = ?, recorded = ?, appended = ?, snapshot_off = ?, off_unavailable = ?, applied = ?, style = ? WHERE app_session_id = ?")
          .run('l-earlier', '2026-11-16T11:00:00.000Z', 'external-style-plus-supplement', 'supplement:3', 1, 0, 0, 'external-style-plus-supplement', 'doperpowers:to-human', a),
      );
      const row = index.ownerChannel.session(a)!;
      expect(row).toMatchObject({ launchId: 'l-earlier', advertised: reserved({ number: 9 }) });
      expect(advertisementOf(row, 'l-earlier')).toEqual({ known: true, number: 8, plugin: null });
      // and the earlier build's lane-off launch reads as no advertisement
      raw((db) => db.prepare("UPDATE owner_channel_sessions SET launch_id = 'l-off', desired = 'off' WHERE app_session_id = ?").run(a));
      expect(advertisementOf(index.ownerChannel.session(a), 'l-off')).toEqual({ known: true, number: null, plugin: null });
    });
  });

  // §M, "The switch": one fact of this machine in the index's own facts, `toHuman.foldSummaries`, `off` or absent
  describe('the summaries’ switch', () => {
    const stored = () => {
      const db = new DatabaseSync(join(dir.path, 'index.sqlite'));
      try {
        return db.prepare("SELECT value FROM index_meta WHERE key = 'toHuman.foldSummaries'").all();
      } finally {
        db.close();
      }
    };

    it('is on by default, kept as off while off and absent while on, and read again after the index reopens', () => {
      expect(index.ownerChannel.foldSummaries()).toBe(true);
      index.ownerChannel.setFoldSummaries(false);
      expect(index.ownerChannel.foldSummaries()).toBe(false);
      expect(stored()).toEqual([{ value: 'off' }]);
      index.close();
      index = new Index(join(dir.path, 'index.sqlite'));
      expect(index.ownerChannel.foldSummaries()).toBe(false);
      index.ownerChannel.setFoldSummaries(true);
      expect(index.ownerChannel.foldSummaries()).toBe(true);
      expect(stored()).toEqual([]);
    });

    it('two writes together: the later value stands', () => {
      index.ownerChannel.setFoldSummaries(false);
      index.ownerChannel.setFoldSummaries(true);
      index.ownerChannel.setFoldSummaries(false);
      expect(index.ownerChannel.foldSummaries()).toBe(false);
    });

    it('survives an earlier build’s launch, which writes no key of the index’s own facts', () => {
      index.ownerChannel.setFoldSummaries(false);
      const db = new DatabaseSync(join(dir.path, 'index.sqlite'));
      try {
        db.prepare("UPDATE owner_channel_sessions SET launch_id = 'l-earlier' WHERE app_session_id = ?").run(a);
      } finally {
        db.close();
      }
      expect(index.ownerChannel.foldSummaries()).toBe(false);
    });
  });

  describe('marks', () => {
    const mark = (over: Partial<OwnerMarkRow> = {}): OwnerMarkRow => ({
      id: `${a}:m1:0:q0`, appSessionId: a, kind: 'need-input', messageUuid: 'm1', blockIndex: 0, span: 0, grammar: 2, head: 'Which backend?', at: '2026-10-09T10:00:00.000Z',
      item: true, live: true, state: 'unanswered', answerText: null, answerOrigin: null, answerMembers: [], answeredAt: null, answerAttempts: [], readAt: null, stateChangedAt: '2026-10-09T10:00:00.000Z', ...over,
    });

    it('stores a mark once by its id, answers the session’s marks in order, and updates one', () => {
      expect(index.ownerChannel.putMark(mark())).toBe(true);
      expect(index.ownerChannel.putMark(mark({ head: 'changed' }))).toBe(false); // a replay changes nothing
      const essential = mark({ id: `${a}:m1:0:e0`, kind: 'essential', state: 'unread', head: 'Must read', at: '2026-10-09T10:00:01.000Z' });
      index.ownerChannel.putMark(essential);
      expect(index.ownerChannel.marks(a)).toEqual([mark(), essential]);
      expect(index.ownerChannel.marks(b)).toEqual([]);
      const attempts = [{ text: 'Answering "Which backend?": Postgres', origin: 'answer' as const, members: [{ kind: 'entry' as const, id: 'q-1', life: 'alive' as const }], unconfirmed: false, reportedAt: '2026-10-09T10:01:00.000Z' }];
      index.ownerChannel.updateMark(mark().id, { state: 'queued', answerAttempts: attempts, stateChangedAt: '2026-10-09T10:01:00.000Z' });
      expect(index.ownerChannel.marks(a)[0]).toEqual(mark({ state: 'queued', answerAttempts: attempts, stateChangedAt: '2026-10-09T10:01:00.000Z' }));
      // the delivered answer and a follow-up on its way, side by side
      const delivered = { answerText: 'Answering "Which backend?": SQLite', answerOrigin: 'reply' as const, answerMembers: [{ kind: 'uuid' as const, id: 'u-1', life: 'alive' as const }], answeredAt: '2026-10-09T10:02:00.000Z' };
      index.ownerChannel.updateMark(mark().id, delivered);
      expect(index.ownerChannel.mark(mark().id)).toEqual(mark({ state: 'queued', answerAttempts: attempts, ...delivered, stateChangedAt: '2026-10-09T10:01:00.000Z' }));
    });

    it('M4: reads one mark by id, the open answers across sessions, and the sessions holding marks', () => {
      const answer = (over: Partial<StoredAnswer> = {}): StoredAnswer => ({ text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [{ kind: 'uuid', id: 'u-1', life: 'alive' }], unconfirmed: false, reportedAt: '2026-10-09T10:01:00.000Z', ...over });
      const taken = answer({ members: [{ kind: 'uuid', id: 'u-0', life: 'alive' }], deliveredAt: '2026-10-09T10:01:30.000Z' });
      index.ownerChannel.putMark(mark());
      index.ownerChannel.putMark(mark({ id: `${b}:m2:0:q0`, appSessionId: b, messageUuid: 'm2', state: 'unconfirmed', answerAttempts: [answer({ unconfirmed: true })] }));
      // answered, with nothing on its way: not open
      index.ownerChannel.putMark(mark({ id: `${b}:m3:0:q0`, appSessionId: b, messageUuid: 'm3', state: 'delivered', at: '2026-10-09T10:02:00.000Z', answerAttempts: [taken] }));
      // answered by a newer answer while an older one is still on its way: open
      index.ownerChannel.putMark(mark({ id: `${b}:m4:0:q0`, appSessionId: b, messageUuid: 'm4', state: 'delivered', at: '2026-10-09T10:03:00.000Z', answerAttempts: [answer(), taken] }));
      // retired: never open
      index.ownerChannel.putMark(mark({ id: `${b}:m5:0:q0`, appSessionId: b, messageUuid: 'm5', state: 'retired', at: '2026-10-09T10:04:00.000Z', answerAttempts: [answer()] }));
      expect(index.ownerChannel.mark(mark().id)).toEqual(mark());
      expect(index.ownerChannel.mark('nothing')).toBeNull();
      expect(index.ownerChannel.openAnswers().map((m) => m.id)).toEqual([`${b}:m2:0:q0`, `${b}:m4:0:q0`]);
      index.ownerChannel.updateMark(mark().id, { state: 'queued', answerAttempts: [answer()] });
      expect(index.ownerChannel.openAnswers().map((m) => m.id)).toEqual([mark().id, `${b}:m2:0:q0`, `${b}:m4:0:q0`]);
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
