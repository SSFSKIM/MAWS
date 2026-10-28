// The page's lane A watches (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M2's "Each watch is its own
// stream" and Interfaces §A): one `laneA.watch` per session per page, shared by everything on the page that reads the
// session's plane (the transcript's streaming overlay, the side question's answers, a command's outcome, the MCP
// widget). A watch is opened while a consumer holds it and the session's bridge is live or starting (the lane A store
// says), and let go with its last consumer. Its first message is its own snapshot, so a consumer that comes later asks to
// be replayed the snapshot and what followed it (`replay`), and starts from the text already streamed; a `reset` (the
// stream lost events, or the bridge's stream ended under the watch) is passed on, and the fresh snapshot follows as a
// message. An `ended` watch is gone: it is opened again once the bridge is live again.
//
// DX4 messages cross IPC as JSON values; they are read here as `desk-hub/protocol`'s `SessionMessage`. A page hears every
// window's `laneA.plane` and reads only its own watch ids.
//
// The session-wide `op` and `compact` messages are kept by their op's id (the last 100 ops per session), so a caller that
// learns an id from a control's answer after its op already ended still finds the op's messages.
import type { SessionMessage } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, EventPayload, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { noteLaneAUsage, useLaneA, type LaneAUsage } from '../stores/lane-a';

export type PlaneEvent = { kind: 'messages'; messages: SessionMessage[] } | { kind: 'reset' } | { kind: 'ended'; reason: string };

type Payload = EventPayload<'laneA.plane'>;
type ReadOutput = Extract<CommandResult<'laneA.read'>, { ok: true }>['value'];

interface Watcher {
  listener: (event: PlaneEvent) => void;
}

interface Entry {
  client: MawsBridge;
  watchers: Set<Watcher>;
  watch: string | null;
  opening: Promise<void> | null; // the open in flight
  early: Payload[]; // what arrived while the open was in flight, its watch id not known yet
  log: SessionMessage[] | null; // the latest snapshot and what followed it, for a consumer that comes later
  off: () => void;
}

const LOG_MAX = 20_000; // past it a later consumer starts at the next snapshot
const OPS_KEPT = 100;

const entries = new Map<AppSessionId, Entry>();
const ops = new Map<AppSessionId, Map<string, SessionMessage[]>>();

const watchable = (appSessionId: AppSessionId): boolean => {
  const bridge = useLaneA.getState().states.get(appSessionId)?.bridge;
  return bridge === 'live' || bridge === 'starting';
};

const tell = (entry: Entry, event: PlaneEvent) => {
  for (const watcher of [...entry.watchers]) watcher.listener(event);
};

function keepOps(appSessionId: AppSessionId, messages: readonly SessionMessage[]): void {
  for (const message of messages) {
    if (message.kind !== 'op' && message.kind !== 'compact') continue;
    const body = message.body as { id?: unknown; rpc?: unknown };
    const id = message.kind === 'op' ? body.id : body.rpc;
    if (typeof id !== 'string') continue;
    let kept = ops.get(appSessionId);
    if (!kept) ops.set(appSessionId, (kept = new Map()));
    kept.set(id, [...(kept.get(id) ?? []), message]);
    while (kept.size > OPS_KEPT) kept.delete(kept.keys().next().value as string);
  }
}

// The `op` (or `compact`) messages seen for an op id on this page, oldest first.
export const opMessagesOf = (appSessionId: AppSessionId, opId: string): readonly SessionMessage[] => ops.get(appSessionId)?.get(opId) ?? [];

function receive(appSessionId: AppSessionId, entry: Entry, payload: Payload): void {
  if ('messages' in payload) {
    const messages = payload.messages as unknown as SessionMessage[];
    keepOps(appSessionId, messages);
    for (const message of messages) {
      const usage = message.kind === 'usage' ? message.body : message.kind === 'snapshot' ? (message.body as { usage?: unknown }).usage : null;
      if (usage && typeof usage === 'object' && 'context' in usage) noteLaneAUsage(appSessionId, usage as LaneAUsage);
    }
    if (messages[0]?.kind === 'snapshot') entry.log = [...messages];
    else if (entry.log !== null) entry.log = entry.log.length + messages.length > LOG_MAX ? null : [...entry.log, ...messages];
    tell(entry, { kind: 'messages', messages });
  } else if ('reset' in payload) {
    entry.log = null;
    tell(entry, { kind: 'reset' });
  } else if ('ended' in payload) {
    entry.watch = null;
    entry.log = null;
    tell(entry, { kind: 'ended', reason: payload.ended });
    open(appSessionId, entry);
  }
  // `paused` and `resumed` are a remote link's transport state (M9): nothing to redraw locally
}

