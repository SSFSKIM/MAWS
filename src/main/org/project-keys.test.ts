// The key table (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §I, "The key
// table" and "`moved`"; M10's Proves): each project id gets this device's row key once, the label of one of this
// device's own rows that carries it (a declared row first, never a row linked into it, never a label another id holds),
// else `id:<id>`; ids first seen together in id order; an entry never changes. `moved` maps the key of an id that has no
// row now to the key of the project that carries the first of its last locations now, looked up where each is now.
import { describe, expect, it } from 'vitest';
import type { OrgKey } from '@shared/machine/org-key';
import { KeyTable, type Carrier, type OwnRow } from './project-keys';

const MAC = 'mac-ref-0000000000000000';
const MINI = 'mini-ref-000000000000000';
const k = (key: string) => key as OrgKey;
const own = (pid: string, id: string | null, key: string, over: Partial<OwnRow> = {}): OwnRow => ({ machine: MAC, pid, id, key: k(key), declared: true, linked: false, ...over });
const at = (machine: string, pid: string, id: string | null): Carrier => ({ machine, pid, id });

describe('the key table', () => {
  it('gives an id the label of a declared row of this device before a discovered one, and `id:` with no row here', () => {
    const t = new KeyTable(null);
    expect(t.update([at(MINI, 'q1', 'P-remote')], [own('a', 'P', 'folder:mac:a', { declared: false }), own('b', 'P', 'folder:mac:b')])).toBe(true);
    expect(t.keys()).toEqual({ P: 'folder:mac:b', 'P-remote': 'id:P-remote' });
  });

  it('keeps a key once given: unchanged after the device’s own location is removed, and when another row later carries the id', () => {
    const t = new KeyTable(null);
    t.update([], [own('a', 'P', 'remote:github.com/x/y')]);
    expect(t.keyOf('P')).toBe('remote:github.com/x/y');
    expect(t.update([at(MINI, 'q1', 'P')], [])).toBe(true); // the locations it last had move; its key does not
    expect(t.keyOf('P')).toBe('remote:github.com/x/y');
    t.update([at(MINI, 'q1', 'P')], [own('c', 'P', 'folder:mac:c')]);
    expect(t.keyOf('P')).toBe('remote:github.com/x/y');
    // the table as kept reads the same
    expect(new KeyTable(t.file()).keyOf('P')).toBe('remote:github.com/x/y');
  });

  it('never lends the label of a row linked into the id', () => {
    const t = new KeyTable(null);
    t.update([], [own('a', 'P', 'remote:github.com/x/y', { linked: true })]);
    expect(t.keyOf('P')).toBe('id:P');
  });

  it('gives two of this device’s rows with one label and two ids two keys, when the table is first filled with both present', () => {
    const t = new KeyTable(null);
    // two clones with one label: one linked into Q, the other still the repository's project P
    t.update([], [own('b', 'Q', 'remote:github.com/x/y'), own('a', 'P', 'remote:github.com/x/y')]);
    expect(t.keys()).toEqual({ P: 'remote:github.com/x/y', Q: 'id:Q' }); // in id order: P first
    // and when the second id comes later
    const later = new KeyTable(null);
    later.update([], [own('a', 'P', 'remote:github.com/x/y')]);
    later.update([], [own('a', 'P', 'remote:github.com/x/y'), own('b', 'Q', 'remote:github.com/x/y')]);
    expect(later.keys()).toEqual({ P: 'remote:github.com/x/y', Q: 'id:Q' });
  });

  it('keys no row of the machine’s own project, and tells no change when nothing moved', () => {
    const t = new KeyTable(null);
    t.update([at(MINI, 'q1', null)], [own('a', null, 'folder:mac:a')]);
    expect(t.keys()).toEqual({});
    t.update([at(MINI, 'q1', 'P')], []);
    expect(t.update([at(MINI, 'q1', 'P')], [])).toBe(false);
  });
});

describe('moved', () => {
  it('names the project that took the last location of a project that has none now', () => {
    const t = new KeyTable(null);
    const before = [at(MINI, 'q1', 'P'), at(MINI, 'q2', 'Q')];
    t.update(before, [own('a', 'P', 'folder:mac:a')]);
    expect(t.moved(before, [own('a', 'P', 'folder:mac:a')])).toEqual({});
    // both of P's locations linked into Q
    const after = [at(MINI, 'q1', 'Q'), at(MINI, 'q2', 'Q')];
    const ownAfter = [own('a', 'Q', 'folder:mac:a', { linked: true })];
    t.update(after, ownAfter);
    expect(t.moved(after, ownAfter)).toEqual({ 'folder:mac:a': 'id:Q' });
  });

  it('maps a project whose locations moved twice straight to their present project', () => {
    const t = new KeyTable(null);
    t.update([at(MINI, 'q1', 'P')], [own('a', 'P', 'folder:mac:a')]);
    t.update([at(MINI, 'q1', 'Q')], [own('a', 'Q', 'folder:mac:a', { linked: true }), own('b', 'Q', 'folder:mac:b')]);
    const now = [at(MINI, 'q1', 'R')];
    const ownNow = [own('a', 'R', 'folder:mac:a', { linked: true }), own('b', 'Q', 'folder:mac:b')];
    t.update(now, ownNow);
    expect(t.keys()).toMatchObject({ P: 'folder:mac:a', Q: 'folder:mac:b', R: 'id:R' });
    // P's last locations (mini q1, mac a) are R's now; Q still has a row
    expect(t.moved(now, ownNow)).toEqual({ 'folder:mac:a': 'id:R' });
  });

  it('maps nowhere a project that came back and was then removed', () => {
    const t = new KeyTable(null);
    t.update([], [own('a', 'P', 'folder:mac:a')]);
    t.update([], [own('a', 'Q', 'folder:mac:a', { linked: true })]); // linked into Q
    expect(t.moved([], [own('a', 'Q', 'folder:mac:a', { linked: true })])).toEqual({ 'folder:mac:a': 'id:Q' });
    t.update([], [own('a', 'P', 'folder:mac:a')]); // unlinked: P again, and P has no entry (Q's set follows its location back)
    expect(t.moved([], [own('a', 'P', 'folder:mac:a')])).toEqual({ 'id:Q': 'folder:mac:a' });
    t.update([], []); // removed: neither has a row, and no location of either is carried now
    expect(t.moved([], [])).toEqual({});
  });
});
