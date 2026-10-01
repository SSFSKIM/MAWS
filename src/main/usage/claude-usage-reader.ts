// The account usage MAWS shows in the status line, read from ClaudeUsage's own files (C7 execution document, Interfaces
// "Status line popovers and usage"; D-17, D-19): the relay exposes no usage endpoint, so its files are the only local
// source. Main reads them once for every session and answers `settings.usage`; a change emits `settings.usageChanged`.
// Files, read only: `accounts.json` (an array of accounts), `pins.json` (`{ drainTarget, drainTargetIsManual, pins:
// { [engineSessionId]: { accountUUID, lastUsed } } }`) and `history/<accountUuid>.jsonl` (`{ limitKey, percent,
// recordedAt, resetsAt }` per line; `session` is the 5-hour window, `weekly_all` the week, `weekly_scoped#<Model>` a
// model's week), of which the newest row per key in the last 64 KiB counts, as ClaudeUsage's own HistoryStore keeps it.
// The directory and `history/` are watched (non-recursive, 500 ms trailing debounce) with a 60 s re-read floor.
// W6 (E1): the top bar's copy of ClaudeUsage's panel also reads `gateway.json` (the routing toggle's state and the port),
// `codex-accounts.json` with the per-model `codex-pins.<model>.json` (the Codex accounts and their drain target), and
// follows `gateway-requests.jsonl` for the last ten minutes of requests (`request-ledger.ts`). Still read only.
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountUsage, UsageActivity, UsageCodex, UsageGateway, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { jsonLines, readTail } from '../files/read-tail';
import { RequestLedger } from './request-ledger';

export const HISTORY_TAIL_BYTES = 64 * 1024;
export const DEBOUNCE_MS = 500;
export const FLOOR_MS = 60_000;

export function claudeUsageDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.MAWS_CLAUDE_USAGE_DIR || join(home, 'Library', 'Application Support', 'ClaudeUsage');
}

export interface ClaudeUsageReaderOptions {
  dir: string;
  emit: (snapshot: UsageSnapshot) => void; // settings.usageChanged
  log?: (message: string) => void;
  debounceMs?: number;
  floorMs?: number;
  now?: () => number; // W6: the clock of `readAt` and of the requests' ten-minute window
}

