// A dashboard made before dashboards were documents (P3-E2 M2 fix wave; parent Decision Log 16): A's generic create
// stored its `files` (relative path → whole text) under the `files` root and wrote no tab. Such a dashboard is held: its
// files read as they are, every write is refused with the way forward (create a new dashboard from their content, then
// delete this one), and nothing migrates it. Portable, so the host's tools and the editor's held state (M3) agree.
import { readFiles } from '../files';
import { listTabs } from '../document/tabs';
import type { Doc } from '../yjs';

/** The files of a held legacy dashboard (a nonempty `files` root and no tab), sorted; null for a dashboard of today. */
export function legacyDashboardFiles(doc: Doc): string[] | null {
  const paths = Object.keys(readFiles(doc));
  return paths.length > 0 && listTabs(doc).length === 0 ? paths : null;
}

/** Why such a dashboard is held, and what to do instead of writing it. */
export const legacyDashboardReason = (paths: readonly string[]): string =>
  `this dashboard was made before dashboards were documents and holds files (${paths.join(', ')}); it is kept read-only as it is: read its files with artifact_read, create a new dashboard from their content with artifact_create (then bind its data with artifact_dataset), and ask the user to delete this one`;
