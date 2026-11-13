// A background task's end from an engine host older than the UX wave's arrivals (U3, first landing; the whole-branch
// review's finding 3, the architect's ruling of 2026-11-13). After an update a session stays with the engine host it
// runs under until it restarts, and that host sends no `arrival`: it tells a background task's end only as
// `task.notification`. Each such end still gets its one line, from that event (its outcome's dot, its sentence), and
// raises nothing else; a host that sends arrivals draws no second one. The older host's events are recorded: the base
// normaliser's output (`90a91001e`) for the tasks probe's journal, `fixtures/uxwave/u3-tasks-r1.base-events.json`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState, olderHostTaskEnds, type TranscriptState } from './reduce';
import type { Row } from './rows';

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const notices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'notice' ? [`${row.outcome ?? 'no outcome'}: ${row.text}`] : []));
const older = JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-tasks-r1.base-events.json'), 'utf8')) as SessionEvent[];

describe('a background task’s end told by an older engine host', () => {
  it('u3-tasks-r1 as the base normaliser mapped it: each background task’s end is one line, in its outcome, in the engine’s words', () => {
    expect(older.some((event) => event.kind === 'user.message' && event.arrival !== undefined)).toBe(false); // the older host's form
    const state = reduce(older);
    expect(notices(rowsOf(withAllExpanded(state)))).toEqual([
      'completed: Background command "uxw ok" completed (exit code 0)',
      'failed: Background command "uxw fail" failed with exit code 1',
      'stopped: uxw stop', // the frame's description: the older host's event carries no sentence for a stopped task
      'failed: Background command "uxw busy fail" failed with exit code 1',
      'completed: Background command "uxw busy ok" completed (exit code 0)',
      'completed: Monitor "uxw monitor" stream ended',
      'completed: Monitor "uxw busy monitor" stream ended',
      'stopped: uxw stall',
    ]); // the foreground commands' ends (600, 664, 826) make none, as they make none from a host that sends arrivals
    // with every turn folded, an end with an outcome stays in view; nothing else is raised for a failure
    const folded = rowsOf(state);
    expect(notices(folded).filter((line) => line.startsWith('failed'))).toEqual(['failed: Background command "uxw fail" failed with exit code 1', 'failed: Background command "uxw busy fail" failed with exit code 1']);
    expect(folded.filter((row) => row.kind === 'error' && row.severity === 'error')).toEqual([]);
    expect(olderHostTaskEnds(state)).toBe(true);
  });

  it('the same session from a host that sends arrivals: each failure is still one line, never a second from its task.notification', () => {
    const rows = rowsOf(withAllExpanded(reduce(journalToEvents(loadUxwaveJournal('u3-tasks-r1')))));
    for (const failed of ['failed: Background command "uxw fail" failed with exit code 1', 'failed: Background command "uxw busy fail" failed with exit code 1']) {
      expect(notices(rows).filter((line) => line === failed)).toHaveLength(1);
    }
  });

  it('no recorded session of a host that sends arrivals reads as an older host’s, at any step', () => {
    const journals = readdirSync(join(FIXTURE_DIR, 'uxwave')).filter((name) => /^u3-.*\.jsonl$/.test(name) && !name.endsWith('.transcript.jsonl')).map((name) => name.slice(0, -'.jsonl'.length));
    expect(journals.length).toBeGreaterThan(10);
    for (const name of journals) {
      let state: TranscriptState = createState(null, null);
      const events = journalToEvents(loadUxwaveJournal(name));
      for (let at = 0; at < events.length; ) {
        const seq = events[at]!.seq;
        let end = at;
        while (end < events.length && events[end]!.seq === seq) end += 1;
        state = applyEvents(state, events.slice(at, end));
        expect(olderHostTaskEnds(state), `${name} at seq ${seq}`).toBe(false);
        at = end;
      }
    }
  });
});
