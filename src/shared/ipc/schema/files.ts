// X2 `files.*` (C8c execution document, Interfaces "`files.*`"; the C8 spec's *`files.*` read service*, K1): main's
// read-only view of a session's own directories, for the Files tool and the file viewer. Owner `main` for every
// command. Every path is confined to the session's allowlist (the realpaths of its `directory`, `additionalDirectories`
// and `worktree.path`) by the open-first boundary in `src/main/files/service.ts`; refusals answer `internal` with
// `path outside the session's directories`. Nothing here writes a file.
import * as z from 'zod';
import { AppSessionIdSchema } from '@shared/graph/ids';
import type { CommandSpec } from './common';

// Declared before the registry, which reads them when this module loads.
export const FILES_READ_DEFAULT_LENGTH = 1024 * 1024; // C4's SPILL_DEFAULT_LENGTH; the viewer's first chunk
export const FILES_READ_MAX_LENGTH = 8 * 1024 * 1024; // one call's ceiling; the image cap is one call
export const FILES_LIST_MAX_ENTRIES = 5000;
// How much of a file's head decides its encoding (a NUL in it makes the file binary); main and the viewer share it.
export const BINARY_SNIFF_BYTES = 8192;

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

export const FilesReadInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  path: z.string(),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(FILES_READ_MAX_LENGTH).optional(), // defaults to FILES_READ_DEFAULT_LENGTH
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
});
export type FilesReadOutput = z.infer<typeof FilesReadOutputSchema>;

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
