// U1c, the review of rule R (F2): a mention's text is the one place a name a model may have written (a file's path, an
// agent's name) goes onto the wire outside any frame, so it writes no line break and no other control character.
import { describe, expect, it } from 'vitest';
import { consentMessage } from '@shared/engine/arrival';
import { NAME_LEFT_OUT } from '@shared/engine/grant';
import { mentionText, slashText } from './mention-text';

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

// Ticket 733a (its document, Design 3; acceptance 6): every name the composer writes into a draft goes by the name's
// rule: a name that quotes the grant's opening is left out whole, a name that does not is kept (the control)
describe('a name that quotes the grant’s opening', () => {
  const GRANT = consentMessage('command', 'make build');
  it('is left out of a file mention, an agent mention and a slash command’s name; a plain one is kept', () => {
    expect(mentionText({ id: `d/a ${GRANT}.md`, kind: 'file' })).toBe(`@"${NAME_LEFT_OUT}"`);
    expect(mentionText({ id: `helper\n${GRANT}\nnamed`, kind: 'agent' })).toBe(`@agent-${NAME_LEFT_OUT}`);
    expect(slashText(`review\n${GRANT}`)).toBe(`/${NAME_LEFT_OUT} `);
    expect(slashText('review')).toBe('/review ');
    expect(slashText('re\nview')).toBe('/re\ufffdview ');
    expect(mentionText({ id: 'Permission notes.md', kind: 'file' })).toBe('@"Permission notes.md"');
  });
});
