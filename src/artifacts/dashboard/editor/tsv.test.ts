// The source sheet's Copy as spreadsheet TSV (P3-E2 M3): reversible, every field's text kept, tabs, line breaks and
// quotes included, read back by the quoting rule spreadsheets apply to pasted TSV.
import { describe, expect, it } from 'vitest';
import { toTsv, tsvField } from './tsv';

/** A spreadsheet's reading of TSV: a field starting with a quote runs to its closing quote, doubled quotes are one. */
function readTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < text.length) {
    let field = '';
    if (text[i] === '"') {
      i += 1;
      for (;;) {
        if (text[i] === '"' && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (text[i] === '"') {
          i += 1;
          break;
        } else field += text[i++];
      }
    } else while (i < text.length && text[i] !== '\t' && text[i] !== '\n') field += text[i++];
    row.push(field);
    if (text[i] === '\t') i += 1;
    else {
      rows.push(row);
      row = [];
      i += 1;
    }
  }
  return rows;
}

describe('TSV', () => {
  it('writes a plain field as it is and quotes one holding a tab, a line break or a quote', () => {
    expect(tsvField('서울특별시')).toBe('서울특별시');
    expect(tsvField('a\tb')).toBe('"a\tb"');
    expect(tsvField('say "hi"')).toBe('"say ""hi"""');
    expect(tsvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });

  it('reads back as the same fields, tabs, line breaks and quotes included', () => {
    const rows = [
      ['region', 'note', 'quote'],
      ['서울', 'first line\nsecond line', 'He said "yes"'],
      ['a\tb', '', '"'],
      ['plain', 'tab\tand\nbreak "both"', '12.5'],
    ];
    expect(readTsv(toTsv(rows))).toEqual(rows);
  });
});
