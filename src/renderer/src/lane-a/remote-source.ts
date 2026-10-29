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
// - The machine serves no agent-scoped subscription: a subagent's own transcript is a gap, ended with its reason.
// - One transcript per session for the page, held while a view shows it (`useRemoteTranscript`): opened at its first
//   holder, closed at its last.
import { useEffect, useMemo } from 'react';
import { SUBSCRIPTION_KINDS, type SessionMessage } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { addressOf, bareOf, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { LANE_A_WORDS } from '../session/controls/lane-a';
import { useTranscriptStore } from '../stores/transcript';
import { PlaneTranscript } from './plane-transcript';
import { ReadError, type SessionPlane, type Subscription, type SubscriptionMessage } from './session-plane';
import { readLaneA, watchLaneA } from './watches';

const TRANSCRIPT_KINDS: ReadonlySet<string> = new Set(SUBSCRIPTION_KINDS.filter((kind) => kind !== 'end' && kind !== 'read'));
const isTranscriptMessage = (message: SessionMessage): message is SubscriptionMessage => TRANSCRIPT_KINDS.has(message.kind);

const INERT: Subscription = { rows: () => {}, diff: () => {}, output: () => {}, read: () => Promise.reject(new ReadError('unsupported', LANE_A_WORDS.remoteSubagentRows)), close: () => {} };

/** The plane of other machines' terminal sessions, as this page's watches carry it. */
export function remotePlane(client: MawsBridge = ipc): SessionPlane {
  return {
    subscribe(target, listener) {
      if (target.agentId !== null) {
        queueMicrotask(() => listener.end({ reason: 'error', message: LANE_A_WORDS.remoteSubagentRows }));
        return INERT;
      }
      const appSessionId = addressOf(target.machine as MachineRef, target.session as AppSessionId);
      let open = true;
      const off = watchLaneA(
        appSessionId,
        (event) => {
          if (!open) return;
          if (event.kind === 'messages') {
            for (const message of event.messages) if (isTranscriptMessage(message)) listener.message(message);
          } else listener.interrupted(); // a reset, or a watch ended and opened again: a fresh snapshot follows
        },
        { replay: true, client },
      );
      const ask = (kind: 'rows' | 'diff' | 'output', args?: Record<string, unknown>) => void readLaneA(appSessionId, kind, client, args);
      return {
        rows: (before, limit) => ask('rows', { before, limit }),
        diff: () => ask('diff'),
        output: (taskId, tail) => ask('output', { taskId, tail }),
        async read(what, args) {
          const answer = await readLaneA(appSessionId, what as 'status', client, args);
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
  const transcript = new PlaneTranscript({ plane: remotePlane(client), target, sessionKey: appSessionId, store: useTranscriptStore });
  held.set(appSessionId, { transcript, holders: 0 });
  return transcript;
}

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

// Tests: every transcript forgotten.
export function resetRemoteTranscripts(): void {
  for (const { transcript } of held.values()) transcript.close();
  held.clear();
}
