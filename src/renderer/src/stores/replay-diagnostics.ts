// The replay controls of the Store section (C4 execution document, M5; acceptance item 6): the fixtures the index lists,
// a start at a chosen speed, and every run the host reports progress for, with pause, resume, speed and stop. A run
// is forgotten once it reports `stopped` (main removes its record then); a `done` run stays until it is stopped.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ReplayFixture, ReplayProgress, Speed } from '@shared/ipc/schema/session';
import { ipc } from '../ipc/client';

export const SPEEDS: Speed[] = [0.25, 0.5, 1, 2, 5, 10, 50, 'instant'];

export interface ReplayRun {
  name: string; // the fixture's name, or the app session id for a run another page started
  progress: ReplayProgress | null; // null until the host's first report
}

export interface ReplayDiagnosticsStore {
  fixtures: ReplayFixture[];
  runs: Record<string, ReplayRun>; // by app session id
  error: string | null; // the last start that failed
  connect(): () => void;
  start(fixture: ReplayFixture, speed: Speed): Promise<void>;
  control(appSessionId: AppSessionId, change: { action?: 'pause' | 'resume' | 'stop'; speed?: Speed }): Promise<void>;
}

export function createReplayDiagnosticsStore(client: MawsBridge) {
  return create<ReplayDiagnosticsStore>()((set, get) => ({
    fixtures: [],
    runs: {},
    error: null,
    connect() {
      let connected = true;
      const off = client.on('session.replay.progress', (progress) => {
        const runs = { ...get().runs };
        if (progress.state === 'stopped') delete runs[progress.appSessionId];
        else runs[progress.appSessionId] = { name: runs[progress.appSessionId]?.name ?? progress.appSessionId, progress };
        set({ runs });
      });
      void client.invoke('session.replay.fixtures', undefined).then((result) => {
        if (!connected) return;
        if (result.ok) set({ fixtures: result.value.fixtures });
        else console.error('[replay] session.replay.fixtures failed', result.error);
      });
      return () => {
        connected = false;
        off();
      };
    },
    async start(fixture, speed) {
      set({ error: null });
      const result = await client.invoke('session.replay.start', { source: { kind: fixture.kind, path: fixture.path }, speed });
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      const { appSessionId } = result.value;
      // The run may already have reported (an instant run can finish before the start answers).
      set({ runs: { ...get().runs, [appSessionId]: { name: fixture.name, progress: get().runs[appSessionId]?.progress ?? null } } });
    },
    async control(appSessionId, change) {
      const result = await client.invoke('session.replay.control', { appSessionId, ...change });
      if (!result.ok) set({ error: result.error.message });
    },
  }));
}

export function describeSpeed(speed: Speed): string {
  return speed === 'instant' ? 'instant' : `${speed}×`;
}

// `running · i / total · 5×`, the acceptance's label.
export function describeProgress(progress: ReplayProgress | null): string {
  if (!progress) return 'starting…';
  const parts = [progress.state, `${progress.index} / ${progress.total}`, describeSpeed(progress.speed)];
  if (progress.message) parts.push(progress.message);
  return parts.join(' · ');
}

export const useReplayDiagnostics = createReplayDiagnosticsStore(ipc);
