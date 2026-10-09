// P2-B M2: a Markdown file's leading `---` block, as far as What's inside reads it (name and description).
import { describe, expect, it } from 'vitest';
import { frontMatter } from './front-matter';

describe('frontMatter', () => {
  it('reads plain, single-quoted and double-quoted values', () => {
    expect(frontMatter('---\nname: review\ndescription: Reviews a change\n---\n# Body')).toEqual({ name: 'review', description: 'Reviews a change' });
    expect(frontMatter("---\nname: 'it''s'\ndescription: 'a: colon'\n---\n")).toEqual({ name: "it's", description: 'a: colon' });
    expect(frontMatter('---\ndescription: "say \\"hi\\"\\n"\n---\n')).toEqual({ name: null, description: 'say "hi"\n' });
  });

  it('reads folded and literal block scalars', () => {
    expect(frontMatter('---\ndescription: >\n  One line\n  folded here.\n\n  A new paragraph.\nname: x\n---\n')).toEqual({ name: 'x', description: 'One line folded here.\nA new paragraph.' });
    expect(frontMatter('---\ndescription: |\n  Line one\n  Line two\n---\n')).toEqual({ name: null, description: 'Line one\nLine two' });
    expect(frontMatter('---\ndescription: >-\n  Trimmed\n---\n')).toEqual({ name: null, description: 'Trimmed' });
  });

  it('drops a trailing comment from a plain value and trims it', () => {
    expect(frontMatter('---\nname:   spaced   # a comment\n---\n')).toEqual({ name: 'spaced', description: null });
  });

  it('answers nothing without a leading block, or for a shape it does not read', () => {
    expect(frontMatter('# Just a heading\nname: x\n')).toEqual({ name: null, description: null });
    expect(frontMatter('---\nname: x\n')).toEqual({ name: null, description: null }); // never closed
    expect(frontMatter('---\ndescription: [a, b]\nname: {k: v}\n---\n')).toEqual({ name: null, description: null });
    expect(frontMatter('---\ndescription:\n  - a\n---\n')).toEqual({ name: null, description: null });
    expect(frontMatter('---\ndescription: ""\n---\n')).toEqual({ name: null, description: null });
    expect(frontMatter('')).toEqual({ name: null, description: null });
  });

  it('reads a CRLF file and a byte-order mark', () => {
    expect(frontMatter('\uFEFF---\r\nname: crlf\r\ndescription: Windows\r\n---\r\n')).toEqual({ name: 'crlf', description: 'Windows' });
  });

  it('reads only top-level keys, never a nested one', () => {
    expect(frontMatter('---\nmetadata:\n  description: nested\nname: top\n---\n')).toEqual({ name: 'top', description: null });
  });
});
