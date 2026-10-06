import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { createRedactor, redactJournal } from '../../test/live/support/live';
import { JOURNAL_MAX_BYTES, JOURNAL_PRUNE_EVERY_MS, JournalReader, JournalWriter, pruneJournals, scheduleJournalPruning } from './journal';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-journal-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function readRows(path: string): JournalRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseJournalRow(JSON.parse(line)));
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

// Writes a launch file with `n` rows whose `at` starts at `startAt`, so ordering and age are content-based.
function seedLaunch(sessionDir: string, launchId: string, startAt: Date, n = 2): void {
  mkdirSync(sessionDir, { recursive: true });
  const lines: string[] = [];
  for (let seq = 1; seq <= n; seq += 1) {
    const at = new Date(startAt.getTime() + seq).toISOString();
    lines.push(JSON.stringify({ seq, direction: 'meta', at, frame: { event: seq === 1 ? 'spawn' : 'exit' } }));
  }
  writeFileSync(join(sessionDir, `${launchId}.jsonl`), lines.join('\n') + '\n');
}

describe('transport frames and journals', () => {
  describe('JournalWriter', () => {
    it('writes X8 rows with consecutive seq under <dir>/<launchId>.jsonl and creates the directory', () => {
      const dir = join(root, 'app-1');
      const writer = new JournalWriter(dir, 'abcdefgh', { maxBytes: JOURNAL_MAX_BYTES });
      expect(writer.path).toBe(join(dir, 'abcdefgh.jsonl'));
      const spawn = writer.row('meta', { event: 'spawn' });
      const out = writer.row('out', { type: 'keep_alive' });
      const err = writer.row('stderr', { text: 'warn' });
      expect(spawn).toMatchObject({ seq: 1, direction: 'meta', frame: { event: 'spawn' } });
      expect(out.seq).toBe(2);
      expect(err.seq).toBe(3);
      expect(spawn.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const rows = readRows(writer.path);
      expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
      expect(rows[1]).toEqual(out);
    });

    it('is a faithful record in production: a frame with an e-mail address and a sk-ant token round-trips byte-identical', () => {
      const writer = new JournalWriter(join(root, 'app-1'), 'abcdefgh', { maxBytes: JOURNAL_MAX_BYTES });
      const frame = { type: 'user', message: { role: 'user', content: 'mail owner@example.com the key sk-ant-api03-abcDEF_123 and super-secret-value' } };
      const row = writer.row('out', frame);
      const text = readFileSync(writer.path, 'utf8');
      expect(text).toBe(JSON.stringify(row) + '\n');
      expect(parseJournalRow(JSON.parse(text.trimEnd()))).toEqual(row);
      expect(text).toContain('owner@example.com');
      expect(text).toContain('sk-ant-api03-abcDEF_123');
    });

    it('applies a redactor only when given one (the fixture-export path), and redactJournal rewrites both', () => {
      const env = { ANTHROPIC_AUTH_TOKEN: 'claudeusage-local-gateway', MY_API_KEY: 'super-secret-value', SHORT_KEY: 'abc' };
      const writer = new JournalWriter(join(root, 'app-1'), 'abcdefgh', { maxBytes: JOURNAL_MAX_BYTES, redact: createRedactor(env) });
      writer.row('out', { type: 'user', message: { content: 'use sk-ant-api03-abcDEF_123 and super-secret-value for owner@example.com, abc stays' } });
      const text = readFileSync(writer.path, 'utf8');
      expect(text).not.toContain('sk-ant-api03-abcDEF_123');
      expect(text).toContain('sk-ant-[REDACTED]');
      expect(text).not.toContain('super-secret-value');
      expect(text).not.toContain('owner@example.com');
      expect(text).toContain('owner@redacted.invalid');
      expect(text).toContain('abc stays');
      expect(text).not.toContain('claudeusage-local-gateway'); // a TOKEN-named value is redacted even when it is the public marker

      const faithful = new JournalWriter(join(root, 'app-2'), 'abcdefgh', { maxBytes: JOURNAL_MAX_BYTES });
      faithful.row('out', { type: 'user', message: { content: 'owner@example.com sk-ant-api03-abcDEF_123' } });
      faithful.row('meta', { event: 'exit', by: 'probe@localhost' });
      const redacted = redactJournal(readFileSync(faithful.path, 'utf8'), env);
      expect(redacted).not.toContain('owner@example.com');
      expect(redacted).not.toContain('sk-ant-api03-abcDEF_123');
      expect(redacted).toContain('owner@redacted.invalid');
      expect(redacted).toContain('sk-ant-[REDACTED]');
      expect(redacted).toContain('probe@localhost');
      expect(redacted.split('\n').filter((l) => l.length > 0).map((l) => parseJournalRow(JSON.parse(l)).seq)).toEqual([1, 2]);
    });

    it('rolls a 128 MiB file to <launchId>.1.jsonl with seq continuing', async () => {
      expect(JOURNAL_MAX_BYTES).toBe(128 * 1024 * 1024);
      const dir = join(root, 'app-1');
      const writer = new JournalWriter(dir, 'abcdefgh', { maxBytes: JOURNAL_MAX_BYTES });
      const payload = 'x'.repeat(1024 * 1024); // ~1 MiB per row
      let last: JournalRow | null = null;
      for (let i = 0; i < 130; i += 1) last = writer.row('in', { type: 'assistant', payload });
      await writer.close();
      expect(last?.seq).toBe(130);
      const first = join(dir, 'abcdefgh.jsonl');
      const second = join(dir, 'abcdefgh.1.jsonl');
      expect(existsSync(second)).toBe(true);
      expect(statSync(first).size).toBeLessThanOrEqual(JOURNAL_MAX_BYTES);
      const firstSeqs = readRows(first).map((r) => r.seq);
      const secondSeqs = readRows(second).map((r) => r.seq);
      expect(firstSeqs[0]).toBe(1);
      expect(secondSeqs[0]).toBe(firstSeqs.at(-1)! + 1);
      expect([...firstSeqs, ...secondSeqs]).toEqual(Array.from({ length: 130 }, (_, i) => i + 1));
      expect(writer.currentPath).toBe(second);
    }, 20_000); // it writes 128 MiB: the 5 s default flaked under a concurrent typecheck (fix wave)

    it('refuses rows after close', async () => {
      const writer = new JournalWriter(join(root, 'app-1'), 'abcdefgh', { maxBytes: JOURNAL_MAX_BYTES });
      await writer.close();
      expect(() => writer.row('meta', { event: 'exit' })).toThrow(/closed/);
    });
  });

  describe('JournalReader', () => {
    it('streams parsed rows back and lists a session\'s launch files in launch order with their rotations', async () => {
      const dir = join(root, 'app-1');
      const writer = new JournalWriter(dir, 'launch2b', { maxBytes: 200 });
      writer.row('meta', { event: 'spawn', pad: 'x'.repeat(120) });
      writer.row('in', { type: 'system', pad: 'x'.repeat(120) });
      writer.row('meta', { event: 'exit' });
      await writer.close();
      seedLaunch(dir, 'launch1a', new Date('2026-09-01T00:00:00Z'));

      expect(await collect(JournalReader.rows(writer.path))).toEqual(readRows(writer.path));
      expect(JournalReader.forSession(dir)).toEqual([
        join(dir, 'launch1a.jsonl'),
        join(dir, 'launch2b.jsonl'),
        join(dir, 'launch2b.1.jsonl'),
        join(dir, 'launch2b.2.jsonl'),
      ]);
      expect(JournalReader.forSession(join(root, 'missing'))).toEqual([]);
    });
  });

  describe('pruneJournals', () => {
    it('keeps the 20 most recent launches per session, deletes older ones and anything past 30 days', async () => {
      const now = new Date('2026-09-28T12:00:00Z');
      const sessionA = join(root, 'app-a');
      for (let i = 0; i < 25; i += 1) seedLaunch(sessionA, `launch${String(i).padStart(3, '0')}`, new Date(now.getTime() - (25 - i) * 60_000));
      const sessionB = join(root, 'app-b');
      seedLaunch(sessionB, 'fresh000', new Date(now.getTime() - 3_600_000));
      seedLaunch(sessionB, 'stale000', new Date(now.getTime() - 31 * 86_400_000));
      const sessionC = join(root, 'app-c');
      seedLaunch(sessionC, 'stale111', new Date(now.getTime() - 40 * 86_400_000));
      writeFileSync(join(root, 'README.txt'), 'not a session'); // ignored

      const result = await pruneJournals(root, { keepPerSession: 20, maxAgeDays: 30, now });
      expect(result).toEqual({ removed: 7 });
      const kept = readdirSync(sessionA).sort();
      expect(kept).toHaveLength(20);
      expect(kept[0]).toBe('launch005.jsonl');
      expect(kept.at(-1)).toBe('launch024.jsonl');
      expect(readdirSync(sessionB)).toEqual(['fresh000.jsonl']);
      expect(existsSync(sessionC)).toBe(false); // an emptied session directory goes too
      expect(existsSync(join(root, 'README.txt'))).toBe(true);
      expect(await pruneJournals(join(root, 'nope'), { keepPerSession: 20, maxAgeDays: 30, now })).toEqual({ removed: 0 });
    });

    // E10: a supervisor outlives the app by days, so pruning also runs while launches are held; a launch the host still
    // holds a row for (live, or exited and answering session.events from its journal) is never removed
    it('never removes a launch it is told to keep, however old', async () => {
      const now = new Date('2026-09-28T12:00:00Z');
      const session = join(root, 'app-a');
      seedLaunch(session, 'held', new Date(now.getTime() - 40 * 86_400_000));
      seedLaunch(session, 'stale', new Date(now.getTime() - 40 * 86_400_000));
      expect(await pruneJournals(root, { keepPerSession: 20, maxAgeDays: 30, now, keep: new Set(['held']) })).toEqual({ removed: 1 });
      expect(readdirSync(session)).toEqual(['held.jsonl']);
    });
  });

  // E10 execution document, §Design 1 "Long-lived host hygiene": at host start and every 24 h after
  describe('scheduleJournalPruning', () => {
    afterEach(() => vi.useRealTimers());

    it('prunes at once and every 24 h, keeping the launches the host holds at each run', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      const start = new Date('2026-09-28T12:00:00Z');
      vi.setSystemTime(start);
      const session = join(root, 'app-a');
      seedLaunch(session, 'old', new Date(start.getTime() - 31 * 86_400_000));
      let held = new Set(['live']);
      const lines: string[] = [];
      const stop = scheduleJournalPruning(root, { keep: () => held, log: (line) => void lines.push(line) });
      await vi.advanceTimersByTimeAsync(0);
      expect(existsSync(join(session, 'old.jsonl'))).toBe(false);
      seedLaunch(session, 'live', new Date(start.getTime() - 29.5 * 86_400_000)); // a launch held across the 30-day mark
      seedLaunch(session, 'done', new Date(start.getTime() - 29.5 * 86_400_000));
      await vi.advanceTimersByTimeAsync(JOURNAL_PRUNE_EVERY_MS);
      expect(readdirSync(session).sort()).toEqual(['live.jsonl']);
      held = new Set();
      await vi.advanceTimersByTimeAsync(JOURNAL_PRUNE_EVERY_MS);
      expect(existsSync(session)).toBe(false);
      stop();
      seedLaunch(session, 'later', new Date(start.getTime() - 40 * 86_400_000));
      await vi.advanceTimersByTimeAsync(JOURNAL_PRUNE_EVERY_MS);
      expect(readdirSync(session)).toEqual(['later.jsonl']); // stopped: no run after it
      expect(JOURNAL_PRUNE_EVERY_MS).toBe(86_400_000);
      expect(lines).toEqual([]);
    });

    it('logs a failed run and runs again at the next interval', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const lines: string[] = [];
      let fail = true;
      const stop = scheduleJournalPruning(root, {
        keep: () => {
          if (fail) throw new Error('table unavailable');
          return new Set();
        },
        log: (line) => void lines.push(line),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(lines).toEqual([expect.stringContaining('table unavailable')]);
      fail = false;
      seedLaunch(join(root, 'app-a'), 'old', new Date(Date.now() - 31 * 86_400_000));
      await vi.advanceTimersByTimeAsync(JOURNAL_PRUNE_EVERY_MS);
      expect(existsSync(join(root, 'app-a'))).toBe(false);
      expect(lines).toHaveLength(1);
      stop();
    });
  });
});
