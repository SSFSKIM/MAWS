// The catalog's network sources, cached on disk (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Caching"). Each source's last good copy lives under the app's user data (`catalog/<source key>.json`: its pages as
// served and its fetch time); the conditional request the spec allows (`If-None-Match`) is not made, because the
// guarded GET carries no request header but the user agent, so a refresh is a full fetch (M2's Decision).
// - A source is refreshed when its copy is older than 24 hours; Refresh refreshes them all. One refresh runs at a time,
//   and a second request joins the one running.
// - A failed source keeps its last copy (`offline`, with its age); a source never fetched and failing is `unavailable`;
//   either way the other sources stand. An automatic retry of a failed source waits RETRY_MS.
// - Each source is parsed on its own (records.ts); one whose document is not its documented shape fails like a network
//   failure, keeping its last copy.
// - `revision` moves, and listeners hear once, for each refresh that changed anything.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogSourceStatus } from '@shared/ipc/schema/catalog';
import { fetchSource, sourceLabel, type Exchange, type PageGet } from './fetch';
import { networkData, parseSource, type NetworkData, type ParsedSource } from './records';

export const REFRESH_AGE_MS = 24 * 60 * 60 * 1000;
export const RETRY_MS = 5 * 60 * 1000;

interface Copy {
  fetchedAt: number;
  parsed: ParsedSource;
  digest: string;
}

export interface StoreDeps {
  dir: string; // <userData>/catalog
  keys: readonly string[];
  pages: PageGet;
  now?: () => number;
  log?: (line: string) => void;
  fs?: { readFile: typeof readFile; writeFile: typeof writeFile; rename: typeof rename; mkdir: typeof mkdir };
}

const digestOf = (pages: readonly unknown[]) => createHash('sha1').update(JSON.stringify(pages)).digest('hex');
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class CatalogStore {
  private readonly copies = new Map<string, Copy>();
  private readonly attempts = new Map<string, { at: number; failed: boolean }>(); // this run's last attempt per source
  private loading: Promise<void> | null = null;
  private running: Promise<CatalogSourceStatus[]> | null = null;
  private memo: { revision: number; data: NetworkData } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly stopping = new AbortController(); // ends every walk in flight (stop)
  private readonly now: () => number;
  private readonly fs: NonNullable<StoreDeps['fs']>;
  revision = 0;
  /** The last refresh's requests, as measured (the live summary reads them). */
  exchanges = new Map<string, Exchange[]>();

  constructor(private readonly deps: StoreDeps) {
    this.now = deps.now ?? Date.now;
    this.fs = deps.fs ?? { readFile, writeFile, rename, mkdir };
  }

  /** End every walk in flight; a source it ends fails like any other, keeping its copy. */
  stop(): void {
    this.stopping.abort();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The copies on disk, read once. */
  loaded(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  /** The copies on disk, then the sources a read needs: awaited when some has no copy yet, else in the background. */
  async ready(): Promise<void> {
    await this.loaded();
    const due = this.deps.keys.filter((key) => this.due(key));
    if (due.length === 0) return;
    const refresh = this.refresh(due);
    if (due.some((key) => !this.copies.has(key))) await refresh;
    else void refresh;
  }

  /** Refresh `keys` (every source by default); joins a refresh already running. */
  refresh(keys: readonly string[] = this.deps.keys): Promise<CatalogSourceStatus[]> {
    this.running ??= this.run(keys).finally(() => (this.running = null));
    return this.running;
  }

  statuses(): CatalogSourceStatus[] {
    return this.deps.keys.map((key) => {
      const copy = this.copies.get(key);
      const label = sourceLabel(key);
      if (!copy) return { key, label, fetchedAt: null, state: 'unavailable', dropped: 0 };
      const state = this.attempts.get(key)?.failed ? 'offline' : this.now() - copy.fetchedAt >= REFRESH_AGE_MS ? 'stale' : 'fresh';
      return { key, label, fetchedAt: new Date(copy.fetchedAt).toISOString(), state, dropped: copy.parsed.dropped };
    });
  }

  /** The sources' records now, parsed (the same object until the revision moves). */
  data(): NetworkData {
    if (this.memo?.revision !== this.revision) this.memo = { revision: this.revision, data: networkData(new Map([...this.copies].map(([key, copy]) => [key, copy.parsed]))) };
    return this.memo.data;
  }

  // A source to refresh on a read: no copy or an old one, unless this run tried it within RETRY_MS and failed.
  private due(key: string): boolean {
    const attempt = this.attempts.get(key);
    if (attempt?.failed && this.now() - attempt.at < RETRY_MS) return false;
    const copy = this.copies.get(key);
    return copy === undefined ? attempt === undefined || attempt.failed : this.now() - copy.fetchedAt >= REFRESH_AGE_MS;
  }

  private async load(): Promise<void> {
    await Promise.all(
      this.deps.keys.map(async (key) => {
        try {
          const saved = JSON.parse(await this.fs.readFile(this.pathOf(key), 'utf8')) as { fetchedAt?: unknown; pages?: unknown };
          if (typeof saved.fetchedAt !== 'number' || !Array.isArray(saved.pages)) return;
          this.copies.set(key, { fetchedAt: saved.fetchedAt, parsed: parseSource(key, saved.pages), digest: digestOf(saved.pages) });
        } catch {
          // no copy, or one that no longer reads: the source is fetched as if never fetched
        }
      }),
    );
    if (this.copies.size > 0) this.revision += 1;
  }

  private async run(keys: readonly string[]): Promise<CatalogSourceStatus[]> {
    await this.loaded();
    const changed = await Promise.all(keys.map((key) => this.refreshOne(key)));
    if (changed.some(Boolean)) {
      this.revision += 1;
      for (const listener of this.listeners) listener();
    }
    return this.statuses();
  }

  private async refreshOne(key: string): Promise<boolean> {
    const at = this.now();
    try {
      const fetched = await fetchSource(key, this.deps.pages, { signal: this.stopping.signal });
      this.exchanges.set(key, fetched.exchanges);
      const parsed = parseSource(key, fetched.pages);
      const digest = digestOf(fetched.pages);
      const fetchedAt = this.now();
      await this.save(key, fetchedAt, fetched.pages);
      const before = this.copies.get(key);
      this.copies.set(key, { fetchedAt, parsed, digest });
      this.attempts.set(key, { at, failed: false });
      return before?.digest !== digest;
    } catch (error) {
      this.attempts.set(key, { at, failed: true });
      this.deps.log?.(`${key}: ${message(error)}${this.copies.has(key) ? '; its last copy stands' : ''}`);
      return false;
    }
  }

  private pathOf(key: string): string {
    return join(this.deps.dir, `${key}.json`);
  }

  private async save(key: string, fetchedAt: number, pages: readonly unknown[]): Promise<void> {
    await this.fs.mkdir(this.deps.dir, { recursive: true });
    const path = this.pathOf(key);
    const temporary = `${path}.${process.pid}.tmp`;
    await this.fs.writeFile(temporary, JSON.stringify({ key, fetchedAt, pages }));
    await this.fs.rename(temporary, path);
  }
}
