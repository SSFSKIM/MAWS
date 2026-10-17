// The session view (DC9; the composite's §9.1): a direct channel's center on a desktop whose session's machine is
// online — MAWS's `Transcript` over the session's main transcript with its owner lane on, so MAWS's report by default
// (the `<message>` spans and questions, one working record per marked turn, an unmarked turn whole) and the full
// transcript a toggle away. The transcript is the session's shared owner's (`depth/owner/session-owner.ts`), which the
// depth column holds too: one subscription feeds both. Its streaming text joins the turn it answers, older rows page in
// at the top until the first, and an ended session stays pageable while the view is open, its liveness read from its
// presence. An `Agent` row opens its agent in the column. Loaded as a chunk of its own, so the phone, which never draws
// it, loads none of MAWS's transcript.
import { useMemo, useRef } from 'react';
import type { SubagentRef } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { useSessionOwner } from '../../depth/owner/session-owner';
import { DESK_ACTIONS } from '../../depth/view/actions';
import { TranscriptPane, transcriptStatus, useKeptTranscript } from '../../depth/view/TranscriptPane';
import { sessionName } from '../../log/projection';
import { useDeskLayout } from '../../shell/layout';
import type { SessionPlane } from '../../shell/session-plane';
import type { DeskSession } from '../../shell/sessions';
import { ReportToggle } from './ReportToggle';

type Props = { project: string; session: DeskSession; plane: SessionPlane };

export default function SessionView({ project, session, plane }: Props) {
  const owner = useSessionOwner(project, session, plane);
  const state = useKeptTranscript(owner.keeper);
  const list = useRef<TranscriptListHandle>(null);
  const actions = useMemo<Partial<TranscriptActions>>(
    () => ({
      ...DESK_ACTIONS,
      // The column takes the request and opens its Subagents tab on the agent; a closed column opens for it.
      openSubagent: (ref: SubagentRef) => {
        owner.openSubagent(ref);
        if (!useDeskLayout.getState().depth.open) useDeskLayout.getState().setDepth({ open: true });
      },
    }),
    [owner],
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="session-view" data-session={session.session} aria-label={`${sessionName(session)}'s session`}>
      <ReportToggle storeKey={owner.main.key} />
      <TranscriptPane controller={owner.main} state={state} variant="session" ownerLane actions={actions} list={list} />
    </section>
  );
}

/** The session view's status word, in the center's header: its transcript loading, reconnecting, paging, unavailable. */
export function SessionStatus({ project, session, plane }: Props) {
  const owner = useSessionOwner(project, session, plane);
  const status = transcriptStatus(useKeptTranscript(owner.keeper));
  return (
    <span className="shrink-0 text-ui-sm text-fg-muted" data-testid="session-status">
      {status}
    </span>
  );
}
