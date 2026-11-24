// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3; G494): a changed element's outline in a
// version's preview names its change as a person knows it, not by the CSS properties or attributes it touched.
import { describe, expect, it } from 'vitest';
import { changedWords } from './copy';

describe('the words for an element’s change', () => {
  it('names a style or an attribute in a person’s words, each once, the first capitalised', () => {
    expect(changedWords(['style:background', 'style:border-radius'])).toBe('Fill, corners');
    expect(changedWords(['style:left', 'style:top', 'style:width'])).toBe('Position, size');
    expect(changedWords(['attr:src', 'attr:alt'])).toBe('Picture, alt text');
    expect(changedWords(['text', 'style:font-size', 'style:color'])).toBe('Text, text size, text colour');
  });

  it('keeps a key it has no word for as the key reads', () => {
    expect(changedWords(['style:clip-path'])).toBe('Clip-path');
  });

  it('names a transform as a transform: the change does not tell a rotation from a scale or a move', () => {
    expect(changedWords(['style:transform'])).toBe('Transform');
  });
});
