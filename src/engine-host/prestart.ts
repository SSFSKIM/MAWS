// Ticket 851, M2 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D3, R4-2, R4-8): what a prestart keeps instead of
// writing. A prestart's launch is staged: its journal rows and its host map lines stay in memory with their sequence
// numbers and timestamps (the session acknowledges the native ring as each enters the stage), and its state-file writes
// (the stored spec, the queue, the lineage, …) are held, the last of each kind, beside the store. At adopt the stage is
// written whole (the map file, then the journal file, each line in its original order) and the journal goes on in a
// writer resumed after its last row, then the held writes land; until then nothing of the launch is on disk. The stage,
// with the events the host keeps for the row, has a byte ceiling; passing it ends the prestart.
import { closeSync, fchmodSync, openSync, writeSync } from 'node:fs';
import { backupStagedState, dropStagedBackup, restoreStagedState } from './holder/adopt'; // M2's review, finding 2
import { dirname, join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { CronRecord, GrantSnapshot, InfrastructureRecord, QueueState, SessionStateStore, StoredQueue } from '@shared/engine/session-state-store';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { mapFileOf, type MapStage } from './holder/checkpoint';
import { JOURNAL_FILE_MODE, JOURNAL_MAX_BYTES, JournalWriter, ownerOnlyJournalDirectory, type JournalPosition } from './journal';
import type { SessionJournal } from './session';

// R4-8: the stage (journal rows, map lines) and the events kept for the hidden row, together
export const PRESTART_STAGE_MAX_BYTES = 1024 * 1024;

// The bytes a prestart holds in memory, and its map lines. `add` past the ceiling tells `overflow` once, on a later
// turn of the event loop (never inside the write that passed it).
// M2's review, finding 9: the ceiling counts until the row is revealed or dropped (`close`), past the stage's release
// (its rows and map lines then on disk, the kept events still in memory)
// The panel's scalpel-2#7: past the ceiling, or once closed, it keeps nothing more (`keeping`): its journal and map drop
// what comes, so an engine that writes on through its stop ladder grows nothing; a stage past its ceiling never commits.
export class Stage implements MapStage {
  private size = 0;
  private overflowed = false;
  private held = true;
  private closed = false;
  readonly mapLines: string[] = [];

  constructor(private readonly opts: { maxBytes?: number; overflow: () => void }) {}

  get holding(): boolean {
    return this.held;
  }

  get bytes(): number {
    return this.size;
  }

  get over(): boolean {
    return this.overflowed;
  }

  get keeping(): boolean {
    return !this.closed && !this.overflowed;
  }

  add(bytes: number): void {
    if (!this.keeping) return;
    this.size += bytes;
    if (this.size <= (this.opts.maxBytes ?? PRESTART_STAGE_MAX_BYTES)) return;
    this.overflowed = true;
    setImmediate(this.opts.overflow);
  }

  mapLine(text: string): void {
    if (!this.keeping) return;
    this.mapLines.push(text);
    this.add(Buffer.byteLength(text));
  }

  // The stage is written: its rows and map lines go to disk from now on; what the host keeps still counts.
  release(): void {
    this.held = false;
  }

  // The row is revealed or dropped: nothing more counts.
  close(): void {
    this.closed = true;
  }
}

// The launch's journal while it is staged: rows numbered and stamped as JournalWriter numbers them, kept as their lines;
// `commit` writes them whole as the launch's first file (and the stage's map lines first, as its map file), then every
// later row goes to a JournalWriter resumed after the last one. The row that passes the stage's ceiling is kept, and
// none after it, or after the stage closed: each is still numbered (the prestart is ended for it on the next turn).
export class StagedJournal implements SessionJournal {
  readonly path: string;
  private seq = 0;
  private lines: string[] = [];
  private writer: JournalWriter | null = null;
  private closed = false;

  constructor(private readonly dir: string, private readonly launchId: string, private readonly stage: Stage) {
    this.path = join(dir, `${launchId}.jsonl`);
  }

  get staged(): boolean {
    return this.writer === null;
  }

  row(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.writer) return this.writer.row(direction, frame);
    if (this.closed) throw new Error(`journal ${this.path} is closed`);
    const row: JournalRow = { seq: this.seq + 1, direction, at: new Date().toISOString(), frame };
    this.seq = row.seq;
    if (!this.stage.keeping) return row; // the panel's scalpel-2#7
    const line = JSON.stringify(row) + '\n';
    this.lines.push(line);
    this.stage.add(Buffer.byteLength(line));
    return row;
  }

  get lastSeq(): number {
    return this.writer?.lastSeq ?? this.seq;
  }

  get currentPath(): string {
    return this.writer?.currentPath ?? this.path;
  }

  // While staged the stream takes no checkpoint (it has none to take: no listener is attached before the commit).
  get position(): JournalPosition | null {
    return this.writer?.position ?? null;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.writer?.close();
  }

  // R4-2: the map file, then the journal file, each written whole, owner-only, as JournalWriter writes (no fsync); then the journal continues on
  // disk and the stage holds nothing more. Throws when a write fails (the adopt then fails: R4-1's step 5).
  commit(): void {
    if (this.writer) return;
    if (this.closed) throw new Error('the prestart’s journal is closed: its process has exited');
    if (this.stage.over) throw new Error('the prestart’s stage passed its ceiling: rows past it were not kept'); // the panel's scalpel-2#7
    ownerOnlyJournalDirectory(dirname(this.dir));
    ownerOnlyJournalDirectory(this.dir);
    if (this.stage.mapLines.length > 0) writeWhole(mapFileOf(this.path), this.stage.mapLines.join('')); // a direct spawn has no map
    writeWhole(this.path, this.lines.join(''));
    this.writer = JournalWriter.resume(this.dir, this.launchId, { maxBytes: JOURNAL_MAX_BYTES });
    this.lines = [];
    this.stage.mapLines.length = 0;
    this.stage.release();
  }
}

