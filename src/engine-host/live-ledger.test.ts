import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLive, readLive, signalOrphan, sweepOrphans, writeLive, type SweepDeps } from './live-ledger';
import { isAlive, procStartOf } from './supervisor-files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-live-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const OWNER = { pid: 500, procStart: 'T500' };
const ROW = { appSessionId: 'app-1', pid: 600, procStart: 'T600', launchId: 'L1' };

describe('the orphan ledger', () => {
  it('writes its owner and rows through a temporary file and a rename', () => {
    writeLive(dir, OWNER, [ROW]);
    expect(JSON.parse(readFileSync(join(dir, 'live.json'), 'utf8'))).toEqual({ owner: OWNER, rows: [ROW] });
    writeLive(dir, OWNER, []);
    expect(readLive(dir)).toEqual({ owner: OWNER, rows: [] });
    expect(readdirSync(dir)).toEqual(['live.json']);
  });

  it('clearLive removes the ledger only when this owner wrote it', () => {
    writeLive(dir, { pid: 501, procStart: 'T501' }, [ROW]); // a successor's
    clearLive(dir, OWNER);
    expect(readLive(dir)?.owner.pid).toBe(501);
    clearLive(dir, { pid: 501, procStart: 'other start' }); // the same pid, another process
    expect(readLive(dir)?.owner.pid).toBe(501);
    clearLive(dir, { pid: 501, procStart: 'T501' });
    expect(readLive(dir)).toBeNull();
    expect(() => clearLive(dir, OWNER)).not.toThrow(); // nothing to clear
  });

  it('reads an unreadable ledger as none', () => {
    writeFileSync(join(dir, 'live.json'), '{"owner":');
    expect(readLive(dir)).toBeNull();
    clearLive(dir, OWNER);
    expect(readdirSync(dir)).toEqual(['live.json']); // not ours to remove
  });
});

