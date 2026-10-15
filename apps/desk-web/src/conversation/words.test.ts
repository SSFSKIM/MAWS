// The words for what came back: a settlement by who decided (a late decision's `by` may come without its side), and a
// steer's result, whose row is null when the session had no bridge to append one.
import { describe, expect, it } from 'vitest';
import { resultText, settledText } from './words';

const ME = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

describe('settledText', () => {
  it('names the side and, from the web, whether it was you', () => {
    expect(settledText('terminal', 'deny', 'terminal', ME)).toBe('Denied in the terminal');
    expect(settledText('web', 'allow', ME, ME)).toBe('Allowed from the web by you');
    expect(settledText('web', 'answered', OTHER, ME)).toBe('Answered from the web');
    expect(settledText('other', 'answered', 'cli', ME)).toBe('Answered from the command line');
  });

  it('reads who decided from `by` when the side is not given', () => {
    expect(settledText(null, null, 'terminal', ME)).toBe('Settled in the terminal');
    expect(settledText(null, null, ME, ME)).toBe('Settled from the web by you');
    expect(settledText(null, null, OTHER, ME)).toBe('Settled from the web');
    expect(settledText(null, null, 'cli', ME)).toBe('Settled from the command line');
  });
});

describe('resultText for a steer', () => {
  it('points at the appended row when there is one, and says it was sent without one when the row is null', () => {
    expect(resultText('steer', { row: 'u1' })).toEqual({ text: 'steered: read at the next model request', warning: false });
    expect(resultText('steer', { row: null })).toEqual({ text: 'sent: the session has no bridge, so there is no row to point at', warning: false });
  });
});
