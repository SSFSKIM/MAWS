// A background task's end from an engine host older than the UX wave's arrivals (U3, first landing; the whole-branch
// review's finding 3, the architect's rulings of 2026-11-13). An older host sends no `arrival`: it tells a background
// task's end only as `task.notification`, and a window may hold what it sent long after (a session it held before a
// successor adopted it, another machine's host of an earlier build). The modern normaliser marks each
// `task.notification` it emits (`arrivals: true`); one without the mark is an older host's, and its end gets its one line
// from that event (its outcome's dot, its sentence), raising nothing else; one with the mark draws none, its end being
// the arrival's. Nothing session-wide is consulted. The older host's events are recorded: the base normaliser's output
// (`90a91001e`) for the tasks probe's journal, `fixtures/uxwave/u3-tasks-r1.base-events.json`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { carriedOf } from '@shared/engine/arrival-schema';
import type { SessionEvent } from '@shared/graph/events';
import { createBackfillContext, recordToEvents } from '../../../../engine-host/fs/backfill';
import { event } from '../../../../../test/support/agents-events';
import { FIXTURE_DIR, loadUxwaveJournal, loadUxwaveTranscript } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const notices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'notice' ? [`${row.outcome ?? 'no outcome'}: ${row.text}`] : []));
// the lines drawn from task.notification events: an older host's ends
const legacyRows = (events: SessionEvent[], rows: Row[]) => {
  const ids = new Set(events.flatMap((event) => (event.kind === 'task.notification' ? [rowId.notice(null, event.id, 0)] : [])));
  return rows.filter((row) => ids.has(row.id));
};
const lineOf = (row: Row) => (row.kind === 'notice' ? `${row.at}: ${row.outcome}: ${row.text}` : row.id);
const legacyLines = (events: SessionEvent[], rows: Row[]) => legacyRows(events, rows).map(lineOf);
// the tasks whose ends the events' arrivals tell
const arrivedTasks = (events: SessionEvent[]) => new Set(events.flatMap((event) => (event.kind === 'user.message' ? carriedOf(event.arrival).flatMap((entry) => (entry.class === 'task' && entry.taskId !== null ? [entry.taskId] : [])) : [])));
// an older host's events before `at`, the modern normaliser's from it (the serving host changed at `at`)
const cutAt = (at: number) => [...older.filter((event) => event.seq !== null && event.seq < at), ...modern.filter((event) => event.seq !== null && event.seq >= at)];
const older = JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-tasks-r1.base-events.json'), 'utf8')) as SessionEvent[];
const modern = journalToEvents(loadUxwaveJournal('u3-tasks-r1'));
const BUSY_MONITOR = 'completed: Monitor "uxw busy monitor" stream ended';
const FAILURES = ['failed: Background command "uxw fail" failed with exit code 1', 'failed: Background command "uxw busy fail" failed with exit code 1'];

