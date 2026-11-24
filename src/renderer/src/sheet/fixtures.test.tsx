// G1.a (the C3 plan's M3): the components render every fixture directory of the pinned set. Each side that has a record
// is drawn as a session's sheet: one card per listed question in the model's order, one accepted card per pending
// outcome, a line per question a queued dismissal hides; and the overview lists the summary of every record. The walk
// reads the pin's directories, so a re-pin that adds a case is covered with no edit.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { summaryOf } from '@shared/sheet/read';
import { EMPTY_MEMORY, SessionSheet, SheetOverview } from './index';
import { fixtureHost } from './test-support/fixture-host';
import { PIN_CASES } from './test-support/pin';

afterEach(cleanup);
const attributes = (selector: string, name: string) => [...document.querySelectorAll(selector)].map((element) => element.getAttribute(name));

describe('every fixture directory of the pin', () => {
  it('holds the set’s twenty-one cases', () => {
    expect(PIN_CASES.length).toBeGreaterThanOrEqual(21);
  });

  const sides = PIN_CASES.flatMap((entry) => (['before', 'after'] as const).filter((side) => entry[side] !== null).map((side) => [entry.name, side, entry[side]!] as const));
  it.each(sides)('%s, %s: a card per listed question, an accepted card per pending outcome, a line per hidden question', (_name, _side, model) => {
    render(<SessionSheet model={model} memory={EMPTY_MEMORY} onMemory={() => {}} host={fixtureHost()} />);
    expect(attributes('[data-sheet-question]', 'data-sheet-question')).toEqual(model.open.map((question) => question.id));
    expect(attributes('[data-sheet-outcome]', 'data-sheet-outcome')).toEqual(model.pending.map((outcome) => outcome.id));
    expect(attributes('[data-sheet-hidden]', 'data-sheet-hidden')).toEqual(model.hidden.map((hidden) => hidden.id));
  });

  // The befores are one machine's records and the afters another's: one machine holds one record per session.
  it.each(['before', 'after'] as const)('lists every record with something on its sheet in the overview (%s)', (side) => {
    const models = PIN_CASES.flatMap((entry) => (entry[side] === null ? [] : [entry[side]]));
    const summaries = models.map((model, i) => summaryOf(model, { appSessionId: null, title: model.session, live: i % 2 === 0 }));
    const listed = summaries.filter((summary) => summary.open + summary.queued + summary.pending + summary.hidden > 0);
    render(<SheetOverview sessions={summaries} onOpen={() => {}} />);
    expect(attributes('[data-sheet-session]', 'data-sheet-session').sort()).toEqual(listed.map((summary) => summary.session).sort());
  });
});
