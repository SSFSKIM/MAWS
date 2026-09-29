// The engine host's side of replay (C4 execution document, Interfaces "Replay engine", start orchestration and launch
// cancellation): `session.replay.launch` does everything that can fail before anything can be observed — it loads and
// validates the source, binds the run's ids, then starts the runner and answers — so a failed launch emits no event for
// its ids. `session.replay.control` pauses, resumes, changes speed or stops a run; a stop for a launch still loading is
// main's cancel (its dispatch timed out), and the launch then discards the load, binds nothing and answers
// `replay launch cancelled`. A stopped run is unbound and dropped; a finished one keeps its events for the snapshot
// command until it is stopped.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { ReplayProgress, ReplaySource, Speed } from '@shared/ipc/schema/session';
import { ReplayClock } from './clock';
import { loadJournalSource, type SourceReader } from './journal-source';
import { ReplayRunner, type RowNormalizer } from './runner';
import { loadTranscriptSource } from './transcript-source';

// The filesystem service's bindings (FsService satisfies it): a replay's ids are bound like a session's, so the
// snapshot command and every `fs.*` command know the app id.
export interface ReplayBindings {
  bind(bindings: readonly { sessionId: SessionId; appSessionId: AppSessionId }[]): void;
  unbind(appSessionId: AppSessionId): Promise<void>;
}

export interface ReplayHostDeps {
  emit: HostEmit;
  bindings: ReplayBindings;
  normalizer: (sessionId: SessionId) => RowNormalizer; // C3's Normalizer, or the stand-in until it lands
  readSource?: SourceReader;
  maxGapMs?: number;
}

export interface ReplayLaunch {
  appSessionId: AppSessionId;
  sessionId: SessionId;
  source: ReplaySource;
  speed: Speed;
}

export class ReplayHost {
  private readonly runs = new Map<AppSessionId, ReplayRunner>();
  private readonly launching = new Set<AppSessionId>();
  private readonly cancelled = new Set<AppSessionId>(); // launches in flight that main has cancelled

  constructor(private readonly deps: ReplayHostDeps) {}

  async launch({ appSessionId, sessionId, source, speed }: ReplayLaunch): Promise<{ totalRows: number; spanMs: number }> {
    if (this.runs.has(appSessionId) || this.launching.has(appSessionId)) throw new Error(`replay already live: ${appSessionId}`);
    this.launching.add(appSessionId);
    try {
      const loaded = source.kind === 'journal' ? await loadJournalSource(source.path, this.deps.readSource) : await loadTranscriptSource(source.path, this.deps.readSource);
      // The one moment a cancel can have arrived: from here to the runner's start nothing awaits.
      if (this.cancelled.has(appSessionId)) throw new Error(`replay launch cancelled: ${appSessionId}`);
      this.deps.bindings.bind([{ sessionId, appSessionId }]);
      const runner = new ReplayRunner({
        appSessionId,
        sessionId,
        clock: new ReplayClock({ speed, maxGapMs: this.deps.maxGapMs }),
        emit: (events) => this.deps.emit('session.eventBatch', { appSessionId, events }),
        progress: (progress) => this.progressed(progress),
      });
      this.runs.set(appSessionId, runner);
      // The runner's first progress and first row follow this answer by a turn of the event loop.
      void ('rows' in loaded ? runner.runJournal(loaded.rows, this.deps.normalizer(sessionId)) : runner.runTranscript(loaded.records));
      return { totalRows: loaded.totalRows, spanMs: loaded.spanMs };
    } finally {
      this.launching.delete(appSessionId);
      this.cancelled.delete(appSessionId);
    }
  }

  // Answers at once. A launch still loading and told to stop is cancelled; an id the host knows nothing of is a no-op.
  control({ appSessionId, action, speed }: { appSessionId: AppSessionId; action?: 'pause' | 'resume' | 'stop'; speed?: Speed }): void {
    const runner = this.runs.get(appSessionId);
    if (runner) runner.control(action, speed);
    else if (action === 'stop' && this.launching.has(appSessionId)) this.cancelled.add(appSessionId);
  }

  // The run's events so far (the `session.events` seam for a replay's app id); null when no run has that id.
  snapshot(appSessionId: AppSessionId): { events: SessionEvent[]; complete: boolean } | null {
    const runner = this.runs.get(appSessionId);
    return runner ? { events: runner.materialized(), complete: runner.state === 'done' } : null;
  }

  private progressed(progress: ReplayProgress): void {
    this.deps.emit('session.replay.progress', progress);
    if (progress.state !== 'stopped') return;
    this.runs.delete(progress.appSessionId);
    this.deps.bindings.unbind(progress.appSessionId).catch((error: unknown) => console.error('[replay] unbind failed:', error instanceof Error ? error.message : error));
  }
}
