// X2 `files.*` (C8c execution document, Interfaces "`files.*`"; the C8 spec's *`files.*` read service*, K1): main's
// view of a session's own directories, for the Files tool, the file viewer and (E5) the editor. Owner `main` for every
// command. Every path is confined to the session's allowlist (the realpaths of its `directory`, `additionalDirectories`
// and `worktree.path`) by the open-first boundary in `src/main/files/service.ts`; refusals answer `internal` with
// `path outside the session's directories`. The one write is E5's `files.write`, the hash-checked save of a file that
// already exists; nothing here creates, renames or deletes a file.
import * as z from 'zod';
import { extensionOf, mimeOf } from '@shared/files/mime';
import { AppSessionIdSchema } from '@shared/graph/ids';
import type { CommandSpec } from './common';

// Declared before the registry, which reads them when this module loads.
export const FILES_READ_DEFAULT_LENGTH = 1024 * 1024; // C4's SPILL_DEFAULT_LENGTH; the viewer's first chunk
export const FILES_READ_MAX_LENGTH = 8 * 1024 * 1024; // one call's ceiling; the image cap is one call
export const FILES_LIST_MAX_ENTRIES = 5000;
// How much of a file's head decides its encoding (a NUL in it makes the file binary); main and the viewer share it.
export const BINARY_SNIFF_BYTES = 8192;
// E5: the editor's ceiling, on the file before the write (main reads it whole to compare) and on the content after it.
export const FILES_WRITE_MAX_BYTES = FILES_READ_MAX_LENGTH;

// Whether `files.openExternal` hands a file of this name to the OS (and the viewer offers the button): an allowlist of
// the document and media kinds MAWS opens outside on purpose, because any installed app can register to launch a file
// it is asked to open (Python Launcher for `.py`), so a list of what not to open is incomplete by construction.
// main's service also requires a regular file with no execute bit. Plain-text logs and tables are in (a viewer past the
// text cap hands them out); legacy Office (`.doc`, `.xls`, `.ppt`) is out, since it carries VBA or XLM macros and an
// agent-written file has no quarantine attribute for Office's macro block to act on.
const EXTERNAL_DOCUMENTS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key', 'epub', 'txt', 'log', 'csv', 'tsv']);
export function opensExternally(name: string): boolean {
  const mime = mimeOf(name);
  if (mime === 'application/pdf' || mime === 'text/html' || /^(image|audio|video)\//.test(mime)) return true;
  return EXTERNAL_DOCUMENTS.has(extensionOf(name));
}

export const FilesEntrySchema = z.strictObject({
  name: z.string(),
  path: z.string(), // absolute, under the confirmed directory's realpath
  kind: z.enum(['file', 'dir', 'symlink', 'other']), // from lstat; 'other': sockets, fifos, devices — listed, never opened
  size: z.number().int(),
  mtimeMs: z.number(),
  target: z.string().nullable(), // readlink for a symlink, else null; shown, never followed
});
export type FilesEntry = z.infer<typeof FilesEntrySchema>;

export const FilesListOutputSchema = z.strictObject({
  root: z.string().nullable(), // the allowlist root that contains `path`; null for the roots listing
  path: z.string(), // the confirmed realpath; '' for the roots listing
  entries: z.array(FilesEntrySchema),
  truncated: z.boolean(), // past FILES_LIST_MAX_ENTRIES
});
export type FilesListOutput = z.infer<typeof FilesListOutputSchema>;

// E5: a file's SHA-256 as lowercase hex, computed by main from the bytes it read or wrote through the descriptor, never
// by the renderer.
export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const FilesReadInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  path: z.string(),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(FILES_READ_MAX_LENGTH).optional(), // defaults to FILES_READ_DEFAULT_LENGTH
  // E5: answer the whole file's hash with this chunk. Main then reads the whole file (up to FILES_READ_MAX_LENGTH) into
  // one buffer, hashes it and slices the chunk from it, so the chunk's bytes are always the hashed file's.
  hash: z.boolean().optional(),
});
export type FilesReadInput = z.infer<typeof FilesReadInputSchema>;

