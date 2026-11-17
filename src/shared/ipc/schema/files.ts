// X2 `files.*` (C8c execution document, Interfaces "`files.*`"; the C8 spec's *`files.*` read service*, K1): main's
// view of a session's own directories, for the Files tool, the file viewer and (E5) the editor. Owner `machine` for
// every command from P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §C): `mawsd` serves
// them with the spine on the daemon shape. Every path is confined to the session's allowlist (the realpaths of its `directory`, `additionalDirectories`
// and `worktree.path`) by the open-first boundary in `src/services/files/service.ts`, but for one file outside them that
// the session's deliverables name (`read`, `openExternal`, `reveal`) or, UX wave U6c, that its transcript links (`read`
// and `openExternal`, asked with `named`); refusals answer `internal` with `path outside the session's directories`. Two
// writes are E5's hash-checked save of a file that already exists: `files.write`, inside the session's directories alone,
// and (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B) `files.writeOutside`, which
// also saves one file outside them that the session's transcript names by a counted form, that the person chose
// (`files.grant`, main's alone) or that the session's agent sent, while the path still resolves to the real path the save
// names; neither writes a file of MAWS's own (its profile folder, an app bundle of it). The other write, P5 O3-E's
// `files.upload`, creates new files in the session's attachments directory alone; nothing here renames a file, or
// deletes one but the upload's own.
//
// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §B): from another machine,
// `files.read` and the rest take the session's directories less the machine's home, as P5's Decision Log 237 has them,
// and admit nothing by name; four acts of their own reach outside them there, each on the terminal's offer row and run
// only under the claim `machine.op` makes: `files.readOutside` (the keyed read), `files.listOutside` (one page of one
// folder of the machine, for the chooser another machine's page draws), `files.chooseOutside` (the pick, which the
// machine's daemon records as its own grant) and `files.writeOutside`. None of them enters a folder macOS protects
// unasked (`open`).
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
  // UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, Interfaces §D): the caller knows the rule:
  // a file outside the session's directories is read when it stands admitted for the session, for a caller on the
  // session's machine alone; U6e (decision 5): admitted by the session's transcript (`src/services/files/named.ts`), by a
  // grant (`files.grant`) or by the agent's delivery, and the answer says which kind (`outside`). Sent by the window only
  // for a session on this Mac; a peer that does not know the key drops it and answers the plain read. U6f (decision 9):
  // from another machine it admits nothing, and a file the session's deliveries admit there is answered `outside`
  // read-only (`why: 'added'`); `files.readOutside` asks by the outside rule there.
  named: z.literal(true).optional(),
  // UX wave U6e (decision 19): the open was asked by the agent (`show_pane`), so no grant admits the file; a peer that does
  // not know the key drops it
  agent: z.literal(true).optional(),
  // UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, Interfaces §B): the bytes of exactly
  // the range asked, as base64 whatever the type, never decoded and never re-cut, answered with the file's `identity`;
  // honoured for a caller on the file's machine alone (a remote caller's is passed over and the plain read answered).
  // Sent by main alone, to serve a file's frame; a daemon that does not know the key drops it and answers the plain read.
  raw: z.literal(true).optional(),
  // UX wave U6f (decision 18): the person said to open the folder macOS protects that the path lies in; read only by
  // `files.readOutside`, and carried here so the window's keyed read can hand it on. Main takes it off a read it sends to
  // another machine as a call.
  open: z.literal(true).optional(),
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
  // UX wave U6c: the file is outside the session's directories and was admitted so (U6e: by the transcript, a grant or the
  // Library); present only in the answer to a request that carried `named`, and absent for every other file
  named: z.literal(true).optional(),
  // UX wave U6e (§B): present exactly when `named` is, on a daemon of U6e or later. `real`: the confirmed real path, which a
  // save names (`files.writeOutside`); `writable`: false for a file only a tool's result names (`why: 'result'`) or only a
  // record of the Library the person added admits (`why: 'added'`), which no save writes
  outside: z.strictObject({ real: z.string(), writable: z.boolean(), why: z.enum(['result', 'added']).optional() }).optional(),
  // UX wave U6e (decision 8): the file is under one of MAWS's own folders (its profile folder, an app bundle of it), which no
  // write reaches; on any read, inside the directories too
  own: z.literal(true).optional(),
  // UX wave U6b-2: the version of the file the bytes are of (its device, inode, size, modification and change times, as
  // the opened descriptor knows them); present exactly in the answer to a raw read, so two raw reads that answer the same
  // identity read the same version, and a read whose file changed while it was read is refused instead
  identity: z.string().min(1).optional(),
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

// UX wave U6e (§B, decisions 5 and 6): the save of a file outside the session's directories, by a command of its own so
// that a daemon that cannot compare the real path does not know it and writes nothing (`unknown_command`). `real` is the
// real path the read answered (`outside.real`); a path that no longer resolves there is refused with FILES_MOVED.
export const FILES_MOVED = 'the path no longer leads to the file that was opened';
// UX wave U6f (decision 18): `open`, a save from another machine of a file in a folder macOS protects, which the person
// opened
export const FilesWriteOutsideInputSchema = FilesWriteInputSchema.extend({ real: z.string(), open: z.literal(true).optional() });
export type FilesWriteOutsideInput = z.infer<typeof FilesWriteOutsideInputSchema>;