// M2's review, finding 4: the write a test can make short
export const prestartIo: { writeSync: (fd: number, buffer: Buffer, offset: number, length: number) => number } = {
  writeSync: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
};

// The whole text or a throw: a write that makes no progress fails it (the adopt then fails, R4-1's step 5).
function writeWhole(path: string, text: string): void {
  const buffer = Buffer.from(text, 'utf8');
  const fd = openSync(path, 'w', JOURNAL_FILE_MODE);
  try {
    fchmodSync(fd, JOURNAL_FILE_MODE);
    for (let offset = 0; offset < buffer.length; ) {
      const written = prestartIo.writeSync(fd, buffer, offset, buffer.length - offset);
      if (!(written > 0)) throw new Error(`${path}: a write stopped at ${offset} of ${buffer.length} bytes`);
      offset += written;
    }
  } finally {
    closeSync(fd);
  }
}

type Kind = 'queue' | 'grants' | 'spec' | 'keep' | 'owed' | 'lineage' | 'cron' | 'observer' | 'infrastructure';

// The session's store while it is staged: every save of the id is held (the last of each kind, in the order each kind
// was first saved) and read back by the loads; `commit` writes them, in that order, to the store beneath. A save after
// the commit waits for the commit's writes, so no held value lands after a newer one.
// M2's review, finding 2: `state`, the state files' directory and the launch: before the commit writes, the state there
// is backed up (holder/adopt.ts); `discard` drops every later write, waits for those under way and restores it; `settle`
// (the promotion) drops the backup.
export class StagingStore implements SessionStateStore {
  private readonly held = new Map<Kind, unknown>();
  private committed: Promise<void> | null = null;
  private dropped = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly store: SessionStateStore, private readonly state: { dir: string; launchId: string } | null = null) {}

  async commit(id: AppSessionId): Promise<void> {
    if (this.committed) return this.committed;
    if (this.dropped) throw new Error('the prestart’s state was discarded');
    const writes = [...this.held];
    this.held.clear();
    this.committed = (async () => {
      if (this.state) backupStagedState(this.state.dir, id, this.state.launchId);
      for (const [kind, value] of writes) await this.write(kind, id, value);
    })();
    return this.committed;
  }

  // Every write the commit made or that followed it, settled (the state file durable before the promotion)
  async flushed(): Promise<void> {
    await this.committed;
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  async discard(id: AppSessionId): Promise<void> {
    this.dropped = true;
    this.held.clear();
    await this.committed?.catch(() => {});
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
    if (this.state) restoreStagedState(this.state.dir, id, this.state.launchId);
  }

  settle(id: AppSessionId): void {
    if (this.state) dropStagedBackup(this.state.dir, id, this.state.launchId);
  }

  private write(kind: Kind, id: AppSessionId, value: unknown): Promise<void> {
    switch (kind) {
      case 'queue': return this.store.saveQueue(id, value as QueueState);
      case 'grants': return this.store.saveGrants(id, value as GrantSnapshot);
      case 'spec': return this.store.saveLaunchSpec(id, value as LaunchSpec);
      case 'keep': return this.store.saveKeep(id, value as boolean);
      case 'owed': return this.store.saveOwedInterrupt(id, value as boolean);
      case 'lineage': return this.store.saveEngineSessionIds(id, value as string[]);
      case 'cron': return this.store.saveCronRecord(id, value as CronRecord);
      case 'observer': return this.store.saveObserverSeen(id, value as string);
      case 'infrastructure': return this.store.saveInfrastructure(id, value as InfrastructureRecord);
    }
  }

  private save(kind: Kind, id: AppSessionId, value: unknown): Promise<void> {
    if (this.dropped) return Promise.resolve();
    if (this.committed === null) {
      this.held.set(kind, structuredClone(value)); // a kind keeps its first save's place, with its newest value
      return Promise.resolve();
    }
    const committed = this.committed;
    const write = (async () => {
      await committed.catch(() => {});
      if (!this.dropped) await this.write(kind, id, value);
    })();
    this.inFlight.add(write);
    void write.catch(() => {}).finally(() => this.inFlight.delete(write));
    return write;
  }

  private load<T>(kind: Kind, read: () => Promise<T>): Promise<T> {
    return this.held.has(kind) ? Promise.resolve(structuredClone(this.held.get(kind)) as T) : read();
  }

  async exists(id: AppSessionId): Promise<boolean> {
    return this.held.size > 0 || this.store.exists(id);
  }
  async loadQueue(id: AppSessionId): Promise<StoredQueue> {
    if (this.held.has('queue')) return { ...(structuredClone(this.held.get('queue')) as QueueState), corrupt: null };
    return this.store.loadQueue(id);
  }
  saveQueue(id: AppSessionId, queue: QueueState): Promise<void> { return this.save('queue', id, queue); }
  loadGrants(id: AppSessionId): Promise<GrantSnapshot> { return this.load('grants', () => this.store.loadGrants(id)); }
  saveGrants(id: AppSessionId, grants: GrantSnapshot): Promise<void> { return this.save('grants', id, grants); }
  loadLaunchSpec(id: AppSessionId): Promise<LaunchSpec | null> { return this.load('spec', () => this.store.loadLaunchSpec(id)); }
  saveLaunchSpec(id: AppSessionId, spec: LaunchSpec): Promise<void> { return this.save('spec', id, spec); }
  forgetJournal(id: AppSessionId): Promise<void> { return this.store.forgetJournal(id); }
  forget(id: AppSessionId): Promise<void> { return this.store.forget(id); }
  loadKeep(id: AppSessionId): Promise<boolean> { return this.load('keep', () => this.store.loadKeep(id)); }
  saveKeep(id: AppSessionId, keep: boolean): Promise<void> { return this.save('keep', id, keep); }
  loadEngineSessionIds(id: AppSessionId): Promise<string[]> { return this.load('lineage', () => this.store.loadEngineSessionIds(id)); }
  saveEngineSessionIds(id: AppSessionId, ids: string[]): Promise<void> { return this.save('lineage', id, ids); }
  loadCronRecord(id: AppSessionId): Promise<CronRecord | null> { return this.load('cron', () => this.store.loadCronRecord(id)); }
  saveCronRecord(id: AppSessionId, record: CronRecord): Promise<void> { return this.save('cron', id, record); }
  loadObserverSeen(id: AppSessionId): Promise<string | null> { return this.load('observer', () => this.store.loadObserverSeen(id)); }
  saveObserverSeen(id: AppSessionId, launchId: string): Promise<void> { return this.save('observer', id, launchId); }
  loadInfrastructure(id: AppSessionId): Promise<InfrastructureRecord | null> { return this.load('infrastructure', () => this.store.loadInfrastructure(id)); }
  saveInfrastructure(id: AppSessionId, record: InfrastructureRecord): Promise<void> { return this.save('infrastructure', id, record); }
  loadOwedInterrupt(id: AppSessionId): Promise<boolean> { return this.load('owed', () => this.store.loadOwedInterrupt(id)); }
  saveOwedInterrupt(id: AppSessionId, owed: boolean): Promise<void> { return this.save('owed', id, owed); }
}

// D4: the spec Send gives equals the prestart's but for `sessionId`, the pin each side's guards minted. Compared as
// canonical JSON (keys sorted at every depth), so the order a builder wrote the keys in never matters.
export function sameLaunchSpec(a: LaunchSpec, b: LaunchSpec): boolean {
  return canonical({ ...a, sessionId: null }) === canonical({ ...b, sessionId: null });
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : v,
  );
}
