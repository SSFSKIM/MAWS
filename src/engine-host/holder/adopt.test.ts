// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D10): which live session hosts a
// start adopts. Each through the launcher's adopt, in parallel; a host of another protocol major left running and counted
// as failed; of two hosts naming one session the newest adopted and the other left, counted; a host holding no engine
// handed to the adopt (which releases it) and not counted when that ends it; a failed adoption counted with its reason.
// P5 O16 panel fix wave 1 (sweep#3): a host whose launch committed with no child yet (its predecessor lost mid-spawn) holds
// an engine, or is about to: held and adopted like one, never released as empty; and only a release the host accepted
// goes uncounted, so no failure is left out by what the roster said at the start.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { adoptable, adoptAll, backupStagedState, clearDeadHost, endPrestart, holdsEngine, recordFailed, recordStart, removeStagedFiles, restoreStagedState } from './adopt';
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
      end: async () => 'ended',
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
      end: async () => 'ended',
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

// Ticket 851, M1 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-1 and R4-2; M1's review): a roster entry
// marked `prestart` is a prestart whose promotion was never acknowledged. Its host is asked to discard it, which the
// host decides atomically against a promotion still in flight: discarded, its launch's staged files (its journal and
// host map, base and rotations) are removed, then its entry, and nothing else; found promoted, it is adopted as any
// host. Until that is decided its session is held, so no launch runs beside it; a discard that fails leaves it guarded.
describe('a prestart never promoted', () => {
  const marked = (holderId: string, over: Partial<RosterEntry> = {}) => entry(holderId, { prestart: true, ...over });
  const tableOf = () => new ProcessTable({ ps: async () => '', log: () => {}, isAlive: () => true, procStartOf: () => 'start' });

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

  it('is ended, or adopted as any host when its host says it was promoted; an end that fails is counted', async () => {
    const adopted: string[] = [];
    const ended: string[] = [];
    const outcome = await adoptAll([entry('good0001'), marked('pre00001'), marked('pre00002'), marked('pre00003')], {
      adopt: async (e) => (adopted.push(`${e.holderId} ${e.prestart === true ? 'marked' : 'unmarked'}`), e.appSessionId as AppSessionId),
      end: async (e) => {
        ended.push(e.holderId);
        if (e.holderId === 'pre00003') throw new Error('no session host answered');
        return e.holderId === 'pre00002' ? 'promoted' : 'ended';
      },
      log: () => {},
    });
    expect(adopted.sort()).toEqual(['good0001 unmarked', 'pre00002 unmarked']);
    expect(ended.sort()).toEqual(['pre00001', 'pre00002', 'pre00003']);
    expect(outcome.adopted.sort()).toEqual(['app-good0001', 'app-pre00002']);
    expect(outcome.ended.map((e) => e.holderId)).toEqual(['pre00001']);
    expect(outcome.failed.map(({ entry: e, reason }) => [e.holderId, reason])).toEqual([['pre00003', 'no session host answered']]);
  });

  it('holds its session at the start, a commit in flight too, so a launch of it is refused until its end is decided', async () => {
    const table = tableOf();
    const stopped: string[] = [];
    const stop = async (e: RosterEntry): Promise<HeldStopOutcome> => (stopped.push(e.holderId), 'stopped');
    const held = recordStart(table, [marked('pre00001'), marked('pre00002', { state: 'ready', child: null }), marked('pre00003', { appSessionId: null, state: 'ready', child: null })], { stop, child: () => null });
    expect(held.sort()).toEqual(['app-pre00001', 'app-pre00002']);
    expect(table.isAdopting('app-pre00002' as AppSessionId)).toBe(true);
    expect(await table.shutdown({ graceMs: 0 })).toEqual({ stopped: 2, forced: 0 });
    expect(stopped.sort()).toEqual(['pre00001', 'pre00002']);
  });

  it('beside an ordinary host of its session, which takes the hold, is recorded unattached', () => {
    const table = tableOf();
    const stop = async (): Promise<HeldStopOutcome> => 'stopped';
    recordStart(table, [entry('older001', { appSessionId: 'app-shared' }), marked('pre00001', { appSessionId: 'app-shared', state: 'ready', child: null })], { stop, child: () => null });
    expect(table.unattachedHosts('app-shared' as AppSessionId).map((h) => h.holderId)).toEqual(['pre00001']);
  });

  it('whose end failed stays guarded, a launched one with no child yet too, until its shutdown closed admission', () => {
    const table = tableOf();
    const stop = async (): Promise<HeldStopOutcome> => 'stopped';
    const launched = marked('pre00002', { state: 'ready', child: null });
    recordFailed(table, [{ entry: launched, reason: 'no session host answered' }], { stop, child: () => null });
    expect(table.unattachedHosts('app-pre00002' as AppSessionId).map((h) => h.holderId)).toEqual(['pre00002']);
  });

  describe('its end', () => {
    let dir: string;
    const names = ['Lpre0001.jsonl', 'Lpre0001.1.jsonl', 'Lpre0001.2.jsonl', 'Lpre0001.hseq', 'Lpre0001.1.hseq', 'Lpre00010.jsonl', 'Lpre00010.hseq', 'Lother01.jsonl', 'Lother01.hseq', 'Lpre0001.log', 'state.json', '.Lpre0001.jsonl'];
    const left = ['.Lpre0001.jsonl', 'Lother01.hseq', 'Lother01.jsonl', 'Lpre0001.log', 'Lpre00010.hseq', 'Lpre00010.jsonl', 'state.json'];
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'maws-staged-'));
      for (const name of names) writeFileSync(join(dir, name), 'x');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const run = async (answer: 'discarded' | 'discarding' | 'promoted') => {
      const order: string[] = [];
      const lines: string[] = [];
      const outcome = await endPrestart(marked('Lpre0001'), {
        discard: async () => (order.push(`discard with ${readdirSync(dir).length} files`), answer),
        exited: async () => 'alive',
        stagedDir: () => dir,
        removeEntry: () => void order.push(`entry with ${readdirSync(dir).length} files`),
        log: (line) => void lines.push(line),
      });
      return { outcome, order, lines };
    };

    it('discarded: removes that launch\'s journal and host map files, then its entry, and nothing else', async () => {
      const { outcome, order, lines } = await run('discarded');
      expect(outcome).toBe('ended');
      expect(order).toEqual([`discard with ${names.length} files`, `entry with ${left.length} files`]);
      expect(readdirSync(dir).sort()).toEqual(left);
      expect(lines).toEqual(['session host Lpre0001 (pid 4242) holds a prestart never promoted: discarded, 5 staged file(s) removed, its entry removed']);
    });

    it('still exiting: removes the staged files and keeps the entry, which its host would write again', async () => {
      const { outcome, order } = await run('discarding');
      expect(outcome).toBe('ended');
      expect(order).toEqual([`discard with ${names.length} files`]);
      expect(readdirSync(dir).sort()).toEqual(left);
    });

    it('promoted meanwhile: removes nothing, and answers so', async () => {
      const { outcome, order } = await run('promoted');
      expect(outcome).toBe('promoted');
      expect(order).toEqual([`discard with ${names.length} files`]);
      expect(readdirSync(dir).length).toBe(names.length);
    });

    it('a staged file that cannot be removed keeps the entry for the next start, and throws nothing', async () => {
      rmSync(join(dir, 'Lpre0001.1.hseq'));
      mkdirSync(join(dir, 'Lpre0001.1.hseq'));
      writeFileSync(join(dir, 'Lpre0001.1.hseq', 'inside'), 'x'); // a directory: rmSync without recursion refuses it
      const { outcome, order, lines } = await run('discarded');
      expect(outcome).toBe('ended');
      expect(order).toEqual([`discard with ${names.length} files`]);
      expect(lines.join('\n')).toContain('its staged files could not all be removed');
    });

    // The panel's scalpel-1#2: a marked host that refuses the successor's connection is one already ending its prestart
    // (its writer lost). Once it has exited, its entry as the roster has it now decides, as a dead host's at the start:
    // still marked, its rollback is finished before the start lets its session go, so no later launch's files are taken
    // for its own at the next start.
    describe('a host that cannot be asked (scalpel-1#2)', () => {
      let stateDir: string;
      beforeEach(() => {
        stateDir = mkdtempSync(join(tmpdir(), 'maws-staged-state-'));
      });
      afterEach(() => rmSync(stateDir, { recursive: true, force: true }));
      const refused = async (): Promise<never> => {
        throw new Error('the session host refused the connection');
      };

      it('and has exited still marked: its staged files and the state it wrote go, then its entry', async () => {
        backupStagedState(stateDir, 'app-Lpre0001', 'Lpre0001'); // no earlier state
        writeFileSync(join(stateDir, 'app-Lpre0001.json'), '{"staged":true}'); // the staged commit's
        const removed: string[] = [];
        const outcome = await endPrestart(marked('Lpre0001'), { discard: refused, exited: async (e) => e, stagedDir: () => dir, removeEntry: (e) => void removed.push(e.holderId), log: () => {}, stateDir });
        expect(outcome).toBe('ended');
        expect(readdirSync(dir).sort()).toEqual(left);
        expect(readdirSync(stateDir)).toEqual([]);
        expect(removed).toEqual(['Lpre0001']);
      });

      it('and has exited promoted: its files stay, its entry alone goes', async () => {
        const removed: string[] = [];
        const outcome = await endPrestart(marked('Lpre0001'), { discard: refused, exited: async (e) => ({ ...e, prestart: undefined }), stagedDir: () => dir, removeEntry: (e) => void removed.push(e.holderId), log: () => {} });
        expect(outcome).toBe('ended');
        expect(readdirSync(dir).length).toBe(names.length);
        expect(removed).toEqual(['Lpre0001']);
      });

      it('and lives on past its exit bound: a failed adoption, nothing removed', async () => {
        const removed: string[] = [];
        await expect(endPrestart(marked('Lpre0001'), { discard: refused, exited: async () => 'alive', stagedDir: () => dir, removeEntry: (e) => void removed.push(e.holderId), log: () => {} })).rejects.toThrow(/refused the connection/);
        expect(readdirSync(dir).length).toBe(names.length);
        expect(removed).toEqual([]);
      });
    });

    it('a dead host\'s: staged files then entry; a failure keeps the entry; an unmarked one\'s entry alone; nothing throws', () => {
      const removed: string[] = [];
      const lines: string[] = [];
      const deps = { stagedDir: () => dir, removeEntry: (e: RosterEntry) => void removed.push(e.holderId), log: (line: string) => void lines.push(line) };
      clearDeadHost(entry('ordinary'), deps);
      clearDeadHost(marked('Lpre0001'), deps);
      expect(removed).toEqual(['ordinary', 'Lpre0001']);
      expect(readdirSync(dir).sort()).toEqual(left);
      writeFileSync(join(dir, 'Lpre0002.jsonl'), 'x');
      mkdirSync(join(dir, 'Lpre0002.hseq'));
      writeFileSync(join(dir, 'Lpre0002.hseq', 'inside'), 'x');
      clearDeadHost(marked('Lpre0002'), deps);
      expect(removed).toEqual(['ordinary', 'Lpre0001']);
      clearDeadHost(entry('ordinary2'), { ...deps, removeEntry: () => { throw new Error('EBUSY'); } });
      expect(lines.join('\n')).toContain('EBUSY');
    });
  });

  it('removeStagedFiles: a directory that does not exist has none', () => {
    expect(removeStagedFiles(join(tmpdir(), 'maws-staged-missing-dir'), 'Lpre0001')).toBe(0);
    expect(existsSync(join(tmpdir(), 'maws-staged-missing-dir'))).toBe(false);
  });
});

