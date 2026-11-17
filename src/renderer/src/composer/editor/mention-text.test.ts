// U1c, the review of rule R (F2): a mention's text is the one place a name a model may have written (a file's path, an
// agent's name) goes onto the wire outside any frame, so it writes no line break and no other control character.
import { describe, expect, it } from 'vitest';
import { mentionText } from './mention-text';

// LF, CR, NEL, the line and paragraph separators, and every other C0 control (tab, vertical tab, form feed among them)
const BREAKS = [...Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)), '\u007f', '\u0085', ' ', ' '];

describe('mentionText', () => {
  it('keeps its forms for a name with no control character', () => {
    expect(mentionText({ id: 'src/a.ts', kind: 'file' })).toBe('@src/a.ts');
    expect(mentionText({ id: 'docs/a b.md', kind: 'file' })).toBe('@"docs/a b.md"');
    expect(mentionText({ id: 'Explore', kind: 'agent' })).toBe('@agent-Explore');
  });

  it.each(BREAKS.map((c) => [`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`, c]))('writes no %s, for a file and for an agent', (_, c) => {
    for (const kind of ['file', 'agent'] as const) {
      const text = mentionText({ id: `d/a${c}b${c}c`, kind });
      expect(text.includes(c), kind).toBe(false);
      expect(text, kind).toMatch(/^@(?:agent-)?"?d\/a.b.c"?$/u);
    }
  });
});
