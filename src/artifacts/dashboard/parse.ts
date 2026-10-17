// The host's dataset parser (P3-E2 M2; XE5's `parseDataset(bytes, format)`; the E2 execution document's boundary
// decisions, parent Decision Log 6). Called by the host only (the tool's validation, the bounded read), never by an
// editor: validation and type inference happen once, in the host, and readers share its result. Portable and DOM-free.
//
// CSV and TSV: RFC 4180 quoted fields (a field in double quotes may hold the delimiter, line breaks and doubled quotes;
// an unquoted field holds no quote), LF or CRLF records, UTF-8 with an optional BOM, a header row of unique nonempty
// names; every record has the header's number of fields; trailing empty lines are ignored. JSON: an array of flat
// objects, the columns the union of their keys in first-seen order, a missing key null. An empty value is null.
//
// Inference reads every value, never a sample. A column is the type every non-null value takes (number: a strict
// finite decimal, so an identifier with a leading zero stays text; boolean: true or false; date: an ISO calendar date
// or a zoned ISO date-time), else the type more than half of them take, the others kept as written and counted
// (`mismatches`, a warning), else text. JSON keeps its native types: a JSON string is text or a date, never a number.
// A refusal names the physical line (1-based; a record spanning lines is named by its first) and the reason.
import { DATASET_LIMITS, type Cell, type ColumnType, type DatasetColumn, type DatasetFormat } from './datasets';
import { DATASET_STATES } from './states';

export interface ParsedDataset {
  columns: DatasetColumn[];
  rows: Cell[][];
  warnings: string[];
}

/** A file the dataset boundary refuses: `invalid` (malformed) or `tooLarge` (over a limit), with its line when known. */
export class DatasetError {
  constructor(
    readonly kind: 'invalid' | 'tooLarge',
    readonly reason: string,
    readonly line?: number,
  ) {}
}

type Limits = Pick<typeof DATASET_LIMITS, 'rows' | 'columns' | 'bytes' | 'columnName'>;

export function parseDataset(bytes: Uint8Array, format: DatasetFormat, limits: Limits = DATASET_LIMITS): ParsedDataset | DatasetError {
  if (bytes.length > limits.bytes) return new DatasetError('tooLarge', `the file is ${bytes.length} bytes; the limit is ${limits.bytes}`);
  const text = decode(bytes);
  if (text instanceof DatasetError) return text;
  try {
    const table = format === 'json' ? readJson(text, limits) : readDelimited(text, format === 'csv' ? ',' : '\t', limits);
    return infer(table.names, table.cells, format === 'json');
  } catch (error) {
    if (error instanceof DatasetError) return error;
    throw error;
  }
}

/**
 * Why `rowKey` cannot key the rows, or null: it must name a column whose every value is present and unique (a value
 * and its type together, so the number 1 and the text "1" are two values). A failure refuses the whole bind.
 */
export function rowKeyProblem(parsed: ParsedDataset, rowKey: string): string | null {
  const k = parsed.columns.findIndex((column) => column.name === rowKey);
  if (k === -1) return `the row key ${JSON.stringify(rowKey)} names no column`;
  const seen = new Set<string>();
  for (let r = 0; r < parsed.rows.length; r++) {
    const value = parsed.rows[r]![k]!;
    if (value === null) return `the row key ${JSON.stringify(rowKey)} is empty on row ${r + 1}`;
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) return `the row key ${JSON.stringify(rowKey)} repeats ${JSON.stringify(value)} on row ${r + 1}`;
    seen.add(key);
  }
  return null;
}

// ── text ──

