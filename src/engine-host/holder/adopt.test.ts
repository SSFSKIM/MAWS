// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D10): which live session hosts a
// start adopts. Each through the launcher's adopt, in parallel; a host of another protocol major left running and counted
// as failed; of two hosts naming one session the newest adopted and the other left, counted; a host holding no engine
// handed to the adopt (which releases it) and not counted when that ends it; a failed adoption counted with its reason.
// P5 O16 panel fix wave 1 (sweep#3): a host whose launch committed with no child yet (its predecessor lost mid-spawn) holds
// an engine, or is about to: held and adopted like one, never released as empty; and only a release the host accepted
// goes uncounted, so no failure is left out by what the roster said at the start.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { adoptable, adoptAll, endPrestart, holdsEngine, recordFailed, recordStart, removeStagedFiles } from './adopt';
import { ProcessTable } from '../process-table'; // P5 O16 wave 1 verification
import type { HeldStopOutcome } from './stop-held'; // P5 O16 wave 1 verification
import type { RosterEntry } from './roster';

const entry = (holderId: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  protocol: 1, holderId, pid: 4242, procStart: 'start', startedAt: '2026-10-31T10:00:00.000Z', socket: `/x/${holderId}.sock`,
  binary: '/x/maws-session-host', appSessionId: `app-${holderId}`, engineSessionId: 'eng', state: 'running', child: { pid: 4243, procStart: 'child' }, fence: 1, exit: null, ...over,
});

describe('adoptable', () => {
  it('takes this major\'s hosts, the newest per session, and the hosts holding no engine; leaves the rest with their reason', () => {
    const older = entry('older001', { appSessionId: 'app-shared', startedAt: '2026-10-31T09:00:00.000Z' });
    const newer = entry('newer001', { appSessionId: 'app-shared', startedAt: '2026-10-31T10:00:00.000Z' });
    const empty = entry('empty001', { appSessionId: 'app-shared', child: null, state: 'ready', startedAt: '2026-10-31T11:00:00.000Z' });
    const major = entry('major002', { protocol: 2 });
    const { take, leave, end } = adoptable([older, newer, empty, major]);
    expect(end).toEqual([]);
    expect(take.map((e) => e.holderId).sort()).toEqual(['empty001', 'newer001']);
    expect(leave.map(({ entry: e, reason }) => [e.holderId, reason])).toEqual([
      ['older001', 'a newer session host (newer001) holds its session; left running'],
      ['major002', 'it speaks session host protocol 2, not 1; left running'],
    ]);
  });

  it('takes a committed host with no child yet as one holding an engine: the newest of its session, never an empty one', () => {
    const older = entry('older001', { appSessionId: 'app-shared', startedAt: '2026-10-31T09:00:00.000Z' });
    const spawning = entry('spawn001', { appSessionId: 'app-shared', state: 'committed', child: null, startedAt: '2026-10-31T10:00:00.000Z' });
    const { take, leave } = adoptable([older, spawning]);
    expect(take.map((e) => e.holderId)).toEqual(['spawn001']);
    expect(leave.map(({ entry: e }) => e.holderId)).toEqual(['older001']);
  });
});

describe('adoptAll', () => {
  it('adopts in parallel; counts a failure and a host left, never a host released for holding no engine', async () => {
    const started: string[] = [];
    const lines: string[] = [];
    const outcome = await adoptAll([entry('good0001'), entry('bad00001'), entry('empty001', { state: 'ready', child: null }), entry('major002', { protocol: 2 })], {
      adopt: async (e) => {
        started.push(e.holderId);
        await new Promise((done) => setTimeout(done, 10));
        if (e.holderId === 'good0001') return e.appSessionId as AppSessionId;
        if (e.child === null) return null; // released: it held no engine
        throw new Error('the session has no stored launch spec');
      },
      end: async () => 'gone',
      log: (line) => void lines.push(line),
    });
    expect(started).toEqual(['empty001', 'good0001', 'bad00001']); // all begun before any ended
    expect(outcome.adopted).toEqual(['app-good0001']);
    expect(outcome.failed.map(({ entry: e, reason }) => [e.holderId, reason])).toEqual([
      ['major002', 'it speaks session host protocol 2, not 1; left running'],
      ['bad00001', 'the session has no stored launch spec'],
    ]);
    expect(lines).toContain('session host bad00001 (pid 4242) not adopted: the session has no stored launch spec');
  });

  it('counts a committed host with no child yet whose adoption failed, and a host whose release failed', async () => {
    const outcome = await adoptAll([entry('spawn001', { state: 'committed', child: null }), entry('empty001', { state: 'ready', child: null })], {
      adopt: async (e) => {
        throw new Error(e.holderId === 'spawn001' ? 'its spawn did not resolve in time' : 'the session host refused its release: the child has not exited');
      },
      end: async () => 'gone',
      log: () => {},
    });
    expect(outcome.failed.map(({ entry: e, reason }) => [e.holderId, reason])).toEqual([
      ['empty001', 'the session host refused its release: the child has not exited'],
      ['spawn001', 'its spawn did not resolve in time'],
    ]);
  });
});

