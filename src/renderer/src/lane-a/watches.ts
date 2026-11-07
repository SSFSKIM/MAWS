// The page's lane A watches (P5 O9 M5, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M2's "Each watch is its own
// stream" and Interfaces §A): one `laneA.watch` per session per page, shared by everything on the page that reads the
// session's plane (the transcript's streaming overlay, the side question's answers, a command's outcome, the MCP
// widget). A watch is opened while a consumer holds it and the session's bridge is live or starting (the lane A store
// says), and let go with its last consumer. Its first message is its own snapshot, so a consumer that comes later asks to
// be replayed the snapshot and what followed it (`replay`), and starts from the text already streamed. Past the replay
// bound (LOG_MAX messages since the snapshot) there is nothing to replay from, so such a consumer has the watch opened
// again: the consumers before it hear a reset, and all of them the new watch's snapshot. A `reset` (the
// stream lost events, or the bridge's stream ended under the watch) is passed on, and the fresh snapshot follows as a
// message. An `ended` watch is gone: it is opened again once the bridge is live again.
//
// DX4 messages cross IPC as JSON values; they are read here as `desk-hub/protocol`'s `SessionMessage`. A page hears every
// window's `laneA.plane` and reads only its own watch ids.
//
// The jobs a snapshot or a `subagents` message carries are kept in the lane A store (`useLaneAJobs`).
//
// The session-wide `op` and `compact` messages are kept by their op's id (the last 100 ops per session), so a caller that
// learns an id from a control's answer after its op already ended still finds the op's messages.
//
// P5 O9 M9: another machine's terminal session (`remote-session.ts`) has a state only while a watch of it is open (main's
// remote adapter folds it from the watch's subscription), so it is watchable whatever its state says, and its plane is
// the transcript's too (`remote-source.ts`), whose older rows, diff and outputs are asked of the watch (`readLaneA`).
//
// 2026-11-06 (the remote lane A drill-in): one subagent's own transcript of such a session is a watch of its own
// (`agentId`), shared by that agent's consumers alone. It carries that transcript and nothing of the session's, so no
// usage, jobs or ops are taken from it. Its consumers hear what they need to say why it shows nothing: the machine's
// pause (`paused`, main's word for a link down or a subscription the machine ended, which main asks again) and main's
// refusal of the watch (`refused`, an endpoint that can't carry it).
import type { SessionMessage } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandResult, EventPayload, MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import type { Job } from 'desk-hub/protocol';
import { laneAJobsWatchEnded, noteLaneAJobs, noteLaneAUsage, useLaneA, type LaneAUsage } from '../stores/lane-a';
import { isRemoteLaneA } from './remote-session';

// `resumed` (P5 O9 M9): a remote link's transport is back after a pause, the watch going on as it was (never a reset).
export type PlaneEvent =
  | { kind: 'messages'; messages: SessionMessage[] }
  | { kind: 'reset' }
  | { kind: 'ended'; reason: string }
  | { kind: 'resumed' }
  // a subagent's watch only (2026-11-06): the machine's pause, and main's refusal of the watch
  | { kind: 'paused'; reason: string }
  | { kind: 'refused'; reason: string };

type Payload = EventPayload<'laneA.plane'>;
type ReadOutput = Extract<CommandResult<'laneA.read'>, { ok: true }>['value'];

interface Watcher {
  listener: (event: PlaneEvent) => void;
}

interface Entry {
  client: MawsBridge;
  agentId: string | null; // a subagent's own transcript; null for the session's watch
  watchers: Set<Watcher>;
  watch: string | null;
  opening: Promise<void> | null; // the open in flight
  early: Payload[]; // what arrived while the open was in flight, its watch id not known yet
  log: SessionMessage[] | null; // the latest snapshot and what followed it, for a consumer that comes later
  overflowed: boolean; // the log was let go past LOG_MAX: a later consumer needs a fresh snapshot
  off: () => void;
}

const LOG_MAX = 20_000; // past it a later consumer starts at the next snapshot
const OPS_KEPT = 100;

const entries = new Map<string, Entry>();
const keyOf = (appSessionId: AppSessionId, agentId: string | null) => (agentId === null ? appSessionId : `${appSessionId}:${agentId}`);
const ops = new Map<AppSessionId, Map<string, SessionMessage[]>>();

