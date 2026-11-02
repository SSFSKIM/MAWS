// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §B and §D; D10, D46): the roster as an
// engine host reads it at its start. Entries the session hosts wrote are read whole; a temp file, a dot-file or an entry
// that does not parse is skipped; a host is live only while its pid is alive with the recorded start time; a dead
// host's files go but its log; a log no entry names is pruned once older than the journals' age limit.
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHosts, pruneHostLogs, readRoster, removeHostFiles, type RosterEntry } from './roster';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-roster-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const entry = (holderId: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  protocol: 1, holderId, pid: 4242, procStart: 'Fri Oct 31 10:00:00 2026', startedAt: '2026-10-31T10:00:00.000Z', socket: join(dir, `${holderId}.sock`),
  binary: '/x/maws-session-host', appSessionId: 'app-1', engineSessionId: 'eng-1', state: 'running', child: { pid: 4243, procStart: 'Fri Oct 31 10:00:01 2026' }, fence: 1, exit: null, ...over,
});
const write = (e: RosterEntry, name = `${e.holderId}.json`) => writeFileSync(join(dir, name), JSON.stringify(e));

describe('readRoster', () => {
  it('reads each entry, skipping temp files, dot-files, other files and entries that do not parse', () => {
    write(entry('aaaaaaaa'));
    write(entry('bbbbbbbb', { state: 'exited', child: null, exit: { code: 0, signal: null, at: '2026-10-31T10:05:00.000Z' } }));
    write(entry('cccccccc'), '.cccccccc.json.4242.tmp');
    writeFileSync(join(dir, 'dddddddd.json'), '{"protocol":1,'); // torn
    writeFileSync(join(dir, 'eeeeeeee.log'), 'a log');
    writeFileSync(join(dir, 'eeeeeeee.token'), 'ab'.repeat(32));
    const logged: string[] = [];
    const read = readRoster(dir, (line) => void logged.push(line));
    expect(read.map((e) => e.holderId).sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    expect(logged).toEqual([expect.stringContaining('dddddddd.json')]);
  });

  it('keeps an entry of another protocol major (adoption decides what to do with it)', () => {
    write({ ...entry('aaaaaaaa'), protocol: 2 });
    expect(readRoster(dir, () => {})).toMatchObject([{ holderId: 'aaaaaaaa', protocol: 2 }]);
  });

  it('answers nothing for a missing directory', () => {
    expect(readRoster(join(dir, 'missing'), () => {})).toEqual([]);
  });
});

describe('liveHosts', () => {
  it('a host is live while its pid is alive with the recorded start time; a reused pid or a gone one is dead', () => {
    const alive = new Map<number, string>([[1, 'start-1'], [2, 'start-other']]);
    const deps = { isAlive: (pid: number) => alive.has(pid), procStartOf: (pid: number) => alive.get(pid) ?? null };
    const live = entry('live0001', { pid: 1, procStart: 'start-1' });
    const reused = entry('reused01', { pid: 2, procStart: 'start-2' });
    const gone = entry('gone0001', { pid: 3, procStart: 'start-3' });
    expect(liveHosts([live, reused, gone], deps)).toEqual({ live: [live], dead: [reused, gone] });
  });
});

describe('a dead host\'s files and the logs', () => {
  it('removeHostFiles takes the entry, the token and the socket (and a fallback socket the entry names), never the log', () => {
    const fallback = join(dir, 'fallback');
    mkdirSync(fallback);
    const e = entry('aaaaaaaa', { socket: join(fallback, 'aaaaaaaa.sock') });
    write(e);
    for (const name of ['aaaaaaaa.token', 'aaaaaaaa.log']) writeFileSync(join(dir, name), 'x');
    writeFileSync(join(fallback, 'aaaaaaaa.sock'), '');
    removeHostFiles(dir, e);
    expect(['aaaaaaaa.json', 'aaaaaaaa.token'].map((n) => existsSync(join(dir, n)))).toEqual([false, false]);
    expect(existsSync(join(fallback, 'aaaaaaaa.sock'))).toBe(false);
    expect(existsSync(join(dir, 'aaaaaaaa.log'))).toBe(true);
  });

  it('pruneHostLogs removes a log no entry names once older than the limit; a named or a recent one stays (D46)', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    const old = new Date(now.getTime() - 31 * 86_400_000);
    for (const name of ['named001.log', 'orphan01.log', 'recent01.log', 'other.txt']) writeFileSync(join(dir, name), 'x');
    for (const name of ['named001.log', 'orphan01.log', 'other.txt']) utimesSync(join(dir, name), old, old);
    expect(pruneHostLogs(dir, new Set(['named001']), { maxAgeDays: 30, now })).toBe(1);
    expect(['named001.log', 'orphan01.log', 'recent01.log', 'other.txt'].map((n) => existsSync(join(dir, n)))).toEqual([true, false, true, true]);
  });
});
