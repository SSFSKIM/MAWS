// The export's grammar, pinned to doperpowers' sminos_marks.py: each case's spans are what its `_parse_marked` returns
// (run with python3 on doperpowers' smns-erb worktree, 2026-10-16), the spans `sminos record` numbers.
import { describe, expect, it } from 'vitest';
import { exportParts } from './export-marks';

const CASES: Array<[string, string[]]> = [
  ['Work before. <message>Already in channel', ['Already in channel']],
  ['Plain. <message>One.</message> Mid. <message>Two.</message> After.', ['One.', 'Two.']],
  ['<message>Outer <insight>inner</insight> tail</message> end', ['Outer', 'inner', 'tail']],
  ['<essential>A</essential><to-human>B</to-human>', ['A', 'B']],
  ['Stray </message> close. <message>X', ['X']],
  ['Quote: `<message>` literal. <message>Real</message>', ['Real']],
  ['```\n<message>in fence</message>\n```\nAfter <message>Y</message>', ['Y']],
  ['<message>\n```sh\necho\n```</message>', ['```sh\necho\n```']],
  ['Cross <message>a <insight>b</message> c</insight> d', ['a', 'b']],
  ['<message>   </message> blank. <message>Z</message>', ['Z']],
  ['<message>Nested <message>same</message> back</message>', ['Nested', 'same', 'back']],
];

describe('the export grammar', () => {
  it.each(CASES)('%j has the spans sminos_marks.py reads', (text, spans) => {
    const parts = exportParts(text);
    expect(parts.flatMap((part) => (part.kind === 'span' ? [part.text] : []))).toEqual(spans);
    expect(parts.flatMap((part) => (part.kind === 'span' ? [part.index] : []))).toEqual(spans.map((_, i) => i));
  });

  it('keeps the working record around the spans, in order, without the tags', () => {
    expect(exportParts('Work before. <message>Already in channel')).toEqual([
      { kind: 'plain', text: 'Work before. ' },
      { kind: 'span', text: 'Already in channel', index: 0 },
    ]);
    expect(exportParts('Stray </message> close. <message>X</message> after').map((part) => part.text)).toEqual(['Stray  close. ', 'X', ' after']);
  });
});
