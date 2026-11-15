// The grants of chosen files (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B,
// decisions 4 and 21, S10 to S12): one real path for one session, kept in a file of the profile, written whole and
// atomically before memory changes, read once when the store is opened. Every file here is under a scratch folder.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { followView, GRANTS_PER_SESSION_MAX, openFileGrants } from './grants';

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
let base: string;
let file: string;
let known: Set<string>;
let lines: string[];
let clock: number;
const open = () => openFileGrants(file, { known: (id) => known.has(id), now: () => ++clock, log: (line) => lines.push(line) });
const stored = () => JSON.parse(readFileSync(file, 'utf8')) as { version: number; sessions: Record<string, { real: string; at: number }[]> };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-grants-')));
  file = join(base, 'profile', 'sessions', 'file-grants.json');
  known = new Set([A, B]);
  lines = [];
  clock = 1000;
});
afterEach(() => {
  chmodSync(base, 0o700);
  if (existsSync(join(base, 'profile', 'sessions'))) chmodSync(join(base, 'profile', 'sessions'), 0o700);
  rmSync(base, { recursive: true, force: true });
});

describe('the grants of chosen files', () => {
  it('is the document’s bound', () => {
    expect(GRANTS_PER_SESSION_MAX).toBe(256);
  });

  it('admits a granted real path for its session alone, and nothing beside it', () => {
    const grants = open();
    grants.add(A, '/work/notes/plan.md');
    expect(grants.has(A, '/work/notes/plan.md')).toBe(true);
    expect(grants.has(B, '/work/notes/plan.md')).toBe(false);
    expect(grants.has(A, '/work/notes')).toBe(false);
    expect(grants.has(A, '/work/notes/plan.md.bak')).toBe(false);
  });

  it('writes the whole file, version 1, mode 0600, before memory, and reads it back when opened again', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    grants.add(B, '/work/b.md');
    expect(stored()).toEqual({ version: 1, sessions: { A: [{ real: '/work/a.md', at: 1001 }], B: [{ real: '/work/b.md', at: 1002 }] } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = open();
    expect(again.has(A, '/work/a.md')).toBe(true);
    expect(again.has(B, '/work/b.md')).toBe(true);
    expect(lines).toEqual([]);
  });

  it('refreshes the time of the same real path granted again, and keeps one entry for it', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    grants.add(A, '/work/b.md');
    grants.add(A, '/work/a.md');
    expect(stored().sessions.A).toEqual([{ real: '/work/b.md', at: 1002 }, { real: '/work/a.md', at: 1003 }]);
  });

  it(`drops a session’s oldest grant at its ${GRANTS_PER_SESSION_MAX + 1}th, in memory and in the file`, () => {
    const grants = open();
    for (let i = 0; i <= GRANTS_PER_SESSION_MAX; i += 1) grants.add(A, `/work/f-${i}.md`);
    expect(grants.has(A, '/work/f-0.md')).toBe(false);
    expect(grants.has(A, '/work/f-1.md')).toBe(true);
    expect(grants.has(A, `/work/f-${GRANTS_PER_SESSION_MAX}.md`)).toBe(true);
    expect(stored().sessions.A).toHaveLength(GRANTS_PER_SESSION_MAX);
    expect(open().has(A, '/work/f-0.md')).toBe(false);
  });

  it('refuses an add for a session the view does not know, and writes nothing (S12)', () => {
    const grants = open();
    expect(() => grants.add('gone' as AppSessionId, '/work/a.md')).toThrow('unknown app session: gone');
    expect(existsSync(file)).toBe(false);
    expect(grants.has('gone' as AppSessionId, '/work/a.md')).toBe(false);
  });

  it('fails an add whose file cannot be written, and memory holds no grant (S7)', () => {
    mkdirSync(join(base, 'profile', 'sessions'), { recursive: true });
    chmodSync(join(base, 'profile', 'sessions'), 0o500);
    const grants = open();
    expect(() => grants.add(A, '/work/a.md')).toThrow();
    expect(grants.has(A, '/work/a.md')).toBe(false);
  });

  it('drops a removed session’s grants from memory and the file; a removal after an add drops what it wrote (S12)', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    grants.add(B, '/work/b.md');
    known.delete(A);
    grants.drop(A);
    expect(grants.has(A, '/work/a.md')).toBe(false);
    expect(stored().sessions).toEqual({ B: [{ real: '/work/b.md', at: 1002 }] });
    expect(open().has(A, '/work/a.md')).toBe(false);
  });

  it('drops in memory when the file cannot be written at a removal, logs it, never throws, and writes the next change without the session (S10)', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    grants.add(B, '/work/b.md');
    chmodSync(join(base, 'profile', 'sessions'), 0o500);
    expect(() => grants.drop(A)).not.toThrow();
    expect(grants.has(A, '/work/a.md')).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('/work/');
    chmodSync(join(base, 'profile', 'sessions'), 0o700);
    grants.add(B, '/work/c.md');
    expect(Object.keys(stored().sessions)).toEqual(['B']);
  });

  it('reconciles with the view: every session it no longer knows loses its grants, the others stand (S11)', () => {
    const first = open();
    first.add(A, '/work/a.md');
    first.add(B, '/work/b.md');
    known.delete(A); // deleted while another build ran
    const grants = open();
    expect(grants.has(A, '/work/a.md'), 'not before the view is asked').toBe(true);
    grants.reconcile();
    expect(grants.has(A, '/work/a.md')).toBe(false);
    expect(grants.has(B, '/work/b.md')).toBe(true);
    expect(stored().sessions).toEqual({ B: [{ real: '/work/b.md', at: 1002 }] });
  });

  it('reconciles without throwing when the view throws or the file cannot be written', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    const throwing = openFileGrants(file, { known: () => { throw new Error('view closed'); }, log: (line) => lines.push(line) });
    expect(() => throwing.reconcile()).not.toThrow();
    known.clear();
    chmodSync(join(base, 'profile', 'sessions'), 0o500);
    const again = open();
    expect(() => again.reconcile()).not.toThrow();
    expect(again.has(A, '/work/a.md')).toBe(false);
  });

  it('holds nothing of a file it cannot read as its own version, logs its size once and never its content, and leaves it until the next change', () => {
    mkdirSync(join(base, 'profile', 'sessions'), { recursive: true });
    const cases = ['{ not json /work/secret.md', JSON.stringify({ version: 2, sessions: { A: [{ real: '/work/a.md', at: 1 }] } }), JSON.stringify({ version: 1, sessions: [] }), '"/work/a.md"'];
    for (const text of cases) {
      writeFileSync(file, text);
      lines = [];
      const grants = open();
      expect(grants.has(A, '/work/a.md'), text).toBe(false);
      grants.reconcile();
      grants.drop(B);
      expect(readFileSync(file, 'utf8'), 'left alone').toBe(text);
      expect(lines, text).toHaveLength(1);
      expect(lines[0], text).toContain(String(Buffer.byteLength(text)));
      expect(lines[0], text).not.toContain('/work/');
    }
    open().add(A, '/work/a.md');
    expect(stored()).toEqual({ version: 1, sessions: { A: [{ real: '/work/a.md', at: expect.any(Number) }] } });
  });

  it('reads past an entry it does not take in a file of its version: one that is no absolute path, no string or no time', () => {
    mkdirSync(join(base, 'profile', 'sessions'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 1, sessions: { A: [{ real: 'relative.md', at: 1 }, { real: 7, at: 1 }, { real: '/work/kept.md', at: 2 }, { real: '/work/no-time.md' }], B: 'not a list' } }));
    const grants = open();
    expect(grants.has(A, '/work/kept.md')).toBe(true);
    expect(grants.has(A, 'relative.md')).toBe(false);
    expect(grants.has(A, '/work/no-time.md')).toBe(false);
    expect(lines).toEqual([]);
  });

  it('opens with no file and none written', () => {
    const grants = open();
    grants.reconcile();
    grants.drop(A);
    expect(existsSync(file)).toBe(false);
    expect(lines).toEqual([]);
  });

  // spine-root.ts's wiring: the view says when the store may be reconciled, and which records went
  it('follows the view: reconciles once it can be read and not before, drops a removed record’s grants, and stops', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    grants.add(B, '/work/b.md');
    known.delete(B);
    const view = fakeSpineView({ unavailable: 'the index is not read yet' });
    const stop = followView(grants, view);
    expect(grants.has(B, '/work/b.md'), 'not while the view cannot be read').toBe(true);
    view.setUnavailable(null);
    expect(grants.has(B, '/work/b.md')).toBe(false);
    expect(grants.has(A, '/work/a.md')).toBe(true);
    view.removeRecord(A);
    expect(grants.has(A, '/work/a.md')).toBe(false);
    expect(stored().sessions).toEqual({});
    grants.add(A, '/work/c.md');
    stop();
    view.removeRecord(A);
    expect(grants.has(A, '/work/c.md'), 'stopped').toBe(true);
    expect(view.listeners()).toBe(0);
  });

  it('reconciles at once over a view that can be read', () => {
    const grants = open();
    grants.add(A, '/work/a.md');
    known.delete(A);
    followView(grants, fakeSpineView())();
    expect(grants.has(A, '/work/a.md')).toBe(false);
  });
});
