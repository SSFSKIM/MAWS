import { describe, expect, it } from 'vitest';
import { contextLine, costLine } from './session-info';

describe('context use and cost, as session info draws them', () => {
  it('reads a full usage', () => {
    const usage = { context: { tokens: 36820, window: 1_000_000, percent: 4 }, cost: { usd: 0.003228125 } };
    expect(contextLine(usage)).toBe('36.8K of 1M (4%)');
    expect(costLine(usage)).toBe('$0.0032');
    expect(costLine({ ...usage, cost: { usd: 1.5 } })).toBe('$1.50');
  });

  it('says unavailable (no bridge) for a null usage, and unavailable for each piece it leaves out', () => {
    expect(contextLine(null)).toBe('unavailable (no bridge)');
    expect(costLine(null)).toBe('unavailable (no bridge)');
    expect(contextLine({ context: { window: 200_000 }, cost: null })).toBe('unavailable · 200K window');
    expect(costLine({ context: { window: 200_000 }, cost: null })).toBe('unavailable');
    expect(contextLine({ context: { tokens: 50_000, window: 200_000 }, cost: null })).toBe('50K of 200K (25%)');
  });

  it('says nothing yet before the snapshot', () => {
    expect(contextLine(undefined)).toBe('…');
    expect(costLine(undefined)).toBe('…');
  });
});
