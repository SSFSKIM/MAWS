import { describe, expect, it } from 'vitest';
import { budgetVerdict, QUIET_LOAD_PER_CORE } from './latency-budget';

describe('a latency bound is asserted only on a quiet machine', () => {
  it('asserts under one runnable thread per core, and skips with the number and the load at or past it', () => {
    expect(QUIET_LOAD_PER_CORE).toBe(1);
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 9.9, cores: 10 })).toEqual({ assert: true });
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 74.26, cores: 10 })).toEqual({
      assert: false,
      reason: 'coldAttachMs: 3200 ms against 3000 ms, not asserted at load 74.3 on 10 cores',
    });
    expect(budgetVerdict('coldAttachMs', 100, 3_000, { load: 10, cores: 10 }).assert).toBe(false); // skipped even when met
  });
});
