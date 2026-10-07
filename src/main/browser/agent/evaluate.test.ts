import { describe, expect, it } from 'vitest';
import { BROWSER_EVAL_MAX_CHARS } from '@shared/maws/browser';
import { evalValueOf } from './evaluate';

// browser_eval's value (E4c Design §6 `browser_eval`): what Playwright returned for the expression, made JSON the result
// can carry, and cut.

describe('evalValueOf', () => {
  it('passes JSON values through and makes undefined null', () => {
    expect(evalValueOf({ a: 1, b: [true, 'x', null] })).toEqual({ value: { a: 1, b: [true, 'x', null] }, truncated: false });
    expect(evalValueOf(undefined)).toEqual({ value: null, truncated: false });
    expect(evalValueOf({ kept: 1, dropped: undefined })).toEqual({ value: { kept: 1 }, truncated: false });
  });

  it('serialises what JSON alone would refuse or lose: big integers, dates, non-finite numbers', () => {
    expect(evalValueOf(new Date(0)).value).toBe('1970-01-01T00:00:00.000Z');
    expect(evalValueOf(10n).value).toBe('10');
    expect(evalValueOf([Number.NaN, Number.POSITIVE_INFINITY]).value).toEqual([null, null]);
  });

  it('answers a value JSON cannot hold (a cycle) as its string', () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    expect(evalValueOf(cyclic)).toEqual({ value: '[object Object]', truncated: false });
  });

  it('cuts a string at the limit, and any other value as its JSON text', () => {
    const long = 'é'.repeat(BROWSER_EVAL_MAX_CHARS + 10);
    expect(evalValueOf(long)).toEqual({ value: long.slice(0, BROWSER_EVAL_MAX_CHARS), truncated: true });
    const list = Array.from({ length: 5000 }, (_, i) => i);
    const cut = evalValueOf(list);
    expect(cut.truncated).toBe(true);
    expect(cut.value).toBe(JSON.stringify(list).slice(0, BROWSER_EVAL_MAX_CHARS));
    expect(evalValueOf('short', 3)).toEqual({ value: 'sho', truncated: true });
  });

  it('never ends a cut inside a surrogate pair', () => {
    const cut = evalValueOf('ab😀', 3);
    expect(cut).toEqual({ value: 'ab', truncated: true });
  });
});
