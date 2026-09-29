// Main's side of replay (C4 execution document, Interfaces "Replay engine", start orchestration and launch
// cancellation): `session.replay.start` allocates the run's ids and its `kind: 'replay'` record (titled by the fixture,
// the override with source `tool`), then dispatches the host's `session.replay.launch`. A launch that fails removes the
// record again and fails the start with the launch's own error. A `timeout` does not end the host's work — the
// supervisor drops the request without telling the host — so main cancels the launch explicitly (`session.replay.control
// { action: 'stop' }`, not awaited), remembers the id as cancelled, and only then removes the record; a progress or batch
// that still arrives for a cancelled id is answered with one more stop and never recreates the row. An id leaves the
// cancelled set on its `stopped` progress or when the engine host goes down. A run's `stopped` progress removes its
// record; a `done` run keeps it. `session.replay.fixtures` lists the fixtures table.
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { ReplayFixture, ReplayProgress } from '@shared/ipc/schema/session';
import type { HostSupervisor } from '../hosts/supervisor';
import { CommandFailure, registerMainHandler } from '../ipc/router';
import type { Index } from './index';

export type ReplayHostPort = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onState'>;

export class ReplayStarter {
  private readonly cancelled = new Set<AppSessionId>(); // launches main gave up on (dispatch timeout)
  private readonly restopped = new Set<AppSessionId>(); // cancelled ids already sent their second stop
  private readonly offs: (() => void)[];

  constructor(
    private readonly index: Index,
    private readonly host: ReplayHostPort,
  ) {
    this.offs = [
      host.onEvent('session.replay.progress', (progress) => this.progressed(progress)),
      host.onEvent('session.eventBatch', ({ appSessionId }) => this.lateRun(appSessionId)),
      // A host that went down took its launches with it; the one that replaces it knows none of these ids.
      host.onState('engine-host', (state) => {
        if (state.state === 'ready') return;
        this.cancelled.clear();
        this.restopped.clear();
      }),
    ];
  }

  async start({ source, speed }: CommandInput<'session.replay.start'>): Promise<CommandOutput<'session.replay.start'>> {
    const appSessionId = randomUUID() as AppSessionId;
    const sessionId = `rp_${randomUUID()}` as SessionId;
    const fixture: ReplayFixture | undefined = this.index.fixtures.list().find((candidate) => candidate.path === source.path);
    const name = fixture?.name ?? basename(source.path, '.jsonl');
    this.index.transaction(() => this.index.sessions.createReplay({ appId: appSessionId, sessionId, title: `replay · ${name}` }));

    const result = await this.host.dispatch('engine-host', 'session.replay.launch', { appSessionId, sessionId, source, speed });
    if (!result.ok) {
      if (result.error.code === 'timeout') {
        this.stop(appSessionId);
        this.cancelled.add(appSessionId);
      }
      this.index.sessions.remove(appSessionId);
      throw new CommandFailure(result.error);
    }
    if (fixture) this.index.fixtures.markPlayed(fixture.id, new Date().toISOString());
    const { totalRows, spanMs } = result.value as CommandOutput<'session.replay.launch'>;
    return { appSessionId, sessionId, totalRows, spanMs };
  }

  fixtures(): CommandOutput<'session.replay.fixtures'> {
    return { fixtures: this.index.fixtures.list() };
  }

  dispose(): void {
    for (const off of this.offs) off();
  }

  private progressed(progress: ReplayProgress): void {
    const appSessionId = progress.appSessionId as AppSessionId;
    if (this.cancelled.has(appSessionId)) {
      if (progress.state === 'stopped') {
        this.cancelled.delete(appSessionId);
        this.restopped.delete(appSessionId);
      } else this.lateRun(appSessionId);
      return;
    }
    if (progress.state !== 'stopped') return;
    try {
      this.index.sessions.remove(appSessionId);
    } catch (error) {
      console.error('[replay] the stopped run\'s record could not be removed:', error instanceof Error ? error.message : error);
    }
  }

  // A cancelled launch that started anyway (its success was the answer the supervisor dropped).
  private lateRun(appSessionId: AppSessionId): void {
    if (!this.cancelled.has(appSessionId) || this.restopped.has(appSessionId)) return;
    this.restopped.add(appSessionId);
    this.stop(appSessionId);
  }

  private stop(appSessionId: AppSessionId): void {
    void this.host.dispatch('engine-host', 'session.replay.control', { appSessionId, action: 'stop' }).then((result) => {
      if (!result.ok) console.error(`[replay] stopping ${appSessionId} failed:`, result.error.message);
    });
  }
}

export function registerReplayHandlers(index: Index, host: ReplayHostPort): ReplayStarter {
  const starter = new ReplayStarter(index, host);
  registerMainHandler('session.replay.start', (input) => starter.start(input));
  registerMainHandler('session.replay.fixtures', () => starter.fixtures());
  return starter;
}
