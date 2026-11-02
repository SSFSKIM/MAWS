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
//   copy is written beside its final name and renamed over it, owner-only and never executable. A file the machine sends
//   as text (`utf8`) is written as that text's UTF-8, which is its bytes for a file the machine decoded whole.
// - The copy (`openCopy`): `<temp>/maws-remote-copies/<machine>/<sha256 of the source>/<name>`, a fresh copy at each open
//   (64 MiB at most, larger refused "too large to copy from <machine>"), handed to the OS as `files.openExternal` hands a
//   local file: a document kind (`opensExternally`), never a program. Under MAWS_E2E=1 MAWS_E2E_OPEN_LOG takes the copy's
//   path as a line in place of the OS, as the files' and library's open seam does. Reveal stays the renderer's greyed
//   "on <machine>": there is nothing here to reveal.
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
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

/**
 * `source`'s bytes paged over `link` into `to`: written, `too-large` past `max` bytes (nothing written), or the read's
 * refusal as the command's.
 */
export async function fetchToFile(link: RemoteLink, source: RemoteCopySource, to: string, max: number, log: (line: string) => void): Promise<Result<'written' | 'too-large'>> {
  const name = 'appSessionId' in source ? 'files.read' : 'library.read';
  for (let tries = 1; ; tries++) {
    const part = `${to}.${randomUUID()}.part`;
    const file = await open(part, 'w', 0o600);
    let outcome: Result<'written' | 'too-large'> | 'changed';
    try {
      outcome = await readInto(link, name, source, file, max, log);
    } finally {
      await file.close();
    }
    if (outcome !== 'changed' && outcome.ok && outcome.value === 'written') {
      await rename(part, to);
      return outcome;
    }
    await rm(part, { force: true });
    if (outcome !== 'changed') return outcome;
    if (tries >= REMOTE_READ_TRIES) return { ok: false, error: ipcError('internal', `${name}: the file kept changing on machine ${link.name} while it was copied`) };
    log(`lane B: ${name} of ${link.name}: the file changed while it was copied; copied again`);
  }
}

async function readInto(link: RemoteLink, name: 'files.read' | 'library.read', source: RemoteCopySource, file: Awaited<ReturnType<typeof open>>, max: number, log: (line: string) => void): Promise<Result<'written' | 'too-large'> | 'changed'> {
  let size: number | null = null;
  let offset = 0;
  for (;;) {
    // the first chunk one answer the channel carries, to learn the size before reading more
    const length = size === null ? REMOTE_READ_PAGE_BYTES : Math.min(FILES_READ_MAX_LENGTH, size - offset);
    const read = await readInPages(link, name, { ...source, offset, length }, log);
    if (!read.ok) return { ok: false, error: failed(read).error };
    const page = read.value as FilesReadOutput;
    if (size === null) {
      size = page.bytes;
      if (size > max) return { ok: true, value: 'too-large' };
    } else if (page.bytes !== size) return 'changed';
    const bytes = Buffer.from(page.content, page.encoding === 'base64' ? 'base64' : 'utf8');
    await file.write(bytes, 0, bytes.length, page.offset);
    offset = page.offset + page.length;
    if (!page.truncated || page.length === 0 || offset >= size) return { ok: true, value: 'written' };
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
  const fetched = await fetchToFile(link, source, path, REMOTE_COPY_MAX_BYTES, deps.log);
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
