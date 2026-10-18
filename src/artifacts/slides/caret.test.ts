// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Notes"): a remote change to the notes keeps the
// owner's caret where their words are.
import { describe, expect, it } from 'vitest';
import { mapCaret, rebaseText } from './caret';

describe('mapping a caret through a remote change', () => {
  it('moves with text inserted or deleted before it and stays for changes after it', () => {
    expect(mapCaret('Say hi', 'Please say hi', 4)).toBe(11); // after "Say "… → after "Please say "
    expect(mapCaret('Say hi', 'Say hi there', 3)).toBe(3);
    expect(mapCaret('Open with ramp time', 'Open ramp time', 15)).toBe(10);
  });

  it('a caret inside deleted text lands where the deletion was', () => {
    expect(mapCaret('alpha beta gamma', 'alpha gamma', 8)).toBe(6);
  });

  it('an insertion exactly at the caret goes before it (the other writer typed there first)', () => {
    expect(mapCaret('ab', 'aXb', 1)).toBe(2);
  });
});

describe('carrying the owner’s composition onto a remote change', () => {
  it('keeps the remote words and adds the owner’s', () => {
    expect(rebaseText('Say hi.', 'Say hi. 안녕', 'Please say hi.')).toBe('Please say hi. 안녕');
    expect(rebaseText('one two', 'one 2', 'zero one two')).toBe('zero one 2');
  });

  // fix wave 1, finding 1: a deletion's end maps before text inserted at it, its start after text inserted at it
  it('keeps a remote insertion at either edge of the owner’s deletion', () => {
    expect(rebaseText('abc', 'ac', 'abXc')).toBe('aXc');
    expect(rebaseText('abc', 'ac', 'aXbc')).toBe('aXc');
    expect(rebaseText('abcd', 'ad', 'aXbcYd')).toBe('aXYd');
  });

  it('maps a position before or after text inserted exactly at it, as asked', () => {
    expect(mapCaret('ab', 'aXb', 1, 'after')).toBe(2);
    expect(mapCaret('ab', 'aXb', 1, 'before')).toBe(1);
  });
});
