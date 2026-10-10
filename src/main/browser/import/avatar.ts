// cua board #90 (its spec's "The avatar and the profile popover"): an imported profile's avatar. Chrome keeps a signed-in
// profile's Google picture as a PNG in the profile directory, named by `Local State`'s `gaia_picture_file_name`; the
// import reads it in place (one more of the enumerated read-only reads: after the profile's admission, capped,
// `O_NOFOLLOW`), makes it a 64 px square PNG and writes that beside the partition as `avatar.png`, which goes with the
// partition folder on removal and rollback. A profile without a picture is drawn by its initial; Chrome's stock
// `avatar_icon` art is not reproduced. Nothing here logs: the caller logs a failure's code, never a byte or a name.
import { isAbsolute, join } from 'node:path';
import { CHROME_PROFILE_DIR } from '@shared/browser/import';
import { admitted, readChromePictureName, realDirectory } from './chrome/local-state';
import { readCappedBytesNoFollow } from './chrome/read-capped';

export const AVATAR_FILE = 'avatar.png'; // in the partition folder, `<userData>/browser/<partitionDirName>/`
export const AVATAR_SIZE = 64;
export const PICTURE_MAX_BYTES = 1024 * 1024;

export type PictureRead = { ok: true; bytes: Buffer } | { ok: false; error: 'none' | 'missing' | 'unreadable' | 'tooLarge' };

// The profile's picture as Chrome keeps it: `none` when Local State names none (or cannot say), `missing` when the
// file, the profile directory or the Chrome folder is gone, `unreadable` for a symlink, a profile directory whose real
// path left the Chrome folder or anything not a regular file.
export async function readChromePicture(userDataDir: string, profileDir: string): Promise<PictureRead> {
  if (!isAbsolute(userDataDir) || !CHROME_PROFILE_DIR.test(profileDir)) return { ok: false, error: 'none' };
  const root = await realDirectory(userDataDir);
  const name = root === null ? null : await readChromePictureName(userDataDir, profileDir);
  if (root === null || name === null) return { ok: false, error: 'none' };
  const profilePath = join(userDataDir, profileDir);
  if (!(await admitted(root, userDataDir, profileDir))) return { ok: false, error: (await realDirectory(profilePath)) === null ? 'missing' : 'unreadable' };
  const read = await readCappedBytesNoFollow(join(profilePath, name), PICTURE_MAX_BYTES);
  return typeof read === 'string' ? { ok: false, error: read } : { ok: true, bytes: read.bytes };
}

// What the avatar needs of Electron's `NativeImage` (main passes `nativeImage.createFromBuffer`).
export interface AvatarImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  crop(rect: { x: number; y: number; width: number; height: number }): AvatarImage;
  resize(options: { width: number; height: number; quality: 'best' }): AvatarImage;
  toPNG(): Buffer;
}

// The picture as the avatar's PNG: its centred square, AVATAR_SIZE px a side; null when the bytes are no image.
export function avatarPng(bytes: Buffer, decode: (bytes: Buffer) => AvatarImage): Buffer | null {
  let image = decode(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const side = Math.min(width, height);
  if (width !== height) image = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  return image.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: 'best' }).toPNG();
}
