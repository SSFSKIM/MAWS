// The recorded state of a session's system prompt (the P2-C document, Design §2, item 2; U2): the engine writes each
// rendered system prompt into the transcript as an `attachment` of type `prompt_snapshot`, and a later launch reuses the
// last one after the last compact boundary instead of rendering. MAWS's appended contract is that snapshot's segment
// opening with the contract's header; an output style never reaches it (U2 run 6). So the state is `contract:<n>`, `none`
// (a snapshot without the contract) or `unrecorded` (no snapshot after the last boundary, or no readable transcript).
//
// The read scans from the end of the file in chunks for the two record types and stops at the first it meets: a snapshot
// is the answer, a boundary means nothing after it was recorded. The answer is kept per path with the offset it covers
// (the end of the last whole line), so a later launch scans only what the engine appended since; a file that shrank is
// read again from the start. A last line still being written is left for the next read.
//
// P2-C M4: the same backward line reader answers the transcript's evidence that the engine took a prompt
// (`transcriptEvidence`, Design §6) and what a rewind took off the chain (`transcriptChain`, Design §5).
import { open } from 'node:fs/promises';
import type { MessageUuid } from '@shared/graph/ids';
import { CONTRACT_HEADER } from '@shared/owner/contract';

export type RecordedState = 'unrecorded' | `contract:${number}` | 'none';

// The header up to its version number.
const HEADER_PREFIX = CONTRACT_HEADER(-1).split('-1')[0]!;

// `contract:<n>` when a segment opens with the header line of contract n, else `none`.
export function classifySnapshot(systemPrompt: unknown): RecordedState {
  if (!Array.isArray(systemPrompt)) return 'none';
  for (const segment of systemPrompt) {
    if (typeof segment !== 'string' || !segment.startsWith(HEADER_PREFIX)) continue;
    const version = Number(/^\d+/.exec(segment.slice(HEADER_PREFIX.length))?.[0] ?? NaN);
    const header = CONTRACT_HEADER(version);
    if (Number.isInteger(version) && (segment === header || segment.startsWith(`${header}\n`))) return `contract:${version}`;
  }
  return 'none';
}

// The last of the two record types in a line, if the line is one: a snapshot classified, or the boundary.
type Found = { kind: 'snapshot'; state: RecordedState } | { kind: 'boundary' };
const SNAPSHOT_TEXT = Buffer.from('"prompt_snapshot"');
const BOUNDARY_TEXT = Buffer.from('"compact_boundary"');

function recordOf(line: Buffer): Found | null {
  // a cheap byte test first: only a line naming either type is parsed
  if (!line.includes(SNAPSHOT_TEXT) && !line.includes(BOUNDARY_TEXT)) return null;
  let record: unknown;
  try {
    record = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null) return null;
  const r = record as { type?: unknown; subtype?: unknown; attachment?: { type?: unknown; systemPrompt?: unknown } | null };
  if (r.type === 'system' && r.subtype === 'compact_boundary') return { kind: 'boundary' };
  if (r.type === 'attachment' && typeof r.attachment === 'object' && r.attachment !== null && r.attachment.type === 'prompt_snapshot') {
    return { kind: 'snapshot', state: classifySnapshot(r.attachment.systemPrompt) };
  }
  return null;
}

const toState = (found: Found | null): RecordedState => (found === null || found.kind === 'boundary' ? 'unrecorded' : found.state);

export class PromptStateReader {
  private readonly chunkBytes: number;
  private readonly cache = new Map<string, { covered: number; found: Found | null }>();

  constructor(opts: { chunkBytes?: number } = {}) {
    this.chunkBytes = opts.chunkBytes ?? 1024 * 1024;
  }

  async recordedState(path: string): Promise<RecordedState> {
    let file;
    try {
      file = await open(path, 'r');
    } catch {
      return 'unrecorded';
    }
    try {
      const { size } = await file.stat();
      const cached = this.cache.get(path);
      const from = cached !== undefined && cached.covered <= size ? cached.covered : 0;
      const scan = await this.scan(file, from, size);
      const found = scan.found ?? (from > 0 ? cached!.found : null);
      this.cache.set(path, { covered: scan.covered, found });
      return toState(found);
    } catch {
      return 'unrecorded';
    } finally {
      await file.close();
    }
  }

  // P2-C M4 (Design §6, the transcript's evidence): the first of `uuids` the engine took, read back from the transcript,
  // or null. A prompt it took leaves a record carrying the prompt's uuid: a `user` record (an idle prompt) or a
  // `queued_command` attachment's `source_uuid` (a `next` steer folded mid-turn); a steer it cancelled leaves none (M4's
  // probe, pass3/p2-to-human-steer-cancel-disk). Read backwards, where recent prompts are; only a line holding one of
  // the uuids is parsed. Uncached: it is asked rarely (an exit's uncertain submission, a recovery the journals could not
  // settle) and for uuids no earlier scan looked for. A transcript that cannot be read (missing, or failing mid-read)
  // rejects: it says nothing of the prompt, and null would read as "not taken" (the service waits and reads again).
  async transcriptEvidence(path: string, uuids: readonly MessageUuid[]): Promise<MessageUuid | null> {
    if (uuids.length === 0) return null;
    const needles = uuids.map((uuid) => Buffer.from(uuid));
    const file = await open(path, 'r');
    try {
      let taken: MessageUuid | null = null;
      await this.linesBackwards(file, 0, (await file.stat()).size, (line) => {
        if (!needles.some((needle) => line.includes(needle))) return false;
        const uuid = takenPromptOf(line);
        if (uuid === null || !uuids.includes(uuid)) return false;
        taken = uuid;
        return true;
      });
      return taken;
    } finally {
      await file.close();
    }
  }

