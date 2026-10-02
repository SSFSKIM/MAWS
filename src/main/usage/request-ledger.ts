// The relay's last ten minutes, for the top bar's usage popover (W6, E1): ClaudeUsage's relay writes one JSON line per
// request to `gateway-requests.jsonl` in its data directory (`TelemetryLedger`, Telemetry.swift: `startedAt` as ISO 8601,
// `totalSeconds`, the serving `account`, `outcome`, `firstByteSeconds`, `longestGapSeconds`, `transportRetries`,
// `heldSeconds` and the token `usage`), and its panel summarises the requests that ended in the last ten minutes. MAWS
// keeps the same window by following the file, read only: the first read takes its tail, later reads only what was
// appended since, and a new file under the name (ClaudeUsage rolls it aside at each UTC day, or past 20 MB) is followed
// from its start while the records already held stay until they age out. The followed file stays open across reads, so
// the lines it gained after the last read and before the roll are read from it before the switch (debt wave 7).
import { open, stat, type FileHandle } from 'node:fs/promises';
import { ACTIVITY_WINDOW_MS, type AccountActivity, type UsageActivity } from '@shared/usage/types';

export const FIRST_TAIL_BYTES = 4 * 1024 * 1024; // ten busy minutes are well under this
export const STALL_SECONDS = 10; // TelemetryLedger.stallThreshold: the silence after which Claude Code shows its indicator red

interface Request {
  end: number; // startedAt + totalSeconds, in ms: the window is over when a request ended, as ClaudeUsage prunes
  account: string | null;
  outcome: string;
  usage: { input: number; cacheRead: number; cacheWrite: number } | null;
  firstByte: number | null;
  longestGap: number | null;
  retries: number;
  held: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parse(line: string): Request | null {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null; // a torn line
  }
  if (typeof r !== 'object' || r === null) return null;
  const started = typeof r.startedAt === 'string' ? Date.parse(r.startedAt) : NaN;
  const total = num(r.totalSeconds);
  if (Number.isNaN(started) || total === null || typeof r.outcome !== 'string') return null;
  const u = typeof r.usage === 'object' && r.usage !== null ? (r.usage as Record<string, unknown>) : null;
  return {
    end: started + total * 1000,
    account: typeof r.account === 'string' ? r.account : null,
    outcome: r.outcome,
    usage: u && { input: num(u.input) ?? 0, cacheRead: num(u.cacheRead) ?? 0, cacheWrite: num(u.cacheWrite) ?? 0 },
    firstByte: num(r.firstByteSeconds),
    longestGap: num(r.longestGapSeconds),
    retries: num(r.transportRetries) ?? 0,
    held: (num(r.heldSeconds) ?? 0) > 0,
  };
}

// The nearest-rank percentile of sorted values (TelemetryLedger.percentile).
function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.round(fraction * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]!;
}

// ClaudeUsage's `activity` and `health` over the held requests.
export function summarise(requests: readonly Request[]): UsageActivity {
  const byAccount = new Map<string, { requests: number; last: number; usage: { input: number; cacheRead: number; cacheWrite: number } | null }>();
  for (const r of requests) {
    if (r.outcome !== 'served' || r.account === null) continue;
    const held = byAccount.get(r.account) ?? { requests: 0, last: -Infinity, usage: null };
    held.requests += 1;
    held.last = Math.max(held.last, r.end);
    if (r.usage) held.usage = { input: (held.usage?.input ?? 0) + r.usage.input, cacheRead: (held.usage?.cacheRead ?? 0) + r.usage.cacheRead, cacheWrite: (held.usage?.cacheWrite ?? 0) + r.usage.cacheWrite };
    byAccount.set(r.account, held);
  }
  const accounts: AccountActivity[] = [...byAccount]
    .map(([account, a]) => {
      const prompt = a.usage ? a.usage.input + a.usage.cacheRead + a.usage.cacheWrite : 0;
      return { account, requests: a.requests, cacheHitRatio: a.usage && prompt > 0 ? a.usage.cacheRead / prompt : null, lastServed: new Date(a.last).toISOString() };
    })
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  const firstBytes = requests.flatMap((r) => (r.firstByte === null ? [] : [r.firstByte])).sort((a, b) => a - b);
  const count = (test: (r: Request) => boolean) => requests.reduce((n, r) => n + (test(r) ? 1 : 0), 0);
  return {
    accounts,
    health: {
      requests: requests.length,
      served: count((r) => r.outcome === 'served'),
      firstByteP50: percentile(firstBytes, 0.5),
      firstByteP95: percentile(firstBytes, 0.95),
      stalls: count((r) => (r.longestGap ?? 0) > STALL_SECONDS),
      transportFailures: requests.reduce((n, r) => n + r.retries + (r.outcome === 'unreachable' ? 1 : 0), 0),
      refused: count((r) => r.outcome === 'refused'),
      unreachable: count((r) => r.outcome === 'unreachable'),
      held: count((r) => r.held),
    },
  };
}

