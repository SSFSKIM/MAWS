import { describe, expect, it } from 'vitest';
import { appendStripped, stripAnsi } from './ansi';

describe('ANSI stripping', () => {
  it('strips CSI, OSC (BEL or ESC \\ terminated) and the single-byte escapes, ESC 7, ESC 8 and ESC c among them', () => {
    expect(stripAnsi('\u001b[1;31mred\u001b[0m')).toBe('red');
    expect(stripAnsi('\u001b]0;title\u0007x\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\')).toBe('xlink');
    expect(stripAnsi('a\u001b7b\u001b8c\u001bcd\u001bMe\u001b=f')).toBe('abcdef');
  });

  it('an OSC split across deltas stays whole until its terminator, then goes entirely', () => {
    let buffer = appendStripped('', 'See \u001b]8;;https://ex');
    expect(buffer).toBe('See \u001b]8;;https://ex'); // not yet complete: nothing is stripped, nothing mangled
    buffer = appendStripped(buffer, 'ample.com\u001b\\docs');
    buffer = appendStripped(buffer, '\u001b]8;;\u001b\\ now.');
    expect(buffer).toBe('See docs now.');
  });

  it('an incomplete CSI at the end of a delta also waits for its final byte', () => {
    let buffer = appendStripped('Build: ', '\u001b[3');
    expect(buffer).toBe('Build: \u001b[3');
    buffer = appendStripped(buffer, '1mfailed\u001b[0m');
    expect(buffer).toBe('Build: failed');
  });
});
