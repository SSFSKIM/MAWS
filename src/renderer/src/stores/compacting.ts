// Whether a session compacts, and since when by this window's clock (UX wave U3b, M4; docs/doperpowers/plans/2026-11-15-
// ux-wave-U3b-transcript-rows-find.md, decision 16 and Interfaces §E): the one place the two signals are read. A session
// MAWS runs says it through its engine status (`activity: 'compacting'` while its process is ready, set by the engine
// host from the engine's `system/status`, the same for a typed and an automatic compaction); a terminal session through
// its sminos bridge's `compact` messages of phase `start` and `end`, held by the operation's id (`lane-a/watches.ts`).
// The two sources never feed one session. The clock starts when this window first sees the compaction and is not
// restarted by the engine's repeat of its status every thirty seconds. Nothing is stored: it lives in the window's memory.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { useLaneA } from './lane-a';
import { useSessions } from './sessions';
import { useTranscriptStore } from './transcript';

export type CompactingSource = { kind: 'engine' } | { kind: 'bridge'; rpc: string };

interface Held {
  since: number; // ms since the epoch, this window's clock
  source: CompactingSource;
}

interface CompactingState {
  held: ReadonlyMap<AppSessionId, Held>;
}

export const useCompacting = create<CompactingState>(() => ({ held: new Map() }));

const ENGINE: CompactingSource = { kind: 'engine' };
const sameSource = (a: CompactingSource, b: CompactingSource) => (a.kind === 'engine' ? b.kind === 'engine' : b.kind === 'bridge' && a.rpc === b.rpc);

function put(appSessionId: AppSessionId, held: Held | null): void {
  const next = new Map(useCompacting.getState().held);
  if (held === null) next.delete(appSessionId);
  else next.set(appSessionId, held);
  useCompacting.setState({ held: next });
}

/** One word of a source. `on` keeps a compaction already seen at the time it was first seen (the engine's repeat; a
 *  second `start` while one runs, which then holds it); off ends it only when the source that holds it says so (a
 *  bridge's `end` for another operation leaves it on). */
export function noteCompacting(appSessionId: AppSessionId, source: CompactingSource, on: boolean): void {
  const current = useCompacting.getState().held.get(appSessionId);
  if (on) {
    if (current === undefined) put(appSessionId, { since: Date.now(), source });
    else if (!sameSource(current.source, source)) put(appSessionId, { since: current.since, source });
  } else if (current !== undefined && sameSource(current.source, source)) put(appSessionId, null);
}

/** Ends whatever compaction the window holds for the session: its bridge's watch reset or ended, its bridge gone. */
export function clearCompacting(appSessionId: AppSessionId): void {
  if (useCompacting.getState().held.has(appSessionId)) put(appSessionId, null);
}

/** When the session's compaction began by this window's clock, or null while it does not compact. */
export function useCompactingSince(appSessionId: AppSessionId | null): number | null {
  return useCompacting((state) => (appSessionId === null ? null : (state.held.get(appSessionId)?.since ?? null)));
}

const compactingNow = (status: EngineSessionStatus) => status.activity === 'compacting' && status.process === 'ready';

/** Follows the sessions store's engine statuses, the lane A store's bridges and the transcript store's rows while the
 *  returned disposer is not called (`transcript/shell.tsx`). */
export function connectCompacting(): () => void {
  const followEngine = (engine: ReadonlyMap<AppSessionId, EngineSessionStatus>, before: ReadonlyMap<AppSessionId, EngineSessionStatus>) => {
    for (const [appSessionId, status] of engine) noteCompacting(appSessionId, ENGINE, compactingNow(status));
    for (const appSessionId of before.keys()) if (!engine.has(appSessionId)) noteCompacting(appSessionId, ENGINE, false); // its status removed
  };
  followEngine(useSessions.getState().engine, new Map());
  const offSessions = useSessions.subscribe((state, before) => {
    if (state.engine !== before.engine) followEngine(state.engine, before.engine);
  });
  // A terminal session's compaction ends with its bridge leaving `live` (or its state going), whatever the bridge said
  const offLaneA = useLaneA.subscribe((state, before) => {
    if (state.states === before.states) return;
    for (const [appSessionId, held] of useCompacting.getState().held) {
      if (held.source.kind !== 'bridge') continue;
      if (before.states.get(appSessionId)?.bridge === 'live' && state.states.get(appSessionId)?.bridge !== 'live') clearCompacting(appSessionId);
    }
  });
  // ... and with a compaction's boundary that reaches its transcript after the compaction began. A session's transcript
  // is kept under its id, on this machine's route and on another machine's (`ipcSource`, `remoteTranscriptOf`). Read
  // only while a bridge holds one, and only for a key whose rows changed.
  const offRows = useTranscriptStore.subscribe((state, before) => {
    for (const [appSessionId, held] of useCompacting.getState().held) {
      if (held.source.kind !== 'bridge') continue;
      const rows = state.entries[appSessionId]?.rows;
      if (rows === undefined || rows === before.entries[appSessionId]?.rows) continue;
      if (rows.some((row) => row.kind === 'boundary' && row.boundaryKind === 'compaction' && Date.parse(row.at) > held.since)) clearCompacting(appSessionId);
    }
  });
  return () => {
    offSessions();
    offLaneA();
    offRows();
  };
}
