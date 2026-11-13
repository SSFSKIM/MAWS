// UX wave U3, first landing, M2 (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, decisions 5, 6 and 21):
// head.ts's reading of each event against what the derivation draws, over every recorded fixture, event by event. What
// the reading decides is where work begins and whether a turn holds anything, so that is what is held: a silent event
// never gives a turn that drew nothing a row, a quiet one never gives a turn with no work a row of work, and a work
// event in a turn with no work draws some unless its kind draws only in context. So the head the reducer reads
// (decision 21) and the empty turn it removes (decision 6) cannot drift from the rows the person sees.
import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PASSES, listEventFixtures, listJournals, listSyntheticJournals, loadEventFixture, loadJournal, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { expandedTurnRows } from './derive';
import { headRole, type HeadRole } from './head';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';

// The work kinds that draw a row only where their context gives one (derive.ts), so may draw none: a block with no text
// yet; a call joining a subagent row already drawn; a request already answered; a side thread's later event; a turn's
// end that leaves every call with its result. Any other work event that draws nothing misreads head.ts's table.
const CONTEXTUAL = new Set<SessionEvent['kind']>(['assistant.block.delta', 'assistant.block.complete', 'tool.use', 'subagent.started', 'task.started', 'permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested', 'side.thread.opened', 'side.thread.summarised', 'turn.ended']);

const drawn = (rows: Row[]) => rows.filter((row) => row.kind !== 'divider' && row.kind !== 'time');
// Not the turn's work: the person's prompt, an arrival's row, a hook's, a notice and what a plugin said.
const isWork = (row: Row) =>
  !(row.kind === 'user' || row.kind === 'notice' || (row.kind === 'agent_message' && (row.direction === 'from_child' || (row.direction === 'between' && row.peer?.sender != null))) ||
    (row.kind === 'error' && (row.severity === 'notice' || row.scope === 'plugin' || row.scope === 'hook')));

function misreadings(events: SessionEvent[]): string[] {
  const wrong: string[] = [];
  let state: TranscriptState = createState(null, null);
  for (const event of events) {
    const rowsBefore = new Map([...state.turns.keys()].map((id) => [id, drawn(expandedTurnRows(state, id))]));
    state = applyEvents(state, [event]);
    const turn = [...state.turns.values()].find((candidate) => candidate.events.some((held) => held.id === event.id));
    if (turn === undefined) continue;
    const before = rowsBefore.get(turn.id) ?? [];
    const after = drawn(expandedTurnRows(state, turn.id));
    const role: HeadRole = headRole(event, turn.id);
    const workBefore = before.some(isWork);
    const workAfter = after.some(isWork);
    if (role === 'silent' && before.length === 0 && after.length > 0) wrong.push(`${event.kind} (silent) drew ${after.map((row) => row.kind).join(', ')} in an empty turn`);
    if (role !== 'work' && !workBefore && workAfter) wrong.push(`${event.kind} (${role}) drew the turn's first work: ${after.filter(isWork).map((row) => row.kind).join(', ')}`);
    if (role === 'work' && !workBefore && !workAfter && !CONTEXTUAL.has(event.kind)) wrong.push(`${event.kind} (work) drew no work`);
  }
  return wrong;
}

const sources: [string, () => SessionEvent[]][] = [
  ...FIXTURE_PASSES.flatMap((pass) => listJournals(pass).map((name): [string, () => SessionEvent[]] => [`${pass}/${name}`, () => journalToEvents(loadJournal(pass, name))])),
  ...listSyntheticJournals().map((name): [string, () => SessionEvent[]] => [`transcript/${name}`, () => journalToEvents(loadSyntheticJournal(name))]),
  ...listEventFixtures().map((name): [string, () => SessionEvent[]] => [`events/${name}`, () => loadEventFixture(name)]),
];

describe('head.ts against the rows the derivation draws', () => {
  it.each(sources)('%s: only work begins a turn’s work, and only a quiet event or work gives an empty turn a row', (_, load) => {
    expect(misreadings(load())).toEqual([]);
  });
});
