// The link records of followed files (UX wave U6b-4c, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md,
// R5, Interfaces §B, X5.6, X5.7, X5.9, X4.4): one real path for one session, with the time, where the link stood and
// whether the file may be saved, kept in a file of the profile, written whole and atomically before memory changes, read
// once when the store is opened. Every file here is under a scratch folder.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { followView } from './grants';
import { LINKS_PER_SESSION_MAX, openFileLinks } from './links';

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const GUIDE = { file: '/work/docs/guide.md' };
const AGENT = { agent: 'a1b2c3' };
let base: string;
let file: string;
let known: Set<string>;
let lines: string[];
let clock: number;
const open = () => openFileLinks(file, { known: (id) => known.has(id), now: () => ++clock, log: (line) => lines.push(line) });
type Stored = { version: number; sessions: Record<string, { real: string; at: number; from?: unknown; why?: string }[]> };
const stored = () => JSON.parse(readFileSync(file, 'utf8')) as Stored;
const sessionsDir = () => join(base, 'profile', 'sessions');

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'maws-links-')));
  file = join(sessionsDir(), 'file-links.json');
  known = new Set([A, B]);
  lines = [];
  clock = 1000;
});
afterEach(() => {
  chmodSync(base, 0o700);
  if (existsSync(sessionsDir())) chmodSync(sessionsDir(), 0o700);
  rmSync(base, { recursive: true, force: true });
});

