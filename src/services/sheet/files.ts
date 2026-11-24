// A record's bodies and uploads (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §C, "Confinement",
// "Bodies", "Uploads"): the only files of a record MAWS reads beyond `state.json` and the inbox, and the only one it
// writes. Every path is the record's own: the record's directory and the one entered (`refs/`, `uploads/`, `texts/`)
// are checked with `lstat` to be real directories, and a body opened without following a link and checked to be a
// regular file, as the door refuses a linked `uploads/` and a file that is not regular. A name is the caller's only
// after the schemas held it to a pattern with no separator. An image goes to a window only as one of the four raster
// types, its bytes that type's signature: bytes an agent chose are never handed to a window as markup (§8.2's fourth
// rule).
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SheetBody, SheetImageType } from '@shared/sheet/model';

export const GONE: SheetBody = { kind: 'gone' };
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // the composer's own bound after downscaleImage (R/composer/editor/attachments.ts)
const BODY_MAX_BYTES = 16 * 1024 * 1024; // past the engine's Read and the upload bound alike: no window is sent more

const EXTENSION: Record<SheetImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const BY_EXTENSION: Record<string, SheetImageType> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** The raster type an upload's name says (`uploads/<stem>.<ext>`), or null. */
export const imageTypeOfName = (name: string): SheetImageType | null => BY_EXTENSION[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? null;

const starts = (bytes: Uint8Array, at: number, sig: readonly number[]): boolean => sig.every((byte, i) => bytes[at + i] === byte);
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** The raster type the bytes' signature is, or null. */
export function imageTypeOf(bytes: Uint8Array): SheetImageType | null {
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, 0, ascii('GIF87a')) || starts(bytes, 0, ascii('GIF89a'))) return 'image/gif';
  if (starts(bytes, 0, ascii('RIFF')) && starts(bytes, 8, ascii('WEBP'))) return 'image/webp';
  return null;
}

const kindOf = async (path: string): Promise<'directory' | 'file' | 'other' | null> => {
  try {
    const st = await lstat(path);
    return st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other';
  } catch {
    return null;
  }
};

/** Whether `record` is a record: a real directory holding a regular `state.json`. */
export const isRecord = async (record: string): Promise<boolean> => (await kindOf(record)) === 'directory' && (await kindOf(join(record, 'state.json'))) === 'file';

/**
 * Whether the record's `inbox.jsonl` may be appended to: absent (the door makes it) or a regular file; never a link or
 * a special file, as the reader refuses to read one. Checked by MAWS before the door runs, whatever the writer checks.
 */
export const isInboxConfined = async (record: string): Promise<boolean> => {
  const kind = await kindOf(join(record, 'inbox.jsonl'));
  return kind === null || kind === 'file';
};

/**
 * A body of the record, `<record>/<dir>/<name>`: as text, or as the image type `as` names when its bytes are that
 * type's; `gone` for anything missing, linked, special, too large or of another type.
 */
export async function readBody(record: string, dir: 'refs' | 'uploads' | 'texts', name: string, as: 'text' | string): Promise<SheetBody> {
  if (as !== 'text' && !(as in EXTENSION)) return GONE;
  if ((await kindOf(record)) !== 'directory' || (await kindOf(join(record, dir))) !== 'directory') return GONE;
  let handle;
  try {
    handle = await open(join(record, dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return GONE;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > BODY_MAX_BYTES) return GONE;
    const bytes = await handle.readFile();
    if (as === 'text') return { kind: 'text', text: new TextDecoder().decode(bytes) };
    return imageTypeOf(bytes) === as ? { kind: 'image', mediaType: as as SheetImageType, data: bytes.toString('base64') } : GONE;
  } catch {
    return GONE;
  } finally {
    await handle.close();
  }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const REFUSED = {
  encoding: 'The image is not base64.',
  size: 'The image is larger than 5 MiB.',
  type: 'The image’s bytes are not of the type it names.',
  record: 'This session has no question sheet on this Mac.',
  uploads: 'The sheet’s uploads/ is not a directory of the record.',
  write: 'The image could not be saved.',
} as const;

/**
 * Writes an image into `<record>/uploads/` exclusively, at mode 0600, under a name of MAWS's own, and answers its
 * `uploads/<name>` as a line names it. Refused, writing nothing, for bytes that are not the type `mediaType` names (the
 * one check the app and C4's page hold at this boundary), past `UPLOAD_MAX_BYTES`, with no record, or where `uploads/`
 * is not a real directory; an absent `uploads/` is made at mode 0700.
 */
export async function writeUpload(record: string, mediaType: SheetImageType, data: string): Promise<{ ok: true; path: string } | { ok: false; why: string }> {
  if (!(mediaType in EXTENSION)) return { ok: false, why: REFUSED.type };
  if (data.length > Math.ceil(UPLOAD_MAX_BYTES / 3) * 4) return { ok: false, why: REFUSED.size };
  if (data.length % 4 !== 0 || !BASE64.test(data)) return { ok: false, why: REFUSED.encoding };
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, why: REFUSED.size };
  if (imageTypeOf(bytes) !== mediaType) return { ok: false, why: REFUSED.type };
  if (!(await isRecord(record))) return { ok: false, why: REFUSED.record };
  const uploads = join(record, 'uploads');
  let kind = await kindOf(uploads);
  if (kind === null) {
    await mkdir(uploads, { mode: 0o700 }).catch(() => {}); // made meanwhile: looked at again below
    kind = await kindOf(uploads);
  }
  if (kind !== 'directory') return { ok: false, why: REFUSED.uploads };
  const name = `maws-${randomBytes(16).toString('hex')}.${EXTENSION[mediaType]}`;
  let handle;
  try {
    handle = await open(join(uploads, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch {
    return { ok: false, why: REFUSED.write };
  }
  try {
    await handle.writeFile(bytes);
  } catch {
    await handle.close();
    await unlink(join(uploads, name)).catch(() => {});
    return { ok: false, why: REFUSED.write };
  }
  await handle.close();
  return { ok: true, path: `uploads/${name}` };
}