function decode(bytes: Uint8Array): string | DatasetError {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    const line = lineAtByte(bytes, firstInvalidUtf8(bytes));
    return new DatasetError('invalid', `line ${line} is not valid UTF-8`, line);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The offset of the first byte that starts no valid UTF-8 sequence (the decoder refused the bytes, so one does). */
function firstInvalidUtf8(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    const [length, min, max] = b < 0x80 ? [1, 0, 0] : b >= 0xc2 && b <= 0xdf ? [2, 0x80, 0xbf] : b === 0xe0 ? [3, 0xa0, 0xbf] : b === 0xed ? [3, 0x80, 0x9f] : b >= 0xe1 && b <= 0xef ? [3, 0x80, 0xbf] : b === 0xf0 ? [4, 0x90, 0xbf] : b === 0xf4 ? [4, 0x80, 0x8f] : b >= 0xf1 && b <= 0xf3 ? [4, 0x80, 0xbf] : [0, 0, 0];
    if (length === 0 || i + length > bytes.length) return i;
    for (let k = 1; k < length; k++) {
      const c = bytes[i + k]!;
      if (k === 1 ? c < min || c > max : c < 0x80 || c > 0xbf) return i;
    }
    i += length;
  }
  return bytes.length;
}

function lineAtByte(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (bytes[i] === 0x0a) line++;
  return line;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

const invalid = (line: number, reason: string) => new DatasetError('invalid', reason, line);

// ── CSV and TSV ──

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;

function readDelimited(text: string, delimiter: ',' | '\t', limits: Limits): { names: string[]; cells: (string | null)[][] } {
  const sep = delimiter.charCodeAt(0);
  const end = trailingEnd(text);
  const records: { line: number; fields: string[] }[] = [];
  let i = 0;
  let line = 1;
  let header: string[] | null = null;
  while (i < end) {
    const start = line;
    const fields: string[] = [];
    for (;;) {
      if (text.charCodeAt(i) === QUOTE) {
        const opened = line;
        let value = '';
        let from = i + 1;
        for (;;) {
          const close = text.indexOf('"', from);
          if (close === -1 || close >= end) throw invalid(opened, `line ${opened} opens a quoted field that never closes`);
          for (let n = text.indexOf('\n', from); n !== -1 && n < close; n = text.indexOf('\n', n + 1)) line++;
          value += text.slice(from, close);
          if (text.charCodeAt(close + 1) === QUOTE) {
            value += '"';
            from = close + 2;
            continue;
          }
          i = close + 1;
          break;
        }
        fields.push(value);
      } else {
        let j = i;
        while (j < end) {
          const c = text.charCodeAt(j);
          if (c === sep || c === LF || c === CR) break;
          if (c === QUOTE) throw invalid(line, `line ${line} has a quote inside an unquoted field`);
          j++;
        }
        fields.push(text.slice(i, j));
        i = j;
      }
      const c = i < end ? text.charCodeAt(i) : -1;
      if (c === sep) {
        i++;
        continue;
      }
      if (c === -1) break;
      if (c === CR && text.charCodeAt(i + 1) === LF) i += 2;
      else if (c === LF) i += 1;
      else if (c === CR) throw invalid(line, `line ${line} ends with a carriage return and no line feed`);
      else throw invalid(line, `line ${line} has text after a closing quote`);
      line++;
      break;
    }
    if (!header) {
      header = fields;
      checkNames(header, limits);
      continue;
    }
    if (fields.length !== header.length) throw invalid(start, `line ${start} has ${fields.length} field${fields.length === 1 ? '' : 's'}; the header has ${header.length}`);
    if (records.length >= limits.rows) throw new DatasetError('tooLarge', `the file has more than ${limits.rows} rows`);
    records.push({ line: start, fields });
  }
  if (!header) throw invalid(1, 'the file is empty; a header row is required');
  return { names: header, cells: records.map(({ fields }) => fields.map((field) => (field === '' ? null : field))) };
}

/** Where the text ends once its trailing empty lines are dropped. */
function trailingEnd(text: string): number {
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === LF || text.charCodeAt(end - 1) === CR)) end--;
  return end;
}

