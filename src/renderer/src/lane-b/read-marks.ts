// A lane B session on another machine, read or unread in this app's memory (P5 O7 M2, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, "Acts"). Its record's reader fields (unread, last seen) are the owner's on that
// machine's index until O8 M6 keys them per member, and `session.update` and `session.setVisible` are not offered over the
// link, so the marks are kept here for the app's run, never written to the owner's record: the session read while it is
// on screen, unread when a turn ends while it isn't, and as the person sets it (the row's dot, the keyboard toggle, Mark
// all read). The record the stores hold says the mark, over whatever record main reads again; a session with no mark
// shows its record's own.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { useSessions } from '../stores/sessions';
import { isRemoteLaneB } from './remote-session';

interface RemoteReadMarks {
  unread: ReadonlyMap<AppSessionId, boolean>;
  visible: ReadonlySet<AppSessionId>; // the remote sessions on screen now, as `connectVisibility` sees them
}

export const useRemoteReadMarks = create<RemoteReadMarks>()(() => ({ unread: new Map(), visible: new Set() }));

export function resetRemoteReadMarks(): void {
  useRemoteReadMarks.setState({ unread: new Map(), visible: new Set() });
}

export function setRemoteUnread(appSessionId: AppSessionId, unread: boolean): void {
  useRemoteReadMarks.setState((s) => ({ unread: new Map(s.unread).set(appSessionId, unread) }));
}

/** On screen or not; on screen reads it. */
export function setRemoteVisible(appSessionId: AppSessionId, visible: boolean): void {
  useRemoteReadMarks.setState((s) => {
    const shown = new Set(s.visible);
    if (visible) shown.add(appSessionId);
    else shown.delete(appSessionId);
    return { visible: shown, ...(visible && { unread: new Map(s.unread).set(appSessionId, false) }) };
  });
}

// The records the stores hold, each with its mark where it differs; one write.
function showMarks(): void {
  const { records, recordsVersion } = useSessions.getState();
  let next: Map<AppSessionId, SessionRecord> | null = null;
  for (const [appSessionId, unread] of useRemoteReadMarks.getState().unread) {
    const record = records.get(appSessionId);
    if (record === undefined || record.unread === unread) continue;
    next ??= new Map(records);
    next.set(appSessionId, { ...record, unread });
  }
  if (next !== null) useSessions.setState({ records: next, recordsVersion: recordsVersion + 1 });
}

export function connectRemoteReadMarks(): () => void {
  const offSessions = useSessions.subscribe((state, before) => {
    if (state.engine !== before.engine) {
      // a turn that ended (a status still held, its turn gone) while the session was off screen
      const { visible } = useRemoteReadMarks.getState();
      for (const [appSessionId, was] of before.engine) {
        const now = state.engine.get(appSessionId);
        if (was.turn !== null && now !== undefined && now.turn === null && !visible.has(appSessionId) && isRemoteLaneB(appSessionId)) setRemoteUnread(appSessionId, true);
      }
    }
    if (state.records !== before.records) showMarks();
  });
  const offMarks = useRemoteReadMarks.subscribe((state, before) => state.unread !== before.unread && showMarks());
  showMarks();
  return () => {
    offSessions();
    offMarks();
  };
}
