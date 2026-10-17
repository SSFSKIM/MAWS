// P3-HD (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, M1; P3 co-work Decision Logs 97 and 98): the X8 journal
// is a faithful, unredacted record kept owner-only. Whatever the process umask, a launch's journal root and session
// directory are 0700 and every launch file the writer opens, rotations included, is 0600: created so, or tightened at
// open when an earlier build left them wider. Ancestors above the journal root keep their modes, and the rows on disk
// stay exactly the rows the writer returned. Scratch directories only: nothing here reads or changes an owner's journal.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { JournalWriter } from './journal';
import { journalDir, openSessionJournal } from './launcher';

const PERMISSIVE_UMASK = 0o000;

let userData: string;
let savedUmask: number;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-journal-modes-'));
  savedUmask = process.umask(PERMISSIVE_UMASK);
});
afterEach(() => {
  process.umask(savedUmask);
  rmSync(userData, { recursive: true, force: true });
});

const APP = 'app-1' as AppSessionId;
const modeOf = (path: string) => statSync(path).mode & 0o777;
const rootDir = () => join(userData, 'engine-host', 'journal');
const serialised = (rows: JournalRow[]) => rows.map((row) => JSON.stringify(row) + '\n').join('');

// Writes rows large enough that a 200-byte bound rotates every row, grouping them by the file each went to.
function writeRotating(writer: JournalWriter, count: number): Map<string, JournalRow[]> {
  const bySegment = new Map<string, JournalRow[]>();
  for (let i = 0; i < count; i += 1) {
    const row = writer.row('in', { type: 'assistant', text: `owner@example.com sk-ant-api03-${'x'.repeat(60)} ${i}` });
    bySegment.set(writer.currentPath, [...(bySegment.get(writer.currentPath) ?? []), row]);
  }
  return bySegment;
}

describe('journal permissions (P3-HD, Decision Logs 97 and 98)', () => {
  describe('created', () => {
    it('makes the launch journal root and session directory 0700 and its file 0600 under a permissive umask', () => {
      const writer = openSessionJournal(userData, APP, 'abcdefgh');
      const rows = [writer.row('meta', { event: 'spawn', argv: ['--mcp-config', '{"mcpServers":{}}'] }), writer.row('out', { type: 'keep_alive' })];
      void writer.close();

      expect(writer.path).toBe(join(journalDir(userData, APP), 'abcdefgh.jsonl'));
      expect(modeOf(rootDir())).toBe(0o700);
      expect(modeOf(journalDir(userData, APP))).toBe(0o700);
      expect(modeOf(writer.path)).toBe(0o600);
      expect(readFileSync(writer.path, 'utf8')).toBe(serialised(rows));
    });

    it('makes every rotated segment 0600 and keeps each segment byte-identical to the rows it took', () => {
      const writer = new JournalWriter(journalDir(userData, APP), 'abcdefgh', { maxBytes: 200 });
      const bySegment = writeRotating(writer, 6);
      void writer.close();

      expect(bySegment.size).toBeGreaterThan(2);
      expect(readdirSync(journalDir(userData, APP)).sort()).toEqual([...bySegment.keys()].map((file) => file.slice(journalDir(userData, APP).length + 1)).sort());
      for (const [file, rows] of bySegment) {
        expect(modeOf(file), file).toBe(0o600);
        expect(readFileSync(file, 'utf8')).toBe(serialised(rows));
      }
    });

    it('makes a later session directory 0700 beside an existing one', () => {
      void openSessionJournal(userData, APP, 'aaaaaaaa').close();
      const second = openSessionJournal(userData, 'app-2' as AppSessionId, 'bbbbbbbb');
      second.row('meta', { event: 'spawn' });
      void second.close();

      expect(modeOf(rootDir())).toBe(0o700);
      expect(modeOf(journalDir(userData, 'app-2' as AppSessionId))).toBe(0o700);
      expect(modeOf(second.path)).toBe(0o600);
    });

    it('leaves the directories above the journal root as they were created', () => {
      void openSessionJournal(userData, APP, 'abcdefgh').close();
      expect(modeOf(join(userData, 'engine-host'))).toBe(0o777 & ~PERMISSIVE_UMASK);
    });
  });

  describe('left wider by an earlier build', () => {
    it('tightens the root, the session directory and a reopened launch file, appending after its faithful contents', () => {
      const dir = journalDir(userData, APP);
      mkdirSync(dir, { recursive: true });
      for (const path of [userData, join(userData, 'engine-host'), rootDir(), dir]) chmodSync(path, 0o755);
      const earlier = JSON.stringify({ seq: 1, direction: 'meta', at: '2026-10-01T00:00:00.000Z', frame: { event: 'spawn' } }) + '\n';
      writeFileSync(join(dir, 'abcdefgh.jsonl'), earlier, { mode: 0o644 });

      const writer = openSessionJournal(userData, APP, 'abcdefgh');
      const row = writer.row('meta', { event: 'exit' });
      void writer.close();

      expect(modeOf(rootDir())).toBe(0o700);
      expect(modeOf(dir)).toBe(0o700);
      expect(modeOf(writer.path)).toBe(0o600);
      expect(readFileSync(writer.path, 'utf8')).toBe(earlier + serialised([row]));
      expect(modeOf(userData)).toBe(0o755);
      expect(modeOf(join(userData, 'engine-host'))).toBe(0o755);
    });

    it('tightens a wider rotation file the writer rotates into', () => {
      const dir = journalDir(userData, APP);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, 'abcdefgh.1.jsonl'), '', { mode: 0o644 });

      const writer = new JournalWriter(dir, 'abcdefgh', { maxBytes: 200 });
      const bySegment = writeRotating(writer, 3);
      void writer.close();

      expect(bySegment.has(join(dir, 'abcdefgh.1.jsonl'))).toBe(true);
      for (const [file, rows] of bySegment) {
        expect(modeOf(file), file).toBe(0o600);
        expect(readFileSync(file, 'utf8')).toBe(serialised(rows));
      }
    });
  });
});
