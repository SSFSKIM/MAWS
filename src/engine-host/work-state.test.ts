// P5 O2 M2: the work state's transition table (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Interfaces "The work
// state"), row by row, the durable crons beside the Stop's (P5 Decision Log 46), and the Stop input's lenient read.
import { describe, expect, it } from 'vitest';
import { CRON_TOOLS, sessionCronsOf, WorkState, type LaunchKind, type SessionCron } from './work-state';

const cron = (id: string, over: Partial<SessionCron> = {}): SessionCron => ({ id, schedule: '*/5 * * * *', recurring: true, prompt: `check ${id}`, ...over });

const state = (kind: LaunchKind = 'fresh') => new WorkState(kind);

// One whole turn: start, then what `during` does, then the end.
function turn(work: WorkState, during: (w: WorkState) => void = () => {}): void {
  work.turnStarted();
  during(work);
  work.turnEnded();
}

describe('launch', () => {
  it('a fresh launch and a resume after a release start known and empty', () => {
    expect(state('fresh').snapshot()).toEqual({ crons: [], unknown: null });
    expect(state('resumed_after_release').snapshot()).toEqual({ crons: [], unknown: null });
  });

  it('any other resume starts unknown until the first Stop: --resume resurrects a session-only cron, which can fire before it', () => {
    const work = state('resumed');
    expect(work.snapshot()).toEqual({ crons: [], unknown: 'resumed' });
    work.durableRead([]); // the scheduled-tasks file holds none of its jobs: the session-only ones are still unread
    expect(work.snapshot()).toEqual({ crons: [], unknown: 'resumed' });
    turn(work, (w) => w.stopped([cron('resurrected')], []));
    expect(work.snapshot()).toEqual({ crons: [cron('resurrected')], unknown: null });
  });

  it('an adopted process is unknown until both a task snapshot and a Stop arrive', () => {
    const work = state('adopted');
    expect(work.snapshot().unknown).toBe('adopted');
    work.stopped([], []);
    expect(work.snapshot().unknown).toBe('adopted'); // the crons are read; the tasks are not yet
    work.tasksChanged();
    expect(work.snapshot()).toEqual({ crons: [], unknown: null });
  });

  it('an adopted process read in the other order: the task snapshot first, then the Stop', () => {
    const work = state('adopted');
    work.tasksChanged();
    expect(work.snapshot().unknown).toBe('adopted'); // the crons are still unread
    work.stopped([], []);
    expect(work.snapshot().unknown).toBeNull();
  });
});

describe('the cron tools', () => {
  it('are CronCreate, CronDelete and ScheduleWakeup', () => {
    expect([...CRON_TOOLS].sort()).toEqual(['CronCreate', 'CronDelete', 'ScheduleWakeup']);
  });

  it('known(l) or dirty(l) and a cron tool: dirty(l), read as unknown "dirty" with the last list', () => {
    const work = state();
    turn(work, (w) => w.stopped([cron('a')], []));
    work.turnStarted();
    work.cronTool();
    expect(work.snapshot()).toEqual({ crons: [cron('a')], unknown: 'dirty' });
    work.cronTool(); // dirty stays dirty
    expect(work.snapshot()).toEqual({ crons: [cron('a')], unknown: 'dirty' });
  });

  it('unknown(w) and a cron tool: unknown(w), its reason kept', () => {
    const work = state('resumed');
    work.turnStarted();
    work.cronTool();
    expect(work.snapshot().unknown).toBe('resumed');
  });
});

describe('the Stop', () => {
  it('any state and a Stop with a list: known(list)', () => {
    for (const before of [(w: WorkState) => w.cronTool(), (w: WorkState) => w.stopped('unreadable', []), () => {}]) {
      const work = state('resumed');
      work.turnStarted();
      before(work);
      work.stopped([cron('b')], []);
      expect(work.snapshot()).toEqual({ crons: [cron('b')], unknown: null });
    }
  });

  it('any state and an unreadable Stop: unknown "stop_unreadable", and the Stop is seen', () => {
    const work = state();
    turn(work, (w) => {
      w.cronTool();
      w.stopped('unreadable', []);
    });
    expect(work.snapshot().unknown).toBe('stop_unreadable'); // not turn_ended_without_stop: the turn's Stop came
  });

  it('a Stop listing nothing after a CronDelete leaves the session known and empty', () => {
    const work = state();
    turn(work, (w) => {
      w.cronTool();
      w.stopped([cron('c')], []);
    });
    turn(work, (w) => {
      w.cronTool();
      w.stopped([], []);
    });
    expect(work.snapshot()).toEqual({ crons: [], unknown: null });
  });
});

describe('the turn end', () => {
  it('dirty(l) and a turn that ended without a Stop (an interrupt, an API error): unknown "turn_ended_without_stop" until the next Stop', () => {
    const work = state();
    turn(work, (w) => w.cronTool());
    expect(work.snapshot()).toEqual({ crons: [], unknown: 'turn_ended_without_stop' });
    turn(work); // a turn with no Stop does not read it either
    expect(work.snapshot().unknown).toBe('turn_ended_without_stop');
    turn(work, (w) => w.stopped([cron('d')], []));
    expect(work.snapshot()).toEqual({ crons: [cron('d')], unknown: null });
  });

  it('known(l) and a human turn that ended without a Stop, with no cron tool: known(l)', () => {
    const work = state();
    turn(work, (w) => w.stopped([cron('e')], []));
    turn(work); // interrupted before any cron tool
    expect(work.snapshot()).toEqual({ crons: [cron('e')], unknown: null });
  });

  it('turnStarted clears the turn\'s Stop-seen mark: a Stop in one turn does not cover a cron tool in the next', () => {
    const work = state();
    turn(work, (w) => w.stopped([], []));
    turn(work, (w) => w.cronTool());
    expect(work.snapshot().unknown).toBe('turn_ended_without_stop');
  });
});