describe('a background task’s end told by an older engine host', () => {
  it('u3-tasks-r1 as the base normaliser mapped it: each background task’s end is one line, in its outcome, in the engine’s words', () => {
    expect(older.some((event) => event.kind === 'user.message' && event.arrival !== undefined)).toBe(false); // the older host's form
    expect(older.some((event) => event.kind === 'task.notification' && event.arrivals !== undefined)).toBe(false);
    const state = reduce(older);
    expect(notices(rowsOf(withAllExpanded(state)))).toEqual([
      'completed: Background command "uxw ok" completed (exit code 0)',
      FAILURES[0],
      'stopped: uxw stop', // the frame's description: the older host's event carries no sentence for a stopped task
      FAILURES[1],
      'completed: Background command "uxw busy ok" completed (exit code 0)',
      'completed: Monitor "uxw monitor" stream ended',
      'completed: Monitor "uxw busy monitor" stream ended',
      'stopped: uxw stall',
    ]); // the foreground commands' ends (600, 664, 826) make none, as they make none from a host that sends arrivals
    // with every turn folded, an end with an outcome stays in view; nothing else is raised for a failure
    const folded = rowsOf(state);
    expect(notices(folded).filter((line) => line.startsWith('failed'))).toEqual(FAILURES);
    expect(folded.filter((row) => row.kind === 'error' && row.severity === 'error')).toEqual([]);
  });

  it('a line drawn after its task’s turn answered leaves that answer the turn’s answer, in view through the fold', () => {
    const withLines = reduce(older);
    const withoutLines = reduce(older.filter((event) => event.kind !== 'task.notification'));
    const answers = (state: TranscriptState) => rowsOf(state).flatMap((row) => (row.kind === 'assistant_text' && row.phase === 'answer' ? [row.id] : []));
    expect(answers(withLines)).toEqual(answers(withoutLines));
    expect(answers(withLines).length).toBeGreaterThan(0);
  });

  it('the same session from a host that sends arrivals: each task.notification is marked, and each failure is one line, never a second from it', () => {
    const notifications = modern.filter((event) => event.kind === 'task.notification');
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.every((event) => event.kind === 'task.notification' && event.arrivals === true)).toBe(true);
    const rows = rowsOf(withAllExpanded(reduce(modern)));
    for (const failed of FAILURES) expect(notices(rows).filter((line) => line === failed)).toHaveLength(1);
    expect(legacyLines(modern, rows)).toEqual([]);
  });

  it('a modern window loaded from seq 359 draws no older host’s line at any step (the turn at 500 that withheld a report included)', () => {
    const window = modern.filter((event) => event.seq === null || event.seq >= 359);
    let state: TranscriptState = createState(null, null);
    for (let at = 0; at < window.length; ) {
      const seq = window[at]!.seq;
      let end = at;
      while (end < window.length && window[end]!.seq === seq) end += 1;
      state = applyEvents(state, window.slice(at, end));
      expect(legacyLines(window, rowsOf(withAllExpanded(state))), `at seq ${seq}`).toEqual([]);
      at = end;
    }
    expect(notices(rowsOf(withAllExpanded(state))).filter((line) => line === FAILURES[1])).toHaveLength(1); // the arrival's, at 578
  });

  it('an older host’s history followed by one modern arrival keeps every line of that history but the one the arrival tells', () => {
    const carriers = modern.filter((event) => event.kind === 'user.message' && event.arrival !== undefined);
    const last = carriers.at(-1)!.seq!;
    const history = older.filter((event) => event.seq !== null && event.seq < last);
    const before = legacyRows(history, rowsOf(withAllExpanded(reduce(history))));
    const after = cutAt(last);
    const told = arrivedTasks(after.filter((event) => event.seq! >= last));
    expect(told.size).toBeGreaterThan(0);
    const kept = before.filter((row) => row.kind === 'notice' && !told.has(row.taskId!));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(before.length); // the arrival's task ended in the history too
    const rows = rowsOf(withAllExpanded(reduce(after)));
    expect(legacyLines(after, rows)).toEqual(kept.map(lineOf));
    const lines = notices(rows);
    expect(new Set(lines).size, 'no completion drawn twice').toBe(lines.length);
  });

  // The whole-branch review's finding 3, its handover round (the architect's ruling of 2026-11-13): the fallback of an
  // unmarked notification yields to the same task's end arrival (its id, and an outcome) in the window.
  const ended = (rows: Row[], taskId: string) => rows.filter((row) => row.kind === 'notice' && row.taskId === taskId && row.outcome !== null);
  const fallbackOf = (taskId: string) => rowId.notice(null, older.find((event) => event.kind === 'task.notification' && event.taskId === taskId)!.id, 0);
  const taskOf = (line: string) => {
    const row = rowsOf(withAllExpanded(reduce(older))).find((drawn) => drawn.kind === 'notice' && `${drawn.outcome}: ${drawn.text}` === line);
    return row?.kind === 'notice' ? row.taskId! : '';
  };

  it.each([
    [578, FAILURES[1]],
    [829, BUSY_MONITOR],
  ])('the host changed at seq %i: the completion the older host told and the arrival tells again is one line, the arrival’s', (at, line) => {
    const taskId = taskOf(line);
    expect(taskId).not.toBe('');
    const rows = rowsOf(withAllExpanded(reduce(cutAt(at))));
    expect(ended(rows, taskId)).toHaveLength(1);
    expect(ended(rows, taskId)[0]!.id).not.toBe(fallbackOf(taskId));
    expect(ended(rows, taskId)[0]!.id.startsWith('notice:')).toBe(true);
    const lines = notices(rows);
    expect(new Set(lines).size, 'no completion drawn twice').toBe(lines.length);
  });

  it('the arrival streams in after the older host’s line was drawn: that line leaves, the arrival’s stands at its own place', () => {
    const taskId = taskOf(FAILURES[1]);
    const events = cutAt(578);
    let state = reduce(events.filter((event) => event.seq! < 578));
    const fallback = rowsOf(withAllExpanded(state)).find((row) => row.id === fallbackOf(taskId));
    expect(fallback, 'drawn while no arrival stands').toBeDefined();
    for (let at = events.findIndex((event) => event.seq! >= 578); at < events.length; ) {
      const seq = events[at]!.seq;
      let end = at;
      while (end < events.length && events[end]!.seq === seq) end += 1;
      state = applyEvents(state, events.slice(at, end));
      expect(ended(rowsOf(withAllExpanded(state)), taskId), `at seq ${seq}`).toHaveLength(1); // never two, never none
      at = end;
    }
    const rows = rowsOf(withAllExpanded(state));
    const [arrival] = ended(rows, taskId);
    expect(arrival!.id).not.toBe(fallbackOf(taskId));
    // at its own place: where its carrier stands (seq 578), not where the older host's notification stood (559)
    const carrier = events.find((event) => event.kind === 'user.message' && carriedOf(event.arrival).some((entry) => entry.class === 'task' && entry.taskId === taskId && entry.outcome !== null))!;
    expect(carrier.seq).toBe(578);
    expect(arrival!.at).toBe(carrier.at);
    expect(fallback!.at).not.toBe(carrier.at);
  });

  it('the arrival is already in the window when the older host’s notification pages in: the fallback is not drawn', () => {
    const taskId = taskOf(FAILURES[1]);
    const events = cutAt(578);
    // an older page rebuilds the store from the whole history, the arrival held before it
    const rows = rowsOf(withAllExpanded(reduce(events)));
    expect(rows.some((row) => row.id === fallbackOf(taskId))).toBe(false);
    expect(ended(rows, taskId)).toHaveLength(1);
  });

  it('a monitor’s event arrival (no outcome) for the same task leaves the older host’s end line standing', () => {
    const taskId = taskOf(BUSY_MONITOR);
    const end = modern.find((event) => event.kind === 'user.message' && carriedOf(event.arrival).some((entry) => entry.class === 'task' && entry.taskId === taskId && entry.outcome !== null));
    expect(end?.kind).toBe('user.message');
    if (end?.kind !== 'user.message') return;
    const last = older.at(-1)!;
    const event: SessionEvent = {
      ...end, id: 'later:event-arrival' as typeof end.id, messageUuid: 'later-event-arrival' as NonNullable<typeof end.messageUuid>, seq: (last.seq ?? 0) + 1, at: last.at,
      arrival: carriedOf(end.arrival).map((entry) => (entry.class === 'task' ? { ...entry, outcome: null, summary: 'uxw busy monitor: tick', durationMs: null } : entry)),
    };
    const rows = rowsOf(withAllExpanded(reduce([...older, event])));
    expect(rows.some((row) => row.id === fallbackOf(taskId))).toBe(true);
    expect(notices(rows)).toContain('no outcome: uxw busy monitor: tick'); // the event's own line, drawn
    expect(notices(rows).filter((line) => line === BUSY_MONITOR)).toHaveLength(1);
  });

  it('no recorded session of a host that sends arrivals draws an older host’s line', () => {
    const journals = readdirSync(join(FIXTURE_DIR, 'uxwave')).filter((name) => /^u3-.*\.jsonl$/.test(name) && !name.endsWith('.transcript.jsonl')).map((name) => name.slice(0, -'.jsonl'.length));
    expect(journals.length).toBeGreaterThan(10);
    for (const name of journals) {
      const events = journalToEvents(loadUxwaveJournal(name));
      expect(legacyLines(events, rowsOf(withAllExpanded(reduce(events)))), name).toEqual([]);
    }
  });
});

