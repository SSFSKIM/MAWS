// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M4; decision 18; B6): ⌘K's Recent
// with nothing typed, from the window's opened list (`keymap/visits.ts`): newest first, eight at most, sessions and
// artifacts mixed, filled with the sessions most recently active; an artifact is drawn by the row `library.get` answers.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { record } from '../../../../test/support/builders';
import type { Opened } from '../keymap/visits';
import { artifactId, libraryRow } from '../test-support/remote-artifacts';
import { artifactKey, RECENT_MAX, recentRows } from './recent';

const S = (id: string) => at(id) as AppSessionId;
const session = (id: string): Opened => ({ kind: 'session', appSessionId: S(id) });
const artifact = (n: number, machine = TEST_MACHINE): Opened => ({ kind: 'artifact', artifactId: artifactId(n), machine });
// Each record's last activity is its number: s9 is the most recently active.
const records = (...ids: string[]) => new Map(ids.map((id) => [S(id), record(S(id))] as const));
const activity = (r: SessionRecord) => Number(r.appId.slice(r.appId.lastIndexOf('/') + 2));
const ids = (rows: ReturnType<typeof recentRows>['rows']) => rows.map((row) => (row.kind === 'session' ? row.record.appId : `${row.machine}:${row.row.title}`));
const ALL = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'];

describe('Recent', () => {
  it('lists what was opened, newest first, eight at most', () => {
    expect(RECENT_MAX).toBe(8);
    const opened = ['s2', 's4', 's6', 's1', 's3', 's5', 's7', 's8', 's9', 's10'].map(session);
    const { rows } = recentRows({ opened, records: records(...ALL), activity, answered: new Map() });
    expect(ids(rows)).toEqual(['s2', 's4', 's6', 's1', 's3', 's5', 's7', 's8'].map(S));
  });

  it('fills fewer than eight with the sessions most recently active, none twice, none archived, none it has no record of', () => {
    const all = records(...ALL);
    all.set(S('s10'), { ...all.get(S('s10'))!, archived: true });
    const opened = [session('s1'), session('s9'), session('s10'), session('gone')];
    const { rows } = recentRows({ opened, records: all, activity, answered: new Map() });
    // s1 and s9 as opened; then by activity s11, (s10 archived), (s9 listed already), s8 …
    expect(ids(rows)).toEqual(['s1', 's9', 's11', 's8', 's7', 's6', 's5', 's4'].map(S));
  });

  it('draws an artifact by the row its machine answered; one that no longer exists is not listed, nor one not yet answered, which is asked', () => {
    const notes = libraryRow(1, { title: 'Launch notes' });
    const there = libraryRow(3, { title: 'Field report' });
    const answered = new Map<string, LibraryRow | null>([
      [artifactKey(TEST_MACHINE, artifactId(1)), notes],
      [artifactKey(TEST_MACHINE, artifactId(2)), null], // gone
      [artifactKey(OTHER_MACHINE, artifactId(3)), there],
    ]);
    const opened = [artifact(1), artifact(2), session('s1'), artifact(3, OTHER_MACHINE), artifact(4), artifact(3)];
    const { rows, ask } = recentRows({ opened, records: records('s1'), activity, answered });
    expect(ids(rows)).toEqual([`${TEST_MACHINE}:Launch notes`, S('s1'), `${OTHER_MACHINE}:Field report`]); // the control: the same read lists the ones that exist
    expect(rows[0]).toEqual({ kind: 'artifact', artifactId: artifactId(1), machine: TEST_MACHINE, row: notes });
    expect(ask).toEqual([artifact(4), artifact(3)]); // not answered yet; the third on this Mac is another artifact than the third on the other machine
  });

  // Decision Log 16 (v): an artifact not answered yet holds its slot in the first eight; session rows are drawn at once
  it('asks for no more artifacts than slots are left, and a null answer frees its slot for the next', () => {
    const opened = [session('s1'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => artifact(n))];
    const first = recentRows({ opened, records: records(...ALL), activity, answered: new Map() });
    expect(first.ask).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => artifact(n)));
    expect(ids(first.rows)[0]).toBe(S('s1'));
    const answered = new Map([[artifactKey(TEST_MACHINE, artifactId(1)), null]]);
    expect(recentRows({ opened, records: records(...ALL), activity, answered }).ask).toEqual([2, 3, 4, 5, 6, 7, 8].map((n) => artifact(n)));
  });

  // M4's re-review: reads out hold no place from a session opened before them in age; it is drawn at once
  it('draws a session opened before artifacts not answered yet, ahead of the fill by activity', () => {
    const opened = [...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => artifact(n)), session('s1')]; // s1 is the least active
    const { rows, ask } = recentRows({ opened, records: records(...ALL), activity, answered: new Map() });
    expect(ask).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => artifact(n)));
    expect(ids(rows)).toEqual(['s1', 's11', 's10', 's9', 's8', 's7', 's6', 's5'].map(S));
  });

  it('asks only for the artifacts it could draw before the eighth row', () => {
    const opened = [...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map(session), artifact(9)];
    expect(recentRows({ opened, records: records(...ALL), activity, answered: new Map() }).ask).toEqual([]);
    const before = [artifact(9), ...opened.slice(0, 8)]; // the control: the same artifact before them is asked
    expect(recentRows({ opened: before, records: records(...ALL), activity, answered: new Map() }).ask).toEqual([artifact(9)]);
  });
});
