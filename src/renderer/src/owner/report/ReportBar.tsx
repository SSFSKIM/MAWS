// The session pane's header while the session's owner-channel lane is on (the P2-C document, Design §7 and §8; the
// parent's Decision Log 19): at its trailing end the two-state control "Report · Transcript", the tab's view; before it,
// in the report, what its top says: how many must-reads wait (with Mark all read, once there are two) and, when the
// engine reported another output style than MAWS read, that notice. Nothing draws while the lane is off: P1's pane.
// The channel is followed by the session's transcript slot, which the pane always mounts with it.
// `toggleReportView` is the unbound action `transcript.toggleReport`, on the focused pane's session.
import type { AppSessionId } from '@shared/graph/ids';
import { focusedSession } from '../../composer/ComposerAppKeys';
import { useOwnerChannelStore } from '../../stores/owner-channel';
import { useTranscriptStore } from '../../stores/transcript';
import { markRead } from './answering';
import { REPORT } from './copy';
import { reportViewOf } from './project';
import './report.css';

export function ReportBar({ appSessionId, markAllRead = () => markRead(appSessionId, 'all') }: { appSessionId: AppSessionId; markAllRead?: () => void }) {
  const owner = useOwnerChannelStore((s) => s.bySession.get(appSessionId) ?? null); // the session's transcript slot follows it
  const key = appSessionId; // the session transcript's store key (`ipcSource`)
  const report = useTranscriptStore((s) => reportViewOf(s.entries[key]?.state?.ui));
  if (!owner?.lane.on) return null;
  const unread = owner.marks.filter((mark) => mark.item && mark.essential?.state === 'unread').length;
  const mismatch = owner.lane.mismatch;
  return (
    <div className="owner-bar" data-owner-bar="">
      <div className="owner-bar-notes">
        {report && unread >= 2 && (
          <span className="owner-bar-unread">
            {REPORT.mustRead(unread)}
            <span aria-hidden="true"> · </span>
            <button type="button" className="owner-bar-link" disabled={!markAllRead} onClick={() => markAllRead?.()}>
              {REPORT.markAllRead}
            </button>
          </span>
        )}
        {report && mismatch !== null && (
          <span role="note" className="owner-bar-notice">
            {REPORT.mismatch(mismatch.observed, mismatch.resolved)}
          </span>
        )}
      </div>
      <div role="group" aria-label={REPORT.view} className="owner-view-toggle">
        {(['report', 'transcript'] as const).map((view) => (
          <button key={view} type="button" aria-pressed={(view === 'report') === report} onClick={() => useTranscriptStore.getState().setView(key, view)}>
            {view === 'report' ? REPORT.report : REPORT.transcript}
          </button>
        ))}
      </div>
    </div>
  );
}

// `transcript.toggleReport`: the focused pane's session tab between its report and its transcript, while its lane is on.
export function toggleReportView(): void {
  const appSessionId = focusedSession();
  if (appSessionId === null) return;
  const ui = useTranscriptStore.getState().entries[appSessionId]?.state.ui;
  if (ui?.ownerLane) useTranscriptStore.getState().setView(appSessionId, reportViewOf(ui) ? 'transcript' : 'report');
}
