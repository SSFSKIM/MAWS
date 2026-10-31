// The checkpoint of a hosted launch (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §C; D6, D23, D39,
// D44): what the session host's ring may drop, and where an adopter replays from.
//
// The host map is an append-only sidecar beside the launch's journal, `<launchId>.hseq` (rotated with it as
// `<launchId>.<n>.hseq`), one line `<hostSeq> <journalSeq>` appended synchronously *before* the row it names, for every
// `in`, `stderr` and `parse_error` row of a hosted record; `<hostSeq> -` retracts the record's earlier lines (its row's
// append failed, so the journal sequence belongs to whatever row lands next); `<hostSeq> *` says every sequence at or
// below it is accounted for (M3's gap reseed). The journal's rows are unchanged, so a build before O16 still reads a
// hosted launch's journal. No record is ever identified by its content: two identical stderr lines are two records.
//
// The frontier is the greatest host sequence at or below which every record is journaled (its map line and its row
// both on disk, or no row to write, D44); the session reports each record as it is journaled, and the frontier is
// acknowledged to the host coalesced, so the ring's unacknowledged bytes stay near zero at idle and an ack never covers
// a record held behind an in-flight write while later ones were journaled.
import { closeSync, existsSync, fchmodSync, openSync, readdirSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const MAP_FILE_MODE = 0o600;

// The map file beside a journal file: `<launchId>(.<n>)?.jsonl` → `<launchId>(.<n>)?.hseq`.
export function mapFileOf(journalFile: string): string {
  return journalFile.replace(/\.jsonl$/, '.hseq');
}

// The writing side, owned by the session: each line goes to the map file of the journal file the row goes to now.
export class HostMap {
  private fd: number | null = null;
  private path: string | null = null;

  line(hostSeq: number, journalSeq: number, journalFile: string): void {
    this.append(`${hostSeq} ${journalSeq}\n`, journalFile);
  }

  retract(hostSeq: number, journalFile: string): void {
    this.append(`${hostSeq} -\n`, journalFile);
  }

  lost(hostSeq: number, journalFile: string): void {
    this.append(`${hostSeq} *\n`, journalFile);
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    this.path = null;
  }

  private append(text: string, journalFile: string): void {
    const path = mapFileOf(journalFile);
    if (path !== this.path) {
      this.close();
      const fd = openSync(path, 'a', MAP_FILE_MODE);
      try {
        fchmodSync(fd, MAP_FILE_MODE);
      } catch (error) {
        closeSync(fd);
        throw error;
      }
      this.fd = fd;
      this.path = path;
    }
    writeSync(this.fd!, text);
  }
}

export const ACK_EVERY_MS = 50;
export const ACK_EVERY_RECORDS = 64;

// The in-memory side, owned by the hosted transport: the contiguous frontier and its coalesced acks (at most one per
// ACK_EVERY_MS or ACK_EVERY_RECORDS records; `flush` at each write's settle).
export class Frontier {
  private frontier: number;
  private acked: number;
  private readonly above = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: { start?: number; ack: (seq: number) => void; everyMs?: number; everyRecords?: number }) {
    this.frontier = opts.start ?? 0;
    this.acked = this.frontier;
  }

  get value(): number {
    return this.frontier;
  }

  // Every record at or below `seq` is journaled.
  reached(seq: number): boolean {
    return this.frontier >= seq;
  }

  journaled(seq: number): void {
    if (seq <= this.frontier) return;
    this.above.add(seq);
    while (this.above.delete(this.frontier + 1)) this.frontier += 1;
    if (this.frontier === this.acked) return;
    if (this.frontier - this.acked >= (this.opts.everyRecords ?? ACK_EVERY_RECORDS)) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), this.opts.everyMs ?? ACK_EVERY_MS);
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.frontier === this.acked) return;
    this.acked = this.frontier;
    this.opts.ack(this.frontier);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The adopter's read (M3)

const MAP_FILE = /^(.+?)(?:\.(\d+))?\.hseq$/;

// The launch's map files, base then rotations in order.
function mapFiles(dir: string, launchId: string): string[] {
  if (!existsSync(dir)) return [];
  const found: { n: number; path: string }[] = [];
  for (const name of readdirSync(dir)) {
    const match = MAP_FILE.exec(name);
    if (match?.[1] !== launchId) continue;
    found.push({ n: match[2] === undefined ? 0 : Number(match[2]) + 1, path: join(dir, name) });
  }
  return found.sort((a, b) => a.n - b.n).map((f) => f.path);
}

// The file cut back to its last newline, so a torn last line (a crash mid-append) never stays as an interior line.
function truncateTorn(path: string): string {
  const text = readFileSync(path, 'utf8');
  const end = text.lastIndexOf('\n') + 1;
  if (end === text.length) return text;
  truncateSync(path, Buffer.byteLength(text.slice(0, end)));
  return text.slice(0, end);
}

// Every map file of the launch, the torn tail truncated; a line whose journal sequence is past the journal's last row
// (its row never landed) dropped and retracted in the map, so a sequence the resumed writer reuses never matches it at a
// later read; a lost-range line accounting for every sequence at or below it.
export function readCheckpoint(dir: string, launchId: string, journalLastSeq: number): { frontier: number; above: number[] } {
  const files = mapFiles(dir, launchId);
  const mapped = new Map<number, number>();
  let lost = 0;
  for (const file of files) {
    for (const line of truncateTorn(file).split('\n')) {
      const [h, j] = line.split(' ');
      const hostSeq = Number(h);
      if (!line || !Number.isInteger(hostSeq) || j === undefined) continue;
      if (j === '-') mapped.delete(hostSeq);
      else if (j === '*') lost = Math.max(lost, hostSeq);
      else if (/^\d+$/.test(j)) mapped.set(hostSeq, Number(j));
    }
  }
  const stale = [...mapped].filter(([, journalSeq]) => journalSeq > journalLastSeq).map(([hostSeq]) => hostSeq);
  if (stale.length > 0) {
    const last = files.at(-1)!;
    const map = new HostMap();
    try {
      for (const hostSeq of stale) map.retract(hostSeq, join(dirname(last), basename(last).replace(/\.hseq$/, '.jsonl')));
    } finally {
      map.close();
    }
    for (const hostSeq of stale) mapped.delete(hostSeq);
  }
  let frontier = lost;
  while (mapped.has(frontier + 1)) frontier += 1;
  const above = [...mapped.keys()].filter((seq) => seq > frontier).sort((a, b) => a - b);
  return { frontier, above };
}
