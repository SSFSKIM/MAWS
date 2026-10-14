// The artifact viewers' pure decisions (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b). Which body draws a
// stored file is decided by `mimeOf` of its name, the function main's scheme handler types its answer with, so a viewer
// never frames a file as something main would serve otherwise; only `application/pdf` gets the PDF frame, the one
// without a `sandbox` attribute (E2's Decision Log 31). Moved here from the Deliverables tool, which reads it too.
//
// An artifact's versions are listed in the order of the revision each captured and named by their place, `v1 … vN`,
// the last marked latest (the Deliverables viewer's labels); the viewer shows a place, or the latest when it was asked
// for none, so it follows a new version as it lands.
import { mimeOf } from '@shared/files/mime';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { SessionRecord } from '@shared/graph/session';

export type BodyKind = 'html' | 'pdf' | 'video' | 'audio' | 'file';

export const basename = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path;

export function bodyOf(nameOrPath: string): BodyKind {
  const mime = mimeOf(basename(nameOrPath));
  if (mime === 'text/html') return 'html';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export const versionLabel = (n: number, latest: boolean): string => (latest ? `v${n} · latest` : `v${n}`);

export const versionsInOrder = (versions: readonly ArtifactVersion[]): ArtifactVersion[] => [...versions].sort((a, b) => a.seq - b.seq || a.id - b.id);

export interface ShownVersion {
  n: number; // its place, from 1
  version: ArtifactVersion;
  latest: boolean;
}

// The version at place `chosen` (from 1), else the latest; null when there are none to show.
export function shownVersion(ordered: readonly ArtifactVersion[], chosen: number | null): ShownVersion | null {
  if (ordered.length === 0) return null;
  const n = chosen !== null && chosen >= 1 && chosen <= ordered.length ? chosen : ordered.length;
  return { n, version: ordered[n - 1]!, latest: n === ordered.length };
}

// What the viewer keeps for a choice of place `n` among `count`: the place, or null (follow the latest) for the latest.
export const versionToShow = (n: number | null, count: number): number | null => (n === null || n >= count || n < 1 ? null : n);

// An absolute path with no `.` or `..` segment, no empty segment and no trailing separator: what the files service
// accepts, and what the host records (it resolves every path it is given).
const isNormal = (path: string): boolean => path.startsWith('/') && (path === '/' || path.slice(1).split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'));

// Whether a path lies under one of the session's directories (its directory, additional directories, worktree), judged
// lexically: the only files the editor could both read and save, so the only ones Open as file is offered for (E2's
// Decision Log 18; moved here by P3-L M5b, as the File viewer's Open as file reads it too). A path that is not normal is
// under nothing (the files service would refuse it).
export function underSession(path: string, session: SessionRecord | undefined): boolean {
  if (!session || !isNormal(path)) return false;
  const roots = [session.directory, ...session.additionalDirectories, ...(session.worktree ? [session.worktree.path] : [])];
  return roots.some((root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`));
}
