// The remote acquisition's bound (P5 O7 M5c review 2): `within` decides an acquisition's timeliness by the clock when the
// answer arrives, not only by its timer, so an endpoint whose event loop stalled across the deadline, and resumed with the
// answer's continuation ahead of the overdue timer, still treats the answer as late and lets it go.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LATE, within } from '../../src/endpoint/acquire';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A clock a test moves by hand, apart from the timers (which fake timers move only when told). */
function clock(start = 1_000) {
  let at = start;
  return { now: () => at, to: (t: number) => void (at = t) };
}

describe('within', () => {
  it('answers an acquisition that settles before the bound', async () => {
    const c = clock();
    const late = vi.fn();
    const answer = within(2_000, c.now, async () => 'id', late);
    await expect(answer).resolves.toBe('id');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(late).not.toHaveBeenCalled();
  });

  it('is LATE, with the answer given to `late` once, when the clock passed the bound before the timer ran', async () => {
    const c = clock();
    const late = vi.fn();
    let settle!: (id: string) => void;
    const answer = within(2_000, c.now, () => new Promise<string>((resolve) => (settle = resolve)), late);
    c.to(2_500); // the loop stalled across `by`: the timer is overdue but has not run
    settle('id');
    await expect(answer).resolves.toBe(LATE);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith('id');
    await vi.advanceTimersByTimeAsync(5_000); // the overdue timer now runs: it must not decide again
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('is LATE with null, once, when the acquisition failed after the bound', async () => {
    const c = clock();
    const late = vi.fn();
    let fail!: (error: Error) => void;
    const answer = within(2_000, c.now, () => new Promise<string>((_, reject) => (fail = reject)), late);
    c.to(2_000);
    fail(new Error('gone'));
    await expect(answer).resolves.toBe(LATE);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(null);
  });

  it('rejects a failure within the bound', async () => {
    const c = clock();
    const late = vi.fn();
    const answer = within(2_000, c.now, () => Promise.reject(new Error('gone')), late);
    await expect(answer).rejects.toThrow('gone');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(late).not.toHaveBeenCalled();
  });

  it('the timer still decides an acquisition unresolved at the bound, and the answer after it is `late`s', async () => {
    const c = clock();
    const late = vi.fn();
    let settle!: (id: string) => void;
    const answer = within(2_000, c.now, () => new Promise<string>((resolve) => (settle = resolve)), late);
    c.to(2_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(answer).resolves.toBe(LATE);
    expect(late).not.toHaveBeenCalled();
    settle('id');
    await vi.advanceTimersByTimeAsync(0);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith('id');
  });

  it('is LATE with null, asking nothing, when the bound has passed on arrival', async () => {
    const c = clock(3_000);
    const late = vi.fn();
    const ask = vi.fn(async () => 'id');
    await expect(within(2_000, c.now, ask, late)).resolves.toBe(LATE);
    expect(ask).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledWith(null);
  });
});
