// P4-A2 (X35, the editors' provisional layer; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2's four rules
// [binding]; the P4 interface ledger §3; this child's execution document R1 to R8): what the host tells every open
// document port about an agent's artifact call while it streams. The host reads the call's input as it arrives
// (`src/shared/maws/partial-json.ts`) and sends, at about 16 ms, the batch's ops as far as they parse, each with the
// text it carries so far (cumulative: a frame replaces the one before it); `committed` names the write's seq, after
// which the renderer withdraws the layer only once its replica has integrated that row (rule 2; the composition hold
// buffers the row, so the withdrawal waits with it); `dropped` withdraws it without trace (rule 3: a refusal, an
// abandoned call, the turn's end, the process's exit). The layer is never a Y write (rule 1) and never enters the block
// the human is composing in (rule 4). The actor's name and colour are the committed write's (`actorDisplay`).
import * as z from 'zod';
import { ArtifactKindSchema } from './entity';
import { AppSessionIdSchema, ToolUseIdSchema } from '../graph/ids';

// The calls whose input the host reads as it streams: a document batch, a deck's or design's publish, a dashboard's dataset.
export const PROVISIONAL_TOOLS = ['artifact_edit', 'artifact_publish', 'artifact_dataset'] as const;
export type ProvisionalTool = (typeof PROVISIONAL_TOOLS)[number];
export const isProvisionalTool = (name: string | null | undefined): name is ProvisionalTool => (PROVISIONAL_TOOLS as readonly string[]).includes(name ?? '');

const Text = z.string();
const BlockId = z.string().min(1).max(64);

// One op of the batch as far as it parsed: the document ops carry the block they name or, for an unscoped quote, the
// block the host found the quote in (`null` until found, or when nothing holds it); `text` is the op's streamed `new`
// or `markdown` so far. A publish's `file` is one of its files' text so far; a dataset's `dataset` names its id.
export const ProvisionalOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('replace_text'), block: BlockId.nullable(), old: Text, text: Text }),
  z.strictObject({ op: z.literal('replace_block'), block: BlockId, text: Text }),
  z.strictObject({ op: z.literal('insert'), after: BlockId.optional(), before: BlockId.optional(), text: Text }),
  z.strictObject({ op: z.literal('set_cell'), table: BlockId, row: z.number().int().nonnegative(), col: z.number().int().nonnegative(), text: Text }),
  z.strictObject({ op: z.literal('delete'), block: BlockId }),
  z.strictObject({ op: z.literal('move'), block: BlockId }),
  // G2 (G-R1): a publish's file (the slide or board) as far as it parses; a publish's frame carries only the files whose
  // text changed since its last, so a layer keeps its files by path, a later text replacing the earlier
  z.strictObject({ op: z.literal('file'), path: z.string().min(1), text: Text }),
  z.strictObject({ op: z.literal('dataset'), dataset: z.string().min(1), text: Text }), // the dashboard view's dataset, as far as it parses
]);
export type ProvisionalOp = z.infer<typeof ProvisionalOpSchema>;

export const PROVISIONAL_STATES = ['streaming', 'committed', 'dropped'] as const;

export const ArtifactProvisionalSchema = z.strictObject({
  toolUseId: ToolUseIdSchema,
  appSessionId: AppSessionIdSchema,
  artifactId: z.string().min(1), // the doc the frame is for: the artifact's id, or its suggestion doc's key in suggest mode
  kind: ArtifactKindSchema,
  state: z.enum(PROVISIONAL_STATES),
  commitSeq: z.number().int().nonnegative().optional(), // `committed` only: the row the write made, which the replica integrates before the layer goes
  at: z.number(), // epoch ms on the host's clock
  name: z.string(), // the agent as presence names it
  color: z.string(), // its author colour (`--author-n`)
  ops: z.array(ProvisionalOpSchema),
});
export type ArtifactProvisional = z.infer<typeof ArtifactProvisionalSchema>;

// The batch tick: Desktop batches its deltas at about this rate (the spec §4.2), one frame per tick per call at most.
export const PROVISIONAL_TICK_MS = 16;

/**
 * A call's frame over what its earlier frames made (G2, G-R1): a publish's frame lists only the files that grew or
 * appeared since the frame before, so its `file` ops merge into the earlier ones by path, a later text replacing the
 * earlier in its place and a new path appended; a file no frame touched keeps its op object, so a reader can tell an
 * unchanged file by identity. Every other op list replaces the one before (R1: cumulative). The renderer's store and the
 * port's provider (which keeps each call still streaming for a listener that attaches later) merge alike.
 */
export function mergeProvisional(earlier: ArtifactProvisional | undefined, frame: ArtifactProvisional): ArtifactProvisional {
  const files = earlier?.ops.filter((op) => op.op === 'file') ?? [];
  if (files.length === 0) return frame;
  const byPath = new Map(files.map((op) => [op.path, op]));
  for (const op of frame.ops) if (op.op === 'file') byPath.set(op.path, op); // a Map keeps a replaced key in its place and appends a new one
  return { ...frame, ops: [...frame.ops.filter((op) => op.op !== 'file'), ...byPath.values()] };
}
