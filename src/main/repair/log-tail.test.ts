// The repair window's log lines (P5 O15 M2, Interfaces §B): the last 20 lines of mawsd.log, each cut at 300 characters;
// of mawsd.out when the log has none; null when neither has any.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { daemonPaths, type DaemonPaths } from '@shared/daemon/files';
import { LOG_LINE_CHARS, LOG_LINES, readLogTail } from './log-tail';

let profile: string;
let paths: DaemonPaths;
beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'maws-repair-'));
  paths = daemonPaths(profile);
  mkdirSync(paths.dir, { recursive: true });
});
afterEach(() => rmSync(profile, { recursive: true, force: true }));
const log = () => join(paths.dir, 'mawsd.log');
const out = () => join(paths.dir, 'mawsd.out');

describe('the log tail', () => {
  it('is the last 20 lines of mawsd.log, in order, with no empty last line', () => {
    writeFileSync(log(), Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    expect(LOG_LINES).toBe(20);
    expect(readLogTail(paths)).toEqual({ path: log(), lines: Array.from({ length: 20 }, (_, i) => `line ${i + 31}`) });
  });

  it('cuts each line at 300 characters', () => {
    writeFileSync(log(), `${'a'.repeat(1000)}\nshort\n`);
    expect(LOG_LINE_CHARS).toBe(300);
    expect(readLogTail(paths)?.lines).toEqual(['a'.repeat(300), 'short']);
  });

  it('reads the end of a log far larger than it shows', () => {
    writeFileSync(log(), `${'x'.repeat(4 * 1024 * 1024)}\n${Array.from({ length: 25 }, (_, i) => `tail ${i}`).join('\n')}`);
    expect(readLogTail(paths)?.lines).toEqual(Array.from({ length: 20 }, (_, i) => `tail ${i + 5}`));
  });

  it('is mawsd.out’s when the log has none, and null when neither has any', () => {
    expect(readLogTail(paths)).toBeNull();
    writeFileSync(log(), '\n\n');
    writeFileSync(out(), 'node: bad option: --nope\n');
    expect(readLogTail(paths)).toEqual({ path: out(), lines: ['node: bad option: --nope'] });
    writeFileSync(out(), '');
    expect(readLogTail(paths)).toBeNull();
  });
});