  // P2-C M4 (Design §5, a rewind): the uuids of the record `uuid` and of every record below it on the transcript's chain
  // (its `parentUuid` links, and a compact boundary's `logicalParentUuid`), or null when no record has that uuid or the
  // file cannot be read. The transcript only grows, and a rewind leaves the branch it cut in the file (the next prompt
  // hangs from the message the rewind kept, rewind-real): so this is what a rewind to `uuid` took off the chain. Read
  // whole, and only when main has no memory of the rewind's target (a restart, an evicted entry).
  async transcriptChain(path: string, uuid: string): Promise<Set<string> | null> {
    let file;
    try {
      file = await open(path, 'r');
    } catch {
      return null;
    }
    try {
      const children = new Map<string, string[]>();
      let found = false;
      await this.linesBackwards(file, 0, (await file.stat()).size, (line) => {
        if (!line.includes(PARENT_TEXT)) return false;
        const link = linkOf(line);
        if (link === null) return false;
        if (link.uuid === uuid) found = true;
        for (const parent of link.parents) children.set(parent, [...(children.get(parent) ?? []), link.uuid]);
        return false;
      });
      if (!found) return null;
      const below = new Set([uuid]);
      for (const member of below) for (const child of children.get(member) ?? []) below.add(child);
      return below;
    } catch {
      return null;
    } finally {
      await file.close();
    }
  }

  private async scan(file: FileHandle, from: number, to: number): Promise<{ found: Found | null; covered: number }> {
    let found: Found | null = null;
    const covered = await this.linesBackwards(file, from, to, (line) => (found = recordOf(line)) !== null);
    return { found, covered };
  }

  // Visits the whole lines of [from, to) from the last to the first, in chunks, until `visit` answers true. Answers the
  // offset just past the region's last newline (or `from` when it has none): the bytes after it are a line still being
  // written, never visited (and left out of the cache).
  private async linesBackwards(file: FileHandle, from: number, to: number, visit: (line: Buffer) => boolean): Promise<number> {
    let covered: number | null = null;
    let end = to;
    let carry = Buffer.alloc(0); // the start of a line whose end the previous (later) chunk held
    while (end > from) {
      const start = Math.max(from, end - this.chunkBytes);
      const chunk = Buffer.alloc(end - start);
      await file.read(chunk, 0, chunk.length, start);
      const data = Buffer.concat([chunk, carry]);
      let lineEnd = data.length;
      for (let i = data.length - 1; i >= 0; i -= 1) {
        if (data[i] !== 0x0a) continue;
        if (covered === null) covered = start + i + 1; // the last newline in the region
        else if (visit(data.subarray(i + 1, lineEnd))) return covered;
        lineEnd = i;
      }
      carry = data.subarray(0, lineEnd);
      end = start;
    }
    if (covered === null) return from; // no whole line in the region
    // the region's first line: whole when the region starts at a line boundary, which every cached offset is
    visit(carry);
    return covered;
  }
}

type FileHandle = Awaited<ReturnType<typeof open>>;

// The prompt uuid a transcript line proves the engine took: a `user` record's own, or a `queued_command` attachment's
// `source_uuid`; null for any other line (a queue operation, a file-history snapshot, another attachment).
function takenPromptOf(line: Buffer): MessageUuid | null {
  let record: unknown;
  try {
    record = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null) return null;
  const r = record as { type?: unknown; uuid?: unknown; attachment?: { type?: unknown; source_uuid?: unknown } | null };
  if (r.type === 'user' && typeof r.uuid === 'string') return r.uuid as MessageUuid;
  if (r.type === 'attachment' && r.attachment?.type === 'queued_command' && typeof r.attachment.source_uuid === 'string') return r.attachment.source_uuid as MessageUuid;
  return null;
}

// A chain record's uuid and the uuids it hangs from, or null for a line that is not one.
const PARENT_TEXT = Buffer.from('"parentUuid"');
function linkOf(line: Buffer): { uuid: string; parents: string[] } | null {
  let record: unknown;
  try {
    record = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof record !== 'object' || record === null) return null;
  const r = record as { uuid?: unknown; parentUuid?: unknown; logicalParentUuid?: unknown };
  if (typeof r.uuid !== 'string') return null;
  return { uuid: r.uuid, parents: [r.parentUuid, r.logicalParentUuid].filter((p): p is string => typeof p === 'string') };
}

const reader = new PromptStateReader();

// The recorded state of the transcript at `path`, through the one cached tail scan.
export function recordedState(path: string): Promise<RecordedState> {
  return reader.recordedState(path);
}

// The first of `uuids` the transcript at `path` shows the engine took, or null (Design §6); rejects when the file cannot
// be read.
export function transcriptEvidence(path: string, uuids: readonly MessageUuid[]): Promise<MessageUuid | null> {
  return reader.transcriptEvidence(path, uuids);
}

// The uuids at and below `uuid` on the chain of the transcript at `path`, or null (a rewind's reach).
export function transcriptChain(path: string, uuid: string): Promise<Set<string> | null> {
  return reader.transcriptChain(path, uuid);
}