// UX wave U6f (§B; decisions 2, 7, 8, 18): the acts of another machine on a file outside the session's directories. The
// open is the keyed read, with no key to ask it (it always asks) and no raw read (no raw read crosses a link, U6b-2).
// The listing is one page of one folder of the machine, its entries by name and directory entry type alone, never a link's
// target, a size or a date. The choice is the daemon's own grant of the file the path leads to, answered with its real
// path, which the tab opens. A path is absolute, or `~` and `~/…` under the daemon user's home.
export const OUTSIDE_LIST_PAGE = 200;
export const FilesReadOutsideInputSchema = FilesReadInputSchema.omit({ named: true, raw: true }).extend({ open: z.literal(true).optional() });
export type FilesReadOutsideInput = z.infer<typeof FilesReadOutsideInputSchema>;
export const FilesListOutsideInputSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, // the session the chooser is open for; it places the request on its machine
  path: z.string().min(1).max(4096).optional(), // absent: the home
  open: z.literal(true).optional(), // read inside the folders macOS protects that the path leads into
  cursor: z.string().min(1).max(1024).optional(), // the last name of the page before
});
export type FilesListOutsideInput = z.infer<typeof FilesListOutsideInputSchema>;
export const OutsideEntrySchema = z.strictObject({ name: z.string(), path: z.string(), kind: z.enum(['dir', 'file', 'link', 'other']), protected: z.boolean() });
export type OutsideEntry = z.infer<typeof OutsideEntrySchema>;
export const FilesListOutsideOutputSchema = z.discriminatedUnion('status', [
  // `path`: the folder's real path; `parent`: its parent, null at the filesystem's root; `home`: the daemon user's home
  z.strictObject({ status: z.literal('listed'), path: z.string(), parent: z.string().nullable(), home: z.string(), entries: z.array(OutsideEntrySchema), cursor: z.string().nullable() }),
  z.strictObject({ status: z.literal('refused'), reason: z.enum(['no-folder', 'not-a-folder', 'unreadable', 'protected']) }),
]);
export type FilesListOutsideOutput = z.infer<typeof FilesListOutsideOutputSchema>;
export const FilesChooseOutsideInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string().min(1).max(4096), open: z.literal(true).optional() });
export type FilesChooseOutsideInput = z.infer<typeof FilesChooseOutsideInputSchema>;
export const FilesChooseOutsideOutputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('granted'), path: z.string() }), // the real path: what the tab opens
  z.strictObject({ status: z.literal('refused'), reason: z.enum(['not-a-file', 'no-file', 'protected']) }),
]);
export type FilesChooseOutsideOutput = z.infer<typeof FilesChooseOutsideOutputSchema>;
// The message of a read's or a save's refusal whose `issues.refusal` is 'protected' (decision 18)
export const FILES_PROTECTED = 'the file is in a folder macOS protects';

const SessionPathSchema = z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string() });
// UX wave U6c: `files.openExternal` takes `named` as `files.read` does; U6e: and `agent`
export const FilesOpenExternalInputSchema = SessionPathSchema.extend({ named: z.literal(true).optional(), agent: z.literal(true).optional() });
export type FilesOpenExternalInput = z.infer<typeof FilesOpenExternalInputSchema>;

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

// UX wave U6e (§B, decision 2): the record that the person chose one file for one session in the system's chooser, which
// main sends once the chooser answered and no page can (main-only). Answered with the real path the daemon granted, what
// the tab opens; a directory, a package and a special file are refused.
export const FilesGrantOutputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('granted'), path: z.string() }),
  z.strictObject({ status: z.literal('refused'), reason: z.literal('not-a-file') }),
]);
export type FilesGrantOutput = z.infer<typeof FilesGrantOutputSchema>;

// P5 O3-E M2 (Interfaces §D; D6): `library.read`'s reach to a File artifact's stored bytes, a path main resolved itself
// (the artifact's admission), read with `files.read`'s rules (no link on the path, a regular file, the same answer).
// Main-only: a page could otherwise read any absolute path outside every session's allowlist. `path` must be absolute,
// which the files service refuses (`path must be absolute`), as `library.read`'s caller has always been told. UX wave
// U6c: `named` is left out as the session is; the caller's resolution is the admission. U6e: `agent` too; its answer is
// the read's, and sets neither `outside` nor `own`. UX wave U6b-2: `raw` too. U6f: `open` too.
export const FilesReadResolvedInputSchema = FilesReadInputSchema.omit({ appSessionId: true, named: true, agent: true, raw: true, open: true });
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

// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 "The attachment", Interfaces §U): an upload a
// send names for the machine to attach. Its id is the name `files.upload` stored it under in the session's upload root
// (the last part of the path it answered: `<upload id>.<n>[.<ext>]`), so it names a file of that root alone and never a
// path. `as: 'document'`: the file goes to the model as a document block, as a PDF dropped on a local session does.
// How long an upload is kept for a send to name (a day): the machine's sweep may take its root after it, and a send naming
// an older one is refused (services/fs/upload-roots.ts, services/files/upload.ts); the composer warns before such a send.
export const UPLOAD_KEPT_MS = 24 * 3600_000;
export const UPLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}\.[0-7](?:\.[a-z0-9]{1,16})?$/;
export const SendUploadSchema = z.strictObject({ uploadId: z.string().regex(UPLOAD_ID_PATTERN), as: z.literal('document') });
export type SendUpload = z.infer<typeof SendUploadSchema>;
// The most uploads one message names (M8's reviewer-high review). Not UPLOAD_FILES_MAX, which bounds one `files.upload`
// call: the composer splits a larger set across calls. A count bound for the schema, the endpoint's read and the
// composer alike; the bytes are bounded apart, each document within MAX_SEND_DOCUMENT_BYTES and the message within
// MAX_SEND_CONTENT_JSON_BYTES (the machine's read, services/files/upload.ts, and the expansion's check).
export const SEND_UPLOADS_MAX = 100;
export const SendUploadsSchema = z.array(SendUploadSchema).min(1).max(SEND_UPLOADS_MAX);
// `files.readUploads` (internal: the machine's endpoint's own read, never offered and never bridged): each upload of the
// session's root read whole as the block a send carries, or the refusal, a sentence naming the upload, with nothing read
// for any of them.
export const UploadDocumentBlockSchema = z.strictObject({ type: z.literal('document'), source: z.strictObject({ type: z.literal('base64'), media_type: z.literal('application/pdf'), data: z.base64() }) });
export type UploadDocumentBlock = z.infer<typeof UploadDocumentBlockSchema>;
export const FilesReadUploadsInputSchema = z.strictObject({ appSessionId: AppSessionIdSchema, uploads: SendUploadsSchema });
export type FilesReadUploadsInput = z.infer<typeof FilesReadUploadsInputSchema>;
export const FilesReadUploadsOutputSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), blocks: z.array(UploadDocumentBlockSchema) }),
  z.strictObject({ status: z.literal('refused'), reason: z.string() }),
]);
export type FilesReadUploadsOutput = z.infer<typeof FilesReadUploadsOutputSchema>;

export const commands = {
  // No path: the roots as 'dir' entries in record order (directory, additionalDirectories…, worktree when it differs),
  // deduplicated by realpath, root null, path ''.
  'files.list': { input: z.strictObject({ appSessionId: AppSessionIdSchema, path: z.string().optional() }), output: FilesListOutputSchema, owner: 'machine' },
  'files.read': { input: FilesReadInputSchema, output: FilesReadOutputSchema, owner: 'machine' },
  // A directory; ref-counted per confirmed realpath; re-confirmed after install and before each batch it forwards.
  'files.watch': { input: SessionPathSchema, output: z.void(), owner: 'machine' },
  'files.unwatch': { input: SessionPathSchema, output: z.void(), owner: 'machine' },
  'files.openExternal': { input: FilesOpenExternalInputSchema, output: FilesOpenExternalOutputSchema, owner: 'machine' },
  // E5 start: the hash-checked save. Not a read: never in the renderer's QUERY_COMMANDS.
  'files.write': { input: FilesWriteInputSchema, output: FilesWriteOutputSchema, owner: 'machine' },
  // E5 end
  // UX wave U6e: the save of a file outside the session's directories (bridged), and the grant of a chosen file
  // (main-only); U6f: from another machine too, beside the open, the chooser's listing and the pick (bridged)
  'files.writeOutside': { input: FilesWriteOutsideInputSchema, output: FilesWriteOutputSchema, owner: 'machine' },
  'files.grant': { input: SessionPathSchema, output: FilesGrantOutputSchema, owner: 'machine' },
  'files.readOutside': { input: FilesReadOutsideInputSchema, output: FilesReadOutputSchema, owner: 'machine' },
  'files.listOutside': { input: FilesListOutsideInputSchema, output: FilesListOutsideOutputSchema, owner: 'machine' },
  'files.chooseOutside': { input: FilesChooseOutsideInputSchema, output: FilesChooseOutsideOutputSchema, owner: 'machine' },
  'files.reveal': { input: SessionPathSchema, output: FilesRevealOutputSchema, owner: 'machine' }, // E1
  'files.readResolved': { input: FilesReadResolvedInputSchema, output: FilesReadOutputSchema, owner: 'machine' }, // P5 O3-E: main-only
  'files.upload': { input: FilesUploadInputSchema, output: FilesUploadOutputSchema, owner: 'machine' }, // P5 O3-E
  'files.readUploads': { input: FilesReadUploadsInputSchema, output: FilesReadUploadsOutputSchema, owner: 'machine' }, // P5 O7 M8: main-only, the endpoint's
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
