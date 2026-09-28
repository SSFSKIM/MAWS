// The Store section's state (C4 execution document, M2 to M4): a diagnostics-only view of the engine's store as MAWS
// knows it, so C4's acceptance is observable before C5's sidebar exists. It subscribes first, then asks for the
// snapshots: `fs.state` (config home, watch), the index's session records (`session.list`, kept current by
// `session.changed` / `session.removed`) and project list (`session.projects.list` / `session.projects.changed`), and
// runs `fs.scan` for the store's counts. Record events that land while `session.list` is in flight are held and applied
// over the snapshot when newer than it (C5's revision rule); rows arrive in bursts of thousands, so they are buffered and
// applied once per `flushMs`.
// Following (M3): one row at a time is followed through `session.events`; the view keeps its `fs.followState` and the
// last twenty events, hydrated as C6's protocol does: batches are buffered while the `session.events` snapshot is in
// flight, then the snapshot is applied and the buffer drained, deduplicated by event id (disk events carry `seq: null`).
import { create } from 'zustand';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { FsScanResult, FsState } from '@shared/ipc/schema/fs';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import type { Holder } from '@shared/wire/store';
import { ipc } from '../ipc/client';

export type ScanStatus =
  | { status: 'idle' }
  | { status: 'running'; progress: { scanned: number; total: number } | null }
  | { status: 'done'; result: FsScanResult }
  | { status: 'failed'; error: string };

export type FollowState = EventPayload<'fs.followState'>;

export interface FollowView {
  appSessionId: AppSessionId;
  state: FollowState | null; // the session's own follower (agentId null); null until the host reports
  events: SessionEvent[]; // the last FOLLOW_LOG events delivered, oldest first
}

export interface StoreDiagnosticsStore {
  fs: FsState | null; // the last fs.state snapshot; null until the host has answered
  records: Record<string, SessionRecord>; // the index's records by app session id, archived ones included
  projects: ProjectRecord[] | null; // the index's visible projects; null until main has answered
  scan: ScanStatus;
  followed: FollowView | null;
  connect(): () => void; // returns disconnect
  follow(appSessionId: AppSessionId): Promise<void>; // after connect; stops following whatever was followed before
  unfollow(): Promise<void>;
}

const FLUSH_MS = 50;
export const FOLLOW_LOG = 20;

type RecordChange = { revision: number; record: SessionRecord | null }; // null: removed

export function createStoreDiagnosticsStore(client: MawsBridge, options: { flushMs?: number } = {}) {
  const flushMs = options.flushMs ?? FLUSH_MS;
  // Ids already in the followed view, so a snapshot overlapping its batches adds nothing twice.
  let seen = new Set<string>();
  // C6's hydration protocol: batches that arrive while the snapshot is in flight are newer than it, so they are held
  // here, applied after the snapshot and deduplicated by id; null once the view is live.
  let heldBatches: SessionEvent[] | null = null;
  // Each follow's own token: a snapshot answered for an earlier follow of the same row (unfollow, then follow again)
  // must neither be applied nor drain the current follow's buffer.
  let followToken = 0;
  const store = create<StoreDiagnosticsStore>()((set, get) => ({
    fs: null,
    records: {},
    projects: null,
    scan: { status: 'idle' },
    followed: null,
    connect() {
      let connected = true;
      // Record changes waiting for the next flush; while `session.list` is in flight they wait for it instead.
      const buffered = new Map<string, RecordChange>();
      let listed = false;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let projectsRevision = -1;

      const flush = () => {
        flushTimer = null;
        if (!listed) return;
        const records = { ...get().records };
        for (const [appId, { record }] of buffered) {
          if (record) records[appId] = record;
          else delete records[appId];
        }
        buffered.clear();
        set({ records });
      };
      const buffer = (appId: AppSessionId, change: RecordChange) => {
        buffered.set(appId, change);
        if (listed) flushTimer ??= setTimeout(flush, flushMs);
      };
      const setProjects = (projects: ProjectRecord[], revision: number) => {
        if (revision < projectsRevision) return;
        projectsRevision = revision;
        set({ projects });
      };

      const offs = [
        client.on('session.changed', ({ record, revision }) => buffer(record.appId, { revision, record })),
        client.on('session.removed', ({ appSessionId, revision }) => buffer(appSessionId, { revision, record: null })),
        client.on('session.projects.changed', ({ projects, revision }) => setProjects(projects, revision)),
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
        void client.invoke('fs.state', undefined).then((result) => {
          if (!connected) return;
          if (!result.ok) console.error('[store] fs.state failed', result.error);
          else set({ fs: result.value });
        });
      };

      readState();
      void client.invoke('session.list', { includeArchived: true }).then((result) => {
        if (!connected) return;
        if (!result.ok) console.error('[store] session.list failed', result.error);
        const snapshot = result.ok ? result.value : { sessions: [], revision: -1 };
        const records: Record<string, SessionRecord> = {};
        for (const record of snapshot.sessions) records[record.appId] = record;
        // What changed after the snapshot was taken wins over it; what it already holds is dropped.
        for (const [appId, change] of buffered) {
          if (change.revision <= snapshot.revision) continue;
          if (change.record) records[appId] = change.record;
          else delete records[appId];
        }
        buffered.clear();
        listed = true;
        set({ records });
      });
      void client.invoke('session.projects.list', undefined).then((result) => {
        if (!connected) return;
        if (!result.ok) console.error('[store] session.projects.list failed', result.error);
        else setProjects(result.value.projects, result.value.revision);
      });
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

    async follow(appSessionId) {
      if (get().followed) await get().unfollow();
      const token = ++followToken;
      seen = new Set();
      heldBatches = [];
      set({ followed: { appSessionId, state: null, events: [] } });
      const snapshot = await client.invoke('session.events', { appSessionId, afterSeq: null, limit: null });
      if (token !== followToken) return; // unfollowed or followed again meanwhile
      if (!snapshot.ok) console.error('[store] session.events failed', snapshot.error);
      const held = heldBatches ?? [];
      heldBatches = null;
      applyEvents(appSessionId, [...(snapshot.ok ? snapshot.value.events : []), ...held]);
    },

    async unfollow() {
      const followed = get().followed;
      if (!followed) return;
      followToken += 1;
      heldBatches = null;
      set({ followed: null });
      const result = await client.invoke('fs.unfollow', { appSessionId: followed.appSessionId, agentId: null });
      if (!result.ok) console.error('[store] fs.unfollow failed', result.error);
    },
  }));
  return store;

  function addEvents(appSessionId: AppSessionId, events: SessionEvent[]): void {
    if (store.getState().followed?.appSessionId !== appSessionId) return;
    if (heldBatches !== null) heldBatches.push(...events);
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

const held = (holder: Holder) => holder.kind !== 'none';

// The rows the section lists: records not archived, held sessions first, then the most recently changed.
export function rowsOf(records: Record<string, SessionRecord>): SessionRecord[] {
  return Object.values(records)
    .filter((record) => !record.archived)
    .sort((a, b) => Number(held(b.holder)) - Number(held(a.holder)) || b.updatedAt.localeCompare(a.updatedAt));
}

export function titleOf(record: SessionRecord): string {
  return record.title.text === '' ? '(untitled)' : record.title.text;
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
