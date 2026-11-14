// Another machine's terminal session as a transcript (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, M9's
// Touches, "The view" and "Reads name the watch's subscription"): a `SessionPlane` over the page's lane A watch of the
// session (`watches.ts`: `laneA.watch`, its `laneA.plane` messages, `laneA.read`), under the lifted `plane-transcript.ts`,
// which maps the machine's DX4 rows through MAWS's backfill into the transcript store under the session's address.
//
// - The watch's subscription kinds go to the transcript; its session-wide kinds (requests, settlements, ops, presence)
//   are the lane A store's and the attention mirror's. Main forwards a replay resume as nothing at all, a transport pause
//   as `paused` (which the watch passes over), and a fresh snapshot after `reset`: a reset, and a watch that ended and is
//   opened again, are the transcript's `interrupted()`, its rows kept drawn until the fresh snapshot merges in.
// - Older rows, the diff and a job's output are asked of the watch (`laneA.read`, which names the watch's subscription in
//   main), their answers arriving on it as messages of their kind; a read (`status`, `mcp`, …) answers by its id.
// - A subagent's own transcript (2026-11-06, the remote drill-in) is a watch of its own naming the agent (main
//   subscribes with `rl2.agent-scope`), drawn under `<address>:<agent>`; its older rows and its jobs' output are asked of
//   that watch. Where the machine gives nothing, the transcript says why (`unserved`): main refused the watch (an
//   endpoint that can't carry it), or the machine paused it before anything came (main asks again); what the plane
//   delivers next clears it. Where the machine's endpoint lists no `rl2.agent-scope` the drill-in shows the port's gap
//   and builds none.
// - The session's presence (its snapshot's, and each `presence` message the main watch carries) goes to the transcript
//   too (`sessionPresence`): no live record there is the session's process gone, which ends the agents it left running
//   (X-168). Only a machine that is up publishes one; a link down pauses the watch and says nothing of the process.
// - One transcript per session, and one per subagent drilled into, for the page, held while a view shows it
//   (`useRemoteTranscript`, `useRemoteAgentTranscript`): opened at its first holder, closed at its last.
import { useEffect, useMemo } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { SUBSCRIPTION_KINDS, type SessionMessage } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf, bareOf, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useTranscriptStore } from '../stores/transcript';
import { PlaneTranscript } from './plane-transcript';
import { ReadError, type SessionPlane, type SubscriptionMessage, type UnansweredAsk } from './session-plane';
import { readLaneA, watchLaneA } from './watches';

const TRANSCRIPT_KINDS: ReadonlySet<string> = new Set(SUBSCRIPTION_KINDS.filter((kind) => kind !== 'end' && kind !== 'read'));
const isTranscriptMessage = (message: SessionMessage): message is SubscriptionMessage => TRANSCRIPT_KINDS.has(message.kind);

/** Why a subagent's own transcript shows nothing yet: main refused its watch, or the machine paused it (main asks again). */
export type Unserved = { kind: 'refused' | 'paused'; reason: string };

/**
 * The plane of other machines' terminal sessions, as this page's watches carry it. `unserved`: told why a subscription
 * shows nothing (a subagent's watch refused or paused), and null once the plane delivers.
 */
export function remotePlane(client: MawsBridge = ipc, hooks: { unserved?(why: Unserved | null): void; presence?(presence: { record?: unknown } | undefined): void } = {}): SessionPlane {
  return {
    subscribe(target, listener) {
      const appSessionId = addressOf(target.machine as MachineRef, target.session as AppSessionId);
      const { agentId } = target;
      let open = true;
      const off = watchLaneA(
        appSessionId,
        (event) => {
          if (!open) return;
          if (event.kind === 'messages') {
            hooks.unserved?.(null);
            for (const message of event.messages) {
              if (isTranscriptMessage(message)) listener.message(message);
              if (agentId === null && (message.kind === 'snapshot' || message.kind === 'presence')) hooks.presence?.(presenceOf(message)); // X-168
            }
          } else if (event.kind === 'resumed') listener.resumed?.(); // the link is back: nothing lost, no snapshot
          else if (event.kind === 'paused' || event.kind === 'refused') hooks.unserved?.({ kind: event.kind, reason: event.reason });
          else listener.interrupted(); // a reset, or a watch ended and opened again: a fresh snapshot follows
        },
        { replay: true, client, agentId },
      );
      // The answer comes on the watch; a read main could not carry (the link down) brings none, so the listener hears why.
      const ask = (unanswered: UnansweredAsk, args?: Record<string, unknown>) =>
        void readLaneA(appSessionId, unanswered.kind, client, args, agentId).then((answer) => {
          if (open && !answer.ok) listener.unanswered?.(unanswered, answer.message);
        });
      return {
        rows: (before, limit) => ask({ kind: 'rows' }, { before, limit }),
        diff: () => ask({ kind: 'diff' }),
        output: (taskId, tail) => ask({ kind: 'output', taskId }, { taskId, tail }),
        async read(what, args) {
          const answer = await readLaneA(appSessionId, what as 'status', client, args, agentId);
          if (answer.ok) return answer.result as never;
          throw new ReadError(answer.code, answer.message);
        },
        close() {
          open = false;
          off();
        },
      };
    },
  };
}

