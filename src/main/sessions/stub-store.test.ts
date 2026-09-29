import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { project, record } from '../../../test/support/builders';
import { StubStore, type StubChange } from './stub-store';

const A = 'app-a' as AppSessionId;
const clock = () => '2026-09-28T11:00:00.000Z';

function store(records = [record(A, { unread: true }), record('app-b', { archived: true })]) {
  const s = new StubStore([project('p1', 0)], records, clock);
  const changes: StubChange[] = [];
  s.onChange((c) => changes.push(c));
  return { s, changes };
}

describe('stub store (the scenario backend behind C4’s record side)', () => {
  it('lists unarchived sessions unless asked for the archived ones too, with the revision', () => {
    const { s } = store();
    expect(s.list({}).sessions.map((r) => r.appId)).toEqual([A]);
    expect(s.list({ includeArchived: true }).sessions).toHaveLength(2);
    expect(s.projectsList()).toEqual({ projects: [project('p1', 0)], revision: 0 });
    expect(s.get(A)?.appId).toBe(A);
    expect(s.get('zz' as AppSessionId)).toBeNull();
  });

  it('answers session.list for a thousand sessions from memory in under a millisecond', () => {
    const many = Array.from({ length: 1000 }, (_, i) => record(`s${i}`));
    const { s } = store(many);
    const times: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const start = performance.now();
      expect(s.list({}).sessions).toHaveLength(1000);
      times.push(performance.now() - start);
    }
    expect(times.sort((x, y) => x - y)[10]).toBeLessThan(1);
  });

  it('applies session.update patches and bumps the revision once per change', () => {
    const { s, changes } = store();
    expect(s.update(A, { pinned: true }).pinned).toBe(true);
    expect(s.update(A, { unread: false, lastSeen: { messageUuid: null, at: '2026-09-28T10:30:00Z' } })).toMatchObject({
      unread: false,
      lastSeen: { at: '2026-09-28T10:30:00Z' },
    });
    expect(s.update(A, { title: { text: 'Renamed', source: 'user' } }).title).toEqual({ text: 'Renamed', source: 'user' });
    expect(s.update(A, { title: null }).title).toEqual({ text: 'app-a', source: 'user' });
    expect(changes.map((c) => c.revision)).toEqual([1, 2, 3, 4]);
    expect(() => s.update('zz' as AppSessionId, { pinned: true })).toThrow(/unknown session/);
  });

  it('applies C4’s unread rule: a turn end marks an unseen session unread and a visible one seen', () => {
    const { s } = store([record(A)]);
    s.turnEnded(A);
    expect(s.get(A)?.unread).toBe(true);
    s.setVisible(A, true);
    expect(s.get(A)).toMatchObject({ unread: false, lastSeen: { at: '2026-09-28T11:00:00.000Z' } });
    s.turnEnded(A);
    expect(s.get(A)?.unread).toBe(false);
    s.setVisible(A, false);
    s.turnEnded(A);
    expect(s.get(A)?.unread).toBe(true);
  });

  it('adds and removes records from the timeline', () => {
    const { s, changes } = store();
    s.put(record('app-c'), 'discovered');
    s.remove(A);
    expect(s.list({}).sessions.map((r) => r.appId)).toEqual(['app-c']);
    expect(changes.at(-1)).toEqual({ kind: 'removed', appSessionId: A, revision: 2 });
  });
});