function checkNames(names: string[], limits: Limits): void {
  if (names.length > limits.columns) throw new DatasetError('tooLarge', `the header has ${names.length} columns; the limit is ${limits.columns}`, 1);
  const seen = new Set<string>();
  names.forEach((name, k) => {
    if (name.trim() === '') throw invalid(1, `column ${k + 1} of the header has no name`);
    if (name.length > limits.columnName) throw invalid(1, `column ${k + 1} of the header is named in ${name.length} characters; a name is at most ${limits.columnName} characters`);
    if (seen.has(name)) throw invalid(1, `the header names column ${JSON.stringify(name)} twice`);
    seen.add(name);
  });
}

// ── JSON ──

function readJson(text: string, limits: Limits): { names: string[]; cells: Cell[][] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const offset = jsonErrorOffset(text);
    const line = offset === null ? undefined : lineAt(text, offset);
    throw new DatasetError('invalid', line === undefined ? 'the file is not valid JSON' : `line ${line} is not valid JSON`, line);
  }
  if (!Array.isArray(value)) throw invalid(1, 'a JSON dataset is an array of flat objects');
  if (value.length > limits.rows) throw new DatasetError('tooLarge', `the file has more than ${limits.rows} rows`);
  const columns = new Map<string, number>();
  const records: Map<number, Cell>[] = [];
  value.forEach((record: unknown, r) => {
    const line = () => lineAt(text, recordOffsets(text)[r] ?? 0);
    if (record === null || typeof record !== 'object' || Array.isArray(record)) throw invalid(line(), `line ${line()}: record ${r + 1} is not an object`);
    const row = new Map<number, Cell>();
    for (const key of Object.keys(record)) {
      const cell = (record as Record<string, unknown>)[key];
      if (cell !== null && typeof cell === 'object') throw invalid(line(), `line ${line()}: record ${r + 1} holds a nested value in ${JSON.stringify(key)}`);
      // JSON.parse reads 1e400 as Infinity, which no JSON answer can carry: refused, never bound unreadable (fix wave I3)
      if (typeof cell === 'number' && !Number.isFinite(cell)) throw invalid(line(), `line ${line()}: record ${r + 1} holds a number in ${JSON.stringify(key)} too large to read`);
      if (key.trim() === '') throw invalid(line(), `line ${line()}: record ${r + 1} has a key with no name`);
      if (key.length > limits.columnName) throw invalid(line(), `line ${line()}: record ${r + 1} has a key of ${key.length} characters; a name is at most ${limits.columnName} characters`);
      let column = columns.get(key);
      if (column === undefined) {
        if (columns.size >= limits.columns) throw new DatasetError('tooLarge', `the records have more than ${limits.columns} keys`, line());
        columns.set(key, (column = columns.size));
      }
      row.set(column, cell === '' ? null : (cell as Cell));
    }
    records.push(row);
  });
  const width = columns.size;
  return { names: [...columns.keys()], cells: records.map((row) => Array.from({ length: width }, (_, k) => row.get(k) ?? null)) };
}

/** The offset of each top-level array element (read only to name a refused record's line). */
function recordOffsets(text: string): number[] {
  const offsets: number[] = [];
  let depth = 0;
  let expecting = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') continue;
    if (expecting) {
      offsets.push(i);
      expecting = false;
    }
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '[' || c === '{') {
      depth++;
      if (depth === 1 && c === '[') expecting = true;
    } else if (c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 1) expecting = true;
  }
  return offsets;
}

/**
 * Where JSON.parse gave up, found again by a small recognizer of RFC 8259 (on the refusal path only, to name the line:
 * the engine's message carries no position for every error). Null when the nesting is too deep to walk.
 */
