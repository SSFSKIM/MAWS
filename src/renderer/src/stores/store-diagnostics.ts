// The Store section's state (C4 execution document, M2): a diagnostics-only view of the engine host's filesystem
// state service, so C4's acceptance is observable before C5's sidebar exists. It subscribes to the `fs.*` events
// first, then asks for the `fs.state` snapshot (config home, watch, counts, live holders) and runs `fs.scan` so every
// session is listed even when the host's own start-up scan finished before this page loaded. Session rows arrive in
// bursts of thousands, so they are buffered and applied once per `flushMs`. M4 switches the rows to `session.list`.
import { create } from 'zustand';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { FsScanResult, FsState } from '@shared/ipc/schema/fs';
import type { Holder, TranscriptSummary } from '@shared/wire/store';
import { ipc } from '../ipc/client';

export interface StoreRow {
  summary: TranscriptSummary;
  appSessionId: AppSessionId | null;
}

export type ScanStatus =
  | { status: 'idle' }
  | { status: 'running'; progress: { scanned: number; total: number } | null }
  | { status: 'done'; result: FsScanResult }
  | { status: 'failed'; error: string };

export interface StoreDiagnosticsStore {
  fs: FsState | null; // the last fs.state snapshot; null until the host has answered
  sessions: Record<string, StoreRow>; // by engine session id
  holders: Record<string, Holder>; // live holders only, by engine session id
  scan: ScanStatus;
  connect(): () => void; // returns disconnect
}

const FLUSH_MS = 50;

export function createStoreDiagnosticsStore(client: MawsBridge, options: { flushMs?: number } = {}) {
  const flushMs = options.flushMs ?? FLUSH_MS;
  return create<StoreDiagnosticsStore>()((set, get) => ({
    fs: null,
    sessions: {},
    holders: {},
    scan: { status: 'idle' },
    connect() {
      let connected = true;
      const buffered = new Map<string, StoreRow | null>(); // null: removed
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      // Holder events are numbered so a snapshot answered after one can tell which of its entries are older.
      let holderSeq = 0;
      const lastHolderEvent = new Map<string, number>();

      const flush = () => {
        flushTimer = null;
        const sessions = { ...get().sessions };
        for (const [sessionId, row] of buffered) {
          if (row) sessions[sessionId] = row;
          else delete sessions[sessionId];
        }
        buffered.clear();
        set({ sessions });
      };
      const buffer = (sessionId: SessionId, row: StoreRow | null) => {
        buffered.set(sessionId, row);
        flushTimer ??= setTimeout(flush, flushMs);
      };
      const setHolder = (sessionId: string, holder: Holder) => {
        const holders = { ...get().holders };
        if (holder.kind === 'none') delete holders[sessionId];
        else holders[sessionId] = holder;
        set({ holders });
      };

      const offs = [
        client.on('fs.sessionChanged', ({ summary, appSessionId }) => buffer(summary.sessionId, { summary, appSessionId })),
        client.on('fs.sessionRemoved', ({ sessionId }) => buffer(sessionId, null)),
        client.on('fs.holderChanged', ({ sessionId, holder }) => {
          lastHolderEvent.set(sessionId, ++holderSeq);
          setHolder(sessionId, holder);
        }),
        client.on('fs.scanProgress', (progress) => {
          if (get().scan.status === 'running') set({ scan: { status: 'running', progress } });
        }),
      ];

      const readState = () => {
        const stamp = holderSeq;
        void client.invoke('fs.state', undefined).then((result) => {
          if (!connected) return;
          if (!result.ok) {
            console.error('[store] fs.state failed', result.error);
            return;
          }
          const holders: Record<string, Holder> = {};
          for (const { sessionId, holder } of result.value.holders) holders[sessionId] = holder;
          for (const [sessionId, seq] of lastHolderEvent) {
            if (seq <= stamp) continue;
            const current = get().holders[sessionId];
            if (current) holders[sessionId] = current;
            else delete holders[sessionId];
          }
          set({ fs: result.value, holders });
        });
      };

      readState();
      set({ scan: { status: 'running', progress: null } });
      void client.invoke('fs.scan', {}).then((result) => {
        if (!connected) return;
        if (!result.ok) {
          console.error('[store] fs.scan failed', result.error);
          set({ scan: { status: 'failed', error: result.error.message } });
          return;
        }
        set({ scan: { status: 'done', result: result.value } });
        readState();
      });

      return () => {
        connected = false;
        offs.forEach((off) => off());
        if (flushTimer) clearTimeout(flushTimer);
        buffered.clear();
      };
    },
  }));
}

export interface StoreRowView extends StoreRow {
  holder: Holder;
}

// Held sessions first, then the most recently written.
export function rowsOf(sessions: Record<string, StoreRow>, holders: Record<string, Holder>): StoreRowView[] {
  const none: Holder = { kind: 'none' };
  return Object.values(sessions)
    .map((row) => ({ ...row, holder: holders[row.summary.sessionId] ?? none }))
    .sort((a, b) => Number(b.holder.kind !== 'none') - Number(a.holder.kind !== 'none') || b.summary.mtimeMs - a.summary.mtimeMs);
}

export function titleOf(summary: TranscriptSummary): string {
  return summary.customTitle ?? summary.aiTitle ?? summary.firstPrompt ?? '(untitled)';
}

export function describeHolder(holder: Holder): string | null {
  switch (holder.kind) {
    case 'terminal':
      return `terminal · ${holder.pid}`;
    case 'background_job':
      return ['bg', holder.jobId, holder.pid].filter((part) => part !== null).join(' · ');
    case 'self':
      return 'MAWS';
    case 'none':
      return null;
  }
}

export const useStoreDiagnostics = createStoreDiagnosticsStore(ipc);
