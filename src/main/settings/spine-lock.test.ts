// P5 O3-A (docs/doperpowers/plans/2026-10-28-p5-o3-spine.md §2; O3-A acceptance 5): `spine.lock`, one writer for the
// machine's data. Two candidates are played in one process by their pids; liveness and start times are the test's.
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LockDeps } from '../../engine-host/supervisor-files';
import { SPINE_LOCK, takeSpineLock } from './spine-lock';

let profile: string;
beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'maws-spine-lock-'));
});
afterEach(() => rmSync(profile, { recursive: true, force: true }));

// A world of processes: pid → start time for the live ones; the clock moves only when a candidate sleeps.
function world(live: Record<number, string>) {
  let now = 1_000_000;
  const slept: number[] = [];
  const deps = (pid: number): LockDeps => ({
    fs,
    pid,
    isAlive: (p) => p in live,
    procStartOf: (p) => live[p] ?? null,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  });
  return { deps, slept, live };
}
const lockOf = () => JSON.parse(readFileSync(join(profile, SPINE_LOCK), 'utf8')) as { pid: number; procStart: string; buildId: string; socketPath: string };

describe('spine.lock', () => {
  it('is taken at once on a free profile, names its holder and build, and is released by its holder alone', async () => {
    const w = world({ 100: 'Mon Oct 27 10:00:00 2026' });
    const lock = await takeSpineLock(profile, { build: '1.0.0+abc', deps: w.deps(100) });
    expect(lock.refused).toBeNull();
    expect(lockOf()).toMatchObject({ pid: 100, procStart: 'Mon Oct 27 10:00:00 2026', buildId: '1.0.0+abc', socketPath: '' });
    expect(w.slept).toEqual([]);
    lock.release();
    expect(readdirSync(profile)).toEqual([]);
  });

  it('refuses a second live candidate after waiting a few seconds, naming the holder, and leaves the holder’s lock', async () => {
    const w = world({ 100: 'Mon Oct 27 10:00:00 2026', 200: 'Mon Oct 27 10:05:00 2026' });
    const first = await takeSpineLock(profile, { build: '1.0.0+abc', deps: w.deps(100) });
    const held = readFileSync(join(profile, SPINE_LOCK), 'utf8');
    const lines: string[] = [];
    const second = await takeSpineLock(profile, { build: '1.0.1+def', deps: w.deps(200), waitMs: 2_000, log: (line) => lines.push(line) });
    expect(second.refused).toBe('spine.lock is held by pid 100 (build 1.0.0+abc), so this run starts none of the machine\'s services and writes none of its files');
    expect(second.holder).toMatchObject({ pid: 100, buildId: '1.0.0+abc' });
    expect(lines).toEqual([`[spine] ${second.refused}`]); // logged once
    expect(w.slept.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(2_000);
    second.release(); // a refused run releases nothing
    expect(readFileSync(join(profile, SPINE_LOCK), 'utf8')).toBe(held);
    expect(readdirSync(profile)).toEqual([SPINE_LOCK]);
    first.release();
  });

  it('takes the lock from a holder that exits during the wait', async () => {
    const w = world({ 100: 'Mon Oct 27 10:00:00 2026', 200: 'Mon Oct 27 10:05:00 2026' });
    await takeSpineLock(profile, { build: '1.0.0+abc', deps: w.deps(100) });
    const deps = w.deps(200);
    const sleep = deps.sleep;
    deps.sleep = async (ms) => {
      await sleep(ms);
      delete w.live[100]; // the exiting app's last steps end
    };
    const second = await takeSpineLock(profile, { build: '1.0.1+def', deps });
    expect(second.refused).toBeNull();
    expect(lockOf()).toMatchObject({ pid: 200, buildId: '1.0.1+def' });
  });

  it.each([
    ['a dead pid', { 200: 'Mon Oct 27 10:05:00 2026' }],
    ['a live pid with another start time (the pid reused)', { 100: 'Tue Oct 28 08:00:00 2026', 200: 'Mon Oct 27 10:05:00 2026' }],
  ])('breaks a stale lock of %s and takes it without waiting', async (_, live) => {
    writeFileSync(join(profile, SPINE_LOCK), JSON.stringify({ pid: 100, procStart: 'Mon Oct 27 10:00:00 2026', protocol: 2, buildId: '0.9.0+old', socketPath: '', startedAt: '2026-10-27T10:00:00.000Z' }));
    const w = world(live);
    const lock = await takeSpineLock(profile, { build: '1.0.0+abc', deps: w.deps(200) });
    expect(lock.refused).toBeNull();
    expect(lockOf()).toMatchObject({ pid: 200 });
    expect(w.slept).toEqual([]);
    expect(readdirSync(profile)).toEqual([SPINE_LOCK]); // no break file or candidate file left behind
  });

  it('a holder whose lock was broken and taken by another never removes the other’s lock', async () => {
    const w = world({ 100: 'Mon Oct 27 10:00:00 2026', 200: 'Mon Oct 27 10:05:00 2026' });
    const first = await takeSpineLock(profile, { build: '1.0.0+abc', deps: w.deps(100) });
    writeFileSync(join(profile, SPINE_LOCK), JSON.stringify({ pid: 200, procStart: 'Mon Oct 27 10:05:00 2026', protocol: 2, buildId: '1.0.1+def', socketPath: '', startedAt: '2026-10-27T10:05:00.000Z' }));
    first.release();
    expect(lockOf()).toMatchObject({ pid: 200 });
  });
});
