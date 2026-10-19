// The dashboard's view spec (P3-E2 M3; parent §2 "Views", ledger X26: the `chart` atom's `spec` is E's): a closed
// declarative grammar a chart or table block names its dataset's view with. No expression, URL or callback can be
// written in it; every value is checked against the grammar, never trusted by its shape. An unknown key, or a value the
// grammar refuses, is dropped with a warning (the agent's `viewWarnings`, and the note under the view); an unknown view
// kind, a spec that is not an object, or a pie of more than one measure (P3-F) cannot be drawn and is the shared
// in-place error. Promoted from M1's spike.
import type { Cell } from './datasets';

export const VIEW_KINDS = ['bar', 'line', 'area', 'scatter', 'pie', 'table'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export const AGGREGATES = ['sum', 'mean', 'count', 'min', 'max'] as const;
export type Aggregate = (typeof AGGREGATES)[number];
export const FILTER_OPS = ['eq', 'ne', 'lt', 'gt', 'in'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];
export const VALUE_FORMATS = ['number', 'percent', 'date', 'text'] as const;
export type ValueFormat = (typeof VALUE_FORMATS)[number];

export interface ViewFilter {
  column: string;
  op: FilterOp;
  value: Cell | Cell[];
}

export interface ViewSpec {
  view: ViewKind;
  x?: string;
  y?: string | string[];
  series?: string;
  agg?: Aggregate;
  sort?: { by: string; dir: 'asc' | 'desc' };
  limit?: number;
  filter?: ViewFilter[];
  columns?: string[];
  format?: Record<string, ValueFormat>;
  /** The caption. */
  title?: string;
}

export type ParsedSpec = { ok: true; spec: ViewSpec; warnings: string[] } | { ok: false; error: string; title?: string };

// Bounds of the grammar: a column name as the dataset's (256), a caption, the series of one view, a filter's list.
export const SPEC_LIMITS = { name: 256, title: 200, ys: 8, columns: 256, inValues: 256, limit: 200_000 } as const;

const KEYS: readonly string[] = ['view', 'x', 'y', 'series', 'agg', 'sort', 'limit', 'filter', 'columns', 'format', 'title'];
const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= SPEC_LIMITS.name;
const isCell = (value: unknown): value is Cell => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const clip = (text: string, max = 40) => (text.length <= max ? text : `${text.slice(0, max)}…`);
/** An untrusted value named in a message, never by calling its own methods (`{toString: 0}` is valid JSON). */
const describe = (value: unknown): string => (typeof value === 'string' ? `"${clip(value)}"` : value === undefined ? '(none)' : value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value === 'object' ? 'object' : `${typeof value} ${clip(JSON.stringify(value) ?? '')}`);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads an untrusted spec (a chart atom's `spec` attribute) into the grammar. */
export function parseSpec(input: unknown): ParsedSpec {
  if (!isRecord(input)) return { ok: false, error: 'the view spec is not an object' };
  const raw = input;
  const title = typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.slice(0, SPEC_LIMITS.title) : undefined;
  if (!oneOf(VIEW_KINDS, raw.view)) return { ok: false, error: `unknown view ${describe(raw.view)}`, ...(title !== undefined && { title }) };
  const warnings = Object.keys(raw)
    .filter((key) => !KEYS.includes(key))
    .map((key) => `unknown key "${clip(key)}" ignored`);
  const spec: ViewSpec = { view: raw.view };
  const bad = (key: string) => warnings.push(`invalid "${key}" ignored`);
  if (raw.x !== undefined) {
    if (isName(raw.x)) spec.x = raw.x;
    else bad('x');
  }
  if (raw.y !== undefined) {
    if (isName(raw.y)) spec.y = raw.y;
    else if (Array.isArray(raw.y) && raw.y.length > 0 && raw.y.length <= SPEC_LIMITS.ys && raw.y.every(isName)) spec.y = [...(raw.y as string[])];
    else bad('y');
  }
  // P3-F: a pie's slices are one measure's sizes; a further measure is the view's error, never dropped in silence
  if (spec.view === 'pie' && Array.isArray(spec.y) && spec.y.length > 1) return { ok: false, error: `a pie view draws one measure; y also names ${spec.y.slice(1).map((name) => `"${clip(name)}"`).join(', ')}`, ...(title !== undefined && { title }) };
  if (raw.series !== undefined) {
    if (isName(raw.series)) spec.series = raw.series;
    else bad('series');
  }
  if (raw.agg !== undefined) {
    if (oneOf(AGGREGATES, raw.agg)) spec.agg = raw.agg;
    else bad('agg');
  }
  if (raw.sort !== undefined) {
    const sort = raw.sort;
    if (isRecord(sort) && isName(sort.by) && (sort.dir === 'asc' || sort.dir === 'desc') && Object.keys(sort).length === 2) spec.sort = { by: sort.by, dir: sort.dir };
    else bad('sort');
  }
  if (raw.limit !== undefined) {
    if (Number.isInteger(raw.limit) && (raw.limit as number) > 0 && (raw.limit as number) <= SPEC_LIMITS.limit) spec.limit = raw.limit as number;
    else bad('limit');
  }
  if (raw.filter !== undefined) {
    const list = Array.isArray(raw.filter) ? raw.filter : [];
    const filters = list.flatMap((item): ViewFilter[] => {
      if (!isRecord(item) || !isName(item.column) || !oneOf(FILTER_OPS, item.op) || Object.keys(item).some((key) => !['column', 'op', 'value'].includes(key))) return [];
      const value = item.value;
      if (item.op === 'in') return Array.isArray(value) && value.length <= SPEC_LIMITS.inValues && value.every(isCell) ? [{ column: item.column, op: item.op, value: [...value] }] : [];
      return isCell(value) ? [{ column: item.column, op: item.op, value }] : [];
    });
    if (filters.length !== list.length || !Array.isArray(raw.filter)) bad('filter');
    if (filters.length > 0) spec.filter = filters;
  }
  if (raw.columns !== undefined) {
    if (Array.isArray(raw.columns) && raw.columns.length > 0 && raw.columns.length <= SPEC_LIMITS.columns && raw.columns.every(isName)) spec.columns = [...(raw.columns as string[])];
    else bad('columns');
  }
  if (raw.format !== undefined) {
    const entries = isRecord(raw.format) ? Object.entries(raw.format) : [];
    const good = entries.filter(([key, value]) => isName(key) && oneOf(VALUE_FORMATS, value));
    if (good.length !== entries.length || entries.length === 0) bad('format');
    // a null-prototype record, so a column named `__proto__` is a key like any other
    if (good.length > 0) spec.format = Object.assign(Object.create(null) as Record<string, ValueFormat>, Object.fromEntries(good));
  }
  if (raw.title !== undefined && title === undefined) bad('title');
  if (title !== undefined) spec.title = title;
  return { ok: true, spec, warnings };
}

/** What a write stores for a chart's spec: the grammar's reading of it (unknown keys dropped), or the input as given
 * when it cannot be read (an unknown view kind stays one, drawn as the error), with what was said about it. */
export function normalizeSpec(input: unknown): { spec: unknown; changed: boolean; warnings: string[] } {
  const parsed = parseSpec(input);
  if (!parsed.ok) return { spec: input, changed: false, warnings: [`${parsed.error}; the view draws as an error`] };
  const spec = plain(parsed.spec);
  return { spec, changed: JSON.stringify(spec) !== JSON.stringify(input), warnings: parsed.warnings };
}

// The spec as a plain JSON value (the format record's null prototype dropped), in the grammar's key order.
function plain(spec: ViewSpec): Record<string, unknown> {
  return JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
}

export const yColumns = (spec: ViewSpec): string[] => (spec.y === undefined ? [] : Array.isArray(spec.y) ? spec.y : [spec.y]);
