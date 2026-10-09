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

// How the engine host's chain follower classes a record for response ownership (chain-follower.ts, `Skeleton.delivery`):
// `interleave` (an attachment, a system record, a task notification) may arrive beside a parallel response's blocks,
// `tail` (a meta user record, a diagnostic) only after the record it hangs off; a human prompt and everything else is
// conversation, never a delivery. The classing reads backfill's prompt rules, so the caller supplies it.
export type Delivery = 'interleave' | 'tail' | null;

const messageIdOf = (record: TranscriptRecord): string | null => {
  const id = (record.message as { id?: unknown } | null | undefined)?.id;
  return record.type === 'assistant' && record.isApiErrorMessage !== true && typeof id === 'string' ? id : null;
};
const isToolResult = (record: TranscriptRecord): boolean => {
  const content = (record.message as { content?: unknown } | null | undefined)?.content;
  return record.type === 'user' && Array.isArray(content) && content.some((block: unknown) => typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_result');
};
const sameScope = (a: TranscriptRecord, b: TranscriptRecord): boolean => (a.agentId ?? null) === (b.agentId ?? null) && (a.isSidechain === true) === (b.isSidechain === true);

// P2-D (2026-10-09): the engine's recovery of a parallel response (SPEC 11.2.2 and 35.12.3), the chain follower's FX6 rule
// over a finished set of records. One API response with several tool calls is written as several assistant records
// sharing `message.id`, and each tool result parents on the record that issued its tool, so the walk from the leaf passes
// through the last result's issuer only and drops the response's other blocks and results. The records are replayed in
// file order the way the follower keeps its chain (chain-follower.ts, `handleRecord`, `branch`, `responseGroup`): a record
// on the leaf extends it; one on an earlier record of the chain joins without cutting only when it and every record it
// would cut belong to that record's response (an assistant record with its message id, a tool result its blocks issued,
// a delivery proved to have arrived on one of them; `deliveryOf`), and otherwise it branches, its ancestry the new chain;
// a rewind anchor cuts the chain at its target. What the replay keeps off `chain` rejoins it in file order. A prompt or
// another response on one of a response's blocks is a real branch, so the members written before it stay off, as they
// do for the follower; when the replay ends anywhere but `chain`'s leaf, nothing is recovered. The holder rule the
// follower applies first (W7) reads live state a finished read does not have.
export function withResponseGroups(chain: readonly TranscriptRecord[], records: readonly TranscriptRecord[], deliveryOf: (record: TranscriptRecord) => Delivery): TranscriptRecord[] {
  interface Node { record: TranscriptRecord; index: number; delivery: Delivery; owner: string | null }
  const nodes = new Map<string, Node>(); // the first record of each uuid (a uuid is written once)
  const parentOf = (uuid: string): string | null => {
    const parent = nodes.get(uuid)?.record.parentUuid;
    return typeof parent === 'string' ? parent : null;
  };
  // the follower's `responseGroup`: the assistant record whose response this record belongs to
  const responseOf = (uuid: string): TranscriptRecord | null => {
    const node = nodes.get(uuid);
    if (node === undefined) return null;
    if (node.record.type === 'assistant' && node.record.isApiErrorMessage !== true) return messageIdOf(node.record) === null ? null : node.record;
    const source = isToolResult(node.record) ? (typeof node.record.sourceToolAssistantUUID === 'string' ? node.record.sourceToolAssistantUUID : parentOf(uuid)) : node.owner;
    const assistant = source === null ? undefined : nodes.get(source)?.record;
    return assistant !== undefined && messageIdOf(assistant) !== null && sameScope(node.record, assistant) ? assistant : null;
  };
  const inResponse = (uuid: string, response: TranscriptRecord): boolean => {
    const owner = responseOf(uuid);
    return owner !== null && messageIdOf(owner) === messageIdOf(response) && sameScope(owner, response);
  };

  let kept: string[] = []; // the replay's chain, root to leaf
  let onChain = new Set<string>();
  let leaf: string | null = null;
  records.forEach((record, index) => {
    if (typeof record.uuid !== 'string') {
      const anchor = LastPromptAnchorSchema.safeParse(record);
      const target = anchor.success && anchor.data.rewound === true ? anchor.data.leafUuid : undefined;
      if (target !== undefined && onChain.has(target)) {
        kept = kept.slice(0, kept.indexOf(target) + 1);
        onChain = new Set(kept);
        leaf = target;
      }
      return;
    }
    const uuid = record.uuid;
    if (nodes.has(uuid)) return;
    const node: Node = { record, index, delivery: deliveryOf(record), owner: null };
    nodes.set(uuid, node);
    if (record.type === 'progress') return; // never the leaf; a child naming it walks through it
    // through progress rows, each once: a malformed transcript can parent them in a cycle (the follower's `throughProgress`
    // bounds the same walk), which then ends on a progress row and branches to this record alone
    let parent = parentOf(uuid);
    const passed = new Set<string>();
    while (parent !== null && !passed.has(parent) && nodes.get(parent)?.record.type === 'progress') {
      passed.add(parent);
      parent = parentOf(parent);
    }
    const extend = () => {
      kept.push(uuid);
      onChain.add(uuid);
      leaf = uuid;
    };
    if (parent === leaf) {
      const response = parent === null ? null : responseOf(parent);
      if (response !== null && node.delivery !== null && sameScope(record, response)) node.owner = response.uuid as string;
      extend();
      return;
    }
    // branch: the ancestry up to the first record on the chain (whose prefix, recovered records included, is kept)
    const walked = [uuid];
    const visited = new Set([uuid]);
    let prefix: string[] = [];
    for (let current = parent; current !== null && nodes.has(current) && !visited.has(current); current = parentOf(current)) {
      if (onChain.has(current)) {
        prefix = kept.slice(0, kept.indexOf(current) + 1);
        break;
      }
      visited.add(current);
      if (nodes.get(current)!.record.type !== 'progress') walked.push(current);
    }
    const next = [...prefix, ...walked.reverse()];
    const nextSet = new Set(next);
    const removed = kept.filter((member) => !nextSet.has(member));
    const typeOf = (member: string) => nodes.get(member)!.record.type;
    const leafSibling = removed.length > 0 && removed.every((member) => typeOf(member) === 'attachment');
    if (!leafSibling && parent !== null && onChain.has(parent) && removed.length > 0) {
      const response = responseOf(parent);
      const delivery = response !== null && node.delivery === 'interleave' && sameScope(record, response)
        && removed.every((member) => nodes.get(member)!.delivery === null || typeOf(member) === 'attachment');
      if (response !== null && (inResponse(uuid, response) || delivery) && removed.every((member) => inResponse(member, response))) {
        if (delivery) node.owner = response.uuid as string;
        extend();
        return;
      }
    }
    kept = next;
    onChain = nextSet;
    leaf = uuid;
  });

  if (leaf === null || chain.at(-1)?.uuid !== leaf) return [...chain];
  const given = new Set(chain.map((record) => record.uuid));
  const recovered = kept.filter((uuid) => !given.has(uuid)).map((uuid) => nodes.get(uuid)!.index);
  if (recovered.length === 0) return [...chain];
  // merged by file position, the chain's own order untouched
  recovered.sort((a, b) => a - b);
  const out: TranscriptRecord[] = [];
  let next = 0;
  for (const record of chain) {
    const at = typeof record.uuid === 'string' ? (nodes.get(record.uuid)?.index ?? -1) : -1;
    while (next < recovered.length && recovered[next] < at) out.push(records[recovered[next++]]);
    out.push(record);
  }
  for (; next < recovered.length; next++) out.push(records[recovered[next]]);
  return out;
}
