// UX wave U3, first landing, M2 (docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md, decisions 5, 6 and 21):
// head.ts's reading of each event against what the derivation draws for it. Over every recorded fixture, an event the
// reading calls silent adds no row to its turn, and one it calls quiet adds no row of the model's work; so the head the
// reducer reads (decision 21) and the empty turn it removes (decision 6) cannot drift from the rows the person sees.
import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PASSES, listEventFixtures, listJournals, listSyntheticJournals, loadEventFixture, loadJournal, loadSyntheticJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { expandedTurnRows } from './derive';
import { headRole } from './head';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row, TurnId } from './rows';

const QUIET_ROW = (row: Row) => row.kind === 'user' || (row.kind === 'error' && (row.severity === 'notice' || row.scope === 'plugin' || row.scope === 'hook'));

// Each event, one at a time, with the rows its turn gained: [event, role, added rows] for every event placed in a turn.
function walk(events: SessionEvent[]): { event: SessionEvent; role: string; added: Row[] }[] {
  const seen: { event: SessionEvent; role: string; added: Row[] }[] = [];
  let state: TranscriptState = createState(null, null);
  for (const event of events) {
    const before = new Map<TurnId, Set<string>>([...state.turns.keys()].map((id) => [id, new Set(expandedTurnRows(state, id).map((row) => row.id))]));
    state = applyEvents(state, [event]);
    const turn = [...state.turns.values()].find((candidate) => candidate.events.some((held) => held.id === event.id));
    if (turn === undefined) continue;
    const had = before.get(turn.id) ?? new Set<string>();
    const added = expandedTurnRows(state, turn.id).filter((row) => !had.has(row.id) && row.kind !== 'divider' && row.kind !== 'time');
    seen.push({ event, role: headRole(event, turn.id), added });
  }
  return seen;
}

const sources: [string, () => SessionEvent[]][] = [
  ...FIXTURE_PASSES.flatMap((pass) => listJournals(pass).map((name): [string, () => SessionEvent[]] => [`${pass}/${name}`, () => journalToEvents(loadJournal(pass, name))])),
  ...listSyntheticJournals().map((name): [string, () => SessionEvent[]] => [`transcript/${name}`, () => journalToEvents(loadSyntheticJournal(name))]),
  ...listEventFixtures().map((name): [string, () => SessionEvent[]] => [`events/${name}`, () => loadEventFixture(name)]),
];

describe('head.ts against the rows the derivation draws', () => {
  it.each(sources)('%s: a silent event adds no row to its turn, a quiet one no row of work', (_, load) => {
    const wrong = walk(load())
      .filter(({ role, added }) => (role === 'silent' && added.length > 0) || (role === 'quiet' && added.some((row) => !QUIET_ROW(row))))
      .map(({ event, role, added }) => `${event.kind} (${role}) added ${added.map((row) => row.kind).join(', ')}`);
    expect(wrong).toEqual([]);
  });
});
