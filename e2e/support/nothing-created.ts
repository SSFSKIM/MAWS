// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6; B8): what a scene that opens, changes
// or copies a file compares before and after, to show the file's frame created nothing: the Library's rows,
// `artifacts.list` for the session, every live artifact, and every file under the profile's artifacts folder (the store's
// directory, src/main/app.ts). A refused read throws, so a snapshot is never a string standing for a list.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export interface Created {
  library: string[];
  sessionArtifacts: string[];
  artifacts: string[];
  artifactFiles: string[];
}

export async function created(page: Page, userData: string, appSessionId: string): Promise<Created> {
  const listed = await page.evaluate(async (appSessionId) => {
    const library = await window.maws.invoke('library.list', {});
    if (!library.ok) throw new Error(`library.list refused: ${library.error.message}`);
    const session = await window.maws.invoke('artifacts.list', { filter: { appSessionId: appSessionId as never } });
    if (!session.ok) throw new Error(`artifacts.list for the session refused: ${session.error.message}`);
    const all = await window.maws.invoke('artifacts.list', {});
    if (!all.ok) throw new Error(`artifacts.list refused: ${all.error.message}`);
    return {
      library: library.value.rows.map((row) => row.id).sort(),
      sessionArtifacts: session.value.artifacts.map((artifact) => artifact.id).sort(),
      artifacts: all.value.artifacts.map((artifact) => artifact.id).sort(),
    };
  }, appSessionId);
  const folder = join(userData, 'artifacts');
  return { ...listed, artifactFiles: existsSync(folder) ? readdirSync(folder, { recursive: true }).map(String).sort() : [] };
}
