// P3-B: the document part of the `maws` server's artifact namespace (X25; §4.3 and §4.4 [binding] of
// docs/doperpowers/plans/2026-10-12-p3-co-work.md; D7 and D14 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// `artifact_edit`, `artifact_comments`, `artifact_reply` and `artifact_resolve`, the fields a document's
// `artifact_read` adds, and a document's `artifact_create`, with their descriptions, the limits the tools enforce and
// the refusals an agent can act on. Kept beside `./tools` until P3-A's artifact tools are on this branch; then
// `./tools` appends these names and entries after A's (one block), and A's `artifact_read` and `artifact_create`
// schemas take the document fields (`DOCUMENT_READ_FIELDS`, `content` for a document).
import * as z from 'zod';
import { ARTIFACT_ID } from './tools';

export const DOCUMENT_TOOL_NAMES = ['artifact_edit', 'artifact_comments', 'artifact_reply', 'artifact_resolve'] as const;
export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

// What the tools enforce (the kind's format reference states the same numbers).
export const DOCUMENT_LIMITS = {
  opsPerBatch: 100,
  textChars: 20_000, // replace_text's old and new, a cell's markdown, a reply
  markdownChars: 1_000_000, // replace_block's and insert's markdown, a create's content
  blocksPerTab: 2_000, // a batch or a create that would leave a tab with more top-level blocks is refused
  tabs: 50, // a document's tabs (the user adds them; no tool makes one)
  readCount: 200,
  readCountMax: 1_000,
} as const;

const ArtifactRefSchema = z.string().regex(ARTIFACT_ID);
const BlockIdSchema = z.string().min(1).max(64);
const TextSchema = z.string().max(DOCUMENT_LIMITS.textChars);
const MarkdownSchema = z.string().max(DOCUMENT_LIMITS.markdownChars);
const ThreadIdSchema = z.string().min(1).max(64);

export const EditOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('replace_text'), block: BlockIdSchema.optional(), old: TextSchema.min(1), new: TextSchema, all: z.boolean().optional() }),
  z.strictObject({ op: z.literal('replace_block'), id: BlockIdSchema, markdown: MarkdownSchema }),
  z.strictObject({ op: z.literal('insert'), after: BlockIdSchema.optional(), before: BlockIdSchema.optional(), markdown: MarkdownSchema }),
  z.strictObject({ op: z.literal('delete'), id: BlockIdSchema }),
  z.strictObject({ op: z.literal('move'), id: BlockIdSchema, after: BlockIdSchema.nullable() }),
  z.strictObject({ op: z.literal('set_cell'), table: BlockIdSchema, row: z.number().int().min(0), col: z.number().int().min(0), markdown: TextSchema }),
]);

export const ArtifactEditInputSchema = z
  .strictObject({
    artifact: ArtifactRefSchema,
    baseRevision: z.number().int().min(0),
    ops: z.array(EditOpSchema).min(1).max(DOCUMENT_LIMITS.opsPerBatch),
    mode: z.enum(['direct', 'suggest']).optional(),
    answering: ThreadIdSchema.optional(),
  })
  .superRefine((input, ctx) => {
    input.ops.forEach((op, i) => {
      if (op.op === 'insert' && (op.after === undefined) === (op.before === undefined)) ctx.addIssue({ code: 'custom', path: ['ops', i], message: 'an insert names one of after or before' });
    });
  });
export type ArtifactEditInput = z.infer<typeof ArtifactEditInputSchema>;

export const ArtifactCommentsInputSchema = z.strictObject({ artifact: ArtifactRefSchema, status: z.enum(['open', 'resolved', 'all']).optional() });
export type ArtifactCommentsInput = z.infer<typeof ArtifactCommentsInputSchema>;
export const ArtifactReplyInputSchema = z.strictObject({ artifact: ArtifactRefSchema, threadId: ThreadIdSchema, body: TextSchema.min(1) });
export type ArtifactReplyInput = z.infer<typeof ArtifactReplyInputSchema>;
export const ArtifactResolveInputSchema = z.strictObject({ artifact: ArtifactRefSchema, threadId: ThreadIdSchema, reopen: z.boolean().optional() });
export type ArtifactResolveInput = z.infer<typeof ArtifactResolveInputSchema>;

// The fields a document's `artifact_read` takes beside A's (`artifact`, `version`; `revision` and `paths` are the file
// kinds'): one tab, a range of top-level blocks from a block id, and only what changed since a revision.
export const DOCUMENT_READ_FIELDS = {
  tab: z.string().min(1).max(64).optional(),
  from: BlockIdSchema.optional(),
  count: z.number().int().min(1).max(DOCUMENT_LIMITS.readCountMax).optional(),
  sinceRevision: z.number().int().min(0).optional(),
};
export const DocumentReadInputSchema = z.strictObject({
  artifact: ArtifactRefSchema,
  revision: z.number().int().min(1).optional(),
  version: z.number().int().min(1).optional(),
  paths: z.array(z.string().min(1).max(512)).min(1).max(200).optional(),
  ...DOCUMENT_READ_FIELDS,
});
export type DocumentReadInput = z.infer<typeof DocumentReadInputSchema>;

// A document's `artifact_create`: its first tab's content as the kind's markdown (empty: one empty paragraph).
export const DocumentCreateInputSchema = z.strictObject({
  kind: z.literal('document'),
  title: z.string().min(1).max(200),
  handle: ArtifactRefSchema.optional(),
  id: ArtifactRefSchema.optional(), // E2's name for `handle`
  content: MarkdownSchema.optional(),
});
export type DocumentCreateInput = z.infer<typeof DocumentCreateInputSchema>;

