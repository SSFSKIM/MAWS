// The X8 journal (charter §13 X8; C3 execution document, Interfaces "Journal"): every frame in and out of an engine
// process, one row per line `{seq, direction, at, frame}`, one file per process launch under
// `<userData>/engine-host/journal/<appSessionId>/<launchId>.jsonl`. The journal is the source of `EventBase.seq`,
// the input to the replay transport, and what `session.events` reads when its ring no longer holds a range, so a row
// is on disk (a synchronous append) before the host normalises it and `row()` returns exactly the row the file holds:
// the production journal is a faithful record (Reload survival, binding), never redacted. The accepted posture: the
// `spawn` row lists environment key names only, never their values, but journals the argument list verbatim, the
// `--mcp-config` and `--settings` JSON included, and conversation content is kept verbatim, as the engine's own
// transcript under `~/.claude` already keeps it. The probe's redaction is applied only when a journal is exported as a
// fixture (`redactJournal`, test/live/support/live.ts); the writer's `redact` option serves that path and tests.
// Rotation at `maxBytes` continues in `<launchId>.<n>.jsonl` with `seq` continuing; pruning keeps recent launches.
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseJournalRow, type JournalDirection, type JournalRow } from '@shared/wire/journal';

export const JOURNAL_MAX_BYTES = 128 * 1024 * 1024;
export const JOURNAL_KEEP_PER_SESSION = 20;
export const JOURNAL_MAX_AGE_DAYS = 30;

const identity = (line: string) => line;

export class JournalWriter {
  readonly path: string; // the launch's first file
  private current: string;
  private fd: number | null;
  private index = 0;
  private bytes = 0;
  private seq = 0;

  private readonly redact: (line: string) => string;

