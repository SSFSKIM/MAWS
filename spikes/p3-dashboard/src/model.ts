// P3-E2 M1 spike (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, M1): the renderer's input. A table is what the
// host's reader would hand a view (columns with inferred types, rows of scalars); `parseCsv` is a minimal stand-in for
// M2's strict parser, enough to load the three vendored datasets, never the product boundary.

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'null';
export type Cell = string | number | boolean | null;
export interface Column {
  name: string;
  type: ColumnType;
}
export interface Table {
  columns: Column[];
  rows: Cell[][];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z)?$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** RFC 4180 records: quoted fields may hold the delimiter, quotes (doubled) and line breaks. */
export function parseCsv(text: string, delimiter = ','): Table {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || record.length > 0) records.push([...record, field]);
  const [header, ...body] = records;
  const types = header.map((_, c) => inferType(body.map((row) => row[c] ?? '')));
  return {
    columns: header.map((name, c) => ({ name, type: types[c] })),
    rows: body.map((row) => header.map((_, c) => cellOf(row[c] ?? '', types[c]))),
  };
}

function inferType(values: string[]): ColumnType {
  const present = values.filter((value) => value !== '');
  if (present.length === 0) return 'null';
  if (present.every((value) => NUMBER.test(value) && Number.isFinite(Number(value)) && !/^[+-]?0\d/.test(value))) return 'number';
  if (present.every((value) => value === 'true' || value === 'false')) return 'boolean';
  if (present.every((value) => ISO_DATE.test(value) && Number.isFinite(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)))) return 'date';
  return 'string';
}

function cellOf(value: string, type: ColumnType): Cell {
  if (value === '') return null;
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  return value;
}

/** A date cell's instant in UTC milliseconds (dates are ISO calendar dates or `Z` date-times; never local time). */
export function instantOf(value: Cell): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(ms) ? ms : null;
}
