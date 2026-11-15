// The message spans of a text as the mod's `parseMarked` reads them (UX wave U2b, M2's second fix wave; the architect's
// direction of 2026-11-15): what a closed stretch's head draws, and nothing the mod assigns to the record.
import { describe, expect, it } from 'vitest';
import { markedSpans } from './marked';
import { MARKED_CASES } from './marked-cases';

describe('markedSpans', () => {
  it.each(MARKED_CASES)('reads the spans of %s', (_name, text, spans) => {
    expect(markedSpans(text).map((span) => span.text)).toEqual(spans);
    expect(markedSpans(text).every((span) => !span.isOpen)).toBe(true);
  });

  it('reads a mark across two list items as one span, its list syntax inside it', () => {
    expect(markedSpans('- Narration <message>Across\n- rows</message> narration.')).toEqual([{ text: 'Across\n- rows', isOpen: false }]);
  });

  it('runs a mark left open to the end, open; a stray closer closes nothing; crossing marks close at the outer closer', () => {
    expect(markedSpans('<message>Done.</message> narration <message>Still open')).toEqual([{ text: 'Done.', isOpen: false }, { text: 'Still open', isOpen: true }]);
    expect(markedSpans('Narration </message> <message>Kept.</message>')).toEqual([{ text: 'Kept.', isOpen: false }]);
    expect(markedSpans('<message>a<insight>b</message>c</insight>')).toEqual([{ text: 'a', isOpen: false }, { text: 'b', isOpen: false }]);
  });

  it('reads no tag in code, nor one a backslash escapes (MAWS draws both literally)', () => {
    expect(markedSpans('`<message>x</message>` and \\<message>y\\</message> then <message>Real.</message>')).toEqual([{ text: 'Real.', isOpen: false }]);
    expect(markedSpans('```\n<message>quoted</message>\n```\n\n<message>After.</message>')).toEqual([{ text: 'After.', isOpen: false }]);
  });

  it('takes the glued reading when the strict one leaves a tag unpaired and it pairs them all', () => {
    // strict: the closing fence line carries the closer, so the fence runs to the end and holds it; glued: the fence
    // closes before the closer
    expect(markedSpans('<message>\n```sh\nls\n```</message>')).toEqual([{ text: '```sh\nls\n```', isOpen: false }]);
  });
});
