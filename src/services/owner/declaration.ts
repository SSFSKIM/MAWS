// The one reader of a to-human installation's declaration (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-
// U2b-to-human-view.md, Interfaces §A, decision 2; §I, item 2). `maws-surface.json` at the installation's root,
// `{ "toHumanView": { "drawsFrom": 9 } }`, says its view draws on a client's surface when the client advertises that
// number or more. MAWS reads it without running the plugin, at each launch for every applicable installation and, after
// a reload, at the path the engine reports for the loaded plugin. A file missing from an installation directory that is
// present, or oversized or otherwise shaped, does not declare: such an installation steps aside at 9 as at 8, whatever
// its version (an installation's path names its release, so a present directory holds what the engine loaded from
// it). A directory that is gone, or any other I/O error, is unknown (§A, table B, "failed"): the launch advertises 8 on
// it, and the tracker of who draws reads it as declaring.
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_DECLARATION } from '@shared/owner/contract';
import { declaresDrawing } from '@shared/owner/draws';

const DECLARATION_MAX_BYTES = 64 * 1024; // the declaration is one key; anything past this is no declaration

// true: it declares; false: the file is missing from a present directory, or does not parse to the declaring shape;
// null: the read failed (the directory gone included).
export async function declarationOf(installPath: string): Promise<boolean | null> {
  let text: string;
  try {
    const handle = await open(join(installPath, TO_HUMAN_DECLARATION), 'r');
    try {
      if ((await handle.stat()).size > DECLARATION_MAX_BYTES) return false;
      text = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    return (await isDirectory(installPath)) ? false : null; // no file in a present directory; else the installation is gone
  }
  try {
    return declaresDrawing(JSON.parse(text) as unknown, TO_HUMAN_CONTRACT_VERSION);
  } catch {
    return false;
  }
}

// The launch's reading: only a declaring file declares.
export async function readDeclaration(installPath: string): Promise<boolean> {
  return (await declarationOf(installPath)) === true;
}

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};
