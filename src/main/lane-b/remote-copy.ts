// A file of another machine brought to this Mac (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Open
// a copy, and Save As of a remote artifact"; A10, the owner's answer of 2026-10-31; Interfaces §K's `remote.openCopy`).
// The machine's `files.openExternal`, `library.openExternally` and the reveals hand a path on the machine to the client
// port, which means nothing here, so none is offered: "Open externally" on a remote file opens a copy instead, and a remote
// artifact's Save As saves one.
//
// - The bytes (`fetchToFile`): a checkout file through `files.read`, a library item's stored file or an export through
//   `library.read` (its `export` form), each in chunks of at most one call's FILES_READ_MAX_LENGTH, each chunk in the
//   pages the channel carries (./remote-files-read.ts). The first chunk says the file's size; past `max` nothing more is
//   read. A file whose size moves between chunks changed under the read, which starts again (REMOTE_READ_TRIES). The
//   copy is written beside its final name, every byte (a short write goes on), and renamed over it, owner-only and never
//   executable. Fix wave 1: a file the machine sends as text is copied only when its bytes are proven (`fetchToFile`).
//   M5a review: a library source reads either byte kind's stored file; an HTML artifact's is its entry file alone (an
//   `html` page is one stored file; no read here names its assets), so a page's relative assets are not copied with it.
// - The copy (`openCopy`): `<temp>/maws-remote-copies/<machine>/<sha256 of the source>/<name>`, a fresh copy at each open
//   (64 MiB at most, larger refused "too large to copy from <machine>"), handed to the OS as `files.openExternal` hands a
//   local file: a document kind (`opensExternally`), never a program. Under MAWS_E2E=1 MAWS_E2E_OPEN_LOG takes the copy's
//   path as a line in place of the OS, as the files' and library's open seam does. Reveal stays the renderer's greyed
//   "on <machine>": there is nothing here to reveal.
// - UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, decision 15): a session's
//   file is read through the reader its caller hands in (`readSessionFile`, the adapter's outside-aware read for the page
//   that asked), on both copies' routes; without one, and for a library source always, as before.
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import type { CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { FILES_READ_MAX_LENGTH, opensExternally, type FilesReadOutput } from '@shared/ipc/schema/files';
import type { RemoteCopySource } from '@shared/ipc/schema/remote';
import { REMOTE_COPY_MAX_BYTES } from '@shared/ipc/schema/remote';
import { artifactExportName } from '@shared/maws/tools';
import { fileNameOf } from '../library/files';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { RemoteLink } from '../machines/remote/link';
import { readInPages, REMOTE_READ_PAGE_BYTES, REMOTE_READ_TRIES } from './remote-files-read';

type Result<T> = { ok: true; value: T } | { ok: false; error: IpcError };
const failed = (result: CommandResult<CommandName>) => result as { ok: false; error: IpcError };

/** A library source: a stored file at a revision, or an export. */
export type ArtifactSource = Exclude<RemoteCopySource, { appSessionId: unknown }>;

/** Why a file the machine sends only as lossy text isn't copied (M5a-b fix wave 1). */
export const notByteForByte = (machine: string) => `${machine} sends this file only as text that isn't valid UTF-8, so it can't be copied here byte for byte`;

type Pass = 'written' | 'too-large' | 'changed' | 'unproven' | 'inexact';

/** UX wave U6f: one chunk of a session's file, read for the caller that asked (`files.read`'s input; its answer's shape). */
export type SessionFileReader = (input: Record<string, unknown>) => Promise<CommandResult<CommandName>>;

/**
 * `source`'s bytes paged over `link` into `to`: written, `too-large` past `max` bytes (nothing written), or the read's
 * refusal as the command's. M5a-b fix wave 1: a copy is the file's bytes or nothing. `files.read` and `library.read`
 * send a text file as `utf8` text decoded leniently, so a page whose text holds a replacement character may not be its
 * bytes: the file is read again hashed (the service decodes the whole file strictly and says whether it is UTF-8), and
 * copied only when it is, its bytes' SHA-256 the file's; otherwise (not UTF-8, or past the hashed read's cap) refused
 * `invalid_input` with `notByteForByte`'s words. Nothing is renamed into place but a whole, proven file.
 */
export async function fetchToFile(link: RemoteLink, source: RemoteCopySource, to: string, max: number, log: (line: string) => void, readSessionFile?: SessionFileReader): Promise<Result<'written' | 'too-large'>> {
  const name = 'appSessionId' in source ? 'files.read' : 'library.read';
  let hashed = false;
  for (let tries = 1; ; ) {
    const part = `${to}.${randomUUID()}.part`;
    let pass: Result<Pass>;
    try {
      const file = await open(part, 'w', 0o600);
      try {
        pass = await readInto(link, name, source, file, max, hashed, log, undefined, readSessionFile);
      } finally {
        await file.close();
      }
      if (pass.ok && pass.value === 'written') await rename(part, to);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    if (pass.ok && pass.value === 'written') return { ok: true, value: 'written' };
    await rm(part, { force: true });
    if (!pass.ok || pass.value === 'too-large') return pass as Result<'too-large'>;
    if (pass.value === 'inexact') return { ok: false, error: ipcError('invalid_input', notByteForByte(link.name)) };
    if (pass.value === 'unproven') {
      hashed = true;
      continue;
    }
    if (++tries > REMOTE_READ_TRIES) return { ok: false, error: ipcError('internal', `${name}: the file kept changing on machine ${link.name} while it was copied`) };
    log(`lane B: ${name} of ${link.name}: the file changed while it was copied; copied again`);
  }
}

/** What a file frame's copy gives the inner read (UX wave U6b-2): a label for the log, and the first page of each pass. */
interface FrameCopy {
  label: string;
  seen(first: { mime: string; bytes: number }): void;
}

/**
 * UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M3, decision 8; Interfaces §C; "What
 * one version means"): a session's file of another machine paged into `sink`, a descriptor its caller opened and whose
 * name it removed, so the copy's bytes never exist under a name (A5, A6). `fetchToFile`'s passes over the same inner read,
 * with three differences:
 *
 * - A pass that starts again truncates `sink` to nothing; there is no part file and no rename.
 * - Every page asks `hash` from the first (A2). Within the hashed read's cap (FILES_READ_MAX_LENGTH) every page answers
 *   the file's hash, a page whose hash or size differs makes the pass `changed`, and the digest of what was written is
 *   compared with it at the end: the copy is one version. Past the cap the machine answers no hash and only the size is
 *   compared, so an equal-size replacement during the copy can leave a copy of two versions until the next read copies
 *   it again (the tracker's row). Proving a text is apart from asking the hash: a text page whose answer carries a hash
 *   is copied when it says the bytes are UTF-8, and one past the cap when it holds no replacement character; either
 *   refused is `notByteForByte`'s. (The hashed pass as it is refuses every text page with no hash, which would refuse
 *   every text file past the cap.)
 * - Each pass's first page is told to the caller (`seen`: the type and size the pass copies), and the paged read and this
 *   copy log by `label`, never by the path (A7).
 *
 * A pass is written only when what it wrote reaches the size its first page gave (Decision Log 30), so the length answered
 * is the length verified.
 *
 * Asks the machine `files.read { appSessionId, path, offset, length, hash }` and nothing else: the keys the copy of Open
 * externally sends when it proves a text. UX wave U6f: through `readSessionFile` when it is given, which adds the keys the
 * tab's own reads there carry (`named`, the agent's mark) for a machine that reads them, and takes them off again for
 * one that does not.
 */
export async function fetchInto(
  link: RemoteLink,
  source: { appSessionId: AppSessionId; path: string },
  sink: FileHandle,
  max: number,
  log: (line: string) => void,
  options: { label: string; seen(first: { mime: string; bytes: number }): void; readSessionFile?: SessionFileReader },
): Promise<Result<{ written: number } | 'too-large'>> {
  let size = 0;
  const frame: FrameCopy = {
    label: options.label,
    seen: (first) => {
      size = first.bytes;
      options.seen(first);
    },
  };
  const asked: RemoteCopySource = { appSessionId: source.appSessionId, path: source.path }; // these two keys and no other
  for (let tries = 1; ; ) {
    await sink.truncate(0);
    const pass = await readInto(link, 'files.read', asked, sink, max, true, log, frame, options.readSessionFile);
    if (!pass.ok) return pass as Result<never>;
    if (pass.value === 'written') return { ok: true, value: { written: size } }; // a written pass ended at exactly this size
    if (pass.value === 'too-large') return { ok: true, value: 'too-large' };
    if (pass.value === 'inexact' || pass.value === 'unproven') return { ok: false, error: ipcError('invalid_input', notByteForByte(link.name)) };
    if (++tries > REMOTE_READ_TRIES) return { ok: false, error: ipcError('internal', `files.read: the file kept changing on machine ${link.name} while it was copied`) };
    log(`lane B: ${options.label} of ${link.name}: the file changed while it was copied; copied again`);
  }
}

// `frame`: a file frame's copy (`fetchInto`), which asks the hash on every page (`hashed` true) and proves a text page by
// what its answer carries, not by the hashed pass's rule. `readSessionFile` (UX wave U6f): how a session source's chunks
// are read, when given.
async function readInto(link: RemoteLink, name: 'files.read' | 'library.read', source: RemoteCopySource, file: FileHandle, max: number, hashed: boolean, log: (line: string) => void, frame?: FrameCopy, readSessionFile?: SessionFileReader): Promise<Result<Pass>> {
  let size: number | null = null;
  let hash: string | null = null;
  const digest = createHash('sha256');
  let offset = 0;
  for (;;) {
    // the first chunk one answer the channel carries, to learn the size before reading more
    const length = size === null ? REMOTE_READ_PAGE_BYTES : Math.min(FILES_READ_MAX_LENGTH, size - offset);
    const chunk = { ...source, offset, length, ...(hashed && { hash: true }) };
    const read = readSessionFile !== undefined && 'appSessionId' in source ? await readSessionFile(chunk) : await readInPages(link, name, chunk, log, frame?.label);
    if (!read.ok) return { ok: false, error: failed(read).error };
    const page = read.value as FilesReadOutput;
    if (size === null) {
      size = page.bytes;
      hash = page.hash;
      frame?.seen({ mime: page.mime, bytes: page.bytes });
      if (size > max) return { ok: true, value: 'too-large' };
    } else if (page.bytes !== size || page.hash !== hash) return { ok: true, value: 'changed' };
    if (page.encoding === 'utf8' && frame) {
      // a frame's copy: the strict decode's word where the answer carries a hash, else no replacement character
      if (page.hash !== null ? page.utf8 !== true : page.content.includes('\uFFFD')) return { ok: true, value: 'inexact' };
    } else if (page.encoding === 'utf8') {
      // lenient text: only text with no replacement character is surely its bytes, else the strict whole-file decode says
      if (hashed && (page.utf8 !== true || page.hash === null)) return { ok: true, value: 'inexact' };
      if (!hashed && page.content.includes('\uFFFD')) return { ok: true, value: 'unproven' };
    }
    const bytes = Buffer.from(page.content, page.encoding === 'base64' ? 'base64' : 'utf8');
    if (hashed) digest.update(bytes);
    await writeAll(file, bytes, page.offset);
    offset = page.offset + page.length;
    if (!page.truncated || page.length === 0 || offset >= size) {
      // UX wave U6b-2 (Decision Log 30): written only at the size the first page gave; a copy that ends short of it (a
      // page of no bytes, or one not marked truncated) read a file that changed, and is read again
      if (offset !== size) return { ok: true, value: 'changed' };
      if (hashed && hash !== null && digest.digest('hex') !== hash) return { ok: true, value: 'changed' };
      return { ok: true, value: 'written' };
    }
  }
}

/** Every byte of `bytes` at `position`: a write the OS takes in part goes on from where it stopped; one taking none fails. */
async function writeAll(file: FileHandle, bytes: Buffer, position: number): Promise<void> {
  for (let done = 0; done < bytes.length; ) {
    const { bytesWritten } = await file.write(bytes, done, bytes.length - done, position + done);
    if (bytesWritten <= 0) throw new Error(`a write of the copy made no progress at byte ${position + done}`);
    done += bytesWritten;
  }
}

/** The name a copy (and a Save As) of a library source takes: an export by the artifact's title, a stored file by its own. */
export async function nameOf(link: RemoteLink, source: ArtifactSource): Promise<Result<string>> {
  if ('export' in source) {
    const got = await dispatchOverLink(link, 'artifacts.get', { artifactId: source.artifactId, prepare: false });
    if (!got.ok) return { ok: false, error: failed(got).error };
    const artifact = (got.value as CommandOutput<'artifacts.get'>).artifact;
    if (artifact === null) return { ok: false, error: ipcError('invalid_input', `no artifact ${source.artifactId} on machine ${link.name}`) };
    const exported = artifactExportName(source.export.revision, source.export.format, source.export.exportId);
    return { ok: true, value: source.export.format === 'pngs' ? `${fileNameOf(artifact.title)} slides${extname(exported)}` : `${fileNameOf(artifact.title)}${extname(exported)}` };
  }
  const content = await dispatchOverLink(link, 'library.content', { artifactId: source.artifactId, ...(source.revision !== undefined && { revision: source.revision }) });
  if (!content.ok) return { ok: false, error: failed(content).error };
  return { ok: true, value: fileNameOf((content.value as CommandOutput<'library.content'>).name) };
}

export interface OpenCopyDeps {
  /** shell.openPath: '' when opened, else the reason. */
  openPath(path: string): Promise<string>;
  /** UX wave U6f: how a session's file is read, for the caller that asked; absent, by the plain call. */
  readSessionFile?: SessionFileReader;
  /** os.tmpdir(), where the copies go. */
  tempDir(): string;
  /** MAWS_E2E and MAWS_E2E_OPEN_LOG, the e2e's open seam. */
  env: NodeJS.ProcessEnv;
  log(line: string): void;
}

/** `remote.openCopy`: the source copied here and handed to the OS, or why not. */
export async function openCopy(link: RemoteLink, source: RemoteCopySource, deps: OpenCopyDeps): Promise<CommandResult<'remote.openCopy'>> {
  let name: string;
  if ('appSessionId' in source) name = fileNameOf(basename(source.path));
  else {
    const named = await nameOf(link, source);
    if (!named.ok) return named;
    name = named.value;
  }
  if (!opensExternally(name)) return { ok: true, value: { opened: false, message: `Not opened outside MAWS: ${name}` } };
  const dir = join(deps.tempDir(), 'maws-remote-copies', link.machine, createHash('sha256').update(JSON.stringify(source)).digest('hex'));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, name);
  const fetched = await fetchToFile(link, source, path, REMOTE_COPY_MAX_BYTES, deps.log, deps.readSessionFile);
  if (!fetched.ok) return fetched;
  if (fetched.value === 'too-large') return { ok: true, value: { opened: false, message: `too large to copy from ${link.name}` } };
  const seam = deps.env.MAWS_E2E === '1' ? deps.env.MAWS_E2E_OPEN_LOG : undefined;
  if (seam) {
    await appendFile(seam, `${path}\n`);
    return { ok: true, value: { opened: true, message: null } };
  }
  const refused = await deps.openPath(path);
  return { ok: true, value: refused === '' ? { opened: true, message: null } : { opened: false, message: refused } };
}