type Account = Omit<AccountUsage, 'pinnedSessionCount'>;
// What the files said at the last read; `pinsFor` is computed per answer from `pins`.
interface Read {
  available: boolean;
  error: string | null;
  readAt: string;
  drainTarget: string | null;
  drainTargetIsManual: boolean;
  accounts: Account[];
  pins: Map<string, string>; // engine session id → account uuid
  // W6 start
  gateway: UsageGateway | null;
  codex: UsageCodex | null;
  activity: UsageActivity | null;
  // W6 end
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class ClaudeUsageReader {
  private last: Read | null = null;
  private reading: Promise<Read> | null = null;
  private asked: string[] = []; // the engine session ids the last `settings.usage` named
  private lastEmitted: string | null = null;
  private watchers: FSWatcher[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private floor: ReturnType<typeof setInterval> | null = null;
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private readonly requests: RequestLedger;

  constructor(private readonly opts: ClaudeUsageReaderOptions) {
    this.log = opts.log ?? ((message) => console.warn(`[claude-usage] ${message}`));
    this.now = opts.now ?? Date.now;
    this.requests = new RequestLedger(join(opts.dir, 'gateway-requests.jsonl'));
  }

  // Reads once, then follows the files until `stop`.
  start(): void {
    void this.refresh();
    this.arm();
    this.floor = setInterval(() => {
      if (this.watchers.length < 2) this.arm(); // the directory (or history/) may have appeared since
      void this.refresh();
    }, this.opts.floorMs ?? FLOOR_MS);
    (this.floor as { unref?: () => void }).unref?.();
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.debounce) clearTimeout(this.debounce);
    if (this.floor) clearInterval(this.floor);
    this.debounce = null;
    this.floor = null;
  }

  // `settings.usage`: the snapshot with `pinsFor` for these ids, which later `settings.usageChanged` events also carry.
  async snapshot(engineSessionIds: string[]): Promise<UsageSnapshot> {
    this.asked = [...engineSessionIds];
    const read = this.last ?? (await this.read());
    const snapshot = this.compose(read);
    this.lastEmitted = signature(snapshot); // what the caller now holds: only a change from it is an event
    return snapshot;
  }

  // C11 start: whether ClaudeUsage's files are there (settings.claudeUsage.status's dataDirPresent): the last read, or one
  // read if none has run; never a caller of settings.usage, so the ids it named and what it was last sent stay as they are
  async available(): Promise<boolean> {
    return (this.last ?? (await this.read())).available;
  }
  // C11 end

  // Re-reads the files and emits when the snapshot differs from the last one published (the read time aside).
  async refresh(): Promise<void> {
    const snapshot = this.compose(await this.read());
    const sig = signature(snapshot);
    if (sig === this.lastEmitted) return;
    const first = this.lastEmitted === null;
    this.lastEmitted = sig;
    if (first) return; // the first read is an answer, not a change
    try {
      this.opts.emit(snapshot);
    } catch (error) {
      this.log(`usageChanged not emitted: ${messageOf(error)}`);
    }
  }

  private arm(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const dir of [this.opts.dir, join(this.opts.dir, 'history')]) {
      try {
        const watcher = watch(dir, { persistent: false }, () => this.schedule());
        watcher.on('error', (error) => this.log(`watch ${dir}: ${messageOf(error)}`));
        this.watchers.push(watcher);
      } catch {
        /* absent for now: the floor re-arms */
      }
    }
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.refresh();
    }, this.opts.debounceMs ?? DEBOUNCE_MS);
  }

  private compose(read: Read): UsageSnapshot {
    const counts = new Map<string, number>();
    for (const account of read.pins.values()) counts.set(account, (counts.get(account) ?? 0) + 1);
    const pinsFor: Record<string, string> = {};
    for (const id of this.asked) {
      const account = read.pins.get(id);
      if (account !== undefined) pinsFor[id] = account;
    }
    return {
      available: read.available, dataDir: this.opts.dir, readAt: read.readAt, error: read.error, drainTarget: read.drainTarget, drainTargetIsManual: read.drainTargetIsManual,
      accounts: read.accounts.map((account) => ({ ...account, pinnedSessionCount: counts.get(account.uuid) ?? 0 })), pinsFor,
      gateway: read.gateway, codex: read.codex, activity: read.activity, // W6
    };
  }

  // One read at a time; a read asked for while one runs gets that one's answer.
  private read(): Promise<Read> {
    this.reading ??= this.readFiles().finally(() => (this.reading = null));
    return this.reading;
  }

  private async readFiles(): Promise<Read> {
    const now = this.now();
    const readAt = new Date(now).toISOString();
    const previous = this.last;
    const absent = (error: string): Read => ({ available: false, error, readAt, drainTarget: null, drainTargetIsManual: false, accounts: [], pins: new Map(), gateway: null, codex: null, activity: null });
    try {
      await stat(this.opts.dir);
    } catch {
      return (this.last = absent(`ClaudeUsage is not installed or has no data at ${this.opts.dir}`));
    }

    let accounts: Omit<Account, 'windows'>[];
    try {
      accounts = parseAccounts(JSON.parse(await readFile(join(this.opts.dir, 'accounts.json'), 'utf8')));
    } catch (error) {
      // a torn write keeps what the last good read said; with nothing before, there is no data yet
      if (previous?.available) return (this.last = { ...previous, readAt });
      return (this.last = absent(`ClaudeUsage has no readable accounts.json at ${this.opts.dir}: ${messageOf(error)}`));
    }

    let pins: Pick<Read, 'drainTarget' | 'drainTargetIsManual' | 'pins'>;
    try {
      pins = parsePins(JSON.parse(await readFile(join(this.opts.dir, 'pins.json'), 'utf8')));
    } catch (error) {
      // a torn pins.json keeps the previous pins until the next change (as C4 does for sidecars)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`pins.json unreadable, keeping the previous pins: ${messageOf(error)}`);
      pins = previous ? { drainTarget: previous.drainTarget, drainTargetIsManual: previous.drainTargetIsManual, pins: previous.pins } : { drainTarget: null, drainTargetIsManual: false, pins: new Map() };
    }

    const withWindows = await Promise.all(accounts.map(async (account) => ({ ...account, windows: await this.windowsOf(account.uuid) })));
    // W6 start
    const [gateway, codex, activity] = await Promise.all([
      this.optional('gateway.json', previous?.gateway ?? null, async () => parseGateway(JSON.parse(await readFile(join(this.opts.dir, 'gateway.json'), 'utf8')))),
      this.optional('codex-accounts.json', previous?.codex ?? null, () => this.codexOf()),
      this.optional('gateway-requests.jsonl', previous?.activity ?? null, () => this.requests.read(now)),
    ]);
    return (this.last = { available: true, error: null, readAt, ...pins, accounts: withWindows, gateway, codex, activity });
    // W6 end
  }

  // W6 start: a file the popover shows beside the accounts. Absent is null; unreadable or torn keeps what the last good
  // read said, as pins.json does.
  private async optional<T>(name: string, previous: T | null, read: () => Promise<T | null>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      this.log(`${name} unreadable, keeping the previous reading: ${messageOf(error)}`);
      return previous;
    }
  }

  // The Codex accounts, and their drain target as ClaudeUsage's Codex section takes it (NativeCodexGateway.swift
  // `currentAccount`): every model routes on its own pins file, and the target is the one account they all name.
  private async codexOf(): Promise<UsageCodex> {
    const accounts = parseCodexAccounts(JSON.parse(await readFile(join(this.opts.dir, 'codex-accounts.json'), 'utf8')));
    const names = (await readdir(this.opts.dir)).filter((name) => /^codex-pins(\..+)?\.json$/.test(name)).sort();
    const files = (
      await Promise.all(
        names.map(async (name) => {
          try {
            return [parsePins(JSON.parse(await readFile(join(this.opts.dir, name), 'utf8')))];
          } catch (error) {
            this.log(`${name} unreadable, left out: ${messageOf(error)}`);
            return [];
          }
        }),
      )
    ).flat();
    const counts = new Map<string, number>();
    for (const file of files) for (const account of file.pins.values()) counts.set(account, (counts.get(account) ?? 0) + 1);
    const targets = new Set(files.flatMap((file) => (file.drainTarget === null ? [] : [file.drainTarget])));
    const drainTarget = targets.size === 1 ? [...targets][0]! : null;
    return {
      accounts: accounts.map((account) => ({ ...account, pinnedSessionCount: counts.get(account.accountId) ?? 0 })),
      drainTarget,
      drainTargetIsManual: drainTarget !== null && files.every((file) => file.drainTarget !== drainTarget || file.drainTargetIsManual),
    };
  }
  // W6 end

  private async windowsOf(uuid: string): Promise<Account['windows']> {
    const newest = new Map<string, UsageWindow>();
    let text: string | null = null;
    try {
      text = await readTail(join(this.opts.dir, 'history', `${uuid}.jsonl`), HISTORY_TAIL_BYTES);
    } catch (error) {
      this.log(`history of ${uuid} unreadable: ${messageOf(error)}`);
    }
    for (const row of jsonLines(text ?? '')) {
      const r = row as { limitKey?: unknown; percent?: unknown; recordedAt?: unknown; resetsAt?: unknown };
      if (typeof r.limitKey !== 'string' || typeof r.percent !== 'number' || typeof r.recordedAt !== 'string' || typeof r.resetsAt !== 'string') continue;
      const held = newest.get(r.limitKey);
      if (!held || r.recordedAt >= held.recordedAt) newest.set(r.limitKey, { percent: r.percent, resetsAt: r.resetsAt, recordedAt: r.recordedAt });
    }
    const scoped = [...newest]
      .filter(([key]) => key.startsWith('weekly_scoped#'))
      .map(([key, window]) => ({ model: key.slice('weekly_scoped#'.length), window }))
      .sort((a, b) => a.model.localeCompare(b.model));
    return { fiveHour: newest.get('session') ?? null, sevenDay: newest.get('weekly_all') ?? null, scoped };
  }
}