const watchable = (appSessionId: AppSessionId): boolean => {
  const bridge = useLaneA.getState().states.get(appSessionId)?.bridge;
  return bridge === 'live' || bridge === 'starting' || isRemoteLaneA(appSessionId);
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
  const session = entry.agentId === null; // the session's own watch: what it carries is the session's
  if ('messages' in payload) {
    const messages = payload.messages as unknown as SessionMessage[];
    if (session) {
      keepOps(appSessionId, messages);
      for (const message of messages) {
        const usage = message.kind === 'usage' ? message.body : message.kind === 'snapshot' ? (message.body as { usage?: unknown }).usage : null;
        if (usage && typeof usage === 'object' && 'context' in usage) noteLaneAUsage(appSessionId, usage as LaneAUsage);
        const jobs = message.kind === 'snapshot' || message.kind === 'subagents' ? (message.body as { jobs?: unknown }).jobs : undefined;
        if (Array.isArray(jobs)) noteLaneAJobs(appSessionId, jobs as Job[]);
      }
    }
    if (messages[0]?.kind === 'snapshot') {
      entry.log = [...messages];
      entry.overflowed = false;
    } else if (entry.log !== null) {
      entry.overflowed = entry.log.length + messages.length > LOG_MAX;
      entry.log = entry.overflowed ? null : [...entry.log, ...messages];
    }
    tell(entry, { kind: 'messages', messages });
  } else if ('reset' in payload) {
    entry.log = null;
    entry.overflowed = false; // the fresh snapshot follows
    tell(entry, { kind: 'reset' });
  } else if ('ended' in payload) {
    entry.watch = null;
    entry.log = null;
    entry.overflowed = false;
    if (session) laneAJobsWatchEnded(appSessionId);
    tell(entry, { kind: 'ended', reason: payload.ended });
    open(appSessionId, entry);
  } else if ('resumed' in payload) {
    tell(entry, { kind: 'resumed' }); // the replay log stands: nothing was lost
  } else if ('paused' in payload && !session) {
    tell(entry, { kind: 'paused', reason: payload.paused }); // a subagent's drill-in says why it shows nothing yet
  }
  // the session's `paused` is a remote link's transport state (M9): the state's link reason says it, and nothing is redrawn
}

function open(appSessionId: AppSessionId, entry: Entry): void {
  if (entry.watch !== null || entry.opening !== null || entry.watchers.size === 0 || !watchable(appSessionId)) return;
  entry.early = [];
  entry.opening = entry.client.invoke('laneA.watch', { appSessionId, ...(entry.agentId !== null && { agentId: entry.agentId }) }).then((result) => {
    entry.opening = null;
    const early = entry.early;
    entry.early = [];
    if (!result.ok) {
      // the bridge went meanwhile (the next live state opens it again); a subagent's consumers hear why
      if (entry.agentId !== null && entries.get(keyOf(appSessionId, entry.agentId)) === entry) tell(entry, { kind: 'refused', reason: result.error.message });
      return;
    }
    const { watch } = result.value;
    if (entries.get(keyOf(appSessionId, entry.agentId)) !== entry || entry.watchers.size === 0) {
      void entry.client.invoke('laneA.unwatch', { appSessionId, watch });
      return;
    }
    entry.watch = watch;
    for (const payload of early) if (payload.watch === watch && entry.watch === watch) receive(appSessionId, entry, payload);
  });
}

function entryFor(appSessionId: AppSessionId, client: MawsBridge, agentId: string | null): Entry {
  const key = keyOf(appSessionId, agentId);
  const held = entries.get(key);
  if (held) return held;
  const entry: Entry = { client, agentId, watchers: new Set(), watch: null, opening: null, early: [], log: null, overflowed: false, off: () => {} };
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
  entries.set(key, entry);
  return entry;
}

// Reads the session's plane while the returned disposer is not called. `replay`: first hear the latest snapshot and what
// followed it, when the page's watch already had one. `agentId` (another machine's session): one subagent's transcript.
export function watchLaneA(appSessionId: AppSessionId, listener: (event: PlaneEvent) => void, { replay = false, client = ipc, agentId = null }: { replay?: boolean; client?: MawsBridge; agentId?: string | null } = {}): () => void {
  const key = keyOf(appSessionId, agentId);
  const entry = entryFor(appSessionId, client, agentId);
  const watcher: Watcher = { listener };
  if (replay && entry.log !== null) listener({ kind: 'messages', messages: [...entry.log] });
  else if (replay && entry.overflowed && entry.watch !== null) {
    void entry.client.invoke('laneA.unwatch', { appSessionId, watch: entry.watch });
    entry.watch = null;
    entry.overflowed = false;
    tell(entry, { kind: 'reset' });
  }
  entry.watchers.add(watcher);
  open(appSessionId, entry);
  return () => {
    if (!entry.watchers.delete(watcher) || entry.watchers.size > 0) return;
    entry.off();
    entries.delete(key);
    if (entry.watch !== null) void entry.client.invoke('laneA.unwatch', { appSessionId, watch: entry.watch });
    entry.watch = null;
  };
}

// A read of the session's bridge (`laneA.read`), which names a watch of this page: the page's, held across the read. M9:
// a remote session's `rows`, `diff` and `output` answer `{requested: true}`, their answers arriving on the watch.
// `agentId`: a remote subagent's own watch (its `rows` and `output`).
export async function readLaneA(appSessionId: AppSessionId, kind: CommandInput<'laneA.read'>['kind'], client: MawsBridge = ipc, args?: Record<string, unknown>, agentId: string | null = null): Promise<ReadOutput> {
  const key = keyOf(appSessionId, agentId);
  const off = watchLaneA(appSessionId, () => {}, { client, agentId });
  try {
    const entry = entries.get(key);
    if (entry?.opening) await entry.opening;
    const watch = entries.get(key)?.watch ?? null;
    if (watch === null) return { ok: false, code: 'no-bridge', message: 'The session’s bridge is not live' };
    const result = await client.invoke('laneA.read', { appSessionId, watch, kind, ...(args !== undefined && { args }) });
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