  // `redact` transforms each serialised line before it is written; production passes none (identity). A writer given
  // a redactor no longer returns what the file holds, which is why only the fixture-export path and tests use one.
  constructor(
    readonly dir: string,
    readonly launchId: string,
    private readonly opts: { maxBytes: number; redact?: (line: string) => string },
  ) {
    this.redact = opts.redact ?? identity;
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${launchId}.jsonl`);
    this.current = this.path;
    this.fd = openSync(this.path, 'a');
  }

  // The file rows go to now (`path`, or the rotation `<launchId>.<n>.jsonl`).
  get currentPath(): string {
    return this.current;
  }

  get lastSeq(): number {
    return this.seq;
  }

  // Appends the row synchronously and returns it; with no redactor the file holds exactly this row. Throws after close.
  row(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.fd === null) throw new Error(`journal ${this.path} is closed`);
    const row: JournalRow = { seq: this.seq + 1, direction, at: new Date().toISOString(), frame };
    const line = this.redact(JSON.stringify(row)) + '\n';
    const length = Buffer.byteLength(line);
    if (this.bytes > 0 && this.bytes + length > this.opts.maxBytes) this.rotate();
    writeSync(this.fd, line);
    this.bytes += length;
    this.seq = row.seq;
    return row;
  }

  private rotate(): void {
    closeSync(this.fd!);
    this.index += 1;
    this.current = join(this.dir, `${this.launchId}.${this.index}.jsonl`);
    this.fd = openSync(this.current, 'a');
    this.bytes = 0;
  }

  async close(): Promise<void> {
    if (this.fd === null) return;
    closeSync(this.fd);
    this.fd = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading

// The host mints eight base32 characters; the reader accepts any id so a hand-named journal (tests, copies) lists too.
const LAUNCH_FILE = /^([A-Za-z0-9_-]+?)(?:\.(\d+))?\.jsonl$/;
const FIRST_ROW_PROBE_BYTES = 256 * 1024;

export interface LaunchFiles {
  launchId: string;
  startedAt: number; // epoch ms of the first row's `at` (spawn), else the base file's mtime
  files: string[]; // base file then rotations in order
}

// The `at` of the first row without reading the whole file (the spawn row can be long; 256 KiB covers it).
function firstRowAt(file: string): number | null {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(FIRST_ROW_PROBE_BYTES);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.toString('utf8', 0, read);
    const nl = text.indexOf('\n');
    const line = nl < 0 ? text : text.slice(0, nl);
    if (line.length === 0) return null;
    const { at } = parseJournalRow(JSON.parse(line));
    const ms = Date.parse(at);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function launchesIn(dir: string): LaunchFiles[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const groups = new Map<string, { base: string | null; rotations: { n: number; file: string }[] }>();
  for (const name of readdirSync(dir)) {
    const match = LAUNCH_FILE.exec(name);
    if (!match) continue;
    const launchId = match[1]!;
    const group = groups.get(launchId) ?? { base: null, rotations: [] };
    if (match[2] === undefined) group.base = join(dir, name);
    else group.rotations.push({ n: Number(match[2]), file: join(dir, name) });
    groups.set(launchId, group);
  }
  const launches: LaunchFiles[] = [];
  for (const [launchId, group] of groups) {
    const rotations = group.rotations.sort((a, b) => a.n - b.n).map((r) => r.file);
    const files = group.base ? [group.base, ...rotations] : rotations;
    const first = files[0]!;
    const startedAt = firstRowAt(first) ?? statSync(first).mtimeMs;
    launches.push({ launchId, startedAt, files });
  }
  return launches.sort((a, b) => a.startedAt - b.startedAt || a.launchId.localeCompare(b.launchId));
}

export class JournalReader {
  // Parsed rows of one file, in order; throws on a row that fails X8.
  static async *rows(path: string): AsyncIterable<JournalRow> {
    const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.length === 0) continue;
      yield parseJournalRow(JSON.parse(line));
    }
  }

  // A session directory's launch files in launch order (by the first row's `at`), each launch's rotations following
  // its base file. Empty for a missing directory.
  static forSession(dir: string): string[] {
    return launchesIn(dir).flatMap((launch) => launch.files);
  }

  // P2-A (2026-10-09): the same listing by launch (X17's recovery folds launch by launch, newest first).
  static launches(dir: string): LaunchFiles[] {
    return launchesIn(dir);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pruning at host start: keep the most recent launches per session and nothing older than the age limit; a session
// directory left empty goes too. Counts launches removed. E10: `keep` names launches never removed whatever their age
// or rank (the rows the host holds, once pruning also runs in a host that has been up for days).
export async function pruneJournals(root: string, opts: { keepPerSession: number; maxAgeDays: number; now?: Date; keep?: ReadonlySet<string> }): Promise<{ removed: number }> {
  if (!existsSync(root) || !statSync(root).isDirectory()) return { removed: 0 };
  const cutoff = (opts.now ?? new Date()).getTime() - opts.maxAgeDays * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const launches = launchesIn(dir).reverse(); // newest first
    launches.forEach((launch, index) => {
      if ((index < opts.keepPerSession && launch.startedAt >= cutoff) || opts.keep?.has(launch.launchId)) return;
      for (const file of launch.files) unlinkSync(file);
      removed += 1;
    });
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
  return { removed };
}

// E10 (E10 execution document, §Design 1 "Long-lived host hygiene"): the detached supervisor outlives the app by days,
// so pruning runs at host start and every 24 h after, keeping every launch the host still holds a row for (`keep`, read
// at each run). A failed run is logged; the next one comes at the next interval. Answers the stop.
export const JOURNAL_PRUNE_EVERY_MS = 24 * 60 * 60_000;

export function scheduleJournalPruning(root: string, opts: { keep: () => ReadonlySet<string>; log: (line: string) => void; everyMs?: number }): () => void {
  const run = () => {
    void (async () => pruneJournals(root, { keepPerSession: JOURNAL_KEEP_PER_SESSION, maxAgeDays: JOURNAL_MAX_AGE_DAYS, keep: opts.keep() }))().catch((error: unknown) =>
      opts.log(`journal pruning failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  };
  run();
  const timer = setInterval(run, opts.everyMs ?? JOURNAL_PRUNE_EVERY_MS);
  (timer as { unref?: () => void }).unref?.(); // the host's own work keeps it alive, never this clock
  return () => clearInterval(timer);
}