// ── results ──

export interface EditOpResultLine {
  line: string;
  target: string;
  newIds: string[];
}
export interface ArtifactEditResult {
  status: 'edited';
  artifactId: string;
  revision: number;
  results: EditOpResultLine[];
  orphaned: string[]; // open threads no live text carries after the batch
  answered?: { threadId: string; messageId: string };
}
export interface DocumentTab {
  id: string;
  title: string;
  blocks: number;
}
export interface DocumentReadResult {
  status: 'read';
  artifactId: string;
  kind: 'document';
  title: string;
  handle?: string;
  revision: number;
  tabs: DocumentTab[];
  tab: string;
  markdown: string;
  next: string | null;
  sinceRevision?: number;
  changed?: string[]; // with sinceRevision: the top-level blocks shown, which changed since it
  deleted?: string[]; // with sinceRevision: the block ids that existed then and exist nowhere now
  complete?: true; // with sinceRevision: the revision is beyond what the host can compare, so the whole range is shown
  version?: DocumentVersionSummary; // when a retained version was read
  versions: DocumentVersionSummary[]; // the latest ones, newest first (the ids `version` takes)
}
export interface DocumentVersionSummary {
  id: number;
  kind: string;
  revision: number;
  at: string;
  by: CommentAuthor['by'];
  label?: string;
}
export type CommentAuthor = { by: 'user' | 'this session' | 'another session'; appSessionId?: string };
export interface ListedThread {
  threadId: string;
  status: 'open' | 'resolved';
  orphaned: boolean;
  tab: string;
  block: string | null; // where its passage is now, or was
  quote: string;
  createdBy: CommentAuthor;
  createdAt: string;
  resolvedAt?: string;
  messages: Array<{ id: string; at: string; body: string } & CommentAuthor>;
}
export interface ArtifactCommentsResult {
  status: 'listed';
  artifactId: string;
  revision: number;
  threads: ListedThread[];
}
export interface ArtifactReplyResult {
  status: 'replied';
  artifactId: string;
  threadId: string;
  messageId: string;
  threadStatus: 'open' | 'resolved';
  revision: number;
  line: string;
}
export interface ArtifactResolveResult {
  status: 'resolved' | 'reopened';
  artifactId: string;
  threadId: string;
  revision: number;
  line: string;
}

// ── refusals: `<tool>: <sentence> <JSON>`, the JSON's `reason` machine-readable (the format of A's `TOOL_ERRORS.refused`)

export const DOCUMENT_REFUSAL_REASONS = ['staleTargets', 'notUnique', 'notFound', 'removedByRestore', 'retry', 'invalid', 'unavailable', 'handleTaken'] as const;
export type DocumentRefusalReason = (typeof DOCUMENT_REFUSAL_REASONS)[number];
export type DocumentRefusal = { reason: DocumentRefusalReason } & Record<string, unknown>;
export const documentRefused = (tool: string, refusal: DocumentRefusal, sentence: string): string => `${tool}: ${sentence} ${JSON.stringify(refusal)}`;
export const documentInvalidArguments = (tool: string, issues: string): string => `${tool}: invalid arguments: ${issues}`;

// ── the tools as `tools/list` describes them ──

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITER = { readOnlyHint: false, openWorldHint: false } as const;

export const DOCUMENT_TOOLS = {
  artifact_edit: {
    title: 'Edit document',
    description:
      'Edit a MAWS document with one atomic batch of block operations; without this tool, tell the user what to change. Read it first (artifact_read): blocks carry ids (^id) and baseRevision is the revision that read returned. ops: replace_text {block?, old, new, all?} (old must match exactly once in the block, or in the whole document when block is absent; it is checked against the live text, so the user typing elsewhere does not refuse it), replace_block {id, markdown}, insert {after | before, markdown}, delete {id}, move {id, after} (after: null moves to the start), set_cell {table, row, col, markdown}. A replace_block, delete or set_cell whose target changed since baseRevision is refused naming the block and its current text. Either every op lands or none does. answering: a comment thread id posts the result into that thread. Returns the new revision, one line per op with the ids of the blocks it made, and the comment threads left without text.',
    input: ArtifactEditInputSchema,
    annotations: WRITER,
  },
  artifact_comments: {
    title: 'List document comments',
    description:
      "List a MAWS document's comment threads with their quoted passage, the block it is on and their messages; without this tool, read the comments footer of artifact_read. status: open (the default, including orphaned threads whose passage is gone), resolved or all.",
    input: ArtifactCommentsInputSchema,
    annotations: READ_ONLY,
  },
  artifact_reply: {
    title: 'Reply to a document comment',
    description: "Post a reply as this session to a comment thread of a MAWS document; without this tool, answer in the conversation. To answer with an edit, give artifact_edit's answering instead.",
    input: ArtifactReplyInputSchema,
    annotations: WRITER,
  },
  artifact_resolve: {
    title: 'Resolve a document comment',
    description: 'Resolve a comment thread of a MAWS document once it is addressed, or reopen it with reopen: true; without this tool, tell the user it is addressed.',
    input: ArtifactResolveInputSchema,
    annotations: WRITER,
  },
} as const satisfies Record<DocumentToolName, { title: string; description: string; input: z.ZodType; annotations: { readOnlyHint: boolean; openWorldHint: boolean } }>;

function issuesText(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
}

/** A call's arguments through `schema`: the data, or the refusal text the tool answers. */
export function parseDocumentArguments<S extends z.ZodType>(tool: string, schema: S, args: unknown): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const parsed = schema.safeParse(args);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: documentInvalidArguments(tool, issuesText(parsed.error)) };
}
