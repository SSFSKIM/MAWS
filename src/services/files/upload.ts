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
import type { FilesUploadInput, FilesUploadOutput } from '@shared/ipc/schema/files';
import type { SpineView } from '@shared/spine/view';
import { AlreadyThere, excludeUploads, rootOf, saveFiles, Unsafe, uploadId, uploadRecords, type UploadRecords } from '../fs/upload-roots';
import type { GitRun } from '../git/runner';
import { MEDIA_TYPES, typeOf } from '../lane-a/media';
import { allowlistOf } from './allowlist';

// A run with no record of the upload roots (a run refused the spine) writes nothing
export const UPLOADS_UNAVAILABLE: FilesUploadOutput = { status: 'refused', reason: 'uploads are not available this run' };
// Lane B's own file names: the only ones its rollback and its sweep remove (lane A's are `<id>.<0-3>.<media ext>`)
const UPLOAD_FILE = /^[A-Za-z0-9_-]{1,128}\.[0-7](?:\.[a-z0-9]{1,16})?$/;
export const UPLOAD_SWEEP_MS = 3600_000; // as lane A's driver sweeps its own

// `<profile>/sessions/uploads.json`: lane B's roots, swept of lane B's files alone.
export function uploadRootsOf(file: string, options: { now?: () => number; log: (line: string) => void }): UploadRecords {
  return uploadRecords(file, UPLOAD_FILE, options);
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
const refused = (reason: string): FilesUploadOutput => ({ status: 'refused', reason });

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
  return async ({ appSessionId, files }) => {
    const id = appSessionId as AppSessionId;
    // The working directory the session's launch is given: its worktree when it runs in one, else its directory
    const directories = directoriesOf(id);
    if (directories === null) return refused(sessions.record(id) === null && sessions.intent(id) == null ? `unknown app session: ${id}` : 'the session has no working directory');
    const separated = files.find((file) => /[/\\]/.test(file.name));
    if (separated) return refused(`${separated.name} has a path separator`);
    let base: string;
    try {
      base = realpathSync(directories.worktree?.path ?? directories.directory); // links above it are the session's own spelling, as lane A resolves its cwd
    } catch (error) {
      return refused(`the session’s working directory could not be read (${errorText(error)}), so nothing was saved`);
    }
    const upload = mint();
    const root = rootOf(base, id);
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