describe('holdsEngine', () => {
  it('a child, or a committed launch whose spawn has not shown one; never a host whose launch never committed', () => {
    expect(holdsEngine(entry('running01'))).toBe(true);
    expect(holdsEngine(entry('spawn001', { state: 'committed', child: null }))).toBe(true);
    expect(holdsEngine(entry('ready001', { state: 'ready', child: null }))).toBe(false);
    expect(holdsEngine(entry('nosess01', { state: 'committed', child: null, appSessionId: null }))).toBe(false);
  });
});

// P5 O16 wave 1 verification: a host the start leaves to a newer host of its session (D59(10)) is known from the roster
// alone, so it is unattached at once, in the start's synchronous step; a stop-all during the adoptions (another
// adoption's preparation or re-initialize) then stops it beside the hold, not only once every adoption has ended
describe('the start’s records', () => {
  const tableOf = () => new ProcessTable({ ps: async () => '', log: () => {}, isAlive: () => true, procStartOf: () => 'start' });

  it('unattaches a losing host before any adoption ends, so a stop-all meanwhile stops both it and the hold', async () => {
    const older = entry('older001', { appSessionId: 'app-shared', pid: 4300, startedAt: '2026-10-31T09:00:00.000Z' });
    const newer = entry('newer001', { appSessionId: 'app-shared', pid: 4400, startedAt: '2026-10-31T10:00:00.000Z' });
    const table = tableOf();
    const stopped: string[] = [];
    const stop = async (e: RosterEntry): Promise<HeldStopOutcome> => (stopped.push(e.holderId), 'stopped');
    expect(recordStart(table, [older, newer], { stop, child: () => null })).toEqual(['app-shared']);
    expect(table.unattachedHosts('app-shared' as AppSessionId).map((h) => h.holderId)).toEqual(['older001']);
    expect(await table.shutdown({ graceMs: 0 })).toEqual({ stopped: 2, forced: 0 }); // the adoption still under way
    expect(stopped.sort()).toEqual(['newer001', 'older001']);
  });

  it('records a losing host once: the failures after the adoptions add a failed adoption, not the loser again', () => {
    const older = entry('older001', { appSessionId: 'app-shared', pid: 4300, startedAt: '2026-10-31T09:00:00.000Z' });
    const newer = entry('newer001', { appSessionId: 'app-shared', pid: 4400, startedAt: '2026-10-31T10:00:00.000Z' });
    const table = tableOf();
    const stop = async (): Promise<HeldStopOutcome> => 'stopped';
    recordStart(table, [older, newer], { stop, child: () => null });
    recordFailed(table, [{ entry: older, reason: 'a newer session host (newer001) holds its session; left running' }, { entry: newer, reason: 'no stored launch spec' }], { stop, child: () => null });
    expect(table.unattachedHosts('app-shared' as AppSessionId).map((h) => h.holderId)).toEqual(['older001', 'newer001']);
  });
});

