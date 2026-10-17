// The scales' admission (E2 panel): a domain is asked for ticks only when its extent is finite and at least
// MIN_EXTENT, before and after `nice`; below it (a subnormal span) d3's tick step cannot be represented.
import { describe, expect, it } from 'vitest';
import { linear, MIN_EXTENT } from './geometry';

describe('linear', () => {
  it('answers no scale for a span below the floor, never asking d3 for ticks (which throws a RangeError there)', () => {
    expect(() => linear([1e-320, 2e-320], [0, 100], 5, true)).not.toThrow();
    expect(linear([1e-320, 2e-320], [0, 100], 5, true)).toBeNull();
    expect(linear([0, 2e-320], [100, 0], 5, false)).toBeNull();
    expect(linear([0, MIN_EXTENT / 10], [0, 100], 5, true)).toBeNull();
  });

  it('answers no scale for a span that is not a finite number, as given or once made nice', () => {
    expect(linear([-1.7e308, 1.7e308], [0, 100], 5, false)).toBeNull();
    expect(linear([0, Number.NaN], [0, 100], 5, false)).toBeNull();
    expect(linear([0, Infinity], [0, 100], 5, true)).toBeNull();
  });

  it('draws a span at the floor and every ordinary one, with finite ticks inside the domain', () => {
    const floor = linear([0, MIN_EXTENT], [0, 100], 5, true)!;
    expect(floor).not.toBeNull();
    expect(floor.ticks.length).toBeGreaterThan(1);
    for (const t of floor.ticks) expect(Number.isFinite(floor.map(t))).toBe(true);
    expect(linear([0, 10], [0, 100], 5, true)!.ticks).toEqual([0, 2, 4, 6, 8, 10]);
    expect(linear([-1e306, 1e306], [0, 100], 5, true)).not.toBeNull();
  });
});