// The panel's scalpel-1#8: the state backup of a staged commit. Its marker is published whole (a temporary renamed into
// place), after the copies; a crash before the marker leaves copies (and maybe a torn temporary) the restore removes,
// the state itself untouched, since the commit writes nothing before its marker.
describe('the state backup of a staged commit (scalpel-1#8)', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'maws-state-backup-'));
  });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  it('a crash after the copies and before the marker: the restore removes the copies and the torn temporary, and keeps the state', () => {
    writeFileSync(join(stateDir, 'app-x.json'), 'before');
    writeFileSync(join(stateDir, 'app-x.json.prestart-L1'), 'before');
    writeFileSync(join(stateDir, 'app-x.prestart-L1.tmp'), '{"files":{"app-x.js'); // never published
    restoreStagedState(stateDir, 'app-x', 'L1');
    expect(readdirSync(stateDir)).toEqual(['app-x.json']);
    expect(readFileSync(join(stateDir, 'app-x.json'), 'utf8')).toBe('before');
  });

  it('publishes its marker whole, and a restore puts back what existed and removes what did not', () => {
    writeFileSync(join(stateDir, 'app-x.json'), 'before');
    backupStagedState(stateDir, 'app-x', 'L1');
    expect(readdirSync(stateDir).sort()).toEqual(['app-x.json', 'app-x.json.prestart-L1', 'app-x.prestart-L1']);
    writeFileSync(join(stateDir, 'app-x.json'), 'after');
    writeFileSync(join(stateDir, 'app-x.cron.json'), 'after');
    restoreStagedState(stateDir, 'app-x', 'L1');
    expect(readdirSync(stateDir)).toEqual(['app-x.json']);
    expect(readFileSync(join(stateDir, 'app-x.json'), 'utf8')).toBe('before');
  });
});
