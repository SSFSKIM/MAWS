// The X8 journal (charter §13 X8; C3 execution document, Interfaces "Journal"): every frame in and out of an engine
// process, one row per line `{seq, direction, at, frame}`, one file per process launch under
// `<userData>/engine-host/journal/<appSessionId>/<launchId>.jsonl`. The journal is the source of `EventBase.seq`,
// the input to the replay transport, and what `session.events` reads when its ring no longer holds a range, so a row
// is on disk (a synchronous append) before the host normalises it. Rotation at `maxBytes` continues in
// `<launchId>.<n>.jsonl` with `seq` continuing; redaction is the probe's; pruning keeps the recent launches.
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, rmdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseJournalRow, type JournalDirection, type JournalRow } from '@shared/wire/journal';

export const JOURNAL_MAX_BYTES = 128 * 1024 * 1024;
export const JOURNAL_KEEP_PER_SESSION = 20;
export const JOURNAL_MAX_AGE_DAYS = 30;

// The probe's `redact`: values of environment keys that look secret (8+ characters, longest first so a value that
// contains another is replaced whole), then `sk-ant-…` keys, then e-mail addresses other than local placeholders.
export function createRedactor(env: Record<string, string>): (s: string) => string {
  const secrets = Object.entries(env)
    .filter(([key, value]) => /TOKEN|KEY|SECRET|PASSWORD/i.test(key) && value.length >= 8)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
    return out
      .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[REDACTED]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/g, (m) => (/@(localhost|redacted\.invalid)$/.test(m) ? m : 'owner@redacted.invalid'));
  };
}

export class JournalWriter {
  readonly path: string; // the launch's first file
  private current: string;
  private fd: number | null;
  private index = 0;
  private bytes = 0;
  private seq = 0;

  constructor(
    readonly dir: string,
    readonly launchId: string,
    private readonly opts: { maxBytes: number; redact: (s: string) => string },
  ) {
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

  // Appends the row synchronously and returns it unredacted (the live normaliser reads the row; the file is what a
  // replay reads). Throws after close.
  row(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.fd === null) throw new Error(`journal ${this.path} is closed`);
    const row: JournalRow = { seq: this.seq + 1, direction, at: new Date().toISOString(), frame };
    const line = this.opts.redact(JSON.stringify(row)) + '\n';
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

interface LaunchFiles {
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
}

// ---------------------------------------------------------------------------------------------------------------------
// Pruning at host start: keep the most recent launches per session and nothing older than the age limit; a session
// directory left empty goes too. Counts launches removed.
export async function pruneJournals(root: string, opts: { keepPerSession: number; maxAgeDays: number; now?: Date }): Promise<{ removed: number }> {
  if (!existsSync(root) || !statSync(root).isDirectory()) return { removed: 0 };
  const cutoff = (opts.now ?? new Date()).getTime() - opts.maxAgeDays * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const launches = launchesIn(dir).reverse(); // newest first
    launches.forEach((launch, index) => {
      if (index < opts.keepPerSession && launch.startedAt >= cutoff) return;
      for (const file of launch.files) unlinkSync(file);
      removed += 1;
    });
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  }
  return { removed };
}