// The delta review's finding (the architect's ruling of 2026-11-13, "the fallback in a history read through an older
// host"): the fallback is drawn unless the turn knows the task as a foreground one. An older host's transcript backfill
// tells a background end as a `task.notification` alone, with no start; a task the turn has no start for counts as one
// in the background.
describe('which tasks’ ends an older host’s line is drawn for', () => {
  const BASH = 'toolu_bg';
  const opened = [
    event('turn.started', { userMessageUuid: 'u1', origin: 'human' }, { seq: 1 }),
    event('user.message', { messageUuid: 'u1', content: 'Run it in the background.' }, { seq: 1, n: 1 }),
    event('tool.use', { toolUseId: BASH, toolName: 'Bash', input: { command: 'sleep 1; exit 1', run_in_background: true }, messageUuid: 'a1', apiMessageId: 'msg_1' }, { seq: 2 }),
    event('tool.result', { toolUseId: BASH, content: 'Command running in background with ID: b1', messageUuid: 'r1' }, { seq: 3 }),
  ];
  const start = (isBackground: boolean) => event('task.started', { taskId: 'b1', toolUseId: BASH, taskType: 'local_bash', description: 'sleep', isBackground }, { seq: 4 });
  const toBackground = event('task.updated', { taskId: 'b1', patch: { isBackground: true } }, { seq: 5 });
  const end = (fields: Record<string, unknown> = {}) => event('task.notification', { taskId: 'b1', toolUseId: BASH, status: 'failed', summary: 'Background command "sleep" failed with exit code 1', ...fields }, { seq: 6 });
  const endArrival = event('user.message', {
    messageUuid: 'n1', content: '', isSynthetic: true, origin: 'task-notification',
    arrival: [{ class: 'task', taskId: 'b1', toolUseId: BASH, runId: 'r-1', outcome: 'failed', summary: 'Background command "sleep" failed with exit code 1', durationMs: null, outputFile: null, detail: null }],
  }, { seq: 7 });
  const rowsFor = (events: SessionEvent[]) => rowsOf(withAllExpanded(reduce(events)));
  const fallbacks = (rows: Row[]) => rows.filter((row) => row.id === rowId.notice(null, end().id, 0)).length;
  const endLines = (rows: Row[]) => rows.filter((row) => row.kind === 'notice' && row.taskId === 'b1' && row.outcome !== null).length;

  it('no start in the turn (the end routed by its tool use): one line', () => expect(fallbacks(rowsFor([...opened, end()]))).toBe(1));
  it('a foreground start: none', () => expect(endLines(rowsFor([...opened, start(false), end()]))).toBe(0));
  it('a background start: one', () => expect(fallbacks(rowsFor([...opened, start(true), end()]))).toBe(1));
  it('started in the foreground, then updated to the background: one', () => expect(fallbacks(rowsFor([...opened, start(false), toBackground, end()]))).toBe(1));
  it('a marked event: none', () => expect(endLines(rowsFor([...opened, end({ arrivals: true })]))).toBe(0));
  it('the same task’s end arrival in the window, whichever came first: the arrival’s line alone', () => {
    const together = rowsFor([...opened, end(), endArrival]);
    expect([fallbacks(together), endLines(together)]).toEqual([0, 1]);
    const drawn = reduce([...opened, end()]);
    expect(fallbacks(rowsOf(withAllExpanded(drawn)))).toBe(1);
    const streamed = rowsOf(withAllExpanded(applyEvents(drawn, [endArrival])));
    expect([fallbacks(streamed), endLines(streamed)]).toEqual([0, 1]);
  });
});

