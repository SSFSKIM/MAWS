// The Store section's state (C4 execution document, M2): a diagnostics-only view of the engine host's filesystem
// state service, so C4's acceptance is observable before C5's sidebar exists. It subscribes to the `fs.*` events
// first, then asks for the `fs.state` snapshot (config home, watch, counts, live holders) and runs `fs.scan` so every
// session is listed even when the host's own start-up scan finished before this page loaded. Session rows arrive in
// bursts of thousands, so they are buffered and applied once per `flushMs`. M4 switches the rows to `session.list`.
// Following (M3): one row at a time is followed through `session.events`; the view keeps its `fs.followState` and the
// last twenty events, hydrated as C6's protocol does: batches are buffered while the `session.events` snapshot is in
// flight, then the snapshot is applied and the buffer drained, deduplicated by event id (disk events carry `seq: null`).
import { create } from 'zustand';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
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

export type FollowState = EventPayload<'fs.followState'>;

export interface FollowView {
  sessionId: SessionId;
  appSessionId: AppSessionId;
  state: FollowState | null; // the session's own follower (agentId null); null until the host reports
  events: SessionEvent[]; // the last FOLLOW_LOG events delivered, oldest first
}

export interface StoreDiagnosticsStore {
  fs: FsState | null; // the last fs.state snapshot; null until the host has answered
  sessions: Record<string, StoreRow>; // by engine session id
  holders: Record<string, Holder>; // live holders only, by engine session id
  scan: ScanStatus;
  followed: FollowView | null;
  connect(): () => void; // returns disconnect
  follow(sessionId: SessionId): Promise<void>; // after connect; stops following whatever was followed before
  unfollow(): Promise<void>;
}

const FLUSH_MS = 50;
export const FOLLOW_LOG = 20;

export function createStoreDiagnosticsStore(client: MawsBridge, options: { flushMs?: number } = {}) {
  const flushMs = options.flushMs ?? FLUSH_MS;
  // Ids already in the followed view, so a snapshot overlapping its batches adds nothing twice.
  let seen = new Set<string>();
  // C6's hydration protocol: batches that arrive while the snapshot is in flight are newer than it, so they are held
  // here, applied after the snapshot and deduplicated by id; null once the view is live.
  let buffered: SessionEvent[] | null = null;
  const store = create<StoreDiagnosticsStore>()((set, get) => ({
    fs: null,
    sessions: {},
    holders: {},
    scan: { status: 'idle' },
    followed: null,
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
        client.on('fs.followState', (state) => {
          const followed = get().followed;
          if (followed?.appSessionId === state.appSessionId && state.agentId === null) set({ followed: { ...followed, state } });
        }),
        client.on('session.eventBatch', ({ appSessionId, events }) => addEvents(appSessionId, events)),
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

    async follow(sessionId) {
      if (get().followed) await get().unfollow();
      const row = get().sessions[sessionId];
      let appSessionId = row?.appSessionId ?? null;
      if (appSessionId === null) {
        // Diagnostics before the index (M4) binds every session: the page binds a fresh app id for the row it follows.
        appSessionId = crypto.randomUUID() as AppSessionId;
        const bound = await client.invoke('fs.bind', { bindings: [{ sessionId, appSessionId }] });
        if (!bound.ok) {
          console.error('[store] fs.bind failed', bound.error);
          return;
        }
        const current = get().sessions[sessionId];
        if (current) set({ sessions: { ...get().sessions, [sessionId]: { ...current, appSessionId } } });
      }
      seen = new Set();
      buffered = [];
      set({ followed: { sessionId, appSessionId, state: null, events: [] } });
      const snapshot = await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null });
      if (get().followed?.appSessionId !== appSessionId) return; // unfollowed or refollowed meanwhile
      if (!snapshot.ok) console.error('[store] session.events failed', snapshot.error);
      const held = buffered ?? [];
      buffered = null;
      applyEvents(appSessionId, [...(snapshot.ok ? snapshot.value.events : []), ...held]);
    },

    async unfollow() {
      const followed = get().followed;
      if (!followed) return;
      set({ followed: null });
      const result = await client.invoke('fs.unfollow', { appSessionId: followed.appSessionId, agentId: null });
      if (!result.ok) console.error('[store] fs.unfollow failed', result.error);
    },
  }));
  return store;

  function addEvents(appSessionId: AppSessionId, events: SessionEvent[]): void {
    if (store.getState().followed?.appSessionId !== appSessionId) return;
    if (buffered !== null) buffered.push(...events);
    else applyEvents(appSessionId, events);
  }

  function applyEvents(appSessionId: AppSessionId, events: SessionEvent[]): void {
    const followed = store.getState().followed;
    if (followed?.appSessionId !== appSessionId) return;
    const fresh: SessionEvent[] = [];
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      fresh.push(event);
    }
    if (fresh.length === 0) return;
    store.setState({ followed: { ...followed, events: [...followed.events, ...fresh].slice(-FOLLOW_LOG) } });
  }
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

export function describeFollow(state: FollowState | null): string {
  if (!state) return '…';
  const parts = [`chain ${state.chainLength}`, `leaf ${state.leafUuid?.slice(0, 8) ?? '—'}`, state.state];
  if (state.skippedLines > 0) parts.push(`skipped ${state.skippedLines}`);
  if (state.gap) parts.push(`gap at ${state.gap.parentUuid.slice(0, 8)}`);
  if (state.message) parts.push(state.message);
  return parts.join(' · ');
}

const DETAIL_CHARS = 50;

// One line per event for the log: its kind and the one detail that tells events of that kind apart.
export function describeEvent(event: SessionEvent): string {
  const detail = eventDetail(event);
  return detail === null ? event.kind : `${event.kind} · ${detail.length > DETAIL_CHARS ? `${detail.slice(0, DETAIL_CHARS)}…` : detail}`;
}

function eventDetail(event: SessionEvent): string | null {
  switch (event.kind) {
    case 'user.message':
      return typeof event.content === 'string' ? event.content : `${event.content.length} blocks`;
    case 'assistant.block.complete':
      return typeof event.block.text === 'string' ? event.block.text : event.block.type;
    case 'tool.use':
      return event.toolName;
    case 'tool.result':
      return event.isError ? 'error' : null;
    case 'boundary.rewind':
      return event.precedingAssistantUuid?.slice(0, 8) ?? null;
    case 'boundary.retraction':
      return `${event.retractedMessageUuids.length} retracted · ${event.reason}`;
    case 'notice.posted':
      return event.text;
    case 'subagent.started':
    case 'subagent.finished':
      return event.taskId;
    default:
      return null;
  }
}

export const useStoreDiagnostics = createStoreDiagnosticsStore(ipc);
