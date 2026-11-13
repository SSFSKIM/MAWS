// What the engine told the agent of a background task's end, a scheduled prompt's firing, an answer to a question asked
// without waiting, or the sminos bridge's wake: one line led by a dot in its outcome's colour (UX wave U3, O-28; UC-2
// "The rows"): green for completed, red for failed, yellow for stopped, muted for no outcome and for the other classes.
// The engine's duration, where it gave one, follows dim. When the engine delivered more with it (`detail`), or it names
// an output file this mount can open (`outputAction`, the U3a document's Interfaces I), the line is the control that
// shows them under it; "Open output" is drawn only where the mount gives an act for the row's session.
import { duration } from '../../model/time';
import { NOTICE } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useActions, useDisclosure, useRowSession } from '../context';
import { ArrivalLine } from './Line';

type NoticeData = Extract<Row, { kind: 'notice' }>;

export function NoticeRow({ row }: { row: NoticeData }) {
  const appSessionId = useRowSession();
  const actions = useActions();
  const [open, toggle] = useDisclosure(`line:${row.id}`);
  const openOutput = row.outputFile === null ? null : (actions.outputAction?.(appSessionId) ?? null);
  const opens = row.detail !== null || openOutput !== null;
  return (
    <div className="transcript-notice" data-class={row.class} data-outcome={row.outcome ?? undefined}>
      <div className="transcript-line">
        <ArrivalLine mark={NOTICE.mark} open={open} onToggle={opens ? toggle : null}>
          {row.text}
          {row.durationMs !== null && <span className="transcript-notice-duration">{` · ${duration(row.durationMs)}`}</span>}
        </ArrivalLine>
      </div>
      {opens && open && (
        <div className="transcript-notice-detail">
          {row.detail !== null && <p className="transcript-peer-body">{row.detail}</p>}
          {openOutput !== null && (
            <button type="button" className="transcript-quiet-button" onClick={() => openOutput({ taskId: row.taskId, path: row.outputFile!, title: row.text })}>
              {NOTICE.openOutput}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
