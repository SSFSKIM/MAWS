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

  // Collected leaf to root, reversed once at the end (an unshift per step is quadratic on long transcripts).
  const leafToRoot: TranscriptRecord[] = [leaf];
  const visited = new Set<string>([leaf.uuid as string]);
  let current = leaf;
  let gap: ChainResult['gap'] = null;
  for (;;) {
    const parentUuid = current.parentUuid;
    if (parentUuid === null || parentUuid === undefined) break;
    const parent = byUuid.get(parentUuid);
    if (parent === undefined || visited.has(parentUuid)) {
      gap = { parentUuid, childUuid: current.uuid as string };
      break;
    }
    leafToRoot.push(parent);
    visited.add(parentUuid);
    current = parent;
  }
  return { chain: leafToRoot.reverse(), leaf, gap };
}

// The API response a record belongs to: an assistant record's own (`message.id`; a diagnostic belongs to none), or for a
// tool result, the response of the record that issued its tool (`sourceToolAssistantUUID`, else its parent).
function responseIdOf(record: TranscriptRecord, byUuid: ReadonlyMap<string, TranscriptRecord>): string | null {
  const id = (r: TranscriptRecord | undefined): string | null => {
    if (r?.type !== 'assistant' || r.isApiErrorMessage === true) return null;
    const message = r.message as { id?: unknown } | null | undefined;
    return typeof message?.id === 'string' ? message.id : null;
  };
  if (record.type === 'assistant') return id(record);
  const content = (record.message as { content?: unknown } | null | undefined)?.content;
  const toolResult = record.type === 'user' && Array.isArray(content) && content.some((block: unknown) => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_result');
  if (!toolResult) return null;
  const source = typeof record.sourceToolAssistantUUID === 'string' ? record.sourceToolAssistantUUID : record.parentUuid;
  return typeof source === 'string' ? id(byUuid.get(source)) : null;
}

// P2-D (2026-10-09): the engine's recovery of a parallel response (SPEC 11.2.2 and 35.12.3), the chain follower's FX6 rule
// read over a finished set of records. One API response with several tool calls is written as several assistant records
// sharing `message.id`, and each tool result parents on the record that issued its tool, so the walk from the leaf passes
// through the last result's issuer only and drops the response's other blocks and results. A response whose last-written
// record is on `chain` regains its members off it, with the records hanging off them written inside the response (a
// hook's attachment between two results), in file order. A chain that leaves a response before its last record (a fork
// from an earlier block, a rewind to one) is a real branch: nothing of that response is recovered.
export function withResponseGroups(chain: readonly TranscriptRecord[], records: readonly TranscriptRecord[]): TranscriptRecord[] {
  const first = new Map<string, number>(); // uuid → index of its first record (a uuid is written once)
  records.forEach((record, index) => {
    if (typeof record.uuid === 'string' && !first.has(record.uuid)) first.set(record.uuid, index);
  });
  const byUuid = new Map([...first].map(([uuid, index]) => [uuid, records[index]]));
  const responses = new Map<string, number[]>(); // response id → its members' indexes, in file order
  for (const index of first.values()) {
    const id = responseIdOf(records[index], byUuid);
    if (id !== null) responses.set(id, [...(responses.get(id) ?? []), index]);
  }
  const onChain = new Set(chain.map((record) => record.uuid));
  const recovered: number[] = [];
  for (const members of responses.values()) {
    const last = members.at(-1)!;
    if (!onChain.has(records[last].uuid) || members.every((i) => onChain.has(records[i].uuid))) continue;
    const inResponse = new Set(members.map((i) => records[i].uuid as string));
    for (let i = members[0] + 1; i < last; i++) {
      const { uuid, parentUuid } = records[i];
      if (typeof uuid === 'string' && first.get(uuid) === i && typeof parentUuid === 'string' && inResponse.has(parentUuid)) inResponse.add(uuid);
    }
    for (const uuid of inResponse) if (!onChain.has(uuid)) recovered.push(first.get(uuid)!);
  }
  if (recovered.length === 0) return [...chain];
  // merged by file position, the chain's own order untouched
  recovered.sort((a, b) => a - b);
  const out: TranscriptRecord[] = [];
  let next = 0;
  for (const record of chain) {
    const at = first.get(record.uuid as string) ?? -1;
    while (next < recovered.length && recovered[next] < at) out.push(records[recovered[next++]]);
    out.push(record);
  }
  for (; next < recovered.length; next++) out.push(records[recovered[next]]);
  return out;
}
