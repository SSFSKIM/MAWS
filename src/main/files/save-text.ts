// `layout.saveTextFile`, the export widget's Save as… (C11 execution document, Interfaces "X2 additions"): the native
// save dialog at ~/Downloads/<defaultName>; the text is written to a temporary file beside the chosen path and renamed
// over it, so a failed write never leaves half a file. The renderer names the file, never the directory.
import { rm, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { SaveDialogOptions } from 'electron';

export type SaveDialog = (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;

export interface SaveTextDeps {
  showSaveDialog: SaveDialog;
  downloads: string; // app.getPath('downloads')
  fs?: { writeFile(path: string, text: string): Promise<void>; rename(from: string, to: string): Promise<void> };
}

export async function saveTextFile(input: { defaultName: string; text: string }, deps: SaveTextDeps): Promise<{ saved: true; path: string } | { saved: false }> {
  if (/[/\\]/.test(input.defaultName)) throw new Error(`the default file name has a path separator: ${input.defaultName}`);
  const { canceled, filePath } = await deps.showSaveDialog({ defaultPath: join(deps.downloads, input.defaultName) });
  if (canceled || !filePath) return { saved: false };
  const fs = deps.fs ?? { writeFile: (path: string, text: string) => writeFile(path, text, 'utf8'), rename };
  const temporary = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, input.text);
    await fs.rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { saved: true, path: filePath };
}
