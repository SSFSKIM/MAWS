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
import { open } from 'node:fs/promises';
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

  // Reads [from, to) backwards in chunks. `covered` is the offset just past the region's last newline (or `from` when it
  // has none): the bytes after it are a line still being written, left out of the answer and of the cache.
  private async scan(file: Awaited<ReturnType<typeof open>>, from: number, to: number): Promise<{ found: Found | null; covered: number }> {
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
        else {
          const found = recordOf(data.subarray(i + 1, lineEnd));
          if (found !== null) return { found, covered };
        }
        lineEnd = i;
      }
      carry = data.subarray(0, lineEnd);
      end = start;
    }
    if (covered === null) return { found: null, covered: from }; // no whole line in the region
    // the region's first line: whole when the region starts at a line boundary, which every cached offset is
    return { found: recordOf(carry), covered };
  }
}

const reader = new PromptStateReader();

// The recorded state of the transcript at `path`, through the one cached tail scan.
export function recordedState(path: string): Promise<RecordedState> {
  return reader.recordedState(path);
}
