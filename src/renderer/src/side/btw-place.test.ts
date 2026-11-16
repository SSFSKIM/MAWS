// `btwPlace`'s whole table (UX wave U4b, M2; Interfaces B): the foot exactly while the column is shown for this session
// and the session is not the floated one; the session's pane in every other row.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { btwPlace } from './btw-place';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

describe('btwPlace', () => {
  it.each([
    ['the column not shown, for this session', { shown: false, session: A }, null, 'pane'],
    ['the column not shown, for another', { shown: false, session: B }, null, 'pane'],
    ['the column not shown, with no session', { shown: false, session: null }, null, 'pane'],
    ['the column not shown, this session floated', { shown: false, session: A }, A, 'pane'],
    ['the column shown for another session', { shown: true, session: B }, null, 'pane'],
    ['the column shown for another session, this one floated', { shown: true, session: B }, A, 'pane'],
    ['the column shown for this session, which is floated', { shown: true, session: A }, A, 'pane'],
    ['the column shown for this session, nothing floated', { shown: true, session: A }, null, 'foot'],
    ['the column shown for this session, another floated', { shown: true, session: A }, B, 'foot'],
  ] as const)('%s', (_, column, floated, place) => {
    expect(btwPlace(column, floated, A)).toBe(place);
  });
});
