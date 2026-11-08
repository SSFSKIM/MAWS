// When what this page learnt of the member's reach on another member's session is asked afresh (board #525; ./reader.ts):
// - the session's listing moves (its revision or policy revision) or another member signs in: what was learnt of it is
//   forgotten, and a lane B session main ended as `READ_REFUSED` is opened again (`retryRemoteSession`);
// - a pane opens the session again (its first holder): the same, for that session.
// - another member signs in: the prompts this app sent are forgotten with it (they were the previous member's).
// Nothing polls. Also the member's own prompts to such a session that entered lane A by a delivery main followed (a send
// whose fate `laneA.send` could not name in time), kept as theirs; and a send the host queued, kept as theirs when its
// queue entry is submitted and has its message uuid.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { READ_REFUSED } from '@shared/org/reader';
import { retryRemoteSession } from '../../lane-b/remote-connect';
import { remoteLaneBStateOf, useRemoteLaneB } from '../../lane-b/remote-session';
import { useLaneA } from '../../stores/lane-a';
import { useQueueStore } from '../../stores/queue';
import { useSessions, type ListedSession } from '../../stores/sessions';
import { forgetOwnPrompts, forgetReaderGrade, learntStands, noteOwnPrompt, othersRow, useReader } from './reader';

const refusedRead = (appSessionId: AppSessionId): boolean => {
  const state = remoteLaneBStateOf(appSessionId);
  return state?.reason === READ_REFUSED && state.stream === 'ended';
};
const moved = (now: ListedSession | undefined, before: ListedSession | undefined) => now?.revision !== before?.revision || now?.policyRev !== before?.policyRev;

export function connectReaderGrades(retry: () => void = retryRemoteSession): () => void {
  const offSessions = useSessions.subscribe((s, before) => {
    if (s.listed === before.listed && s.member === before.member) return;
    if (s.member !== before.member) forgetOwnPrompts(); // what this app sent was the previous member's
    for (const [appSessionId, learnt] of useReader.getState().learnt) if (!learntStands(learnt, othersRow(s.listed, appSessionId), s.member)) forgetReaderGrade(appSessionId);
    const again = [...useRemoteLaneB.getState().states.keys()].some((id) => refusedRead(id) && (s.member !== before.member || moved(s.listed.get(id), before.listed.get(id))));
    if (again) retry();
  });
  const offLaneA = useLaneA.subscribe((s, before) => {
    if (s.states === before.states) return;
    for (const [appSessionId, state] of s.states) {
      if (state === before.states.get(appSessionId)) continue;
      for (const delivery of state.deliveries) if (delivery.state === 'entered') noteOwnPrompt(appSessionId, delivery.uuid);
    }
  });
  // a send the host queued: its entry gets its message uuid when it is submitted, and is then noted as the member's own
  const offQueue = useQueueStore.subscribe((s, before) => {
    if (s.bySession === before.bySession) return;
    for (const [appSessionId, queued] of useReader.getState().queued) {
      const queue = s.bySession.get(appSessionId);
      if (queue === undefined || queue === before.bySession.get(appSessionId)) continue;
      for (const entry of queue.entries) if (queued.has(entry.queueId)) noteOwnPrompt(appSessionId, entry.messageUuid);
    }
  });
  return () => {
    offSessions();
    offLaneA();
    offQueue();
  };
}

const panes = new Map<AppSessionId, number>();

/** A pane showing the session: its first opening asks afresh what was learnt of it. */
export function useReaderPane(appSessionId: AppSessionId, retry: () => void = retryRemoteSession): void {
  useEffect(() => {
    const held = panes.get(appSessionId) ?? 0;
    if (held === 0) {
      forgetReaderGrade(appSessionId);
      if (refusedRead(appSessionId)) retry();
    }
    panes.set(appSessionId, held + 1);
    return () => {
      const left = (panes.get(appSessionId) ?? 1) - 1;
      if (left > 0) panes.set(appSessionId, left);
      else panes.delete(appSessionId);
    };
  }, [appSessionId, retry]);
}

// Tests: no pane holds any session.
export function resetReaderPanes(): void {
  panes.clear();
}
