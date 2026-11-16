// The one reading of a text's marks (UX wave U2b, M2's third fix wave; the architect's direction of 2026-11-15): which
// words are a message and which the record's, for every reader the renderer has. The tags are the shared grammar's
// (its pairing, its code regions, the glued recovery, `parseLive` while a block streams), and a tag after a backslash
// is text; the messages are split into runs as the mod's `parseMarked` splits them.
import { describe, expect, it } from 'vitest';
import { markedSpans, readMarked } from './marked';
import { MARKED_CASES } from './marked-cases';

const plain = (text: string, live = false) => markedSpans(text, live).map(({ text: words, isOpen }) => ({ text: words, isOpen }));

describe('readMarked', () => {
  it.each(MARKED_CASES)('reads the spans of %s', (_name, text, spans) => {
    expect(plain(text)).toEqual(spans.map((words) => ({ text: words, isOpen: false })));
  });

  it('gives each span its range in the text', () => {
    const text = 'ab <message> For you </message> cd';
    const [span] = readMarked(text).spans;
    expect(text.slice(span!.start, span!.end)).toBe('For you');
    expect(readMarked(text).tags).toEqual([3, 21]);
  });

  it('reads a mark across two list items as one span, its list syntax inside it', () => {
    expect(plain('- Narration <message>Across\n- rows</message> narration.')).toEqual([{ text: 'Across\n- rows', isOpen: false }]);
  });

  it('leaves a mark open at the end of a completed text literal, the record’s, and reads it open while the text streams', () => {
    const text = '<message>Done.</message> narration <message>Still open';
    expect(plain(text)).toEqual([{ text: 'Done.', isOpen: false }]);
    expect(readMarked(text).hasRecord).toBe(true);
    expect(plain(text, true)).toEqual([{ text: 'Done.', isOpen: false }, { text: 'Still open', isOpen: true }]);
  });

  it('reads a stray closer and crossing marks as text, as the shared grammar does', () => {
    expect(plain('Narration </message> <message>Kept.</message>')).toEqual([{ text: 'Kept.', isOpen: false }]);
    expect(plain('<message>a<insight>b</message>c</insight>')).toEqual([]);
    expect(readMarked('<message>a<insight>b</message>c</insight>').hasRecord).toBe(true);
  });

  it('reads no tag in code, nor one a backslash escapes', () => {
    expect(plain('`<message>x</message>` and \\<message>y\\</message> then <message>Real.</message>')).toEqual([{ text: 'Real.', isOpen: false }]);
    expect(plain('```\n<message>quoted</message>\n```\n\n<message>After.</message>')).toEqual([{ text: 'After.', isOpen: false }]);
  });

  it('takes the glued reading when the strict one leaves a tag unpaired and it pairs them all', () => {
    // strict: the closing fence line carries the closer, so the fence runs to the end and holds it; glued: the fence
    // closes before the closer
    expect(plain('<message>\n```sh\nls\n```</message>')).toEqual([{ text: '```sh\nls\n```', isOpen: false }]);
  });

  it('splits a mark nested in another into runs, the outer one’s text after it a run of its own', () => {
    expect(plain('<message>A <insight>B</insight> C</message>')).toEqual(['A', 'B', 'C'].map((words) => ({ text: words, isOpen: false })));
    expect(readMarked('<message>A <insight>B</insight> C</message>').hasRecord).toBe(false);
  });
});
