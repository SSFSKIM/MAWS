// `layout.saveTextFile`, the export widget's Save as… (C11 execution document, Interfaces "X2 additions"): the native
// save dialog at ~/Downloads/<defaultName>; the text is written to a temporary file beside the chosen path and renamed
// over it, so a failed write never leaves half a file. The renderer names the file, never the directory.
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write';
import type { SaveDialogOptions } from 'electron';
import { ipcError } from '@shared/ipc/errors';
import { CommandFailure } from '../ipc/router';

export type SaveDialog = (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;

export interface SaveTextDeps {
  showSaveDialog: SaveDialog;
  downloads: string; // app.getPath('downloads')
}

export async function saveTextFile(input: { defaultName: string; text: string }, deps: SaveTextDeps): Promise<{ saved: true; path: string } | { saved: false }> {
  if (/[/\\]/.test(input.defaultName)) throw new CommandFailure(ipcError('invalid_input', `the default file name has a path separator: ${input.defaultName}`));
  const { canceled, filePath } = await deps.showSaveDialog({ defaultPath: join(deps.downloads, input.defaultName) });
  if (canceled || !filePath) return { saved: false };
  await atomicWriteFile(filePath, input.text);
  return { saved: true, path: filePath };
}
