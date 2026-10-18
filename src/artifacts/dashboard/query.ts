// E3 M3 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2 and Decision Log 12; the architect's approved
// shared names): a query dataset's identity, the one rule the host's refresh (engine-host/dashboards/refresh.ts) and
// the editor's live controls (./editor/) read. Portable: no Node, Electron or window.maws.
import type { QuerySource } from './datasets';

/** A JSON value as canonical text: object keys sorted, undefined members dropped (an array's undefined, like a bare
 * one, reads null, as JSON does), so two argument objects are one whatever order their keys came in. */
export function canonicalQueryValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalQueryValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalQueryValue(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A query's identity: its server, tool and arguments, never its schedule, staleness or the dataset's metadata (the
 * architect's M2 ruling). Two queries are one exactly when their identities are equal. */
export const queryIdentity = (source: Pick<QuerySource, 'server' | 'tool' | 'args'>): string => canonicalQueryValue([source.server, source.tool, source.args]);
