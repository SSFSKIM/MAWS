// The store's nightly maintenance (the P3-A document's Decision Log 5 and 8; P3-0's S7a `Store.maintain`): once per
// 24 hours of host uptime, and soon after the host starts when the last run is over 24 hours old; off the commit path.
// In order: each Y doc's head rewritten at its committed revision (a load is the head plus the log after it), the log
// rows a head covers and older than 7 days deleted, `auto` versions thinned (versions.ts), provenance merged into hour
// and day rows (losslessly), then `PRAGMA incremental_vacuum`. The last run's time is kept in `meta`.
import type { ArtifactStore } from './store';

export const MAINTENANCE_EVERY_MS = 24 * 3_600_000;
export const MAINTENANCE_START_DELAY_MS = 60_000; // after the host starts, before an overdue run
const LAST_RUN_KEY = 'maintenance.lastRun';

export interface MaintenanceReport {
  heads: number;
  logRowsPruned: number;
  versionsThinned: number;
  attributionsMerged: number;
}

export class Maintenance {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<MaintenanceReport> | null = null;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly store: ArtifactStore,
    options: { now: () => number; log: (line: string) => void },
  ) {
    this.now = options.now;
    this.log = options.log;
  }

  lastRun(): number | null {
    const raw = this.store.storage.getMeta(LAST_RUN_KEY);
    return raw === null ? null : Number(raw);
  }

  // Schedules the runs: the first after the start delay when the last run is overdue, else when it falls due.
  start(): void {
    this.stop();
    const last = this.lastRun();
    const due = last === null ? MAINTENANCE_START_DELAY_MS : Math.max(MAINTENANCE_START_DELAY_MS, last + MAINTENANCE_EVERY_MS - this.now());
    this.arm(due);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run()
        .catch((error: unknown) => this.log(`maintenance failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => this.arm(MAINTENANCE_EVERY_MS));
    }, delay);
    (this.timer as { unref?: () => void }).unref?.();
  }

  // One pass; a pass already running is answered rather than doubled.
  run(): Promise<MaintenanceReport> {
    this.running ??= this.pass().finally(() => (this.running = null));
    return this.running;
  }

  private async pass(): Promise<MaintenanceReport> {
    const { store } = this;
    const { service, storage } = store;
    const now = this.now();
    if (storage.readOnly) return { heads: 0, logRowsPruned: 0, versionsThinned: 0, attributionsMerged: 0 };
    // Synchronous from here to the thinning: no batch can open between the commit and these outside-batch steps.
    service.commitNow();
    const behind = storage.db
      .prepare('SELECT DISTINCT u.artifactId AS id FROM artifact_updates u LEFT JOIN artifact_head h ON h.artifactId = u.artifactId WHERE u.bytes IS NOT NULL AND u.seq > COALESCE(h.seq, 0)')
      .all() as { id: string }[];
    for (const { id } of behind) {
      const { revision, state } = service.readState(id);
      storage.writeHead(id, revision, state);
    }
    const logRowsPruned = storage.pruneLog(now);
    const { merged: attributionsMerged } = storage.tierAttributions(now);
    const pinned = store.versions.pinned();
    const artifacts = (storage.db.prepare('SELECT DISTINCT artifactId AS id FROM artifact_versions').all() as { id: string }[]).map((row) => row.id);
    const plan = artifacts.map((id) => ({ id, drop: store.versions.thinnable(id, now, pinned) })).filter((p) => p.drop.length > 0);
    const files = plan.length === 0 ? [] : await service.inBatch(() => plan.flatMap(({ id, drop }) => store.versions.drop(id, drop).map((ref) => ({ artifactId: id, ref }))));
    store.removeUnreferenced(files);
    service.commitNow();
    storage.incrementalVacuum();
    storage.setMeta(LAST_RUN_KEY, String(now));
    const report = { heads: behind.length, logRowsPruned, versionsThinned: plan.reduce((n, p) => n + p.drop.length, 0), attributionsMerged };
    this.log(`maintenance: ${JSON.stringify(report)}`);
    return report;
  }
}
