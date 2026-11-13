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
import type { SessionEvent } from '@shared/graph/events';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const notices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'notice' ? [`${row.outcome ?? 'no outcome'}: ${row.text}`] : []));
// the lines drawn from task.notification events: an older host's ends
const legacyLines = (events: SessionEvent[], rows: Row[]) => {
  const ids = new Set(events.flatMap((event) => (event.kind === 'task.notification' ? [rowId.notice(null, event.id, 0)] : [])));
  return rows.filter((row) => ids.has(row.id)).map((row) => (row.kind === 'notice' ? `${row.at}: ${row.outcome}: ${row.text}` : row.id));
};
const older = JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-tasks-r1.base-events.json'), 'utf8')) as SessionEvent[];
const modern = journalToEvents(loadUxwaveJournal('u3-tasks-r1'));
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

  it('a modern window loaded from seq 359 draws no older host’s line (the turn at 500 that withheld a report included)', () => {
    const window = modern.filter((event) => event.seq === null || event.seq >= 359);
    const rows = rowsOf(withAllExpanded(reduce(window)));
    expect(legacyLines(window, rows)).toEqual([]);
    expect(notices(rows).filter((line) => line === FAILURES[1])).toHaveLength(1); // the arrival's, at 578
  });

  it('an older host’s history followed by one modern arrival keeps every line of that history', () => {
    const carriers = modern.filter((event) => event.kind === 'user.message' && event.arrival !== undefined);
    const last = carriers.at(-1)!.seq!;
    const history = older.filter((event) => event.seq !== null && event.seq < last);
    const before = legacyLines(history, rowsOf(withAllExpanded(reduce(history))));
    expect(before.length).toBeGreaterThan(0);
    const after = [...history, ...modern.filter((event) => event.seq !== null && event.seq >= last)];
    const rows = rowsOf(withAllExpanded(reduce(after)));
    expect(legacyLines(after, rows)).toEqual(before);
    expect(notices(rows).length).toBeGreaterThan(before.length); // the arrival's own line, beside them
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
