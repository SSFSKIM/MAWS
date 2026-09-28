// X1 transcript records (charter §4.3 as revised by C2; C1 execution document, Interfaces "X1 — transcript records"):
// the engine's on-disk JSONL under `~/.claude/projects/`, which C4 tails and backfills from. Loose objects; the only
// required field is `type`, because anchor rows (`last-prompt`) have no `uuid`.
import * as z from 'zod';

export const TranscriptRecordSchema = z.looseObject({
  type: z.string(),
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string().optional(),
  isSidechain: z.boolean().optional(),
  agentId: z.string().optional(),
  timestamp: z.string().optional(),
  message: z.unknown().optional(),
});
export type TranscriptRecord = z.infer<typeof TranscriptRecordSchema>;

// The anchor a rewind appends (`rewound: true`); parsed and exposed for C4's anchor handling, never walked by currentChain.
export const LastPromptAnchorSchema = TranscriptRecordSchema.extend({
  type: z.literal('last-prompt'),
  lastPrompt: z.string(),
  rewound: z.boolean().optional(),
  leafUuid: z.string().optional(),
});
export type LastPromptAnchor = z.infer<typeof LastPromptAnchorSchema>;

// agent-<id>.meta.json beside a sidecar transcript.
export const AgentMetaSchema = z.looseObject({
  agentType: z.string(),
  description: z.string(),
  toolUseId: z.string(),
  spawnDepth: z.number(),
  requestShape: z.string().optional(),
  requestNonInteractive: z.boolean().optional(),
  model: z.string().optional(),
});
export type AgentMeta = z.infer<typeof AgentMetaSchema>;

export function parseTranscriptRecord(line: unknown): TranscriptRecord {
  return TranscriptRecordSchema.parse(line);
}

export interface ChainResult {
  chain: TranscriptRecord[]; // root to leaf
  leaf: TranscriptRecord | null;
  gap: { parentUuid: string; childUuid: string } | null; // the first parent reference the walk could not follow
}

// The transcript the model sees: start from the last record in file order that has a uuid (the leaf), follow `parentUuid`
// until a record whose `parentUuid` is null (the root), and return the chain root to leaf. Records off that chain (the
// branch a rewind left behind) are excluded; records without a uuid (`last-prompt` anchors, `file-history-snapshot`) are
// never on it, whatever their type; records with a uuid are on it whatever their type (`system`, `progress`, …).
// If a `parentUuid` names no record in the input, or names one already visited, the walk stops: `chain` begins at the
// child that referenced it and `gap` names both uuids. Nothing is fabricated and no record is skipped over to find a
// plausible ancestor. File order is not the transcript: a rewind appends an anchor and the next turn's user record
// points at an older parent (pass-2 `rewind.jsonl` snapshots).
export function currentChain(records: TranscriptRecord[]): ChainResult {
  const byUuid = new Map<string, TranscriptRecord>();
  let leaf: TranscriptRecord | null = null;
  for (const record of records) {
    if (typeof record.uuid !== 'string') continue;
    if (!byUuid.has(record.uuid)) byUuid.set(record.uuid, record);
    leaf = record;
  }
  if (leaf === null) return { chain: [], leaf: null, gap: null };

  const chain: TranscriptRecord[] = [leaf];
  const visited = new Set<string>([leaf.uuid as string]);
  let current = leaf;
  for (;;) {
    const parentUuid = current.parentUuid;
    if (parentUuid === null || parentUuid === undefined) return { chain, leaf, gap: null };
    const parent = byUuid.get(parentUuid);
    if (parent === undefined || visited.has(parentUuid)) {
      return { chain, leaf, gap: { parentUuid, childUuid: current.uuid as string } };
    }
    chain.unshift(parent);
    visited.add(parentUuid);
    current = parent;
  }
}
