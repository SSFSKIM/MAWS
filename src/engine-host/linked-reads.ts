// P4-A3 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md, lever 2): a human message that links artifacts
// carries their reads (`@shared/maws/linked-read`), attached here as the message is written to the engine, so each read
// is the artifact as it is at send time. Each linked artifact is read once through the session's own `artifact_read`
// (its answer, whole), in link order, and attached while the reads' total stays within the cap; a read refused or above
// what is left is not attached, and the agent reads it as it would have. The message the queue keeps and shows is the
// human's: the reads go only into the frame.
import { estimateTokens, LINKED_READ_CAP_TOKENS, linkedArtifacts, linkedReadBlock, type LinkedArtifact } from '@shared/maws/linked-read';
import type { SendContent } from '@shared/engine/session-state-store';

export interface LinkedReadOutcome {
  content: SendContent;
  attached: { artifactId: string; revision: number; tokens: number }[];
  skipped: { artifactId: string; why: 'refused' | 'over the cap' }[];
}

// `read` answers the read tool's result text, or null when the tool refused it (no such artifact, not readable here).
export async function withLinkedReads(content: SendContent, read: (link: LinkedArtifact) => Promise<string | null>, cap = LINKED_READ_CAP_TOKENS): Promise<LinkedReadOutcome> {
  const links = linkedArtifacts(content);
  const outcome: LinkedReadOutcome = { content, attached: [], skipped: [] };
  if (links.length === 0) return outcome;
  const blocks: string[] = [];
  let used = 0;
  for (const link of links) {
    const text = await read(link);
    const block = text === null ? null : blockOf(text);
    if (block === null) {
      outcome.skipped.push({ artifactId: link.artifactId, why: 'refused' });
      continue;
    }
    const tokens = estimateTokens(block.text);
    if (used + tokens > cap) {
      outcome.skipped.push({ artifactId: link.artifactId, why: 'over the cap' });
      continue;
    }
    used += tokens;
    blocks.push(block.text);
    outcome.attached.push({ artifactId: link.artifactId, revision: block.revision, tokens });
  }
  if (blocks.length === 0) return outcome;
  const reads = blocks.map((text) => ({ type: 'text' as const, text }));
  outcome.content = typeof content === 'string' ? [{ type: 'text', text: content }, ...reads] : [...content, ...reads];
  return outcome;
}

function blockOf(text: string): { text: string; revision: number } | null {
  try {
    const revision = (JSON.parse(text) as { status?: unknown; revision?: unknown }).revision;
    return typeof revision === 'number' ? { text: linkedReadBlock(text), revision } : null;
  } catch {
    return null; // not a read answer (linkedReadBlock refuses one that is not of status read)
  }
}
