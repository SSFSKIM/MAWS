import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/protocol/canonical';

// RFC 8785 (JCS) pins these outputs itself, so they check the canonicalizer independently of this repository's vectors.
describe('canonicalize (RFC 8785)', () => {
  it('writes the RFC 8785 §3.2.2 sample: literals, numbers in ECMAScript form, strings with only the required escapes', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('orders keys by their UTF-16 code units, as RFC 8785 §3.2.3 does, not by code point', () => {
    const input = JSON.parse('{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}');
    // Read off the text: JSON.parse would put the integer-like key "1" first again.
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`));
    expect(keys).toEqual(['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('writes no whitespace and recurses into arrays and objects', () => {
    expect(canonicalize({ b: [1, { d: 2, c: [] }], a: {} })).toBe('{"a":{},"b":[1,{"c":[],"d":2}]}');
  });

  it('writes -0 as 0', () => {
    expect(canonicalize([-0])).toBe('[0]');
  });

  it('leaves out a key whose value is undefined, as JSON.stringify does on the wire', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it.each([
    ['a non-finite number', { n: Number.NaN }],
    ['an infinite number', [Number.POSITIVE_INFINITY]],
    ['a lone surrogate in a string', { s: '\ud800' }],
    ['a lone surrogate in a key', { '\udc00': 1 }],
    ['undefined in an array', [undefined]],
    ['undefined at the top', undefined],
    ['a bigint', { n: 1n }],
    ['a function', { f: () => 1 }],
    ['an object that is not plain', { d: new Date(0) }],
  ])('refuses %s', (_label, value) => {
    expect(() => canonicalize(value)).toThrow(TypeError);
  });
});
