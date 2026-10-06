// E2 (M4): the Deliverables tool's pure decisions (E2 execution document, Design §4). Which body draws a version is
// decided by `mimeOf(basename(path))`, the same function main's scheme handler types its answer with, so the viewer
// never frames a file as something main would serve it otherwise; in particular only `application/pdf` gets the PDF
// frame, the one without a `sandbox` attribute (Decision Log 31).
import { mimeOf } from '@shared/files/mime';
import type { SessionRecord } from '@shared/graph/session';
import type { DeliverableRecord } from '@shared/maws/deliverable';

export type DeliverableKind = DeliverableRecord['kind'];
export type BodyKind = 'html' | 'pdf' | 'video' | 'audio' | 'file';

export const basename = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path;
export const dirnameOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf('/')));
// A path under a home directory written from `~` (the renderer has no home of its own to ask; Session info's rule).
export const homeAbbreviated = (path: string): string => path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');

export function bodyOf(path: string): BodyKind {
  const mime = mimeOf(basename(path));
  if (mime === 'text/html') return 'html';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

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

// An absolute path with no `.` or `..` segment, no empty segment and no trailing separator: what the files service
// accepts, and what the host records (it resolves every path it is given).
const isNormal = (path: string): boolean => path.startsWith('/') && (path === '/' || path.slice(1).split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'));

// Whether a path lies under one of the session's directories (its directory, additional directories, worktree), judged
// lexically: the only files the editor could both read and save, so the only ones Open as file is offered for
// (Decision Log 18). A path that is not normal is under nothing (the files service would refuse it).
export function underSession(path: string, session: SessionRecord | undefined): boolean {
  if (!session || !isNormal(path)) return false;
  const roots = [session.directory, ...session.additionalDirectories, ...(session.worktree ? [session.worktree.path] : [])];
  return roots.some((root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`));
}