function open(appSessionId: AppSessionId, entry: Entry): void {
  if (entry.watch !== null || entry.opening !== null || entry.watchers.size === 0 || !watchable(appSessionId)) return;
  entry.early = [];
  entry.opening = entry.client.invoke('laneA.watch', { appSessionId }).then((result) => {
    entry.opening = null;
    const early = entry.early;
    entry.early = [];
    if (!result.ok) return; // the bridge went meanwhile; the next live state opens it again
    const { watch } = result.value;
    if (entries.get(appSessionId) !== entry || entry.watchers.size === 0) {
      void entry.client.invoke('laneA.unwatch', { appSessionId, watch });
      return;
    }
    entry.watch = watch;
    for (const payload of early) if (payload.watch === watch && entry.watch === watch) receive(appSessionId, entry, payload);
  });
}

function entryFor(appSessionId: AppSessionId, client: MawsBridge): Entry {
  const held = entries.get(appSessionId);
  if (held) return held;
  const entry: Entry = { client, watchers: new Set(), watch: null, opening: null, early: [], log: null, off: () => {} };
  const offPlane = client.on('laneA.plane', (payload) => {
    if (payload.appSessionId !== appSessionId) return;
    if (entry.watch === null) {
      if (entry.opening !== null) entry.early.push(payload);
      return;
    }
    if (payload.watch === entry.watch) receive(appSessionId, entry, payload);
  });
  const offStore = useLaneA.subscribe((state, before) => {
    if (state.states.get(appSessionId) !== before.states.get(appSessionId)) open(appSessionId, entry);
  });
  entry.off = () => {
    offPlane();
    offStore();
  };
  entries.set(appSessionId, entry);
  return entry;
}

// Reads the session's plane while the returned disposer is not called. `replay`: first hear the latest snapshot and what
// followed it, when the page's watch already had one.
export function watchLaneA(appSessionId: AppSessionId, listener: (event: PlaneEvent) => void, { replay = false, client = ipc }: { replay?: boolean; client?: MawsBridge } = {}): () => void {
  const entry = entryFor(appSessionId, client);
  const watcher: Watcher = { listener };
  if (replay && entry.log !== null) listener({ kind: 'messages', messages: [...entry.log] });
  entry.watchers.add(watcher);
  open(appSessionId, entry);
  return () => {
    if (!entry.watchers.delete(watcher) || entry.watchers.size > 0) return;
    entry.off();
    entries.delete(appSessionId);
    if (entry.watch !== null) void entry.client.invoke('laneA.unwatch', { appSessionId, watch: entry.watch });
    entry.watch = null;
  };
}

// A read of the session's bridge (`laneA.read`), which names a watch of this page: the page's, held across the read.
export async function readLaneA(appSessionId: AppSessionId, kind: 'usage' | 'config' | 'settings' | 'mcp' | 'status', client: MawsBridge = ipc): Promise<ReadOutput> {
  const off = watchLaneA(appSessionId, () => {}, { client });
  try {
    const entry = entries.get(appSessionId);
    if (entry?.opening) await entry.opening;
    const watch = entries.get(appSessionId)?.watch ?? null;
    if (watch === null) return { ok: false, code: 'no-bridge', message: 'The session’s bridge is not live' };
    const result = await client.invoke('laneA.read', { appSessionId, watch, kind });
    return result.ok ? result.value : { ok: false, code: 'failed', message: result.error.message };
  } finally {
    off();
  }
}

// Tests: every watch forgotten (nothing is unwatched).
export function resetLaneAWatches(): void {
  for (const entry of entries.values()) entry.off();
  entries.clear();
  ops.clear();
}
