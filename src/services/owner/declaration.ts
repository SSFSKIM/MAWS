// The one reader of a to-human installation's declaration (the UX wave, U2b: docs/doperpowers/plans/2026-11-15-ux-wave-
// U2b-to-human-view.md, Interfaces §A, decision 2; §I, item 2). `maws-surface.json` at the installation's root,
// `{ "toHumanView": { "drawsFrom": 9 } }`, says its view draws on a client's surface when the client advertises that
// number or more. MAWS reads it without running the plugin, at each launch for every applicable installation and, after
// a reload, at the path the engine reports for the loaded plugin. A missing, oversized or otherwise shaped file does not
// declare: such an installation steps aside at 9 as at 8, whatever its version. A read that fails with an I/O error
// other than "no such file" is unknown (§A, table B, "failed"): the launch advertises 8 on it, and the tracker of who
// draws reads it as declaring.
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_DECLARATION } from '@shared/owner/contract';
import { declaresDrawing } from '@shared/owner/draws';

const DECLARATION_MAX_BYTES = 64 * 1024; // the declaration is one key; anything past this is no declaration

// true: it declares; false: the file is missing, or does not parse to the declaring shape; null: the read failed.
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
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : null; // no file, or no installation; else failed
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
