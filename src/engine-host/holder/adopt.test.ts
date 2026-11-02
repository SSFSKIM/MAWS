// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D10): which live session hosts a
// start adopts. Each through the launcher's adopt, in parallel; a host of another protocol major left running and counted
// as failed; of two hosts naming one session the newest adopted and the other left, counted; a host holding no engine
// handed to the adopt (which releases it) and not counted when that ends it; a failed adoption counted with its reason.
// P5 O16 panel fix wave 1 (sweep#3): a host whose launch committed with no child yet (its predecessor lost mid-spawn) holds
// an engine, or is about to: held and adopted like one, never released as empty; and only a release the host accepted
// goes uncounted, so no failure is left out by what the roster said at the start.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { adoptable, adoptAll, holdsEngine, recordFailed, recordStart } from './adopt';
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
    const { take, leave } = adoptable([older, newer, empty, major]);
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
