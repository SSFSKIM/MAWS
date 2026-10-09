// C6's registration into C5's shell (C6 execution document, Public surface and "X2 surface C6 consumes"; C5's Slots):
// the `transcript` slot renders `TranscriptSlot` for a session tab (and, with an agent id, for C5's agent tab), and the
// transcript's path chips open C5's file tab through the layout store. `openExternal` needs no registration: the default
// actions already route links to `layout.openExternal`. Called once from `App.tsx`; a later registration (C8c's
// `openFile`) wins over this one.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionPhase } from '@shared/ipc/schema/session';
import type { Slots } from '../app/slots';
import { registerSlot } from '../app/slots';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { ipcSource } from './source/ipc';
import { TranscriptSlot } from './lazy';
import { registerTranscriptActions } from './view/registry';
// P2-C start (2026-10-09)
import { registerAction } from '../keymap/actions-runtime';
import { toggleReportView } from '../owner/report/ReportBar';
// P2-C end

// C5's liveness rule, as its digest carries it: main's read model moves a session's phase only while C3's process table
// holds a live process for it (`exiting` included) or a C4 replay run plays it, so a phase of a running process says
// the session is live, and `exited`, `failed`, `foreign` or no digest at all say it is not. A disk-backed session with
// no live process then shows no working divider ticking from the wall clock (the store's `setLive`).
// Edge (2026-09-28, final-pass review): C5 also sets `failed` on a failed `turn.ended` while the process lives
// (`src/main/sessions/digest.ts`, the `turn.ended` case), so a background subagent's detail line still running after a
// failed turn stops ticking until the next phase change; kept, since the turn itself has closed.
const LIVE_PHASES: ReadonlySet<SessionPhase> = new Set(['starting', 'working', 'waiting', 'idle']);
const useLive = (appSessionId: AppSessionId) => useSessions((state) => LIVE_PHASES.has(state.digests.get(appSessionId)?.phase as SessionPhase));

// The slot's props onto TranscriptSlot's (C5 passes `agentId: null` for a session tab), with the session's liveness
// told to the store under the source's key; a child agent runs in its parent's process.
export const ShellTranscript: Slots['transcript'] = ({ appSessionId, agentId }) => {
  const key = ipcSource(appSessionId, agentId ?? undefined).key!;
  const live = useLive(appSessionId);
  useEffect(() => {
    useTranscriptStore.getState().setLive(key, live);
    return () => useTranscriptStore.getState().setLive(key, null); // a closed tab says nothing more about the key
  }, [key, live]);
  return <TranscriptSlot appSessionId={appSessionId} agentId={agentId ?? undefined} className="h-full" />;
};

// A path chip: C5's file tab at that line. The chip's session is not known to a registered action, and a file tab's
// identity is its path alone (C5's `tabId`), so the tab carries none.
export const openFileInTab = (path: string, line?: number) => useLayout.getState().openTab({ kind: 'file', path, line: line ?? null, appSessionId: null });

export function connectTranscript(): () => void {
  registerSlot('transcript', ShellTranscript);
  const offReport = registerAction('transcript.toggleReport', toggleReportView); // P2-C (2026-10-09)
  const offActions = registerTranscriptActions({ openFile: openFileInTab });
  return () => {
    offReport();
    offActions();
  };
}
