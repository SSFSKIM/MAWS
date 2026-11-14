// `files.upload` (P5 O3-E M3, docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §F; D7; O7's C8): the
// bytes a caller sends written into the session's attachments directory on this machine, so a message's paths are the
// machine's. The bounds (1 to 8 files, 32 MiB decoded each and in all) are the input schema's, checked before a call
// reaches here; everything else is lane A's rules for a desk upload (../fs/upload-roots.ts): the directory
// `<working directory>/.claude/desk-uploads/<appSessionId>/`, reached from `/` following no link, each file created
// exclusively, 0600, the repository's `info/exclude` carrying the uploads' line, the root recorded in
// `<profile>/sessions/uploads.json` before the first byte and swept a day after its last upload.
//
// The stored name is `<upload id>.<n>[.<ext>]` (the id lane A's minter's, `n` the file's index): the extension the
// bytes' signature names for the media lane A knows, else the given name's when it is letters and digits alone (at most
// 16, lowercased), else none; the given name is never written. Every refusal is a value with nothing written, a later
// file's taking back the earlier ones of the call, so a remote act's stored answer is the refusal itself.
import { realpathSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { MAX_SEND_CONTENT_JSON_BYTES, MAX_SEND_DOCUMENT_BYTES } from '@shared/engine/session-state-store';
import { REMOTE_UPLOAD_PART_BYTES, UPLOAD_FILE_MAX_BYTES, UPLOAD_ID_PATTERN, UPLOAD_KEPT_MS, type FilesReadUploadsInput, type FilesReadUploadsOutput, type FilesUploadInput, type FilesUploadOutput, type UploadDocumentBlock, type UploadPart } from '@shared/ipc/schema/files';
import type { SpineView } from '@shared/spine/view';
import { AlreadyThere, confirmOpens, excludeUploads, promoteStaged, readUpload, rootOf, saveFiles, stagePart, Unconfirmed, Unsafe, uploadId, uploadRecords, type UploadRecords } from '../fs/upload-roots';
import type { GitRun } from '../git/runner';
import { MEDIA_TYPES, typeOf } from '../lane-a/media';
import { admittedFolder, allowlistOf, type AllowlistRecord } from './allowlist';

// A run with no record of the upload roots (a run refused the spine) writes nothing
export const UPLOADS_UNAVAILABLE: FilesUploadOutput = { status: 'refused', reason: 'uploads are not available this run' };
export const UPLOAD_READS_UNAVAILABLE: FilesReadUploadsOutput = { status: 'refused', reason: 'uploads are not available this run' }; // P5 O7 M8
// Lane B's own file names: the only ones its rollback and its sweep remove (lane A's are `<id>.<0-3>.<media ext>`)
const UPLOAD_FILE = UPLOAD_ID_PATTERN; // P5 O7 M8: a stored name is the id a send names it by
// P5 O7 M4: a remote upload's staging, named by the sender's upload id (UploadPartSchema's pattern)
const STAGED_FILE = /^[A-Za-z0-9_-]{16,128}$/;
export const UPLOAD_SWEEP_MS = 3600_000; // as lane A's driver sweeps its own

// `<profile>/sessions/uploads.json`: lane B's roots, swept of lane B's files alone.
export function uploadRootsOf(file: string, options: { now?: () => number; log: (line: string) => void }): UploadRecords {
  return uploadRecords(file, UPLOAD_FILE, { ...options, staged: STAGED_FILE });
}

// The roots swept once soon after the start (never inside it) and then every UPLOAD_SWEEP_MS, until the answer is called.
export function scheduleUploadSweep(roots: UploadRecords, { log }: { log: (line: string) => void }): () => void {
  let stopped = false;
  const sweep = () => {
    try {
      const swept = roots.sweep();
      if (swept > 0) log(`swept ${swept} upload root${swept === 1 ? '' : 's'} no upload went to for a day`);
    } catch (error) {
      log(`the upload roots were not swept (${errorText(error)})`);
    }
  };
  const sweeper = setInterval(sweep, UPLOAD_SWEEP_MS);
  sweeper.unref();
  setImmediate(() => {
    if (!stopped) sweep();
  });
  return () => {
    stopped = true;
    clearInterval(sweeper);
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const refused = (reason: string): { status: 'refused'; reason: string } => ({ status: 'refused', reason }); // either command's refusal

// UX wave U8c-2 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, M3 decision 7): the base of a
// call, decided once, before a root is recorded, the exclude file is touched or a byte is written or read: the session's
// working folder as the admission takes it (`admittedFolder`), so a folder only one of the record's facts names is used
// only while it is a registered work tree of the record's repository, and then as the realpath the check ran on. The
// record's own folder resolves as lane A resolves its bridge's cwd (links above it are the session's own spelling). What
// is not pinned: the directory at that pathname between the admission and the walk that writes (tech-debt tracker).
type Base = { base: string } | { refusal: string };
async function baseOf(directories: AllowlistRecord): Promise<Base> {
  const admitted = await admittedFolder(directories, 'path');
  if (admitted === null) return { refusal: 'the session’s working folder is not a worktree of its repository' };
  if (admitted.checked) return { base: admitted.folder };
  try {
    return { base: realpathSync(admitted.folder) };
  } catch (error) {
    return { refusal: `the session’s working directory could not be read (${errorText(error)})` };
  }
}

// The stored extension: the signature's, else the name's when usable, else none.
function extensionOf(name: string, bytes: Buffer): string | null {
  const type = typeOf(bytes);
  if (type !== null) return MEDIA_TYPES[type];
  const given = extname(name).slice(1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(given) ? given : null;
}

export interface UploadDeps {
  sessions: Pick<SpineView, 'record' | 'intent'>; // whose working directory: the record, else the setup intent's location
  roots: UploadRecords; // lane B's record (uploadRootsOf)
  git: GitRun; // the exclude's read of the repository's common directory
  mint?: () => string; // the upload id (lane A's minter by default)
  log(line: string): void;
}

export function createUpload({ sessions, roots, git, mint = uploadId, log }: UploadDeps): (input: FilesUploadInput) => Promise<FilesUploadOutput> {
  const directoriesOf = allowlistOf(sessions);
  // P5 O7 M4 ("Uploads in parts"): one part of a remote upload staged after the parts before it (every part but the last
  // is REMOTE_UPLOAD_PART_BYTES, so the staged size says which index comes next), the whole bounded as one file is, and
  // at the last moved into the root under the name a one-call upload would give it, which alone answers its path.
  const uploadPart = (base: string, id: AppSessionId, root: string, part: UploadPart, bytes: Buffer, name: string): FilesUploadOutput => {
    try {
      const staged = stagePart(base, id, part.upload, part.index * REMOTE_UPLOAD_PART_BYTES, bytes, UPLOAD_FILE_MAX_BYTES);
      if (staged === 'out-of-order') return refused('part out of order');
      if (staged === 'too-large') return refused(`the file exceeds ${UPLOAD_FILE_MAX_BYTES / 1024 / 1024} MiB, so nothing was saved`);
      if (!part.last) return { status: 'ok', paths: [] };
      const upload = mint();
      const stored = promoteStaged(base, id, part.upload, (head) => {
        const ext = extensionOf(name, head);
        return ext === null ? `${upload}.0` : `${upload}.0.${ext}`;
      });
      return { status: 'ok', paths: [join(root, stored)] };
    } catch (error) {
      if (error instanceof AlreadyThere) return refused(`${error.file} is already there`);
      if (error instanceof Unsafe) return refused(`a path on the way is a link or not a directory (${error.message})`);
      return refused(`the part could not be written (${errorText(error)}), so nothing was saved`);
    }
  };
  return async ({ appSessionId, files, part }) => {
    const id = appSessionId as AppSessionId;
    // The working directory the session's launch is given: its worktree when it runs in one, else its directory
    const directories = directoriesOf(id);
    if (directories === null) return refused(sessions.record(id) === null && sessions.intent(id) == null ? `unknown app session: ${id}` : 'the session has no working directory');
    const separated = files.find((file) => /[/\\]/.test(file.name));
    if (separated) return refused(`${separated.name} has a path separator`);
    const decided = await baseOf(directories);
    if ('refusal' in decided) return refused(`${decided.refusal}, so nothing was saved`);
    const { base } = decided; // the one base of this call, whatever the record says later in it
    const root = rootOf(base, id);
    // P5 O7 M8: nothing written (the record, the exclude, a file) where no open can be confirmed to follow no link
    try {
      confirmOpens();
    } catch (error) {
      if (error instanceof Unsafe) return refused(`the upload was not saved: ${error.message}`);
      throw error;
    }
    try {
      roots.record(id, root);
    } catch (error) {
      return refused(`the upload could not be recorded (${errorText(error)}), so nothing was saved`);
    }
    try {
      if (!(await excludeUploads(base, git))) log(`${id}: ${base} is in no repository; its uploads are not excluded from git`);
    } catch (error) {
      if (error instanceof Unsafe) return refused(`the upload was not saved: ${error.message}`);
      log(`${id}: ${root} was not excluded from git (${errorText(error)})`);
    }
    if (part !== undefined) return uploadPart(base, id, root, part, Buffer.from(files[0]!.bytes, 'base64'), files[0]!.name);
    const upload = mint();
    const named = files.map((file, n) => {
      const bytes = Buffer.from(file.bytes, 'base64');
      const ext = extensionOf(file.name, bytes);
      return { name: ext === null ? `${upload}.${n}` : `${upload}.${n}.${ext}`, bytes };
    });
    try {
      const { names } = saveFiles(base, id, named, UPLOAD_FILE);
      return { status: 'ok', paths: names.map((name) => join(root, name)) };
    } catch (error) {
      if (error instanceof AlreadyThere) return refused(`${error.file} is already there`);
      if (error instanceof Unsafe) return refused(`a path on the way is a link or not a directory (${error.message})`);
      return refused(`the upload could not be written (${errorText(error)}), so nothing was saved`);
    }
  };
}

// ---- a send's uploads read back (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The attachment") --
// `files.readUploads`: the machine's endpoint reads a remote send's `uploads` here before the send reaches the engine
// host, so the model gets each PDF as the document block a local drop sends. An upload id is the name `files.upload`
// stored the file under; it is read only from the sending session's own root, under its working directory's real path,
// with no link on the way (../fs/upload-roots.ts `readUpload`), a file still there, written within UPLOAD_KEPT_MS, a PDF
// by its bytes, within the engine's document bound, the whole within the message's. The first that fails refuses them
// all, in a sentence that names it.

// An upload is attached within the day it was written (UPLOAD_KEPT_MS, the age at which the sweep may take its root):
// older is expired, whether or not the sweep has come yet, so whether a send attaches does not hang on when it last ran.
const base64Length = (bytes: number) => 4 * Math.ceil(bytes / 3);

export interface UploadReaderDeps {
  sessions: Pick<SpineView, 'record' | 'intent'>; // whose working directory: as `files.upload` resolves it
  now?: () => number;
}

export function createUploadReader({ sessions, now = Date.now }: UploadReaderDeps): (input: FilesReadUploadsInput) => Promise<FilesReadUploadsOutput> {
  const directoriesOf = allowlistOf(sessions);
  return async ({ appSessionId, uploads }) => {
    const id = appSessionId as AppSessionId;
    const directories = directoriesOf(id);
    if (directories === null) return refused(sessions.record(id) === null && sessions.intent(id) == null ? `unknown app session: ${id}` : 'the session has no working directory');
    const decided = await baseOf(directories);
    if ('refusal' in decided) return refused(decided.refusal);
    const { base } = decided;
    const blocks: UploadDocumentBlock[] = [];
    let encoded = 0;
    for (const { uploadId: name } of uploads) {
      let read: ReturnType<typeof readUpload>;
      try {
        read = readUpload(base, id, name, MAX_SEND_DOCUMENT_BYTES);
      } catch (error) {
        if (error instanceof Unconfirmed) return refused(error.message);
        if (error instanceof Unsafe) return refused(`${name} is a link or not a file of its own, so it was not attached`);
        return refused(`${name} could not be read (${errorText(error)})`);
      }
      if ('missing' in read) return refused(`${name} is not among this session’s uploads (it may have been swept); attach the file again`);
      if ('tooLarge' in read) return refused(`${name} is larger than ${MAX_SEND_DOCUMENT_BYTES / 1024 / 1024} MiB, the most a document can be`);
      if (now() - read.writtenAt > UPLOAD_KEPT_MS) return refused(`${name} was uploaded more than a day ago; attach the file again`);
      if (typeOf(read.bytes) !== 'application/pdf') return refused(`${name} is not a PDF, so it can’t be attached as a document`);
      encoded += base64Length(read.bytes.length);
      if (encoded > MAX_SEND_CONTENT_JSON_BYTES) return refused(`the uploads are larger than ${MAX_SEND_CONTENT_JSON_BYTES / 1024 / 1024} MiB together, the most a message can be`);
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: read.bytes.toString('base64') } });
    }
    return { status: 'ok', blocks };
  };
}