describe('a history read through an older host’s transcript backfill', () => {
  // The tasks probe's transcript as build F's backfill (`f1852de3a`, backfill.ts:320-323) mapped it, recorded:
  // `fixtures/uxwave/u3-tasks-r1.base-backfill.json` (no task.started; each end a task.notification alone)
  const baseBackfill = JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-tasks-r1.base-backfill.json'), 'utf8')) as SessionEvent[];
  // the background tasks whose ends draw a line, in the order they end: the commands and monitors, and the background
  // agent's second end, told under another tool use than its call's (no group claims it; this branch's reader draws
  // "Agent \"uxw agent\" finished" for it); the agents' ends told under their calls are their groups'
  const TASKS = ['bky1j6v31', 'bobq8duq2', 'bmo4g9r2h', 'a91c8f61a920a8733', 'bzhlugr58', 'bfa5697eq', 'b42ylgnxq', 'b7yxry0k8', 'b6qw9e9zq'];
  const STALL = 'b6qw9e9zq';
  const noticesOf = (rows: Row[], taskId: string) => rows.filter((row) => row.kind === 'notice' && row.taskId === taskId);

  it('build F’s backfill, replayed: every background end is exactly one line, the older host’s', () => {
    expect(baseBackfill.some((e) => e.kind === 'task.started' || (e.kind === 'task.notification' && e.arrivals !== undefined))).toBe(false);
    const rows = rowsOf(withAllExpanded(reduce(baseBackfill)));
    expect(legacyRows(baseBackfill, rows).map((row) => (row.kind === 'notice' ? row.taskId : row.id))).toEqual(TASKS);
    for (const taskId of TASKS) expect(noticesOf(rows, taskId), taskId).toHaveLength(1);
  });

  it('the same transcript through this branch’s backfill: the same tasks, one line each, and no second line', () => {
    const records = loadUxwaveTranscript('u3-tasks-r1');
    const ctx = createBackfillContext({ sessionId: baseBackfill[0]!.sessionId, agent: null });
    const events = records.flatMap((record) => recordToEvents(record, ctx));
    const rows = rowsOf(withAllExpanded(reduce(events)));
    expect(legacyRows(events, rows)).toEqual([]);
    for (const taskId of TASKS) {
      const ended = noticesOf(rows, taskId).filter((row) => row.kind === 'notice' && row.outcome !== null);
      // the stall is no end to this branch's reader (an event, its own line with no outcome); the older host told it as one
      expect(ended, taskId).toHaveLength(taskId === STALL ? 0 : 1);
      expect(noticesOf(rows, taskId).length, taskId).toBeGreaterThan(0);
    }
  });
});
