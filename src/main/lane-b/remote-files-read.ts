// A remote lane B session's `files.read` in answers the channel carries (P5 O7 M4, the milestone review). One call may
// ask up to FILES_READ_MAX_LENGTH (8 MiB: the viewer reads an image whole, the editor's conflict re-read a whole file
// with its hash), which as base64 or escaped JSON passes the channel's message bound, and the endpoint answers such a
// result `too-large` (src/endpoint/calls.ts). So, as `session.events` is read (./remote-history.ts):
//
// - The read goes as one call first. Refused `too-large`, the range asked is read again from its offset in ranged calls
//   of at most REMOTE_READ_PAGE_BYTES (base64 of it fits the channel), each going on from the last one's
//   `offset + length` (a utf8 chunk ends on a character boundary, so it may be shorter than asked); a page itself refused
//   `too-large` (text whose JSON escaping grew it) is asked again at half the size, down to REMOTE_READ_PAGE_MIN.
// - The pages are assembled into the one answer the renderer asked for: the bytes decoded and encoded again (base64),
//   or the text joined (utf8), with the file's size, mime and encoding from the pages, `length` the bytes covered and
//   `truncated` whether the file goes on past them.
// - With `hash` (the whole file's, E5: the chunk's bytes are always the hashed file's), every page asks it: pages that
//   answer different hashes read a file that changed under them, so the read starts again, up to REMOTE_READ_TRIES
//   times, then answers `internal`. The whole file is hashed on every page (up to 8 MiB each), the price of that check.
import { MESSAGE_MAX_BYTES } from '../../../apps/org-protocol/src/index.ts';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { FILES_READ_DEFAULT_LENGTH, type FilesReadOutput } from '@shared/ipc/schema/files';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { RemoteLink } from '../machines/remote/link';

/** Bytes per ranged read: base64 of it, with the answer's envelope, stays under the channel's result bound. */
export const REMOTE_READ_PAGE_BYTES = Math.floor(((MESSAGE_MAX_BYTES - 64 * 1024) * 3) / 4 / 3) * 3;
/** The smallest page a refused one is halved to: past it the read answers the refusal. */
export const REMOTE_READ_PAGE_MIN = 16 * 1024;
/** Reads of a file that changed between its pages, at most. */
export const REMOTE_READ_TRIES = 3;

type Result = CommandResult<CommandName>;
const tooLarge = (result: Result) => !result.ok && (result.error.issues as { refusal?: unknown } | undefined)?.refusal === 'too-large';

export async function readFileInPages(link: RemoteLink, input: Record<string, unknown>, log: (line: string) => void): Promise<Result> {
  const whole = await dispatchOverLink(link, 'files.read', input);
  if (!tooLarge(whole)) return whole;
  const said = `lane B: files.read of ${link.name} ${String(input.path)}`;
  log(`${said}: too large for the channel in one answer; read in pages`);
  for (let tries = 1; ; tries++) {
    const read = await readOnce(link, input);
    if (read !== 'changed') return read;
    if (tries >= REMOTE_READ_TRIES) return { ok: false, error: ipcError('internal', `files.read: ${String(input.path)} kept changing on machine ${link.name} while it was read`) };
    log(`${said}: the file changed between its pages; read again`);
  }
}

/** The range asked, in pages; `changed` when the pages answered different hashes. */
async function readOnce(link: RemoteLink, input: Record<string, unknown>): Promise<Result | 'changed'> {
  const start = typeof input.offset === 'number' ? input.offset : 0;
  const asked = typeof input.length === 'number' ? input.length : FILES_READ_DEFAULT_LENGTH;
  const pages: FilesReadOutput[] = [];
  let at = start;
  let size = REMOTE_READ_PAGE_BYTES;
  for (;;) {
    const left = start + asked - at;
    const read = await dispatchOverLink(link, 'files.read', { ...input, offset: at, length: Math.min(size, left) });
    if (tooLarge(read) && size > REMOTE_READ_PAGE_MIN) {
      size = Math.max(REMOTE_READ_PAGE_MIN, Math.floor(size / 2));
      continue;
    }
    if (!read.ok) return read;
    const page = read.value as FilesReadOutput;
    const first = pages[0];
    if (first !== undefined && (page.hash !== first.hash || page.bytes !== first.bytes || page.encoding !== first.encoding)) return 'changed';
    pages.push(page);
    at = page.offset + page.length;
    if (!page.truncated || page.length === 0 || at >= start + asked) break;
  }
  const first = pages[0]!;
  const content = first.encoding === 'base64' ? Buffer.concat(pages.map((page) => Buffer.from(page.content, 'base64'))).toString('base64') : pages.map((page) => page.content).join('');
  const length = at - start;
  const value: FilesReadOutput = { ...first, content, offset: start, length, truncated: start + length < first.bytes };
  return { ok: true, value } as Result;
}