function parseAccounts(value: unknown): Omit<Account, 'windows'>[] {
  if (!Array.isArray(value)) throw new Error('accounts.json is not an array');
  return value
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && typeof (a as { uuid?: unknown }).uuid === 'string')
    .map((a) => ({
      uuid: a.uuid as string,
      email: str(a.email) ?? '',
      displayName: str(a.displayName) ?? '',
      planLabel: str(a.planLabel),
      rateLimitTier: str(a.rateLimitTier),
      needsReauthentication: a.needsReauthentication === true,
      lastSeenActive: str(a.lastSeenActive),
      credentialOwnership: a.credentialOwnership === 'legacy' || a.credentialOwnership === 'appManaged' ? a.credentialOwnership : null,
    }));
}

function parsePins(value: unknown): Pick<Read, 'drainTarget' | 'drainTargetIsManual' | 'pins'> {
  if (typeof value !== 'object' || value === null) throw new Error('pins.json is not an object');
  const file = value as { drainTarget?: unknown; drainTargetIsManual?: unknown; pins?: unknown };
  const pins = new Map<string, string>();
  if (typeof file.pins === 'object' && file.pins !== null) {
    for (const [session, pin] of Object.entries(file.pins)) {
      const account = (pin as { accountUUID?: unknown } | null)?.accountUUID;
      if (typeof account === 'string') pins.set(session, account);
    }
  }
  return { drainTarget: str(file.drainTarget), drainTargetIsManual: file.drainTargetIsManual === true, pins };
}

// W6 start
function parseGateway(value: unknown): UsageGateway {
  if (typeof value !== 'object' || value === null) throw new Error('gateway.json is not an object');
  const file = value as { routingEnabled?: unknown; port?: unknown };
  return { routingEnabled: file.routingEnabled === true, port: typeof file.port === 'number' && Number.isInteger(file.port) ? file.port : null };
}

function parseCodexAccounts(value: unknown): Omit<UsageCodex['accounts'][number], 'pinnedSessionCount'>[] {
  if (!Array.isArray(value)) throw new Error('codex-accounts.json is not an array');
  return value
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null && typeof (a as { accountID?: unknown }).accountID === 'string')
    .map((a) => ({ accountId: a.accountID as string, email: str(a.email) ?? '', planLabel: str(a.planLabel), needsReauthentication: a.needsReauthentication === true }));
}
// W6 end

function signature(snapshot: UsageSnapshot): string {
  return JSON.stringify({ ...snapshot, readAt: null });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