describe('the link records of followed files', () => {
  it('is the document’s bound', () => {
    expect(LINKS_PER_SESSION_MAX).toBe(256);
  });

  it('answers a recorded real path for its session alone, with its why, and nothing beside it', () => {
    const links = open();
    links.add(A, '/work/out/notes.txt', GUIDE);
    links.add(A, '/work/out/result.txt', AGENT, 'result');
    links.add(A, '/work/out/linked.txt', GUIDE, 'linked');
    expect(links.get(A, '/work/out/notes.txt')).toEqual({ why: null });
    expect(links.get(A, '/work/out/result.txt')).toEqual({ why: 'result' });
    expect(links.get(A, '/work/out/linked.txt')).toEqual({ why: 'linked' });
    expect(links.get(B, '/work/out/notes.txt')).toBeNull();
    expect(links.get(A, '/work/out')).toBeNull();
    expect(links.get(A, '/work/out/notes.txt.bak')).toBeNull();
  });

  it('writes the whole file, version 1, mode 0600, with where each link stood, before memory, and reads it back when opened again (X1.6)', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    links.add(B, '/work/out/b.txt', AGENT, 'result');
    expect(stored()).toEqual({
      version: 1,
      sessions: { A: [{ real: '/work/out/a.txt', at: 1001, from: GUIDE }], B: [{ real: '/work/out/b.txt', at: 1002, from: AGENT, why: 'result' }] },
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = open();
    expect(again.get(A, '/work/out/a.txt')).toEqual({ why: null });
    expect(again.get(B, '/work/out/b.txt')).toEqual({ why: 'result' });
    expect(lines).toEqual([]);
  });

  it('makes a path followed again the newest, and keeps one entry for it', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    links.add(A, '/work/out/b.txt', GUIDE);
    links.add(A, '/work/out/a.txt', { file: '/work/docs/other.md' });
    expect(stored().sessions.A).toEqual([
      { real: '/work/out/b.txt', at: 1002, from: GUIDE },
      { real: '/work/out/a.txt', at: 1003, from: { file: '/work/docs/other.md' } },
    ]);
  });

  // R4's third point, X4.4: a record is raised by a follow that finds more and never lowered by one that finds less, and
  // its `from` is always the source of the strength it has
  it('never lowers a record that admits a save: a follow that finds less makes it the newest and keeps its from; a read-only one is raised', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    links.add(A, '/work/out/b.txt', GUIDE);
    links.add(A, '/work/out/a.txt', AGENT, 'result');
    expect(links.get(A, '/work/out/a.txt')).toEqual({ why: null });
    expect(stored().sessions.A).toEqual([
      { real: '/work/out/b.txt', at: 1002, from: GUIDE },
      { real: '/work/out/a.txt', at: 1003, from: GUIDE },
    ]);
    links.add(A, '/work/out/c.txt', AGENT, 'result');
    links.add(A, '/work/out/c.txt', GUIDE);
    expect(links.get(A, '/work/out/c.txt')).toEqual({ why: null });
    expect(stored().sessions.A!.at(-1)).toEqual({ real: '/work/out/c.txt', at: 1005, from: GUIDE });
  });

  it(`drops a session’s oldest record at its ${LINKS_PER_SESSION_MAX + 1}th, in memory and in the file (X5.6)`, () => {
    const links = open();
    for (let i = 0; i <= LINKS_PER_SESSION_MAX; i += 1) links.add(A, `/work/out/f-${i}.txt`, GUIDE);
    expect(links.get(A, '/work/out/f-0.txt')).toBeNull();
    expect(links.get(A, '/work/out/f-1.txt')).toEqual({ why: null });
    expect(links.get(A, `/work/out/f-${LINKS_PER_SESSION_MAX}.txt`)).toEqual({ why: null });
    expect(stored().sessions.A).toHaveLength(LINKS_PER_SESSION_MAX);
    expect(open().get(A, '/work/out/f-0.txt')).toBeNull();
    expect(open().get(A, '/work/out/f-1.txt')).toEqual({ why: null });
  });

  it('refuses an add for a session the view does not know, and writes nothing (W2 b)', () => {
    const links = open();
    expect(() => links.add('gone' as AppSessionId, '/work/out/a.txt', GUIDE)).toThrow('unknown app session: gone');
    expect(existsSync(file)).toBe(false);
    expect(links.get('gone' as AppSessionId, '/work/out/a.txt')).toBeNull();
    links.add(A, '/work/out/a.txt', GUIDE); // the control: a known session's add is written
    expect(existsSync(file)).toBe(true);
  });

  it('fails an add whose file cannot be written, and memory holds no record (X5.9)', () => {
    mkdirSync(sessionsDir(), { recursive: true });
    chmodSync(sessionsDir(), 0o500);
    const links = open();
    expect(() => links.add(A, '/work/out/a.txt', GUIDE)).toThrow();
    expect(links.get(A, '/work/out/a.txt')).toBeNull();
    chmodSync(sessionsDir(), 0o700);
    links.add(A, '/work/out/a.txt', GUIDE); // the control: the same add once the folder can be written
    expect(links.get(A, '/work/out/a.txt')).toEqual({ why: null });
  });

  it('drops a removed session’s records from memory and the file (X5.6, K9)', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    links.add(B, '/work/out/b.txt', GUIDE);
    known.delete(A);
    links.drop(A);
    expect(links.get(A, '/work/out/a.txt')).toBeNull();
    expect(links.get(B, '/work/out/b.txt')).toEqual({ why: null });
    expect(stored().sessions).toEqual({ B: [{ real: '/work/out/b.txt', at: 1002, from: GUIDE }] });
    expect(open().get(A, '/work/out/a.txt')).toBeNull();
  });

  it('drops in memory when the file cannot be written at a removal, logs it with no path, never throws, and writes the next change without the session', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    links.add(B, '/work/out/b.txt', GUIDE);
    chmodSync(sessionsDir(), 0o500);
    expect(() => links.drop(A)).not.toThrow();
    expect(links.get(A, '/work/out/a.txt')).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('/work/');
    chmodSync(sessionsDir(), 0o700);
    links.add(B, '/work/out/c.txt', GUIDE);
    expect(Object.keys(stored().sessions)).toEqual(['B']);
  });

  it('reconciles with the view: every session it no longer knows loses its records, the others stand', () => {
    const first = open();
    first.add(A, '/work/out/a.txt', GUIDE);
    first.add(B, '/work/out/b.txt', GUIDE);
    known.delete(A); // removed while another build ran
    const links = open();
    expect(links.get(A, '/work/out/a.txt'), 'not before the view is asked').toEqual({ why: null });
    links.reconcile();
    expect(links.get(A, '/work/out/a.txt')).toBeNull();
    expect(links.get(B, '/work/out/b.txt')).toEqual({ why: null });
    expect(stored().sessions).toEqual({ B: [{ real: '/work/out/b.txt', at: 1002, from: GUIDE }] });
  });

  it('reconciles without throwing when the view throws or the file cannot be written', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    const throwing = openFileLinks(file, { known: () => { throw new Error('view closed'); }, log: (line) => lines.push(line) });
    expect(() => throwing.reconcile()).not.toThrow();
    known.clear();
    chmodSync(sessionsDir(), 0o500);
    const again = open();
    expect(() => again.reconcile()).not.toThrow();
    expect(again.get(A, '/work/out/a.txt')).toBeNull();
  });

  it('holds nothing of a file it cannot read as its own version, logs its size once and never its content, and leaves it until the next change (X5.7)', () => {
    mkdirSync(sessionsDir(), { recursive: true });
    const entry = { real: '/work/out/a.txt', at: 1, from: GUIDE };
    const cases = ['{ not json /work/out/secret.txt', JSON.stringify({ version: 2, sessions: { A: [entry] } }), JSON.stringify({ version: 1, sessions: [] }), JSON.stringify({ version: 1 }), '"/work/out/a.txt"'];
    for (const text of cases) {
      writeFileSync(file, text);
      lines = [];
      const links = open();
      expect(links.get(A, '/work/out/a.txt'), text).toBeNull();
      links.reconcile();
      links.drop(B);
      expect(readFileSync(file, 'utf8'), 'left alone').toBe(text);
      expect(lines, text).toHaveLength(1);
      expect(lines[0], text).toContain(String(Buffer.byteLength(text)));
      expect(lines[0], text).not.toContain('/work/');
    }
    // the control: a file of this version is read
    writeFileSync(file, JSON.stringify({ version: 1, sessions: { A: [entry] } }));
    lines = [];
    expect(open().get(A, '/work/out/a.txt')).toEqual({ why: null });
    expect(lines).toEqual([]);
  });

  it('reads past an entry it does not take, reads a why it does not know as linked, and keeps from as it read it (X5.7)', () => {
    mkdirSync(sessionsDir(), { recursive: true });
    const odd = { line: 7, file: '/work/docs/guide.md' };
    writeFileSync(file, JSON.stringify({
      version: 1,
      sessions: {
        A: [
          { real: 'relative.txt', at: 1 },
          { real: 7, at: 1 },
          { at: 1, from: GUIDE },
          { real: '/work/out/no-time.txt' },
          { real: '/work/out/kept.txt', at: 2, from: GUIDE },
          { real: '/work/out/later.txt', at: 3, from: odd, why: 'a-reason-of-a-later-build' },
          { real: '/work/out/null.txt', at: 4, why: null },
          { real: '/work/out/result.txt', at: 5, from: AGENT, why: 'result' },
        ],
        B: 'not a list',
      },
    }));
    const links = open();
    expect(links.get(A, '/work/out/kept.txt')).toEqual({ why: null });
    expect(links.get(A, '/work/out/later.txt')).toEqual({ why: 'linked' });
    expect(links.get(A, '/work/out/null.txt')).toEqual({ why: 'linked' });
    expect(links.get(A, '/work/out/result.txt')).toEqual({ why: 'result' });
    expect(links.get(A, 'relative.txt')).toBeNull();
    expect(links.get(A, '/work/out/no-time.txt')).toBeNull();
    expect(lines).toEqual([]);
    links.add(B, '/work/out/b.txt', GUIDE); // the next write keeps each kept entry's from as it was read
    expect(stored().sessions.A!.find((one) => one.real === '/work/out/later.txt')).toEqual({ real: '/work/out/later.txt', at: 3, from: odd, why: 'linked' });
  });

  it('opens with no file and none written', () => {
    const links = open();
    links.reconcile();
    links.drop(A);
    expect(existsSync(file)).toBe(false);
    expect(lines).toEqual([]);
  });

  // spine-root.ts's wiring, grants.ts's own function (decision 2): the view says when the store may be reconciled, and
  // which records went
  it('follows the view as the grants do: reconciles once it can be read, drops a removed record’s links, and stops (X5.6)', () => {
    const links = open();
    links.add(A, '/work/out/a.txt', GUIDE);
    links.add(B, '/work/out/b.txt', GUIDE);
    known.delete(B);
    const view = fakeSpineView({ unavailable: 'the index is not read yet' });
    const stop = followView(links, view);
    expect(links.get(B, '/work/out/b.txt'), 'not while the view cannot be read').toEqual({ why: null });
    view.setUnavailable(null);
    expect(links.get(B, '/work/out/b.txt')).toBeNull();
    expect(links.get(A, '/work/out/a.txt')).toEqual({ why: null });
    view.removeRecord(A);
    expect(links.get(A, '/work/out/a.txt')).toBeNull();
    expect(stored().sessions).toEqual({});
    links.add(A, '/work/out/c.txt', GUIDE);
    stop();
    view.removeRecord(A);
    expect(links.get(A, '/work/out/c.txt'), 'stopped').toEqual({ why: null });
    expect(view.listeners()).toBe(0);
  });
});