// Ticket 851, M1 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-1 and R4-2): a roster entry marked `prestart`
// is a prestart whose promotion was never acknowledged. It is never adopted, whatever else the roster holds: its host is
// ended and that launch's staged files (its journal and host map, base and rotations) removed, and nothing else.
describe('a prestart never promoted', () => {
  const marked = (holderId: string, over: Partial<RosterEntry> = {}) => entry(holderId, { prestart: true, ...over });

  it('is never taken: not as the newest host of its session, not as a host holding no engine; another major\'s is that major\'s', () => {
    const older = entry('older001', { appSessionId: 'app-shared', startedAt: '2026-10-31T09:00:00.000Z' });
    const prestart = marked('pre00001', { appSessionId: 'app-shared', startedAt: '2026-10-31T10:00:00.000Z' });
    const launched = marked('pre00002', { state: 'ready', child: null });
    const major = marked('major002', { protocol: 2 });
    const { take, leave, end } = adoptable([older, prestart, launched, major]);
    expect(take.map((e) => e.holderId)).toEqual(['older001']);
    expect(end.map((e) => e.holderId)).toEqual(['pre00001', 'pre00002']);
    expect(leave.map(({ entry: e }) => e.holderId)).toEqual(['major002']);
  });

  it('is ended, never adopted, and counted neither adopted nor failed; an end that throws is logged', async () => {
    const adopted: string[] = [];
    const ended: string[] = [];
    const lines: string[] = [];
    const outcome = await adoptAll([entry('good0001'), marked('pre00001'), marked('pre00002')], {
      adopt: async (e) => (adopted.push(e.holderId), e.appSessionId as AppSessionId),
      end: async (e) => {
        ended.push(e.holderId);
        if (e.holderId === 'pre00002') throw new Error('no ps');
        return 'stopped';
      },
      log: (line) => void lines.push(line),
    });
    expect(adopted).toEqual(['good0001']);
    expect(ended.sort()).toEqual(['pre00001', 'pre00002']);
    expect(outcome.adopted).toEqual(['app-good0001']);
    expect(outcome.failed).toEqual([]);
    expect(outcome.ended.map((e) => e.holderId).sort()).toEqual(['pre00001', 'pre00002']);
    expect(lines).toContain('session host pre00002 (pid 4242) holds a prestart never promoted; its end failed: no ps');
  });

  it('is recorded unattached at the start, never held, so a launch, a forget or a stop all of its session stops it first', async () => {
    const table = new ProcessTable({ ps: async () => '', log: () => {}, isAlive: () => true, procStartOf: () => 'start' });
    const stopped: string[] = [];
    const stop = async (e: RosterEntry): Promise<HeldStopOutcome> => (stopped.push(e.holderId), 'stopped');
    expect(recordStart(table, [marked('pre00001'), marked('pre00002', { state: 'ready', child: null })], { stop, child: () => null })).toEqual([]);
    expect(table.unattachedHosts('app-pre00001' as AppSessionId).map((h) => h.holderId)).toEqual(['pre00001']);
    expect(table.unattachedHosts('app-pre00002' as AppSessionId)).toEqual([]); // no engine: nothing to guard
    expect(await table.shutdown({ graceMs: 0 })).toEqual({ stopped: 1, forced: 0 });
    expect(stopped).toEqual(['pre00001']);
  });

  it('ends its host first, then removes that launch\'s journal and host map files and nothing else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maws-staged-'));
    try {
      const names = ['Lpre0001.jsonl', 'Lpre0001.1.jsonl', 'Lpre0001.2.jsonl', 'Lpre0001.hseq', 'Lpre0001.1.hseq', 'Lpre00010.jsonl', 'Lpre00010.hseq', 'Lother01.jsonl', 'Lother01.hseq', 'Lpre0001.log', 'state.json', '.Lpre0001.jsonl'];
      for (const name of names) writeFileSync(join(dir, name), 'x');
      const order: string[] = [];
      const lines: string[] = [];
      const outcome = await endPrestart(marked('Lpre0001'), {
        stop: async () => (order.push(`stop with ${readdirSync(dir).length} files`), 'stopped'),
        stagedDir: (e) => (order.push(`dir of ${e.appSessionId}`), dir),
        log: (line) => void lines.push(line),
      });
      expect(outcome).toBe('stopped');
      expect(order).toEqual([`stop with ${names.length} files`, 'dir of app-Lpre0001']);
      expect(readdirSync(dir).sort()).toEqual(['.Lpre0001.jsonl', 'Lother01.hseq', 'Lother01.jsonl', 'Lpre0001.log', 'Lpre00010.hseq', 'Lpre00010.jsonl', 'state.json']);
      expect(lines).toEqual(['session host Lpre0001 (pid 4242) holds a prestart never promoted: not adopted; ended (stopped), 5 staged file(s) removed']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes nothing when its session has no journal directory, and a missing directory is no error', async () => {
    expect(await endPrestart(marked('Lpre0001', { appSessionId: null }), { stop: async () => 'gone', stagedDir: () => null, log: () => {} })).toBe('gone');
    expect(removeStagedFiles(join(tmpdir(), 'maws-staged-missing-dir'), 'Lpre0001')).toBe(0);
    expect(existsSync(join(tmpdir(), 'maws-staged-missing-dir'))).toBe(false);
  });
});
