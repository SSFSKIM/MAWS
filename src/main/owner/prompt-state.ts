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
// (`transcriptEvidence`, Design §6).
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
  // settle) and for uuids no earlier scan looked for.
  async transcriptEvidence(path: string, uuids: readonly MessageUuid[]): Promise<MessageUuid | null> {
    if (uuids.length === 0) return null;
    const needles = uuids.map((uuid) => Buffer.from(uuid));
    let file;
    try {
      file = await open(path, 'r');
    } catch {
      return null;
    }
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

const reader = new PromptStateReader();

// The recorded state of the transcript at `path`, through the one cached tail scan.
export function recordedState(path: string): Promise<RecordedState> {
  return reader.recordedState(path);
}

// The first of `uuids` the transcript at `path` shows the engine took, or null (Design §6).
export function transcriptEvidence(path: string, uuids: readonly MessageUuid[]): Promise<MessageUuid | null> {
  return reader.transcriptEvidence(path, uuids);
}
