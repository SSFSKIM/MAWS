// A local lane A upload (P5 O9 M7, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M7 and Interfaces §B, §H): the
// images and PDFs the composer serialized, decoded and checked here, saved where a Read of them asks nothing, and handed
// to the bridge's `media` op, which reads each into the conversation by a Read of its own at the main loop's next step.
// The save follows the desk-upload rules of ../fs/upload-roots.ts (sminos's own, lifted there by P5 O3-E M3 for lane
// B's `files.upload` too): the files go under `<cwd>/.claude/desk-uploads/<engineSessionId>/`, `cwd` the session's live
// directory as its bridge reads it, resolved, reached from `/` following no link; each created exclusively, 0600, as
// `<upload>.<n>.<ext>`, the extension the one its bytes' signature names (the Read picks image or PDF handling by it);
// the repository's `info/exclude` gains the uploads' line; each root recorded in `<userData>/lane-a/uploads.json` before
// anything is written under it and swept a day after its last upload. Lane A's own file names (`UPLOAD_FILE`) are the
// only ones its rollback and its sweep remove.
import { realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ControlResult } from '@shared/ipc/schema/lane-a';
import { excludeUploads, removeFiles, rootOf, saveFiles, Unsafe, uploadId, uploadRecords as recordsOf, type UploadRecords } from '../fs/upload-roots';
import type { GitRun } from '../git/runner';
import type { PostResult } from './deliveries';

export { EXCLUDE_LINE, excludeUploads, rootOf, SWEEP_AFTER_MS, Unsafe, UPLOADS, uploadId, type UploadRecords } from '../fs/upload-roots';

// DX6 `media`'s types, each with its stored extension.
export const MEDIA_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const;
export type MediaType = keyof typeof MEDIA_TYPES;
export const FILES_MAX = 4; // the bridge's MEDIA_FILES_MAX
const MiB = 1024 * 1024;
// The composer's own bounds (C3's, the API's per-file limits): the bridge sets none, reading the files by path.
export const BYTES_MAX: Record<MediaType, number> = { 'image/png': 5 * MiB, 'image/jpeg': 5 * MiB, 'image/gif': 5 * MiB, 'image/webp': 5 * MiB, 'application/pdf': 32 * MiB };
export interface DecodedFile {
  name: string; // for display only
  mediaType: MediaType;
  ext: string;
  bytes: Buffer;
}

export function typeOf(bytes: Buffer): MediaType | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  const head = bytes.subarray(0, 12).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.startsWith('%PDF-')) return 'application/pdf';
  return null;
}

