// `layout.pickFiles`, the composer's "+" menu (C7 execution document, Interfaces "X2 additions"; §4.1: the renderer
// loads nothing by path, so picked files reach it through main). The native open dialog; an image up to 20 MiB or a PDF
// up to 32 MiB comes back with its bytes (base64) for an attachment, anything else by path alone (the renderer mentions
// it). `kind: 'directory'` answers the chosen directory's path and never reads what is in it.
import type { OpenDialogOptions } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { PickedFile, PickFilesInput } from '@shared/ipc/schema/layout';

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_BYTES = 32 * 1024 * 1024;

export type OpenDialog = (options: OpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>;

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.pdf': 'application/pdf',
};
const IMAGE_EXTENSIONS = Object.keys(MEDIA_TYPES).filter((ext) => MEDIA_TYPES[ext]!.startsWith('image/')).map((ext) => ext.slice(1));

export async function pickFiles(input: PickFilesInput, deps: { showOpenDialog: OpenDialog; imageMaxBytes?: number }): Promise<{ files: PickedFile[] }> {
  const options: OpenDialogOptions = { properties: input.kind === 'directory' ? ['openDirectory'] : input.multiple ? ['openFile', 'multiSelections'] : ['openFile'] };
  if (input.kind === 'photos') options.filters = [{ name: 'Images', extensions: IMAGE_EXTENSIONS }];
  if (input.directory !== null) options.defaultPath = input.directory;
  const { canceled, filePaths } = await deps.showOpenDialog(options);
  if (canceled) return { files: [] };
  const files: PickedFile[] = [];
  for (const path of filePaths) {
    if (input.kind === 'directory') {
      files.push({ path, name: basename(path), bytes: 0, mediaType: 'inode/directory', data: null });
      continue;
    }
    let bytes: number;
    try {
      bytes = (await stat(path)).size;
    } catch {
      continue; // gone between the dialog and the read
    }
    const mediaType = MEDIA_TYPES[extname(path).toLowerCase()] ?? null;
    const cap = mediaType === 'application/pdf' ? PDF_MAX_BYTES : mediaType?.startsWith('image/') ? (deps.imageMaxBytes ?? IMAGE_MAX_BYTES) : 0;
    const data = bytes <= cap ? (await readFile(path)).toString('base64') : null;
    files.push({ path, name: basename(path), bytes, mediaType, data });
  }
  return { files };
}
