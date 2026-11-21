// UX wave U1c (l4-approvals-12; the U1c document, Design 6, Interfaces §E): the control under a blocked call's line, in a
// session's own transcript. In order: the grant's subject whole, when the line does not name it; the one button; the
// muted line under a row blocked again; the last press's notice. The button stands only beside the whole of what it
// consents to, and what it sends is the name the rule read from the store's row (`call`), never the drawn cell's. The
// word cut (N102; "Every hidden fact has an owner that takes keyboard focus"): an unavailable button is drawn
// aria-disabled and keeps the keyboard, its reason its tooltip and description; a closed one (a grant out) is disabled.
import { BLOCKED } from '../transcript/model/copy';
import type { BlockedCallProps } from '../transcript/view/context';
import { useRowSession } from '../transcript/view/context';
import type { AppSessionId } from '@shared/graph/ids';
import { approve, useGrant } from './grants';
import { UnavailableButton } from '../ui/tip';

export function ApproveAndRetry(props: BlockedCallProps) {
  const appSessionId = useRowSession();
  return appSessionId === null ? null : <Control appSessionId={appSessionId} {...props} />;
}

function Control({ appSessionId, cell, call, again, grant, onLine }: BlockedCallProps & { appSessionId: AppSessionId }) {
  const { gate, notice } = useGrant(appSessionId, call, grant);
  return (
    <div className="transcript-blocked">
      {!onLine && <pre className="transcript-blocked-subject">{call.subject}</pre>}
      <UnavailableButton reason={gate.state === 'unavailable' ? gate.reason : null}>
        <button type="button" className="transcript-button" disabled={gate.state === 'closed'} onClick={() => void approve(appSessionId, call, cell)}>
          {BLOCKED.approve}
        </button>
      </UnavailableButton>
      {again && <p role="status" className="transcript-blocked-line">{BLOCKED.always[call.kind]}</p>}
      {notice !== null && <p role="status" className="transcript-blocked-line">{notice}</p>}
    </div>
  );
}
