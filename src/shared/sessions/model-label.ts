// The model chip's words (W3; charter §5.4 as amended 2026-10-01): `<alias> <effort>`, as the owner reads them (opus
// high, sonnet xhigh, fable high, sol high), and never "Default", "Default model" or "Default (recommended)". The alias
// is the catalogue row's value without its `claude/` prefix; the catalogue's `default` row shares Opus's resolved id
// and comes first (reads.jsonl seq 3), so a resolved id is named by the first row that is not `default`, and `default`
// itself by the row its resolved model names. Pure. W9 (H4): moved here from the composer's frame, since the panel's
// summary names the model by it too (beside Settings, the widgets and the Direct model sheet).
import type { Effort } from '../engine/launch-spec';

interface Row {
  value: string;
  displayName: string;
  resolvedModel?: string;
}

export const DEFAULT_ROW = 'default';

// What the `default` row runs: the named row sharing its resolved model.
export function defaultTarget<R extends Row>(rows: readonly R[]): R | undefined {
  const resolved = rows.find((r) => r.value === DEFAULT_ROW)?.resolvedModel;
  return resolved === undefined ? undefined : rows.find((r) => r.value !== DEFAULT_ROW && (r.resolvedModel === resolved || r.value === resolved));
}

// The row a model id names: its alias, else the first named row resolving to it; `default` is the row it runs.
export function rowFor<R extends Row>(rows: readonly R[], id: string | null): R | undefined {
  if (id === null) return undefined;
  if (id === DEFAULT_ROW) return defaultTarget(rows);
  const named = rows.filter((r) => r.value !== DEFAULT_ROW);
  return named.find((r) => r.value === id) ?? named.find((r) => r.resolvedModel === id);
}

// A value as the chip says it: `claude/astra` → astra, an OpenRouter `claude/<vendor>/<model>[1m]` → its model, a full
// Claude id with no row to name it → its family (`claude-opus-5-5[1m]` → opus).
export function shortAlias(value: string): string {
  const bare = value.startsWith('claude/') ? value.slice('claude/'.length) : value;
  const family = /^claude-(opus|sonnet|fable|haiku)(?:-|$)/.exec(bare)?.[1];
  if (family) return family;
  return (bare.split('/').pop() ?? bare).replace(/\[1m\]$/, '');
}

// The alias for a model id over a catalogue; null when there is no id at all.
export function aliasOf(id: string | null, rows: readonly Row[]): string | null {
  if (id === null) return null;
  const row = rowFor(rows, id);
  return shortAlias(row?.value ?? (id === DEFAULT_ROW ? (rows.find((r) => r.value === DEFAULT_ROW)?.resolvedModel ?? id) : id));
}

// Whether the engine's report `resolved` is the model `requested` runs: the same id, or the id the catalogue resolves
// the request to (an alias or `default` by its row, a resolved id as itself). Exact ids, never aliases: the alias is for
// display only, and "haiku" names Haiku 4.5 and 5.5 alike, "glm" two providers' models. Null when the catalogue cannot
// say what the request runs (an alias it does not list, a row with no resolved id).
export function reportsRequested(requested: string, resolved: string, rows: readonly Row[]): boolean | null {
  if (requested === resolved) return true;
  const row = rows.find((r) => r.value === requested);
  const runs = row ? row.resolvedModel : rows.some((r) => r.resolvedModel === requested) ? requested : undefined;
  return runs === undefined ? null : runs === resolved;
}

// The model a session asked for and whether the engine has acknowledged it: one rule for the model chip and the
// selector (P2-F wave S, the review of S-chip). `held` is the request this renderer made and the engine has not reported
// since (widgets/model.ts), `value` null for Default; it wins over the status, whose null `requested` cannot tell an
// explicit Default from no request. A request is pending until the engine reports running it (`reportsRequested`),
// and while nothing is reported at all; one the catalogue cannot resolve is pending only while held, since a report
// after the ask is all the acknowledgement there is to see.
export interface ModelAsk {
  asked: string | null; // the model asked for; null: none, or Default when `explicit`
  explicit: boolean;
  pending: boolean;
}
export function modelAsk(held: { value: string | null } | undefined, model: { requested: string | null; resolved: string | null }, rows: readonly Row[]): ModelAsk {
  const asked = held ? held.value : model.requested;
  const explicit = held !== undefined || asked !== null;
  if (!explicit) return { asked, explicit, pending: false };
  if (model.resolved === null) return { asked, explicit, pending: true };
  const reported = reportsRequested(asked ?? DEFAULT_ROW, model.resolved, rows);
  return { asked, explicit, pending: reported === null ? held !== undefined : !reported };
}

// The chip's text: the alias and the effort the engine runs at; the alias alone for a model without effort (Haiku) or
// while the effort is not known; `Model` while nothing names a model.
export function chipLabel(alias: string | null, effort: Effort | null | undefined): string {
  if (alias === null) return 'Model';
  return effort ? `${alias} ${effort}` : alias;
}

// A catalogue row's name in a list: `default` is named by the model it runs (its own display name is the engine's
// "Default (recommended)", which MAWS never shows), and the list marks it with the Default badge.
export function listName(row: Row, rows: readonly Row[]): string {
  if (row.value !== DEFAULT_ROW) return row.displayName;
  return defaultTarget(rows)?.displayName ?? aliasOf(DEFAULT_ROW, rows) ?? row.value;
}

// The effort levels in words (Claude Desktop's labels), for the selector's title.
export const EFFORT_WORDS: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
