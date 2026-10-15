// The renderer's `present` route (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13, H1): read from the
// window's URL as main loads it, the app itself everywhere else.
import { describe, expect, it } from 'vitest';
import { presentParams } from './PresentRoute';

const DECK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('the present route', () => {
  it('reads the deck, the role, the slide and whether a presenter window is paired', () => {
    expect(presentParams(`?present=1&artifact=${DECK}&role=presenter&slide=s2&paired=1&e2e=1`)).toEqual({ artifactId: DECK, role: 'presenter', slideId: 's2', paired: true });
    expect(presentParams(`?present=1&artifact=${DECK}&role=audience`)).toEqual({ artifactId: DECK, role: 'audience', slideId: null, paired: false });
  });

  it('is not the route without its mark, a deck or a known role', () => {
    expect(presentParams('?e2e=1')).toBeNull();
    expect(presentParams(`?artifact=${DECK}&role=audience`)).toBeNull();
    expect(presentParams('?present=1&role=audience')).toBeNull();
    expect(presentParams(`?present=1&artifact=${DECK}&role=speaker`)).toBeNull();
  });
});
