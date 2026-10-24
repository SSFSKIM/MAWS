import type { AppSessionId, ProjectId, SessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { ArchiveOutcome } from '@shared/ipc/schema/session';
import { isActionable, isOpen } from '@shared/attention/kinds';
import type { Index } from '../index/index';
import type { GitRun } from '../git/runner';

interface Dependencies {
  index: Pick<Index, 'sessions' | 'attention'>;
  status(id: AppSessionId): EngineSessionStatus | null;
  waiting(id: AppSessionId): boolean;
  activity?(id: AppSessionId): number | null;
  git: GitRun;
  archive(id: AppSessionId, eligible: () => Promise<boolean>, stillEligible: () => boolean): Promise<ArchiveOutcome>;
  // The index source's freshness (`IndexSessionSource.discoveryCurrent`): a session's last activity is read only once
  // this run's scan has answered and no summary of its transcript waits to be applied.
  discovered(engineSessionId: SessionId | null): boolean;
  // Whether the owner keeps the session open in a main tab; only the automatic sweep reads it.
  open?(id: AppSessionId): boolean;
  now?: () => number;
}

export class DiscoveryPendingError extends Error {
  constructor() {
    super('Sessions are still being read from disk; try again in a moment');
  }
}

// Both the opt-in timer and the project command use this policy. The service runs the guard again under its
// per-session lock, after its authoritative holder read, so a late pin, request or resumed process is not archived.
export class InactiveArchive {
  constructor(private readonly deps: Dependencies) {}

  // Whether a run would read a current index; one before that throws DiscoveryPendingError.
  ready(): boolean {
    return this.deps.discovered(null);
  }

  // `automatic`: the opt-in sweep, which also keeps every session open in a tab (the owner is keeping it in view); the
  // project command archives those too, and the renderer closes their tabs.
  async run(days: 7 | 14 | 30, projectId: ProjectId | null, { current = () => true, automatic = false }: { current?: () => boolean; automatic?: boolean } = {}) {
    const { index } = this.deps;
    if (!this.ready()) throw new DiscoveryPendingError();
    const cutoff = (this.deps.now?.() ?? Date.now()) - days * 86_400_000;
    const waiting = new Set((await index.attention.list()).filter((item) => isOpen(item) && isActionable(item)).map((item) => item.appSessionId));
    let archived = 0;
    let skipped = 0;
    for (const record of index.sessions.list().filter((r) => projectId === null || r.projectId === projectId)) {
      if (!current()) break;
      const id = record.appId;
      const eligibleNow = () => {
        const latest = index.sessions.get(id);
        if (!current() || !latest || latest.archived || latest.pinned || latest.holder.kind !== 'none' || waiting.has(id) || this.deps.waiting(id)) return false;
        if (!this.deps.discovered(latest.engineSessionId)) return false;
        const status = this.deps.status(id);
        if (status && (status.process !== 'exited' || status.keepAlive.includes('background_tasks') || status.keepAlive.includes('queued_messages'))) return false;
        const at = Math.max(Date.parse(index.sessions.summaryOf(id)?.lastRecordAt ?? latest.updatedAt), this.deps.activity?.(id) ?? -Infinity);
        return Number.isFinite(at) && at < cutoff && !(automatic && this.deps.open?.(id));
      };
      const eligible = async () => {
        if (!eligibleNow()) return false;
        const worktree = index.sessions.get(id)!.worktree;
        if (worktree) {
          try {
            if ((await this.deps.git(worktree.path, ['status', '--porcelain=v1', '--untracked-files=all'])).trim() !== '') return false;
          } catch { return false; } // an unreadable/missing worktree is not known clean
        }
        return eligibleNow();
      };
      if (!eligibleNow()) { skipped++; continue; }
      try {
        const outcome = await this.deps.archive(id, eligible, eligibleNow);
        if ('archived' in outcome) archived++;
        else skipped++;
      } catch (error) {
        skipped++;
        console.warn('[sessions] inactive archive skipped a session', id, error);
      }
    }
    return { archived, skipped };
  }
}

// The setting defaults to Never. A change to it starts a sweep, then hourly while enabled, and after each scan of the
// store (`scanned`), since none runs before the index is current; disabling or shutdown invalidates an in-flight sweep
// before another record can be archived.
export function scheduleInactiveArchive(
  archiver: InactiveArchive,
  days: () => 7 | 14 | 30 | null,
  subscribe: (changed: () => void) => () => void,
  scanned: (listener: () => void) => () => void,
): () => void {
  let stopped = false;
  let running = false;
  const run = async () => {
    const value = days();
    if (stopped || running || value === null || !archiver.ready()) return;
    running = true;
    try { await archiver.run(value, null, { current: () => !stopped && days() === value, automatic: true }); }
    catch (error) { console.warn('[sessions] inactive archive could not run', error); }
    finally { running = false; }
  };
  let previous = days();
  const off = subscribe(() => { const next = days(); if (next !== previous) { previous = next; void run(); } });
  const offScanned = scanned(() => void run());
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  void run();
  return () => { stopped = true; clearInterval(timer); off(); offScanned(); };
}