describe('tasks', () => {
  it('tasks unknown and a background_tasks_changed: tasks known', () => {
    const work = state('adopted');
    work.stopped([], []);
    work.tasksChanged();
    expect(work.snapshot().unknown).toBeNull();
  });

  it('a task snapshot leaves the crons as they were', () => {
    const work = state();
    work.turnStarted();
    work.cronTool();
    work.tasksChanged();
    expect(work.snapshot().unknown).toBe('dirty');
  });
});

// The durable crons (P5 Decision Log 46): no Stop lists them; the scheduled-tasks file is read at each Stop and at a
// resume's launch, and its jobs join the Stop's list.
describe('the durable crons', () => {
  it('a durable job created before a resume holds the session from the launch, before any Stop', () => {
    const work = state('resumed_after_release');
    work.durableRead([cron('durable')]);
    expect(work.snapshot()).toEqual({ crons: [cron('durable')], unknown: null });
  });

  it('each Stop reads both: the Stop\'s list and the file\'s jobs, merged; a CronDelete of the durable job empties both', () => {
    const work = state();
    turn(work, (w) => {
      w.cronTool(); // CronCreate durable: true
      w.stopped([], [cron('durable')]); // the Stop lists none of it (the probe's durable `hold`)
    });
    expect(work.snapshot()).toEqual({ crons: [cron('durable')], unknown: null });
    turn(work, (w) => w.stopped([cron('session')], [cron('durable')]));
    expect(work.snapshot()).toEqual({ crons: [cron('session'), cron('durable')], unknown: null });
    turn(work, (w) => {
      w.cronTool();
      w.stopped([], []);
    });
    expect(work.snapshot()).toEqual({ crons: [], unknown: null });
  });

  it('a file that exists but cannot be read is unknown "durable_unreadable" until a read succeeds', () => {
    const work = state('resumed_after_release');
    work.durableRead('unreadable');
    expect(work.snapshot()).toEqual({ crons: [], unknown: 'durable_unreadable' });
    turn(work, (w) => w.stopped([cron('session')], 'unreadable'));
    expect(work.snapshot()).toEqual({ crons: [cron('session')], unknown: 'durable_unreadable' });
    turn(work, (w) => w.stopped([], []));
    expect(work.snapshot()).toEqual({ crons: [], unknown: null });
  });

  it('a resume\'s first Stop reason outranks the file\'s: the session-only crons are still unread', () => {
    const work = state('resumed');
    work.durableRead('unreadable');
    expect(work.snapshot().unknown).toBe('resumed');
  });
});

// P5 Decision Log 49: the cron record the state file keeps, which bounds a resume's unknown
describe('the cron record', () => {
  it('is the last Stop\'s list, clean after a Stop and not after a cron tool or an unreadable Stop', () => {
    const work = state();
    expect(work.cronRecord()).toEqual({ sessionCrons: [], toolSinceStop: false });
    turn(work, (w) => {
      w.cronTool();
      expect(w.cronRecord()).toEqual({ sessionCrons: [], toolSinceStop: true });
      w.stopped([cron('a')], [cron('durable')]);
    });
    expect(work.cronRecord()).toEqual({ sessionCrons: [cron('a')], toolSinceStop: false }); // the durable jobs are the file's
    turn(work, (w) => w.stopped('unreadable', []));
    expect(work.cronRecord().toolSinceStop).toBe(true);
  });

  it('a resume whose record is clean starts known and empty', () => {
    const work = state('resumed');
    work.resumedWith({ sessionCrons: [], toolSinceStop: false });
    expect(work.snapshot()).toEqual({ crons: [], unknown: null });
  });

  it.each([
    ['a listed session cron', { sessionCrons: [cron('a')], toolSinceStop: false }],
    ['a cron tool since the Stop', { sessionCrons: [], toolSinceStop: true }],
    ['no record (missing, unreadable, or an older build\'s)', null],
  ])('a resume with %s stays unknown until its first Stop', (_case, record) => {
    const work = state('resumed');
    work.resumedWith(record);
    expect(work.snapshot().unknown).toBe('resumed');
    turn(work, (w) => w.stopped([], []));
    expect(work.snapshot().unknown).toBeNull();
  });

  it('only a resume reads it: an adopted process stays unknown', () => {
    const work = state('adopted');
    work.resumedWith({ sessionCrons: [], toolSinceStop: false });
    expect(work.snapshot().unknown).toBe('adopted');
  });
});

describe('the Stop input, read leniently', () => {
  it('reads session_crons, dropping an entry of the wrong shape with a log line', () => {
    const dropped: string[] = [];
    const crons = sessionCronsOf({ hook_event_name: 'Stop', session_crons: [cron('ok'), { id: 'no-schedule', recurring: true, prompt: 'x' }, 'junk', cron('also-ok', { recurring: false })] }, (line) => dropped.push(line));
    expect(crons).toEqual([cron('ok'), cron('also-ok', { recurring: false })]);
    expect(dropped).toHaveLength(2);
  });

  it('keeps an entry\'s known fields only, so a later engine\'s extra field never reaches the status', () => {
    expect(sessionCronsOf({ session_crons: [{ ...cron('x'), durable: true }] }, () => {})).toEqual([cron('x')]);
  });

  it('is unreadable when session_crons is not an array (the SPEC says it is always present)', () => {
    expect(sessionCronsOf({ hook_event_name: 'Stop' }, () => {})).toBe('unreadable');
    expect(sessionCronsOf({ session_crons: {} }, () => {})).toBe('unreadable');
  });
});
