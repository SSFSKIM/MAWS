import { describe, expect, it } from 'vitest';
import { budgetVerdict, LOADED_CEILING, QUIET_LOAD_PER_CORE } from './latency-budget';

describe('a latency bound is asserted as named only on a quiet machine', () => {
  it('holds the bound under one runnable thread per core, and five times it with the reason at or past it', () => {
    expect(QUIET_LOAD_PER_CORE).toBe(1);
    expect(LOADED_CEILING).toBe(5);
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 9.9, cores: 10 })).toEqual({ ceiling: 3_000, reason: null });
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 74.26, cores: 10 })).toEqual({
      ceiling: 15_000,
      reason: 'coldAttachMs: 3200 ms against 3000 ms, held to 15000 ms at load 74.3 on 10 cores',
    });
    expect(budgetVerdict('pingMaxMs', 20, 100, { load: 10, cores: 10 }).ceiling).toBe(500); // loaded even when met
  });
});