/** The presence a snapshot or a `presence` message carries. */
const presenceOf = (message: SessionMessage): { record?: unknown } | undefined => {
  const body = message.body as { presence?: unknown; record?: unknown } | null;
  const presence = message.kind === 'snapshot' ? body?.presence : body;
  return typeof presence === 'object' && presence !== null ? (presence as { record?: unknown }) : undefined;
};

interface Held {
  transcript: PlaneTranscript;
  holders: number;
}

const held = new Map<AppSessionId, Held>();

/** The page's transcript of a remote session, made at its first ask; opened while held. */
export function remoteTranscriptOf(appSessionId: AppSessionId, client: MawsBridge = ipc): PlaneTranscript {
  const kept = held.get(appSessionId);
  if (kept) return kept.transcript;
  const target = { machine: machineOf(appSessionId), session: bareOf(appSessionId), agentId: null };
  const plane = remotePlane(client, { presence: (presence) => transcript.sessionPresence(presence) });
  const transcript: PlaneTranscript = new PlaneTranscript({ plane, target, sessionKey: appSessionId, store: useTranscriptStore });
  held.set(appSessionId, { transcript, holders: 0 });
  return transcript;
}

/** The page's transcript of a remote session while something holds it, or null; never made here. */
export const heldRemoteTranscript = (appSessionId: AppSessionId): PlaneTranscript | null => held.get(appSessionId)?.transcript ?? null;

/** Holds the transcript open until the returned release; the last release closes it. */
export function holdRemoteTranscript(appSessionId: AppSessionId, transcript: PlaneTranscript): () => void {
  let entry = held.get(appSessionId);
  if (entry?.transcript !== transcript) held.set(appSessionId, (entry = { transcript, holders: 0 }));
  entry.holders += 1;
  if (entry.holders === 1) transcript.open();
  const holding = entry;
  return () => {
    holding.holders -= 1;
    if (holding.holders > 0) return;
    transcript.close();
    if (held.get(appSessionId) === holding) held.delete(appSessionId);
  };
}

/** A view's transcript of a remote session (null: none), held while the view is mounted. */
export function useRemoteTranscript(appSessionId: AppSessionId | null, client: MawsBridge = ipc): PlaneTranscript | null {
  const transcript = useMemo(() => (appSessionId === null ? null : remoteTranscriptOf(appSessionId, client)), [appSessionId, client]);
  useEffect(() => (appSessionId === null || transcript === null ? undefined : holdRemoteTranscript(appSessionId, transcript)), [appSessionId, transcript]);
  return transcript;
}

/** A subagent's own transcript of a remote session, and why it shows nothing yet (null once the plane delivers). */
export interface RemoteAgentTranscript {
  transcript: PlaneTranscript;
  unserved: StoreApi<{ why: Unserved | null }>;
}

const agentsHeld = new Map<string, RemoteAgentTranscript & { holders: number }>();
const agentKey = (appSessionId: AppSessionId, agentId: string) => `${appSessionId}:${agentId}`;

/** The page's transcript of a remote session's subagent, made at its first ask; opened while held. */
export function remoteAgentTranscriptOf(appSessionId: AppSessionId, agentId: string, client: MawsBridge = ipc): RemoteAgentTranscript {
  const kept = agentsHeld.get(agentKey(appSessionId, agentId));
  if (kept) return kept;
  const unserved = createStore<{ why: Unserved | null }>(() => ({ why: null }));
  const plane = remotePlane(client, { unserved: (why) => unserved.getState().why !== why && unserved.setState({ why }) });
  const target = { machine: machineOf(appSessionId), session: bareOf(appSessionId), agentId };
  const made = { transcript: new PlaneTranscript({ plane, target, sessionKey: appSessionId, store: useTranscriptStore }), unserved, holders: 0 };
  agentsHeld.set(agentKey(appSessionId, agentId), made);
  return made;
}

/** Holds the subagent's transcript open until the returned release; the last release closes it. */
export function holdRemoteAgentTranscript(appSessionId: AppSessionId, agentId: string, given: RemoteAgentTranscript): () => void {
  const key = agentKey(appSessionId, agentId);
  let entry = agentsHeld.get(key);
  if (entry?.transcript !== given.transcript) agentsHeld.set(key, (entry = { ...given, holders: 0 }));
  entry.holders += 1;
  if (entry.holders === 1) given.transcript.open();
  const holding = entry;
  return () => {
    holding.holders -= 1;
    if (holding.holders > 0) return;
    holding.transcript.close();
    if (agentsHeld.get(key) === holding) agentsHeld.delete(key);
  };
}

/** A view's transcript of a remote session's subagent, held while the view is mounted. */
export function useRemoteAgentTranscript(appSessionId: AppSessionId, agentId: string, client: MawsBridge = ipc): RemoteAgentTranscript {
  const made = useMemo(() => remoteAgentTranscriptOf(appSessionId, agentId, client), [appSessionId, agentId, client]);
  useEffect(() => holdRemoteAgentTranscript(appSessionId, agentId, made), [appSessionId, agentId, made]);
  return made;
}

// Tests: every transcript forgotten.
export function resetRemoteTranscripts(): void {
  for (const { transcript } of held.values()) transcript.close();
  held.clear();
  for (const { transcript } of agentsHeld.values()) transcript.close();
  agentsHeld.clear();
}
