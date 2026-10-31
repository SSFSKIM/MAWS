// A gap in a transcript's history (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The gap bar";
// acceptance 11; P5 Decision Log 77): events between two points were not delivered, so the transcript draws one bar,
// "Earlier history isn't available", where they would have been. Its two sources are the transcript source's
// (source/ipc.ts): a remote lane B stream that went on past what it could not carry (`remote.gap`, a relaunch's snapshot,
// a range the machine's journal lost, an event too large for the channel), and a `session.events` page whose range is
// partly gone (`historyUnavailable`). The source puts an event of its own at that point: a `notice.posted` under a key
// of MAWS's own, its id under the bare app id with `seq: null` as an event the app synthesises (so the live-form filter
// lets it past and the store deduplicates it by id), which the derivation draws as a `gap` row (rows.ts), never as a
// notice.
import type { SessionEvent } from '@shared/graph/events';
import type { EventId, SessionId } from '@shared/graph/ids';

export const HISTORY_GAP_KEY = 'maws:history-gap';
export const HISTORY_GAP = 'Earlier history isn’t available';

export const isHistoryGap = (event: SessionEvent): boolean => event.kind === 'notice.posted' && event.key === HISTORY_GAP_KEY;

/** The gap's event: `bareApp` is the session's bare app id, `tag` what makes this gap's id its own. */
export function historyGapEvent(bareApp: string, tag: string, at: string, sessionId: SessionId): SessionEvent {
  return {
    id: `${bareApp}:history-gap:${tag}` as EventId, sessionId, at, seq: null, agentId: null, parentToolUseId: null,
    kind: 'notice.posted', level: 'notice', key: HISTORY_GAP_KEY, text: HISTORY_GAP,
  };
}
