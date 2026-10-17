// The host's dataset parser (P3-E2 M2; XE5; the E2 execution document's boundary decisions, parent Decision Log 6):
// strict quoted-field CSV and TSV, flat-object JSON, every value inferred, explicit refusals naming the physical line.
import { describe, expect, it } from 'vitest';
import { DATASET_LIMITS } from './datasets';
import { DatasetError, parseDataset, rowKeyProblem, type ParsedDataset } from './parse';

const utf8 = (text: string) => new TextEncoder().encode(text);
const ok = (text: string | Uint8Array, format: 'csv' | 'tsv' | 'json' = 'csv'): ParsedDataset => {
  const parsed = parseDataset(typeof text === 'string' ? utf8(text) : text, format);
  if (parsed instanceof DatasetError) throw new Error(`refused: line ${parsed.line}: ${parsed.reason}`);
  return parsed;
};
const refused = (text: string | Uint8Array, format: 'csv' | 'tsv' | 'json' = 'csv'): DatasetError => {
  const parsed = parseDataset(typeof text === 'string' ? utf8(text) : text, format);
  if (!(parsed instanceof DatasetError)) throw new Error('parsed');
  return parsed;
};

describe('CSV and TSV', () => {
  it('reads a header and rows, infers every column and keeps the header order', () => {
    const parsed = ok('region,month,sales,active\nSeoul,2026-01-01,120.5,true\nBusan,2026-02-01,98,false\n');
    expect(parsed.columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'month', type: 'date' },
      { name: 'sales', type: 'number' },
      { name: 'active', type: 'boolean' },
    ]);
    expect(parsed.rows).toEqual([
      ['Seoul', '2026-01-01', 120.5, true],
      ['Busan', '2026-02-01', 98, false],
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('reads RFC 4180 quoting: delimiters, doubled quotes, CRLF and line breaks inside a quoted field', () => {
    const parsed = ok('name,note\r\n"Kim, J.","said ""hi"""\r\nLee,"two\nlines"\r\n');
    expect(parsed.rows).toEqual([
      ['Kim, J.', 'said "hi"'],
      ['Lee', 'two\nlines'],
    ]);
  });

  it('names the physical line of a ragged row, counting the lines a quoted field spans', () => {
    const error = refused('a,b\n1,"x\ny"\n2,3,4\n');
    expect(error).toMatchObject({ kind: 'invalid', line: 4 });
    expect(error.reason).toBe('line 4 has 3 fields; the header has 2');
    expect(refused('a,b\n1\n').line).toBe(2);
  });

  it('refuses an unterminated quote at the line it opened, a quote inside an unquoted field and text after a closing quote', () => {
    expect(refused('a,b\n1,"open\n\n')).toMatchObject({ line: 2, reason: 'line 2 opens a quoted field that never closes' });
    expect(refused('a,b\n1,x"y\n')).toMatchObject({ line: 2, reason: 'line 2 has a quote inside an unquoted field' });
    expect(refused('a,b\n1,"x"y\n')).toMatchObject({ line: 2, reason: 'line 2 has text after a closing quote' });
  });

  it('requires a header of unique, nonempty names', () => {
    expect(refused('')).toMatchObject({ line: 1, reason: 'the file is empty; a header row is required' });
    expect(refused('a,,c\n1,2,3\n')).toMatchObject({ line: 1, reason: 'column 2 of the header has no name' });
    expect(refused('a,b,a\n1,2,3\n')).toMatchObject({ line: 1, reason: 'the header names column "a" twice' });
    expect(refused(`${'x'.repeat(DATASET_LIMITS.columnName + 1)}\n1\n`).reason).toContain(`at most ${DATASET_LIMITS.columnName} characters`);
  });

  it('takes a UTF-8 BOM and Korean text; refuses invalid UTF-8 naming its line', () => {
    const parsed = ok(utf8('﻿지역,매출\n서울,120\n'));
    expect(parsed.columns).toEqual([
      { name: '지역', type: 'string' },
      { name: '매출', type: 'number' },
    ]);
    const bytes = new Uint8Array([...utf8('a\nok\n'), 0xff, 0x0a]);
    expect(refused(bytes)).toMatchObject({ line: 3, reason: 'line 3 is not valid UTF-8' });
  });

  it('reads TSV with the same strict grammar', () => {
    const parsed = ok('a\tb\n"x\ty"\t2\n', 'tsv');
    expect(parsed.rows).toEqual([['x\ty', 2]]);
    expect(refused('a\tb\n1\n', 'tsv').line).toBe(2);
  });

  it('reads one byte sequence as different tables by format', () => {
    const bytes = utf8('a,b\tc\n1,2\t3\n');
    expect(ok(bytes, 'csv').columns.map((c) => c.name)).toEqual(['a', 'b\tc']);
    expect(ok(bytes, 'tsv').columns.map((c) => c.name)).toEqual(['a,b', 'c']);
  });

  it('reads empty fields as null and an all-empty column as null', () => {
    const parsed = ok('a,b,c\n1,,\n,x,\n');
    expect(parsed.rows).toEqual([
      [1, null, null],
      [null, 'x', null],
    ]);
    expect(parsed.columns.map((c) => c.type)).toEqual(['number', 'string', 'null']);
  });

  it('keeps identifiers with a leading zero, signs and other non-strict numbers as text', () => {
    const parsed = ok('id\n007\n');
    expect(parsed.columns[0]!.type).toBe('string');
    expect(parsed.rows).toEqual([['007']]);
    for (const text of ['+1', '1.', '-.', '"1,000"', ' 1', '0x10', '00.5', 'NaN', 'Infinity', '1e400']) expect(ok(`n\n${text}\n`).columns[0]!.type, text).toBe('string');
    for (const text of ['0', '-0.5', '12', '1e3', '-2.5E-3', '.5', '-.19']) expect(ok(`n\n${text}\n`).columns[0]!.type, text).toBe('number');
    // a missing-value marker in a numeric column (GISTEMP's ***, the penguins' NA) is kept as written and counted
    const marked = ok('anomaly\n-.19\n.02\n***\n');
    expect(marked.columns[0]).toEqual({ name: 'anomaly', type: 'number', mismatches: 1 });
    expect(marked.rows).toEqual([[-0.19], [0.02], ['***']]);
  });

  it('reads ISO calendar dates and zoned date-times, never an ambiguous or impossible one', () => {
    for (const text of ['2026-02-28', '2024-02-29', '2026-10-16T08:30Z', '2026-10-16T08:30:05.123+09:00']) expect(ok(`d\n${text}\n`).columns[0]!.type, text).toBe('date');
    for (const text of ['2026-02-29', '2026-13-01', '2026-10-16T08:30', '2026-10-16 08:30Z', '16/10/2026', '2026-10-16T24:00Z']) expect(ok(`d\n${text}\n`).columns[0]!.type, text).toBe('string');
  });

  it('infers over every row and counts the values a mixed column does not take, keeping them as written', () => {
    const lines = ['amount', ...Array.from({ length: 9 }, (_, i) => String(i)), 'n/a'];
    const parsed = ok(`${lines.join('\n')}\n`);
    expect(parsed.columns).toEqual([{ name: 'amount', type: 'number', mismatches: 1 }]);
    expect(parsed.rows.at(-1)).toEqual(['n/a']);
    expect(parsed.warnings).toEqual(['1 of 10 values in amount are not number']);
    // a value far down the file still counts: no sampling
    const late = ok(`n\n${Array.from({ length: 5_000 }, () => '1').join('\n')}\nlate\n`);
    expect(late.columns[0]).toEqual({ name: 'n', type: 'number', mismatches: 1 });
    // no type a majority takes: text
    expect(ok('v\n1\nx\ny\n').columns[0]).toEqual({ name: 'v', type: 'string' });
  });

  it('takes prototype names as ordinary columns', () => {
    const parsed = ok('__proto__,constructor,hasOwnProperty\n1,2,3\n');
    expect(parsed.columns.map((c) => c.name)).toEqual(['__proto__', 'constructor', 'hasOwnProperty']);
    expect(parsed.rows).toEqual([[1, 2, 3]]);
  });

  it('refuses more rows or columns than the limits', () => {
    const header = Array.from({ length: DATASET_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(',');
    expect(refused(`${header}\n`)).toMatchObject({ kind: 'tooLarge', line: 1 });
    const rows = `n\n${'1\n'.repeat(DATASET_LIMITS.rows + 1)}`;
    expect(refused(rows)).toMatchObject({ kind: 'tooLarge', reason: `the file has more than ${DATASET_LIMITS.rows} rows` });
    expect(ok(`n\n${'1\n'.repeat(DATASET_LIMITS.rows)}`).rows).toHaveLength(DATASET_LIMITS.rows);
  });

  it('refuses a file over the byte limit before reading it', () => {
    expect(refused(new Uint8Array(DATASET_LIMITS.bytes + 1))).toMatchObject({ kind: 'tooLarge', reason: `the file is ${DATASET_LIMITS.bytes + 1} bytes; the limit is ${DATASET_LIMITS.bytes}` });
  });

  it('ignores trailing empty lines but refuses an empty line between rows', () => {
    expect(ok('a,b\n1,2\n\n\n').rows).toEqual([[1, 2]]);
    expect(refused('a,b\n1,2\n\n3,4\n').line).toBe(3);
  });
});

describe('row keys', () => {
  it('takes a column of unique non-null values, refusing a missing column, a null and a repeat', () => {
    const parsed = ok('id,v\na,1\nb,2\n');
    expect(rowKeyProblem(parsed, 'id')).toBeNull();
    expect(rowKeyProblem(parsed, 'nope')).toBe('the row key "nope" names no column');
    expect(rowKeyProblem(ok('id,v\na,1\n,2\n'), 'id')).toBe('the row key "id" is empty on row 2');
    expect(rowKeyProblem(ok('id,v\na,1\nb,2\na,3\n'), 'id')).toBe('the row key "id" repeats "a" on row 3');
    // numbers and their text are one value once typed
    expect(rowKeyProblem(ok('id\n1\n2\n'), 'id')).toBeNull();
  });
});

describe('JSON', () => {
  it('reads an array of flat objects: the union of keys in first-seen order, missing cells null', () => {
    const parsed = ok(JSON.stringify([{ region: 'Seoul', sales: 120 }, { sales: 98, active: true, region: 'Busan' }, { region: 'Jeju' }]), 'json');
    expect(parsed.columns).toEqual([
      { name: 'region', type: 'string' },
      { name: 'sales', type: 'number' },
      { name: 'active', type: 'boolean' },
    ]);
    expect(parsed.rows).toEqual([
      ['Seoul', 120, null],
      ['Busan', 98, true],
      ['Jeju', null, null],
    ]);
  });

  it('keeps native JSON types: a numeric string stays text, a date string is a date, an empty string is null', () => {
    const parsed = ok(JSON.stringify([{ id: '12', at: '2026-10-16', blank: '' }]), 'json');
    expect(parsed.columns).toEqual([
      { name: 'id', type: 'string' },
      { name: 'at', type: 'date' },
      { name: 'blank', type: 'null' },
    ]);
    expect(parsed.rows).toEqual([['12', '2026-10-16', null]]);
  });

  it('refuses invalid JSON, a non-array, a non-object record and a nested value, naming the line', () => {
    expect(refused('[{"a": 1},\n{"a": }]', 'json')).toMatchObject({ kind: 'invalid', line: 2 });
    expect(refused('{"a": 1}', 'json').reason).toBe('a JSON dataset is an array of flat objects');
    expect(refused('[\n{"a": 1},\n2\n]', 'json')).toMatchObject({ line: 3, reason: 'line 3: record 2 is not an object' });
    expect(refused('[\n{"a": 1},\n{"a": {"b": 2}}\n]', 'json')).toMatchObject({ line: 3, reason: 'line 3: record 2 holds a nested value in "a"' });
    expect(refused('[{"a": [1]}]', 'json')).toMatchObject({ line: 1 });
    expect(refused('[{"": 1}]', 'json').reason).toBe('line 1: record 1 has a key with no name');
  });

  it('takes prototype keys as ordinary columns', () => {
    const parsed = ok('[{"__proto__": 1, "constructor": "x"}]', 'json');
    expect(parsed.columns.map((c) => c.name)).toEqual(['__proto__', 'constructor']);
    expect(parsed.rows).toEqual([[1, 'x']]);
  });

  it('refuses a number JSON.parse reads as infinite, naming its record’s line (M2 fix wave I3)', () => {
    for (const text of ['1e400', '-1e400']) expect(refused(`[\n{"a": 1},\n{"a": ${text}}\n]`, 'json'), text).toMatchObject({ kind: 'invalid', line: 3, reason: 'line 3: record 2 holds a number in "a" too large to read' });
  });

  it('counts the values a text column does not take, with a text majority or none (M2 fix wave I5)', () => {
    const majority = ok(JSON.stringify([{ v: 'a' }, { v: 'b' }, { v: 'c' }, { v: 1 }]), 'json');
    expect(majority.columns).toEqual([{ name: 'v', type: 'string', mismatches: 1 }]);
    expect(majority.rows).toEqual([['a'], ['b'], ['c'], [1]]);
    expect(majority.warnings).toEqual(['1 of 4 values in v are not string']);
    const none = ok(JSON.stringify([{ v: 1 }, { v: true }, { v: 'x' }, { v: null }]), 'json');
    expect(none.columns).toEqual([{ name: 'v', type: 'string', mismatches: 2 }]);
    expect(none.rows).toEqual([[1], [true], ['x'], [null]]);
    expect(none.warnings).toEqual(['2 of 4 values in v are not string']);
    // CSV text is always text: a text column of it counts nothing
    expect(ok('v\n1\nx\ny\n').columns[0]).toEqual({ name: 'v', type: 'string' });
  });

  it('counts mixed native values without coercing them', () => {
    const parsed = ok(JSON.stringify([{ v: 1 }, { v: 2 }, { v: 'three' }]), 'json');
    expect(parsed.columns).toEqual([{ name: 'v', type: 'number', mismatches: 1 }]);
    expect(parsed.rows).toEqual([[1], [2], ['three']]);
    expect(parsed.warnings).toEqual(['1 of 3 values in v are not number']);
  });
});