// E10 execution document, §Design 1 "The orphan ledger and sweep": a successor whose predecessor died stops the engines
// that predecessor left (they lost their stdio and run on until their turn ends, M0 Q1), SIGTERM first so each engine
// shuts its own tools down, SIGKILL to its group past the grace; a pid is signalled only while it is the recorded process.
describe('sweepOrphans', () => {
  // A process world: each pid's start time while alive, and what ends it.
  type Proc = { start: string; endsOn: 'SIGTERM' | 'SIGKILL' | 'never' };
  function world(procs: Record<number, Proc>) {
    const alive = new Map(Object.entries(procs).map(([pid, proc]) => [Number(pid), proc]));
    const signals: [number, string][] = [];
    const lines: string[] = [];
    const slept: number[] = [];
    const deps: SweepDeps = {
      isAlive: (pid) => alive.has(pid),
      procStartOf: (pid) => alive.get(pid)?.start ?? null,
      signal: (pid, signal) => {
        signals.push([pid, signal]);
        const proc = alive.get(pid);
        if (proc && (proc.endsOn === signal || signal === 'SIGKILL')) alive.delete(pid);
      },
      sleep: async (ms) => void slept.push(ms),
      log: (line) => void lines.push(line),
    };
    return { alive, signals, lines, slept, deps };
  }
  const row = (n: number, procStart: string) => ({ appSessionId: `app-${n}`, pid: n, procStart, launchId: `L${n}` });

  it('with the owner dead, stops each row alive with its recorded start, SIGTERM first and SIGKILL past 5 s; a dead and a reused pid are left alone', async () => {
    const { alive, signals, slept, deps, lines } = world({
      602: { start: 'reused start', endsOn: 'SIGTERM' }, // the pid of a dead engine, now another process
      603: { start: 'T603', endsOn: 'SIGTERM' }, // an orphan that honours SIGTERM
      604: { start: 'T604', endsOn: 'never' }, // an orphan that ignores it
    });
    writeLive(dir, OWNER, [row(601, 'T601'), row(602, 'T602'), row(603, 'T603'), row(604, 'T604')]); // 500 and 601 are dead
    expect(await sweepOrphans(dir, deps)).toBe(2);
    expect(signals).toEqual([[603, 'SIGTERM'], [604, 'SIGTERM'], [604, 'SIGKILL']]);
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(5_000); // the grace, waited once for every orphan
    expect([...alive.keys()]).toEqual([602]);
    expect(lines.some((line) => line.includes('602'))).toBe(false);
    expect(lines.filter((line) => line.includes('orphan'))).not.toEqual([]);
  });

  it('a pid whose start time differs from the owner’s is a dead owner; one that cannot be read never makes a live owner dead', async () => {
    const reused = world({ 500: { start: 'another process', endsOn: 'SIGTERM' }, 603: { start: 'T603', endsOn: 'SIGTERM' } });
    writeLive(dir, OWNER, [row(603, 'T603')]);
    expect(await sweepOrphans(dir, reused.deps)).toBe(1);

    const unreadable = world({ 500: { start: 'T500', endsOn: 'SIGTERM' }, 603: { start: 'T603', endsOn: 'SIGTERM' } });
    unreadable.deps.procStartOf = (pid) => (pid === 500 ? null : 'T603');
    expect(await sweepOrphans(dir, unreadable.deps)).toBe(0);
    expect(unreadable.signals).toEqual([]);
  });

  it('with the owner alive, sweeps nothing: its engines are its own', async () => {
    const { signals, deps, lines } = world({ 500: { start: 'T500', endsOn: 'SIGTERM' }, 603: { start: 'T603', endsOn: 'SIGTERM' } });
    writeLive(dir, OWNER, [row(603, 'T603')]);
    expect(await sweepOrphans(dir, deps)).toBe(0);
    expect(signals).toEqual([]);
    expect(lines.some((line) => line.includes('alive'))).toBe(true);
  });

  it('never signals a row whose start time was not recorded or cannot be read now', async () => {
    const { signals, deps } = world({ 603: { start: 'T603', endsOn: 'SIGTERM' }, 604: { start: 'T604', endsOn: 'SIGTERM' } });
    deps.procStartOf = (pid) => (pid === 604 ? null : (pid === 603 ? 'T603' : null));
    writeLive(dir, OWNER, [row(603, ''), row(604, 'T604')]);
    expect(await sweepOrphans(dir, deps)).toBe(0);
    expect(signals).toEqual([]);
  });

  it('stops waiting once every orphan is gone, and never SIGKILLs a pid that was reused meanwhile', async () => {
    const { alive, signals, slept, deps } = world({ 603: { start: 'T603', endsOn: 'never' }, 604: { start: 'T604', endsOn: 'SIGTERM' } });
    deps.sleep = async (ms) => {
      slept.push(ms);
      alive.set(603, { start: 'a newer process', endsOn: 'never' }); // 603 died and its pid was taken
    };
    writeLive(dir, OWNER, [row(603, 'T603'), row(604, 'T604')]);
    expect(await sweepOrphans(dir, deps)).toBe(2);
    expect(signals).toEqual([[603, 'SIGTERM'], [604, 'SIGTERM']]);
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(5_000);
  });

  it('skips with a log line when the ledger is unreadable, and quietly when there is none', async () => {
    const { signals, deps, lines } = world({});
    expect(await sweepOrphans(dir, deps)).toBe(0);
    expect(lines).toEqual([]);
    writeFileSync(join(dir, 'live.json'), '{"owner":');
    expect(await sweepOrphans(dir, deps)).toBe(0);
    expect(lines).toEqual([expect.stringContaining('unreadable')]);
    expect(signals).toEqual([]);
  });

  it('a signal that fails is logged and the sweep goes on', async () => {
    const { deps, lines } = world({ 603: { start: 'T603', endsOn: 'SIGTERM' }, 604: { start: 'T604', endsOn: 'SIGTERM' } });
    const signal = deps.signal;
    deps.signal = (pid, name) => {
      if (pid === 603) throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
      signal(pid, name);
    };
    writeLive(dir, OWNER, [row(603, 'T603'), row(604, 'T604')]);
    expect(await sweepOrphans(dir, deps)).toBe(1);
    expect(lines.some((line) => line.includes('603') && line.includes('not permitted'))).toBe(true);
  });

  // Real processes, each in its own group as the transport spawns an engine; every one is killed at the end.
  describe('over real processes', () => {
    const children: ChildProcess[] = [];
    afterEach(() => {
      for (const child of children.splice(0)) {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    });
    function orphan(script: string): Promise<{ pid: number; procStart: string }> {
      const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      children.push(child);
      return new Promise((resolve, reject) => {
        child.stdout!.once('data', () => resolve({ pid: child.pid!, procStart: procStartOf(child.pid!)! })); // its trap is set
        child.once('error', reject);
      });
    }
    const real = (graceMs: number): SweepDeps => ({ isAlive, procStartOf, signal: signalOrphan, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log: () => {}, graceMs });

    it('ends an orphan with SIGTERM, and one that ignores it with SIGKILL to its group past the grace', async () => {
      const polite = await orphan('echo up; exec sleep 30');
      const stubborn = await orphan("trap '' TERM; echo up; sleep 30 & wait; sleep 30");
      writeLive(dir, { pid: 999_999, procStart: 'gone' }, [
        { appSessionId: 'app-1', pid: polite.pid, procStart: polite.procStart, launchId: 'L1' },
        { appSessionId: 'app-2', pid: stubborn.pid, procStart: stubborn.procStart, launchId: 'L2' },
      ]);
      const started = Date.now();
      expect(await sweepOrphans(dir, real(400))).toBe(2);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      await vi.waitFor(() => expect([isAlive(polite.pid), isAlive(stubborn.pid)]).toEqual([false, false]), { timeout: 3_000, interval: 20 });
    });
  });
});