function jsonErrorOffset(text: string): number | null {
  let i = 0;
  const fail = (): never => {
    throw i;
  };
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++;
  };
  const literal = (word: string) => {
    for (const ch of word) {
      if (text[i] !== ch) fail();
      i++;
    }
  };
  const string = () => {
    i++;
    for (;;) {
      if (i >= text.length) fail();
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return;
      }
      if (c < 0x20) fail();
      if (c !== 0x5c) {
        i++;
        continue;
      }
      const escape = text[i + 1];
      if (escape === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
      else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) i += 2;
      else fail();
    }
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (text[i] === close) {
        i++;
        return;
      }
      for (;;) {
        if (c === '{') {
          ws();
          if (text[i] !== '"') fail();
          string();
          ws();
          if (text[i] !== ':') fail();
          i++;
        }
        value();
        ws();
        if (text[i] === close) {
          i++;
          return;
        }
        if (text[i] !== ',') fail();
        i++;
      }
    }
    if (c === '"') return string();
    if (c === 't') return literal('true');
    if (c === 'f') return literal('false');
    if (c === 'n') return literal('null');
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!number) fail();
    i += number![0].length;
  };
  try {
    value();
    ws();
    return i;
  } catch (thrown) {
    return typeof thrown === 'number' ? Math.min(thrown, text.length) : null;
  }
}

// ── inference ──

// A strict decimal: no sign but '-', no leading zero before a digit (an identifier like 007 stays text), no grouping;
// a leading-dot fraction (`.5`, `-.19`, as NASA's GISTEMP tables write them) is a number.
const NUMBER = /^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN = /^(?:true|false)$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const isNumberText = (text: string) => NUMBER.test(text) && Number.isFinite(Number(text));

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

export function isIsoDate(text: string): boolean {
  const date = DATE.exec(text);
  if (date) return isCalendarDate(Number(date[1]), Number(date[2]), Number(date[3]));
  const time = DATE_TIME.exec(text);
  if (!time) return false;
  const [, y, mo, d, h, mi, s, oh, om] = time;
  return isCalendarDate(Number(y), Number(mo), Number(d)) && Number(h) < 24 && Number(mi) < 60 && (s === undefined || Number(s) < 60) && (oh === undefined || (Number(oh) < 24 && Number(om) < 60));
}

type Kind = Exclude<ColumnType, 'string' | 'null'>;
const KINDS: readonly Kind[] = ['number', 'date', 'boolean'];

/** Which inferred kind a raw value takes, if any: CSV text by its grammar, JSON by its native type. */
function kindOf(value: Cell, native: boolean): Kind | null {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value !== 'string') return null;
  if (!native && isNumberText(value)) return 'number';
  if (!native && BOOLEAN.test(value)) return 'boolean';
  return isIsoDate(value) ? 'date' : null;
}

function typed(value: Cell, kind: Kind): Cell {
  if (typeof value !== 'string') return value;
  if (kind === 'number') return Number(value);
  if (kind === 'boolean') return value.toLowerCase() === 'true';
  return value; // a date keeps its ISO text
}

function infer(names: string[], cells: Cell[][], native: boolean): ParsedDataset {
  const warnings: string[] = [];
  const columns: DatasetColumn[] = names.map((name, k) => {
    const counts: Record<Kind, number> = { number: 0, date: 0, boolean: 0 };
    let present = 0;
    for (const row of cells) {
      const value = row[k]!;
      if (value === null) continue;
      present++;
      const kind = kindOf(value, native);
      if (kind) counts[kind]++;
    }
    if (present === 0) return { name, type: 'null' };
    const best = KINDS.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    let type: ColumnType = best;
    let mismatches: number;
    if (counts[best] * 2 <= present) {
      // text: every value stays as written; a native JSON number or boolean among them is not text, and is counted
      type = 'string';
      mismatches = cells.reduce((n, row) => n + (row[k] !== null && typeof row[k] !== 'string' ? 1 : 0), 0);
    } else {
      for (const row of cells) {
        const value = row[k]!;
        if (value !== null && kindOf(value, native) === best) row[k] = typed(value, best);
      }
      mismatches = present - counts[best];
    }
    if (mismatches === 0) return { name, type };
    warnings.push(DATASET_STATES.mismatches(mismatches, cells.length, name, type));
    return { name, type, mismatches };
  });
  return { columns, rows: cells, warnings };
}
