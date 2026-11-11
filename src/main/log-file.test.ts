// P5 O15 M2b §H (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): main's log file. Each case wraps a console of
// its own (never the process's), on a fake clock, and reads the real file it writes under a scratch directory.
import { Console } from 'node:console';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMainLog, MAIN_LOG_HELD_LINES } from './log-file';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-main-log-'));
});

afterEach(() => {
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

/** A console whose two streams are kept as text, captured on a clock that moves one second a call. */
function captured(options: { maxBytes?: number } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const stream = (into: string[]) => new Writable({ write: (chunk: Buffer, _encoding, done) => void (into.push(chunk.toString()), done()) });
  const console = new Console({ stdout: stream(out), stderr: stream(err) });
  let second = 0;
  const said: string[] = [];
  const log = captureMainLog(console, { ...options, now: () => new Date(Date.UTC(2026, 10, 10, 12, 0, second++)), stderr: (text) => void said.push(text) });
  return { console, log, out, err, said };
}

const at = (second: number) => new Date(Date.UTC(2026, 10, 10, 12, 0, second)).toISOString();
const fileOf = (dir: string) => readFileSync(join(dir, 'main.log'), 'utf8');
const linesOf = (dir: string) => fileOf(dir).split('\n').slice(0, -1);
const modeOf = (path: string) => statSync(path).mode & 0o777;

describe('the held lines', () => {
  it('are written at install with the time each was said, in order, and every later line as it comes', () => {
    const { console, log } = captured();
    console.log('[main] MAWS 0.0.0 · pid %d', 42);
    console.warn('a warning', { code: 7 });
    const dir = join(root, 'logs');
    expect(existsSync(dir)).toBe(false);
    expect(log.install(dir)).toBe(true);
    expect(linesOf(dir)).toEqual([`${at(0)} [main] MAWS 0.0.0 · pid 42`, `${at(1)} a warning { code: 7 }`]);
    console.info('after');
    expect(linesOf(dir)).toEqual([`${at(0)} [main] MAWS 0.0.0 · pid 42`, `${at(1)} a warning { code: 7 }`, `${at(2)} after`]);
  });

  it(`keep the newest ${MAIN_LOG_HELD_LINES} and count the rest, the count first`, () => {
    const { console, log } = captured();
    for (let i = 0; i <= MAIN_LOG_HELD_LINES; i += 1) console.log(`line ${i}`);
    const dir = join(root, 'logs');
    log.install(dir);
    const lines = linesOf(dir);
    expect(lines).toHaveLength(MAIN_LOG_HELD_LINES + 1);
    expect(lines[0]).toBe(`${at(1)} 1 earlier lines were not held`);
    expect(lines[1]).toBe(`${at(1)} line 1`);
    expect(lines.at(-1)).toMatch(/ line 1000$/);
  });
});

describe('the file', () => {
  it('has a line with its time for each console call, and for each line of a multi-line one', () => {
    const { console, log } = captured();
    const dir = join(root, 'logs');
    log.install(dir);
    console.log('one');
    console.error('two\nthree');
    expect(linesOf(dir)).toEqual([`${at(0)} one`, `${at(1)} two`, `${at(1)} three`]);
  });

  it('leaves the console its text, warn and error included', () => {
    const { console, log, out, err } = captured();
    console.log('held');
    log.install(join(root, 'logs'));
    console.info('info %s', 'too');
    console.warn('careful');
    console.error('failed');
    expect(out.join('')).toBe('held\ninfo too\n');
    expect(err.join('')).toBe('careful\nfailed\n');
  });

  it('is renamed to main.log.1 at its bound and begun again', () => {
    const { console, log } = captured({ maxBytes: 64 });
    const dir = join(root, 'logs');
    log.install(dir);
    console.log('a'.repeat(30)); // 24 + 1 + 30 + 1 = 56 bytes
    console.log('b'.repeat(30));
    expect(readFileSync(join(dir, 'main.log.1'), 'utf8')).toBe(`${at(0)} ${'a'.repeat(30)}\n`);
    expect(fileOf(dir)).toBe(`${at(1)} ${'b'.repeat(30)}\n`);
  });

  it('makes its directory 0700 and itself 0600, and tightens an existing pair', () => {
    const fresh = captured();
    const dir = join(root, 'logs');
    fresh.log.install(dir);
    expect([modeOf(dir), modeOf(join(dir, 'main.log'))]).toEqual([0o700, 0o600]);
    const loose = join(root, 'loose');
    mkdirSync(loose);
    chmodSync(loose, 0o755);
    writeFileSync(join(loose, 'main.log'), 'kept\n');
    chmodSync(join(loose, 'main.log'), 0o644);
    expect(captured().log.install(loose)).toBe(true);
    expect([modeOf(loose), modeOf(join(loose, 'main.log'))]).toEqual([0o700, 0o600]);
    expect(fileOf(loose)).toBe('kept\n');
  });

  it('counts an existing file toward its bound', () => {
    const dir = join(root, 'logs');
    mkdirSync(dir, { mode: 0o700 });
    writeFileSync(join(dir, 'main.log'), 'x'.repeat(40) + '\n', { mode: 0o600 });
    const { console, log } = captured({ maxBytes: 64 });
    log.install(dir);
    console.log('a'.repeat(30));
    expect(readFileSync(join(dir, 'main.log.1'), 'utf8')).toBe('x'.repeat(40) + '\n');
    expect(fileOf(dir)).toBe(`${at(0)} ${'a'.repeat(30)}\n`);
  });
});

describe('a file log that cannot open is off, and nothing is thrown', () => {
  const off = (dir: string, why: RegExp) => {
    const { console, log, out, said } = captured();
    console.log('held');
    expect(log.install(dir)).toBe(false);
    console.log('after');
    expect(out.join(''), 'the console goes on as before').toBe('held\nafter\n');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^\[main\] the file log is off: .+\n$/);
    expect(said[0]).toMatch(why);
    expect(existsSync(join(dir, 'main.log'))).toBe(false);
    expect(log.install(dir), 'and stays off').toBe(false);
    expect(said).toHaveLength(1);
  };

  // Root writes through any mode, so the unwritable parent is a case only an ordinary user can see.
  it.skipIf(process.getuid?.() === 0)('when its parent cannot be written', () => {
    chmodSync(root, 0o500);
    off(join(root, 'logs'), /EACCES/);
  });

  it('when a regular file stands at its path', () => {
    writeFileSync(join(root, 'logs'), '');
    off(join(root, 'logs'), /not a directory/);
  });

  it('when a symlink stands at its path, even one to a directory', () => {
    mkdirSync(join(root, 'elsewhere'), { mode: 0o700 });
    symlinkSync(join(root, 'elsewhere'), join(root, 'logs'));
    off(join(root, 'logs'), /symlink/);
    expect(existsSync(join(root, 'elsewhere', 'main.log'))).toBe(false);
  });
});

describe('a write that fails', () => {
  it('drops its line and says so once; the lines after it are written when they can be', () => {
    const { console, log, said } = captured();
    const dir = join(root, 'logs');
    log.install(dir);
    rmSync(join(dir, 'main.log'));
    mkdirSync(join(dir, 'main.log')); // appending to a directory fails
    console.log('lost');
    console.log('lost too');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^\[main\] the file log dropped a line.*EISDIR.*\n$/);
    rmSync(join(dir, 'main.log'), { recursive: true });
    console.log('written');
    expect(fileOf(dir)).toBe(`${at(2)} written\n`);
    expect(said).toHaveLength(1);
  });
});

describe('one writer of a profile’s file', () => {
  it('two captures on one profile, one installed: only that one writes and renames the file', () => {
    const dir = join(root, 'logs');
    const first = captured({ maxBytes: 64 });
    const second = captured({ maxBytes: 64 });
    first.console.log('first, before');
    second.console.log('second, held and never written');
    first.log.install(dir);
    second.console.log('second, after');
    first.console.log('a'.repeat(30));
    first.console.log('b'.repeat(30));
    second.console.log('c'.repeat(60));
    const files = [readFileSync(join(dir, 'main.log.1'), 'utf8'), fileOf(dir)].join('');
    expect(files).not.toContain('second');
    expect(files).not.toContain('c'.repeat(60));
    expect(fileOf(dir)).toBe(`${at(2)} ${'b'.repeat(30)}\n`);
    expect(second.out.join('')).toBe(`second, held and never written\nsecond, after\n${'c'.repeat(60)}\n`);
  });
});