// `encoding` is decided per file (its first BINARY_SNIFF_BYTES and its name), so every chunk of one file answers one
// encoding. `length` is the byte count this chunk covers, so the next chunk's offset is `offset + length`: a utf8 chunk
// ends on a character boundary and never between the `\r` and `\n` of a CRLF unless it ends the file, so it may be
// shorter than asked (or, when withholding would leave it empty, a few bytes longer). `truncated` when
// `offset + length < bytes`.
export const FilesReadOutputSchema = z.strictObject({
  encoding: z.enum(['utf8', 'base64']),
  content: z.string(),
  bytes: z.number().int(),
  offset: z.number().int(),
  length: z.number().int(),
  truncated: z.boolean(),
  mime: z.string(),
  // E5: the whole file's hash when asked (`hash: true`); null when not asked, and for a file past
  // FILES_READ_MAX_LENGTH (a head is never edited).
  hash: HashSchema.nullable(),
});
export type FilesReadOutput = z.infer<typeof FilesReadOutputSchema>;

// E5: write `content` (UTF-8) over an existing file only when the file's current hash is `expectedHash`. Confined
// exactly as `files.read`; never creates a file and never follows a rename (it writes through the confirmed
// descriptor). `content` is bounded in characters here; main refuses `content too large` when its UTF-8 bytes exceed
// FILES_WRITE_MAX_BYTES, and `too large to edit: <path>` for a file past it.
export const FilesWriteInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  path: z.string(),
  content: z.string().max(FILES_WRITE_MAX_BYTES),
  expectedHash: HashSchema,
});
export type FilesWriteInput = z.infer<typeof FilesWriteInputSchema>;

export const FilesWriteOutputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), hash: HashSchema }), // the hash of what was written
  z.strictObject({ status: z.literal('conflict'), hash: HashSchema }), // the file's current hash; nothing written
]);
export type FilesWriteOutput = z.infer<typeof FilesWriteOutputSchema>;

const SessionPathSchema = z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string() });

export const FilesOpenExternalOutputSchema = z.strictObject({
  opened: z.boolean(),
  message: z.string().nullable(), // shell.openPath's error text
});
export type FilesOpenExternalOutput = z.infer<typeof FilesOpenExternalOutputSchema>;

export const commands = {
  // No path: the roots as 'dir' entries in record order (directory, additionalDirectories…, worktree when it differs),
  // deduplicated by realpath, root null, path ''.
  'files.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string().optional() }), output: FilesListOutputSchema, owner: 'main' },
  'files.read': { input: FilesReadInputSchema, output: FilesReadOutputSchema, owner: 'main' },
  // A directory; ref-counted per confirmed realpath; re-confirmed after install and before each batch it forwards.
  'files.watch': { input: SessionPathSchema, output: z.void(), owner: 'main' },
  'files.unwatch': { input: SessionPathSchema, output: z.void(), owner: 'main' },
  'files.openExternal': { input: SessionPathSchema, output: FilesOpenExternalOutputSchema, owner: 'main' },
  // E5 start: the hash-checked save. Not a read: never in the renderer's QUERY_COMMANDS.
  'files.write': { input: FilesWriteInputSchema, output: FilesWriteOutputSchema, owner: 'main' },
  // E5 end
} as const satisfies Record<`files.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

// `invalidated`: the watched directory (path is its confirmed realpath) failed a re-confirmation and its watch was
// dropped; the holder re-lists and re-watches, which runs the boundary again.
export const FilesChangedSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  path: z.string(),
  kind: z.enum(['created', 'changed', 'removed', 'invalidated']),
});
export type FilesChanged = z.infer<typeof FilesChangedSchema>;

export const events = {
  'files.changed': FilesChangedSchema,
} as const satisfies Record<`files.${string}`, z.ZodType>;
