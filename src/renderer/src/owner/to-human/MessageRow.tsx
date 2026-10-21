// P4-R7: a message tool's message (a `to_human` row, `@shared/owner/message-call`) drawn where and as a `<message>` span
// is: the report's message card while the session's owner-channel lane is on or the mount is local (the comment card's
// thread), as `SurfaceAssistantRow` draws a marked text there; the to-human presenter's span otherwise (the lane off, a
// subagent's transcript). Never an MCP row.
import { MessageCard } from '../report/OwnerReport';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../../transcript/model/rows';
import { useTranscriptContext } from '../../transcript/view/context';
import { messagePresentation } from './Presenter';

export function ToHumanMessageRow({ row }: { row: Extract<Row, { kind: 'to_human' }> }) {
  const { storeKey, variant, presentation } = useTranscriptContext();
  const laneOn = useTranscriptStore((s) => s.entries[storeKey]?.state.ui.ownerLane === true);
  const owned = variant === 'session' && !!storeKey && (laneOn || presentation === 'local');
  if (!owned) return messagePresentation(row.text);
  return (
    <div className="owner-report" data-owner-report={row.id} data-to-human-call={row.toolUseId}>
      <div className="owner-report-item">
        <MessageCard text={row.text} live={false} />
      </div>
    </div>
  );
}
