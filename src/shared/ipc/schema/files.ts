// X2 `files.*` (C8c execution document, Interfaces "`files.*`"; the C8 spec's *`files.*` read service*, K1): main's
// view of a session's own directories, for the Files tool, the file viewer and (E5) the editor. Owner `machine` for
// every command from P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §C): `mawsd` serves
// them with the spine on the daemon shape. Every path is confined to the session's allowlist (the realpaths of its `directory`, `additionalDirectories`
// and `worktree.path`) by the open-first boundary in `src/main/files/service.ts`; refusals answer `internal` with
// `path outside the session's directories`. One write is E5's `files.write`, the hash-checked save of a file that
// already exists; the other, P5 O3-E's `files.upload`, creates new files in the session's attachments directory alone;
// nothing here renames a file, or deletes one but the upload's own.
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
  // E5: with the hash, whether the hashed bytes are valid UTF-8 (main's strict decode of the whole buffer), so the
  // renderer knows the text it holds re-encodes to the file's bytes exactly; null when not hashed. A byte-length
  // comparison is no such test: a truncated multi-byte sequence decodes to U+FFFD, which may be as long.
  utf8: z.boolean().nullable(),
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

// E1 start: `files.reveal` shows a file in Finder (a delivered file's Reveal in Finder, E1 residue 8): the same boundary as
// `openExternal` and any regular file, whatever its kind, since revealing runs nothing; a refusal answers `revealed:
// false` with the boundary's message (Electron's showItemInFolder reports nothing, so `true` means it was asked).
export const FilesRevealOutputSchema = z.strictObject({ revealed: z.boolean(), message: z.string().nullable() });
export type FilesRevealOutput = z.infer<typeof FilesRevealOutputSchema>;
// E1 end

// P5 O3-E M2 (Interfaces §D; D6): `library.read`'s reach to a File artifact's stored bytes, a path main resolved itself
// (the artifact's admission), read with `files.read`'s rules (no link on the path, a regular file, the same answer).
// Main-only: a page could otherwise read any absolute path outside every session's allowlist. `path` must be absolute,
// which the files service refuses (`path must be absolute`), as `library.read`'s caller has always been told.
export const FilesReadResolvedInputSchema = FilesReadInputSchema.omit({ appSessionId: true });
export type FilesReadResolvedInput = z.infer<typeof FilesReadResolvedInputSchema>;

// P5 O3-E (Interfaces §F; D7; O7's C8): bounded bytes written into a session's attachments directory on its machine,
// answered with the stored absolute paths in input order. The bounds are the schema's, so an oversized call is
// `invalid_input` at main's router and at `machine.op`'s validation, before a line reaches the socket (whose cap is
// 64 MiB) or the handler: 1 to UPLOAD_FILES_MAX files, each and all together at most 32 MiB decoded. Base64 strings of
// one length decode to lengths up to two bytes apart (by their padding), so the encoded length is only a pre-cap (the
// padded encoding of the bound, before the pattern runs) and the bounds are on the decoded lengths, exactly. Declared at
// M2 (the manifest final then), its write M3's; a refusal is a value, as files.write's.
const MiB = 1024 * 1024;
export const UPLOAD_FILE_MAX_BYTES = 32 * MiB; // decoded, per file
export const UPLOAD_CALL_MAX_BYTES = 32 * MiB; // decoded, per call
export const UPLOAD_FILES_MAX = 8;
const encodedLength = (bytes: number) => 4 * Math.ceil(bytes / 3); // padded
// The bytes a string the base64 pattern took decodes to: three per four characters, less one per pad
const decodedLength = (base64: string) => (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §O, "Uploads in parts"): an upload from
// another machine crosses a channel whose message is 4 MiB, so one file goes as parts, each its own act: `part` names
// the upload (an id the sender mints), the part's index from 0, and whether it is the last. With it, `files` holds the
// one file's part: every part before the last exactly REMOTE_UPLOAD_PART_BYTES decoded, the last at most that. The
// service stages the parts in order and moves the whole into place at the last, which alone answers its path.
export const REMOTE_UPLOAD_PART_BYTES = 2 * MiB;
export const UploadPartSchema = z.strictObject({ upload: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), index: z.number().int().nonnegative(), last: z.boolean() });
export type UploadPart = z.infer<typeof UploadPartSchema>;
export const FilesUploadInputSchema = z
  .strictObject({
    appSessionId: AppSessionIdSchema,
    part: UploadPartSchema.optional(),
    files: z
      .array(
        z.strictObject({
          name: z.string(),
          bytes: z
            .base64()
            .max(encodedLength(UPLOAD_FILE_MAX_BYTES))
            .refine((bytes) => decodedLength(bytes) <= UPLOAD_FILE_MAX_BYTES, { message: `a file of an upload exceeds ${UPLOAD_FILE_MAX_BYTES / MiB} MiB` }),
        }),
      )
      .min(1)
      .max(UPLOAD_FILES_MAX),
  })
  .refine((input) => input.files.reduce((sum, file) => sum + decodedLength(file.bytes), 0) <= UPLOAD_CALL_MAX_BYTES, {
    message: `the files of one upload exceed ${UPLOAD_CALL_MAX_BYTES / MiB} MiB together`,
    path: ['files'],
  })
  .refine((input) => input.part === undefined || input.files.length === 1, { message: 'a part carries one file', path: ['files'] })
  .refine((input) => input.part === undefined || input.files.length !== 1 || partSizeFits(input.part, decodedLength(input.files[0]!.bytes)), {
    message: `a part before the last carries exactly ${REMOTE_UPLOAD_PART_BYTES / MiB} MiB, the last at most that`,
    path: ['files'],
  });
function partSizeFits(part: UploadPart, bytes: number): boolean {
  return part.last ? bytes <= REMOTE_UPLOAD_PART_BYTES : bytes === REMOTE_UPLOAD_PART_BYTES;
}
export type FilesUploadInput = z.infer<typeof FilesUploadInputSchema>;
export const FilesUploadOutputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), paths: z.array(z.string()) }),
  z.strictObject({ status: z.literal('refused'), reason: z.string() }), // a sentence for the caller to show; nothing written
]);
export type FilesUploadOutput = z.infer<typeof FilesUploadOutputSchema>;

export const commands = {
  // No path: the roots as 'dir' entries in record order (directory, additionalDirectories…, worktree when it differs),
  // deduplicated by realpath, root null, path ''.
  'files.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string().optional() }), output: FilesListOutputSchema, owner: 'machine' },
  'files.read': { input: FilesReadInputSchema, output: FilesReadOutputSchema, owner: 'machine' },
  // A directory; ref-counted per confirmed realpath; re-confirmed after install and before each batch it forwards.
  'files.watch': { input: SessionPathSchema, output: z.void(), owner: 'machine' },
  'files.unwatch': { input: SessionPathSchema, output: z.void(), owner: 'machine' },
  'files.openExternal': { input: SessionPathSchema, output: FilesOpenExternalOutputSchema, owner: 'machine' },
  // E5 start: the hash-checked save. Not a read: never in the renderer's QUERY_COMMANDS.
  'files.write': { input: FilesWriteInputSchema, output: FilesWriteOutputSchema, owner: 'machine' },
  // E5 end
  'files.reveal': { input: SessionPathSchema, output: FilesRevealOutputSchema, owner: 'machine' }, // E1
  'files.readResolved': { input: FilesReadResolvedInputSchema, output: FilesReadOutputSchema, owner: 'machine' }, // P5 O3-E: main-only
  'files.upload': { input: FilesUploadInputSchema, output: FilesUploadOutputSchema, owner: 'machine' }, // P5 O3-E
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
