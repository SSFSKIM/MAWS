// P3-E2 M1 spike: the closed declarative view grammar of the parent's §2 "Views" (E §2), as both candidates read it.
// No expression, URL or callback can be written in it; unknown keys are dropped with a warning, an unknown view kind
// is an error the renderer draws. M3 hardens this into `src/artifacts/dashboard/spec.ts`.

export const VIEW_KINDS = ['bar', 'line', 'area', 'scatter', 'pie', 'table'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export type Agg = 'sum' | 'mean' | 'count' | 'min' | 'max';
export type FilterOp = 'eq' | 'ne' | 'lt' | 'gt' | 'in';
export type Format = 'number' | 'percent' | 'date' | 'text';
export type Scalar = string | number | boolean | null;

export interface ViewSpec {
  view: ViewKind;
  x?: string;
  y?: string | string[];
  series?: string;
  agg?: Agg;
  sort?: { by: string; dir: 'asc' | 'desc' };
  limit?: number;
  filter?: { column: string; op: FilterOp; value: Scalar | Scalar[] }[];
  columns?: string[];
  format?: Record<string, Format>;
  title?: string;
}

export type Parsed = { ok: true; spec: ViewSpec; warnings: string[] } | { ok: false; error: string; title?: string };

const AGGS: readonly string[] = ['sum', 'mean', 'count', 'min', 'max'];
const OPS: readonly string[] = ['eq', 'ne', 'lt', 'gt', 'in'];
const FORMATS: readonly string[] = ['number', 'percent', 'date', 'text'];
const KEYS = ['view', 'x', 'y', 'series', 'agg', 'sort', 'limit', 'filter', 'columns', 'format', 'title'];
const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const isScalar = (value: unknown): value is Scalar => value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Reads untrusted JSON into a spec: every value checked against the grammar, never trusted by shape. */
export function parseSpec(input: unknown): Parsed {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'the view spec is not an object' };
  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : undefined;
  if (!(VIEW_KINDS as readonly unknown[]).includes(raw.view)) return { ok: false, error: `unknown view "${String(raw.view).slice(0, 40)}"`, title };
  const warnings = Object.keys(raw)
    .filter((key) => !KEYS.includes(key))
    .map((key) => `unknown key "${key.slice(0, 40)}" ignored`);
  const spec: ViewSpec = { view: raw.view as ViewKind };
  const bad = (key: string) => warnings.push(`invalid "${key}" ignored`);
  if (raw.x !== undefined) (isName(raw.x) ? (spec.x = raw.x) : bad('x'));
  if (raw.y !== undefined) {
    if (isName(raw.y)) spec.y = raw.y;
    else if (Array.isArray(raw.y) && raw.y.length > 0 && raw.y.length <= 8 && raw.y.every(isName)) spec.y = raw.y as string[];
    else bad('y');
  }
  if (raw.series !== undefined) (isName(raw.series) ? (spec.series = raw.series) : bad('series'));
  if (raw.agg !== undefined) (AGGS.includes(raw.agg as string) ? (spec.agg = raw.agg as Agg) : bad('agg'));
  if (raw.sort !== undefined) {
    const sort = raw.sort as Record<string, unknown> | null;
    if (sort && isName(sort.by) && (sort.dir === 'asc' || sort.dir === 'desc')) spec.sort = { by: sort.by, dir: sort.dir };
    else bad('sort');
  }
  if (raw.limit !== undefined) (Number.isInteger(raw.limit) && (raw.limit as number) > 0 && (raw.limit as number) <= 200_000 ? (spec.limit = raw.limit as number) : bad('limit'));
  if (raw.filter !== undefined) {
    const list = Array.isArray(raw.filter) ? raw.filter : [];
    const filters = list.filter((f): f is { column: string; op: FilterOp; value: Scalar | Scalar[] } => {
      const item = f as Record<string, unknown> | null;
      if (!item || !isName(item.column) || !OPS.includes(item.op as string)) return false;
      return item.op === 'in' ? Array.isArray(item.value) && item.value.length <= 256 && item.value.every(isScalar) : isScalar(item.value);
    });
    if (filters.length !== list.length || !Array.isArray(raw.filter)) bad('filter');
    if (filters.length > 0) spec.filter = filters.map((f) => ({ column: f.column, op: f.op, value: f.value }));
  }
  if (raw.columns !== undefined) (Array.isArray(raw.columns) && raw.columns.length <= 256 && raw.columns.every(isName) ? (spec.columns = raw.columns as string[]) : bad('columns'));
  if (raw.format !== undefined) {
    const entries = typeof raw.format === 'object' && raw.format !== null ? Object.entries(raw.format as Record<string, unknown>) : [];
    const good = entries.filter(([key, value]) => isName(key) && FORMATS.includes(value as string));
    if (good.length !== entries.length || entries.length === 0) bad('format');
    if (good.length > 0) spec.format = Object.fromEntries(good) as Record<string, Format>;
  }
  if (title !== undefined) spec.title = title;
  return { ok: true, spec, warnings };
}
