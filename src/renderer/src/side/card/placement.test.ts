// P4-B1 (D7): the placement moved to src/artifacts/comments/placement.ts, its cases beside it; this module re-exports it
// so the renderer's importers keep their path.
import { describe, expect, it } from 'vitest';
import * as moved from '@artifacts/comments/placement';
import * as here from './placement';

describe('the renderer’s placement module', () => {
  it('re-exports the portable placement: the same functions and constants', () => {
    expect(here.placeCard).toBe(moved.placeCard);
    expect(Object.keys(here).sort()).toEqual(Object.keys(moved).sort());
  });
});
