import type { AppSessionId, ProjectId } from '@shared/graph/ids';
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
  now?: () => number;
}

// Both the opt-in timer and the project command use this policy. The service runs the guard again under its
// per-session lock, after its authoritative holder read, so a late pin, request or resumed process is not archived.
export class InactiveArchive {
  constructor(private readonly deps: Dependencies) {}

  async run(days: 7 | 14 | 30, projectId: ProjectId | null, current: () => boolean = () => true) {
    const { index } = this.deps;
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
        const status = this.deps.status(id);
        if (status && (status.process !== 'exited' || status.keepAlive.includes('background_tasks') || status.keepAlive.includes('queued_messages'))) return false;
        const at = Math.max(Date.parse(index.sessions.summaryOf(id)?.lastRecordAt ?? latest.updatedAt), this.deps.activity?.(id) ?? -Infinity);
        return Number.isFinite(at) && at < cutoff;
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

// The setting defaults to Never. A change to it starts a sweep, then hourly while enabled; disabling or shutdown
// invalidates an in-flight sweep before another record can be archived.
export function scheduleInactiveArchive(archiver: InactiveArchive, days: () => 7 | 14 | 30 | null, subscribe: (changed: () => void) => () => void): () => void {
  let stopped = false;
  let running = false;
  const run = async () => {
    const value = days();
    if (stopped || running || value === null) return;
    running = true;
    try { await archiver.run(value, null, () => !stopped && days() === value); }
    catch (error) { console.warn('[sessions] inactive archive could not run', error); }
    finally { running = false; }
  };
  let previous = days();
  const off = subscribe(() => { const next = days(); if (next !== previous) { previous = next; void run(); } });
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
  void run();
  return () => { stopped = true; clearInterval(timer); off(); };
}
