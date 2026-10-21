// P4-A3 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md, lever 2): a human message the queue submits carries
// the reads of the artifacts its words link (`@shared/maws/linked-read`), taken as the queue submits it, so each read is
// the artifact as it is at send time. Each linked artifact is read once through the session's own `artifact_read` (its
// answer, whole), in link order, and attached while the reads' total stays within the cap; a read refused or above what
// is left is not attached, the session's memory of the artifact put back as it was (`read`'s side), and the agent reads
// it as it would have. The reads attached keep their effects only if the frame carrying them is written (`settle`). The
// message the queue keeps and shows is the human's: the reads go only into the frame.
import { LINKED_READ_CAP_BYTES, linkedArtifacts, linkedReadBlock, utf8Bytes, type LinkedArtifact } from '@shared/maws/linked-read';
import type { SendContent } from '@shared/engine/session-state-store';

export type Admission = { ok: true; block: string; revision: number; bytes: number } | { ok: false; why: 'refused' | 'over the cap' };
// What the reader answers: the admission, and for a read admitted, what undoes its effects if its frame is not written.
export type ReadAnswer = Admission & { undo?: () => void };

export interface LinkedReadOutcome {
  content: SendContent;
  attached: { artifactId: string; revision: number; bytes: number }[];
  skipped: { artifactId: string; why: 'refused' | 'over the cap' }[];
  // the attached reads' effects kept (the frame carrying them was written) or undone, latest first (it was not)
  settle(written: boolean): void;
}

// `read` reads the link and asks `admit` of its answer (the read tool's result text, or null when the tool refused it)
// before keeping what the read changed: a read `admit` refuses must leave the session as it found it.
export type LinkedReader = (link: LinkedArtifact, admit: (text: string | null) => Admission) => Promise<ReadAnswer>;

export async function withLinkedReads(content: SendContent, read: LinkedReader, cap = LINKED_READ_CAP_BYTES): Promise<LinkedReadOutcome> {
  const links = linkedArtifacts(content);
  const undos: (() => void)[] = [];
  const outcome: LinkedReadOutcome = {
    content, attached: [], skipped: [],
    settle: (written) => {
      if (!written) for (const undo of undos.reverse()) undo();
    },
  };
  if (links.length === 0) return outcome;
  const blocks: string[] = [];
  let used = 0;
  for (const link of links) {
    const admitted = await read(link, (text) => {
      const block = text === null ? null : blockOf(text);
      if (block === null) return { ok: false, why: 'refused' };
      const bytes = utf8Bytes(block.text);
      return used + bytes > cap ? { ok: false, why: 'over the cap' } : { ok: true, block: block.text, revision: block.revision, bytes };
    });
    if (!admitted.ok) {
      outcome.skipped.push({ artifactId: link.artifactId, why: admitted.why });
      continue;
    }
    used += admitted.bytes;
    if (admitted.undo) undos.push(admitted.undo);
    blocks.push(admitted.block);
    outcome.attached.push({ artifactId: link.artifactId, revision: admitted.revision, bytes: admitted.bytes });
  }
  if (blocks.length === 0) return outcome;
  const reads = blocks.map((text) => ({ type: 'text' as const, text }));
  outcome.content = typeof content === 'string' ? [{ type: 'text', text: content }, ...reads] : [...content, ...reads];
  return outcome;
}

function blockOf(text: string): { text: string; revision: number } | null {
  try {
    const revision = (JSON.parse(text) as { revision?: unknown }).revision;
    return typeof revision === 'number' ? { text: linkedReadBlock(text), revision } : null;
  } catch {
    return null; // not a read answer (linkedReadBlock refuses one that is not of status read)
  }
}
