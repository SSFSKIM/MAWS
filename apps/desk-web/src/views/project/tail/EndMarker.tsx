// An ended or retired session's end, as the last row of its session view (the composite's §9.1, "Lifecycle"; the end
// marker as the owner chose it, mockups/desk/09-session-view.html 3A and 3B): MAWS's boundary shape — a rule, its words,
// a rule — the session named under it through `SessionLabel` (title first, alias muted), with what the channel's
// header offers: Resume for an ended session (a second door where the eye ends; drawn disabled with §5's reason when it
// cannot), who retired it for a retired one, which cannot be resumed. Whether the session runs is read from its presence, never from the subscription, which stays open and
// pageable after the end; the history above stays.
import { useState } from 'react';
import { retiredBy } from '../../../conversation/capabilities';
import { byWhom } from '../../../conversation/stream';
import { SessionLabel } from '../../../shell/SessionLabel';
import type { DeskSession } from '../../../shell/sessions';
import { useCapabilities, useDesk } from '../../conversation/desk-context';
import { RpcStatus } from '../../conversation/RpcStatus';

export function EndMarker({ session }: { session: DeskSession }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const can = useCapabilities(session).resume;
  const retired = retiredBy(session);
  const who = retired === null ? null : retired ? byWhom(retired, member) : null;
  const words = retired === null ? 'Ended' : who ? `Retired by ${who}` : 'Retired';
  return (
    <div className="desk-end-marker" data-testid="end-marker" data-end={retired === null ? 'ended' : 'retired'}>
      <div className="transcript-boundary">
        <span className="transcript-boundary-rule" aria-hidden="true" />
        <span className="transcript-boundary-text desk-end-words">{words}</span>
        <span className="transcript-boundary-rule" aria-hidden="true" />
      </div>
      <div className="desk-end-who">
        <SessionLabel session={session} name="font-medium text-fg" muted="text-fg-muted" />
      </div>
      <p className="desk-end-sub">
        {retired === null
          ? `Its process on ${session.machine} is gone. Everything above stays here.`
          : 'It left the project. Everything above stays here; it cannot be resumed.'}
      </p>
      {retired === null && (
        <div className="desk-end-actions">
          <button
            type="button"
            className="desk-end-resume"
            disabled={!can.can}
            title={can.reason ?? undefined}
            onClick={async () => setRpc(await connection.rpc(member, session.machine, 'resume', { session: session.session }))}
          >
            Resume
          </button>
          <RpcStatus nonce={rpc} />
        </div>
      )}
    </div>
  );
}