interface Followed {
  handle: FileHandle; // open across reads: a roll renames the file, and the handle still reads it
  ino: number;
  offset: number | null; // where the next read starts, always just after a newline; null: from the file's tail
}

export class RequestLedger {
  private requests: Request[] = [];
  private followed: Followed | null = null;

  constructor(private readonly path: string) {}

  // The window as of `now`; null while the file does not exist (the relay has never served from this data directory).
  async read(now: number): Promise<UsageActivity | null> {
    const named = await inodeAt(this.path);
    let rolled = false;
    if (named !== null && this.followed !== null && named !== this.followed.ino) {
      await this.consume(this.followed); // rolled: the old file's last lines, written after the last read, come first
      await this.close();
      rolled = true; // the new file from its start, the held requests kept
    }
    if (named === null) await this.close();
    else if (this.followed === null) {
      try {
        const handle = await open(this.path, 'r');
        this.followed = { handle, ino: (await handle.stat()).ino, offset: rolled ? 0 : null };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (this.followed === null) {
      this.requests = [];
      return null;
    }
    await this.consume(this.followed);
    return this.window(now);
  }

  // Ends the follow (the reader stopped, or the file is gone); a later read starts afresh from the file's tail.
  async close(): Promise<void> {
    const followed = this.followed;
    this.followed = null;
    await followed?.handle.close();
  }

  // What the file gained since the last read, whole lines only: a last line still being written waits for the next read.
  // A first read, or one of a file cut short in place (which forgets what was held), takes the tail, one byte early so a
  // tail starting on a line keeps it, and drops the line the tail cuts.
  private async consume(followed: Followed): Promise<void> {
    const { size } = await followed.handle.stat();
    let tail = false;
    if (followed.offset === null || size < followed.offset) {
      this.requests = [];
      followed.offset = Math.max(0, size - FIRST_TAIL_BYTES - 1);
      tail = followed.offset > 0;
    }
    if (size <= followed.offset) return;
    const buffer = Buffer.alloc(size - followed.offset);
    const { bytesRead } = await followed.handle.read(buffer, 0, buffer.length, followed.offset);
    const chunk = buffer.subarray(0, bytesRead);
    const complete = chunk.lastIndexOf(0x0a) + 1;
    let text = chunk.subarray(0, complete).toString('utf8');
    if (tail) text = text.slice(text.indexOf('\n') + 1);
    for (const line of text.split('\n')) {
      const request = line.trim() === '' ? null : parse(line);
      if (request) this.requests.push(request);
    }
    followed.offset += complete;
  }

  private window(now: number): UsageActivity {
    const cutoff = now - ACTIVITY_WINDOW_MS;
    this.requests = this.requests.filter((r) => r.end >= cutoff);
    return summarise(this.requests);
  }
}

// The inode under the name, or null when nothing is there.
async function inodeAt(path: string): Promise<number | null> {
  try {
    return (await stat(path)).ino;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
