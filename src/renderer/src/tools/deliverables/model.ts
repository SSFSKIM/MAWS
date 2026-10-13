// E2 (M4): the Deliverables tool's pure decisions (E2 execution document, Design §4). Which body draws a version is
// decided by `mimeOf(basename(path))`, the same function main's scheme handler types its answer with, so the viewer
// never frames a file as something main would serve it otherwise; in particular only `application/pdf` gets the PDF
// frame, the one without a `sandbox` attribute (Decision Log 31).
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { basename } from '../artifacts/viewers/model';

// P3-L (M5b): the body's choice and `basename` moved beside the artifact viewers, which share them
export { basename, bodyOf, underSession, type BodyKind } from '../artifacts/viewers/model';

export type DeliverableKind = DeliverableRecord['kind'];
export const dirnameOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf('/')));
// A path under a home directory written from `~` (the renderer has no home of its own to ask; Session info's rule).
export const homeAbbreviated = (path: string): string => path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');

export const titleOf = (record: DeliverableRecord): string => record.title ?? basename(record.path);
export const latestVersion = (record: DeliverableRecord): number => Math.max(1, record.versions.length);
export const versionPath = (record: DeliverableRecord, version: number): string => record.versions[version - 1]?.path ?? record.path;
export const changedAt = (record: DeliverableRecord): string => record.updatedAt ?? record.createdAt;

const GROUP_ORDER: readonly DeliverableKind[] = ['artifact', 'file', 'screenshot'];

// The list's groups in a fixed order, each present only when it has rows, newest first within.
export function groupsOf(records: readonly DeliverableRecord[]): { kind: DeliverableKind; records: DeliverableRecord[] }[] {
  return GROUP_ORDER.map((kind) => ({
    kind,
    records: records.filter((r) => r.kind === kind).sort((a, b) => changedAt(b).localeCompare(changedAt(a))),
  })).filter((group) => group.records.length > 0);
}