// Standard base64, strictly: no other character, padded as encoded.
function decode(data: string): Buffer | null {
  if (data === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === data ? bytes : null;
}

const sizeOf = (bytes: number) => (bytes >= MiB ? `${Math.ceil(bytes / MiB)} MB` : `${Math.ceil(bytes / 1024)} KB`);

// The upload's files decoded, or why not: one to four, each one of the five types with bytes that are that type, within
// its bound. Checked before anything is written.
export function checkUpload(files: readonly { name: string; mediaType: string; data: string }[]): { ok: true; files: DecodedFile[] } | { ok: false; reason: string } {
  if (files.length < 1 || files.length > FILES_MAX) return { ok: false, reason: `a message takes 1 to ${FILES_MAX} images or PDFs` };
  const out: DecodedFile[] = [];
  for (const file of files) {
    if (!(file.mediaType in MEDIA_TYPES)) return { ok: false, reason: `${file.name} is not a PNG, JPEG, GIF or WebP image or a PDF` };
    const mediaType = file.mediaType as MediaType;
    const bytes = decode(file.data);
    if (bytes === null) return { ok: false, reason: `${file.name} did not arrive as base64 bytes` };
    if (typeOf(bytes) !== mediaType) return { ok: false, reason: `${file.name}'s bytes are not ${mediaType}` };
    if (bytes.length > BYTES_MAX[mediaType]) return { ok: false, reason: `${file.name} is ${sizeOf(bytes.length)}; ${mediaType === 'application/pdf' ? 'a PDF' : 'an image'} can be at most ${BYTES_MAX[mediaType] / MiB} MB` };
    out.push({ name: file.name, mediaType, ext: MEDIA_TYPES[mediaType], bytes });
  }
  return { ok: true, files: out };
}

// An upload's own file name (`<upload>.<n>.<ext>`): the only names a removal ever touches.
const UPLOAD_FILE = /^[A-Za-z0-9_-]{1,128}\.[0-3]\.(?:png|jpg|gif|webp|pdf)$/;

// The upload's files written under `base`, the session's resolved working directory, as `<upload>.<n>.<ext>`: its root
// and the files' names in order. When one cannot be saved, the files this upload made are removed and nothing else.
// Throws Unsafe, or an OSError.
export function saveUpload(base: string, session: string, upload: string, files: readonly DecodedFile[]): { root: string; names: string[] } {
  return saveFiles(base, session, files.map((file, n) => ({ name: `${upload}.${n}.${file.ext}`, bytes: file.bytes })), UPLOAD_FILE);
}

// An upload's files removed (every upload file, when none are named), its recorded path walked from `/` without
// following a link: whether it is done (a root already gone is).
export const removeUpload = (root: string, names?: readonly string[]): boolean => removeFiles(root, UPLOAD_FILE, names);

// `<userData>/lane-a/uploads.json`: lane A's roots, swept of lane A's files alone.
export function uploadRecords(file: string, { now, log = (line: string) => console.warn(`[lane-a] ${line}`) }: { now?: () => number; log?: (line: string) => void } = {}): UploadRecords {
  return recordsOf(file, UPLOAD_FILE, { now, log });
}

// ---- the op -----------------------------------------------------------------------------------------------------------
export interface MediaDeps {
  session: string; // the engine session id
  launch: string | null; // the launch the upload was admitted under, carried by every post of it
  post(body: Record<string, unknown>, launch: string | null): Promise<PostResult>;
  records: UploadRecords;
  git: GitRun;
  retryDelaysMs: readonly number[]; // before the second and third posts of a lost one
  log(line: string): void;
}

const refused = (code: string, message: string): ControlResult => ({ state: 'refused', code, message });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The bridge's answer to a `media` post: held (queued, or a duplicate of an upload it holds), a definite refusal, or
// lost (it may hold it).
function heldOf(posted: PostResult): 'held' | 'lost' | ControlResult {
  if (posted.kind === 'lost' || posted.status === 504 || posted.status === 503) return 'lost';
  const body = posted.body ?? {};
  const result = (body.result ?? {}) as Record<string, unknown>;
  if (posted.status === 200 && body.ok === true && (result.queued === true || result.duplicate === true)) return 'held';
  const message = typeof body.error === 'string' ? body.error : `the bridge answered ${posted.status}`;
  return refused(typeof body.code === 'string' ? body.code : posted.status === 400 ? 'bad-args' : 'refused', message);
}

// One upload, end to end: checked, the session's directory read from its bridge, the root recorded, the exclude entry,
// the save, then the `media` op, retried under the same upload id when its answer is lost (the bridge answers a held
// upload `duplicate`). A refusal of the bridge's takes the files back; a silence leaves them (it may hold them).
export async function sendMedia(deps: MediaDeps, files: readonly { name: string; mediaType: string; data: string }[]): Promise<ControlResult> {
  const checked = checkUpload(files);
  if (!checked.ok) return refused('bad-args', checked.reason);
  // The read is fenced too: an upload admitted under another launch saves nothing.
  const read = await deps.post({ op: 'read', what: 'status' }, deps.launch);
  if (read.kind === 'answer' && typeof read.body?.code === 'string') return refused(read.body.code, typeof read.body.error === 'string' ? read.body.error : `the bridge answered ${read.status}`);
  const cwd = read.kind === 'answer' && read.status === 200 && read.body?.ok === true ? ((read.body.result ?? {}) as Record<string, unknown>).cwd : null;
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return refused('failed', 'the session did not say where it works, so nothing was saved');
  let base: string;
  try {
    base = realpathSync(cwd);
  } catch (error) {
    return refused('failed', `the session’s directory could not be read (${errorText(error)}), so nothing was saved`);
  }
  const upload = uploadId();
  const root = rootOf(base, deps.session);
  try {
    deps.records.record(deps.session, root);
  } catch (error) {
    return refused('failed', `the upload could not be recorded (${errorText(error)}), so nothing was saved`);
  }
  try {
    if (!(await excludeUploads(base, deps.git))) deps.log(`${deps.session}: ${base} is in no repository; its uploads are not excluded from git`);
  } catch (error) {
    if (error instanceof Unsafe) return refused('unsafe', `the upload was not saved: ${error.message}`);
    deps.log(`${deps.session}: ${root} was not excluded from git (${errorText(error)})`);
  }
  let names: string[];
  try {
    names = saveUpload(base, deps.session, upload, checked.files).names;
  } catch (error) {
    return refused(error instanceof Unsafe ? 'unsafe' : 'failed', `the upload was not saved: ${errorText(error)}`);
  }
  const body = { op: 'media', upload, root, files: checked.files.map((f, n) => ({ n, path: join(root, names[n]!), name: f.name, mediaType: f.mediaType })) };
  for (let attempt = 0; attempt <= deps.retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, deps.retryDelaysMs[attempt - 1]));
    const held = heldOf(await deps.post(body, deps.launch));
    if (held === 'lost') continue;
    if (held === 'held') return { state: 'done', result: { upload, root, paths: body.files.map((f) => f.path) } };
    removeUpload(root, names); // the bridge refused it: nothing holds its files
    return held;
  }
  return { state: 'unknown', why: 'timeout', id: upload };
}
