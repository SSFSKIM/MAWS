// Review's view state (UX wave U5b, M2; the execution document's Interfaces §E): the key the marks, the folds and the
// place share, the person's fold choices beside the Viewed marks, and the places kept per key. Pure transitions.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { TurnId } from '../../../transcript';
import type { ReviewScope } from './review-model';
import { isFolded } from './stack-model';
import { createReviewUi, foldAll, forSession, isViewed, placeKey, savePlace, setFold, toggleViewed, type ReviewUi } from './view-state';

const A = 'app-a' as AppSessionId;
const T = 'turn:6f1c2e0a-0000-4000-8000-000000000001' as TurnId;
const DIR = '/work/berth';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const KEY = placeKey(DIR, 'uncommitted', null, null);

const ui = (over: Partial<ReviewUi> = {}): ReviewUi => ({ ...createReviewUi({ session: A, directory: DIR }).getState(), ...over });
const folded = (state: ReviewUi, path: string, signature: string) =>
  isFolded({ choice: state.folds.get(KEY)?.get(path), viewed: isViewed(state.viewed, KEY, path, signature), pastCap: false });

describe('the key of a scope’s marks, folds and place', () => {
  it('is the folder and the scope, with the turn for Last turn and the commit’s hash for a commit', () => {
    expect(placeKey(DIR, 'uncommitted', null, null)).toBe(`${DIR}\0uncommitted`);
    expect(placeKey(DIR, 'branch', T, null)).toBe(`${DIR}\0branch`); // a turn names only Last turn's
    expect(placeKey(DIR, 'turn', T, null)).toBe(`${DIR}\0turn\0${T}`);
    expect(placeKey(DIR, 'staged', null, SHA)).toBe(`${DIR}\0staged`); // a commit listed beside another scope is not its key
    // the commit's scope is M9's; its key holds the hash, so each commit's marks, folds and place are its own
    const commit = 'commit' as ReviewScope;
    expect(placeKey(DIR, commit, null, SHA)).toBe(`${DIR}\0commit\0${SHA}`);
    expect(placeKey(DIR, commit, null, SHA)).not.toBe(placeKey(DIR, commit, null, SHA.replace('0', 'f')));
  });
});

describe('folds', () => {
  it('starts with no fold, no place and no reveal, and keeps them for the folder when the session changes', () => {
    const start = ui();
    expect(start.folds.size).toBe(0);
    expect(start.places.size).toBe(0);
    expect(start.reveal).toBeNull();
    const kept = { ...start, ...setFold(start, KEY, 'a.ts', 'closed') };
    const placed = { ...kept, ...savePlace(kept, KEY, { path: 'a.ts', row: null, offset: 4 }), reveal: { path: 'a.ts', n: 1 } };
    const next = { ...placed, ...forSession(A, DIR) };
    expect(next.folds.get(KEY)?.get('a.ts')).toBe('closed');
    expect(next.places.get(KEY)).toEqual({ path: 'a.ts', row: null, offset: 4 });
    expect(next.reveal).toBeNull();
  });

  it('marking Viewed removes the person’s choice, so the mark folds the file', () => {
    let state = ui();
    state = { ...state, ...setFold(state, KEY, 'a.ts', 'open') };
    state = { ...state, ...toggleViewed(state, KEY, 'a.ts', 'sig-1') };
    expect(state.folds.get(KEY)?.has('a.ts')).toBe(false);
    expect(folded(state, 'a.ts', 'sig-1')).toBe(true);
  });

  it('a mark that drops because the file changed unfolds it again, unless the person folded it', () => {
    let state = ui();
    state = { ...state, ...toggleViewed(state, KEY, 'a.ts', 'sig-1') };
    state = { ...state, ...toggleViewed(state, KEY, 'b.ts', 'sig-1') };
    state = { ...state, ...setFold(state, KEY, 'b.ts', 'closed') }; // folded by hand after the mark
    expect(folded(state, 'a.ts', 'sig-2')).toBe(false); // the file changed: the mark no longer holds
    expect(folded(state, 'b.ts', 'sig-2')).toBe(true);
  });

  it('Collapse all sets closed on every file, Expand all sets open on every file, for one key alone', () => {
    const other = placeKey(DIR, 'staged', null, null);
    let state = ui();
    state = { ...state, ...setFold(state, other, 'a.ts', 'open') };
    state = { ...state, ...foldAll(state, KEY, ['a.ts', 'b.ts', 'c.ts'], 'closed') };
    expect([...state.folds.get(KEY)!]).toEqual([
      ['a.ts', 'closed'],
      ['b.ts', 'closed'],
      ['c.ts', 'closed'],
    ]);
    state = { ...state, ...foldAll(state, KEY, ['a.ts', 'b.ts', 'c.ts'], 'open') };
    expect([...state.folds.get(KEY)!.values()]).toEqual(['open', 'open', 'open']);
    expect(state.folds.get(other)?.get('a.ts')).toBe('open');
  });
});

describe('places', () => {
  it('keeps one place per key, the latest written', () => {
    let state = ui();
    state = { ...state, ...savePlace(state, KEY, { path: 'a.ts', row: { side: 'new', line: 12 }, offset: 3 }) };
    state = { ...state, ...savePlace(state, placeKey(DIR, 'turn', T, null), { path: '/work/berth/b.ts', row: null, offset: 0 }) };
    state = { ...state, ...savePlace(state, KEY, { path: 'c.ts', row: { side: 'old', line: 2 }, offset: 0 }) };
    expect(state.places.get(KEY)).toEqual({ path: 'c.ts', row: { side: 'old', line: 2 }, offset: 0 });
    expect(state.places.get(placeKey(DIR, 'turn', T, null))).toEqual({ path: '/work/berth/b.ts', row: null, offset: 0 });
  });
});
