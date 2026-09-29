// `layout.pickFiles`, the composer's "+" menu (C7 execution document, Interfaces "X2 additions"; §4.1: the renderer
// loads nothing by path, so picked files reach it through main). The native open dialog; an image up to 20 MiB or a PDF
// up to 32 MiB comes back with its bytes (base64) for an attachment (PNG, JPEG, GIF and WebP only), anything else by path alone (the renderer mentions
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
// The image types an attachment can carry: the Messages API's four, which the composer's canvas downscale also decodes;
// HEIC, BMP and TIFF keep their media type but are answered by path alone.
const ATTACHABLE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_EXTENSIONS = Object.keys(MEDIA_TYPES).filter((ext) => ATTACHABLE_IMAGES.has(MEDIA_TYPES[ext]!)).map((ext) => ext.slice(1));

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
    const cap = mediaType === 'application/pdf' ? PDF_MAX_BYTES : mediaType !== null && ATTACHABLE_IMAGES.has(mediaType) ? (deps.imageMaxBytes ?? IMAGE_MAX_BYTES) : -1;
    const data = bytes <= cap ? (await readFile(path)).toString('base64') : null;
    files.push({ path, name: basename(path), bytes, mediaType, data });
  }
  return { files };
}
