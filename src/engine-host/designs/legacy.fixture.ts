// P3-E1 M2: the host tests' legacy design (imported by tests only): a design as a build before E1 stored it (its agent's
// files uninterpreted in A's generic `files` root, through A's generic publish, no design adapter registered), the
// upgrade to this build (the store reopened over the same file with the host's design module registered), and the log
// rows read as another process would see them.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { publishFiles } from '@artifacts/files';
import { boardPath, CANVAS_PATH } from '@artifacts/design/canvas';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';

export const AGENT: Actor = { kind: 'session', appSessionId: 'app-legacy' as AppSessionId };

export const LEGACY_FILES: Record<string, string> = {
  [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'Launch', boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, poster: { x: 500, y: 0, w: 1080, h: 10_000 } }, order: ['phone', 'poster'] }),
  [boardPath('phone')]: '<section id="phone" style="background:var(--ds-color-bg, #ffffff)"><h1 id="t" style="font-size:32px; color:#1a1a1a">Sign in</h1></section>',
  [boardPath('poster')]: '<section id="poster"><h1 id="t" style="font-size:96px">Poster</h1></section>',
};

/**
 * A design created with `files` by `actor` on a store with no design adapter (the generic file model), with a named
 * version of that state when `version` is set; the store is left closed, as an app quitting before its upgrade.
 */
export async function makeLegacyDesign(userData: string, options: { files?: Record<string, string>; actor?: Actor; version?: boolean; spaceDir?: string } = {}): Promise<{ id: string; versionId: number | null; spaceId: string | null }> {
  const documents = openDocuments(userData, () => {})!;
  try {
    const space = options.spaceDir ? await documents.store.createSpace({ name: 'Project', linkedDir: options.spaceDir }) : null;
    const files = options.files ?? LEGACY_FILES;
    const created = await documents.store.create({ kind: 'design', title: 'Launch', ...(space && { spaceId: space.id }), initial: (doc) => void publishFiles(doc, {}, files, false) }, options.actor ?? AGENT);
    const versionId = options.version ? await documents.store.createVersion(created.id, { kind: 'named', actor: { kind: 'human' }, label: 'Before E1' }) : null;
    return { id: created.id, versionId, spaceId: space?.id ?? null };
  } finally {
    documents.close();
  }
}

/** The artifact's log rows (seq, actor key), read through a connection of its own. */
export function logRows(userData: string, artifactId: string): { seq: number; actor: string }[] {
  const db = new DatabaseSync(join(userData, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT seq, actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(artifactId) as { seq: number; actor: string }[];
  } finally {
    db.close();
  }
}

/** Marks the store as a newer app's, so this build opens it read-only (A's Decision Log 12). */
export function markNewer(userData: string): void {
  const db = new DatabaseSync(join(userData, 'artifacts', 'store.sqlite'));
  try {
    db.exec('PRAGMA user_version = 99');
  } finally {
    db.close();
  }
}

export type { Documents };
