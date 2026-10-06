// One X3 row → its component, in the transcript's reading column (W2: the `.thread-column` the composer frame shares).
// The wrapper carries the row's element id (the divider's aria-controls names work-area rows by it), its kind and turn
// for tests and the harness, and is focusable so a jump can land on it. A row of a rewound branch the reader revealed
// is muted and marked not in context. W8: a work-area row's wrapper runs the shared disclosure motion when its divider
// opens or folds the work area (motion.ts).
import { useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { useDisclosureMotion } from '../../../ui/disclosure';
import { NOT_IN_CONTEXT } from '../../model/copy';
import type { Row } from '../../model/rows';
import { rowElementId, useTranscriptContext, useWorkMotion } from '../context';
import { inWorkArea } from '../motion';
import { AgentMessageRow } from './AgentMessage';
import { AskCapsule } from './AskCapsule'; // E1
import { DeliveryRowView } from './Delivery'; // E1
import { SideThreadRow } from './SideThread'; // E3
import { FoldedAssistantProbes, SurfaceAssistantRow, SurfaceCommandRow, SurfaceGroupRow, SurfaceQuestionRow, SurfaceUserRow } from '../../surface/Rows';
import { BashRow } from './Bash';
import { BoundaryRow } from './Boundary';
import { CellRow } from './Cell';
import { DividerRow } from './Divider';
import { ErrorRow } from './Error';
import { PlanRow } from './Plan';
import { ReceiptRow } from './Receipt';
import { RequestSlotRow } from './RequestSlot';
import { SubagentRow } from './Subagent';
import { ThinkingRow } from './Thinking';
import { TimeRow } from './Time';

function body(row: Row) {
  switch (row.kind) {
    case 'time': return <TimeRow row={row} />;
    case 'user': return <SurfaceUserRow row={row} />;
    case 'assistant_text': return <SurfaceAssistantRow row={row} />;
    case 'thinking': return <ThinkingRow row={row} />;
    case 'divider': return <><FoldedAssistantProbes row={row} /><DividerRow row={row} /></>;
    case 'group': return <SurfaceGroupRow row={row} />;
    case 'cell': return <CellRow row={row} />;
    case 'receipt': return <ReceiptRow row={row} />;
    case 'subagent': return <SubagentRow row={row} />;
    case 'agent_message': return <AgentMessageRow row={row} />;
    case 'bash': return <BashRow row={row} />;
    case 'local_command': return <SurfaceCommandRow row={row} />;
    case 'plan': return <PlanRow row={row} />;
    case 'question': return <SurfaceQuestionRow row={row} />;
    case 'request_slot': return <RequestSlotRow row={row} />;
    case 'boundary': return <BoundaryRow row={row} />;
    case 'error': return <ErrorRow row={row} />;
    // E1 start
    case 'ask': return <AskCapsule row={row} />;
    case 'delivery': return <DeliveryRowView row={row} />;
    // E1 end
    case 'side_thread': return <SideThreadRow row={row} />; // E3
  }
}

// The first row a turn shows: where a revealed branch's turn says it is not in context.
const opensTurn = (row: Row) => row.kind === 'user' || (row.kind === 'divider' && row.origin !== 'human'); // engine and peer turns open with their divider

// Keep one frame/body lineage when a surface answer moves a row into or out of the work area.
export function RowView({ row }: { row: Row }) {
  const motion = useWorkMotion();
  const work = inWorkArea(row);
  const folding = useSyncExternalStore(motion.subscribe, () => work && motion.isFolding(row.turnId!));
  const [appear] = useState(() => work && motion.isOpening(row.turnId!));
  const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(!folding, { appear });
  return (
    <RowFrame row={row} frameRef={ref}>
      {mounted && body(row)}
    </RowFrame>
  );
}

function RowFrame({ row, frameRef, children }: { row: Row; frameRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  const { idPrefix, storeKey } = useTranscriptContext();
  const muted = useTranscriptStore((state) => row.turnId !== null && (state.entries[storeKey]?.state.hidden?.turns.includes(row.turnId) ?? false));
  return (
    <div ref={frameRef} id={rowElementId(idPrefix, row.id)} className="thread-column transcript-row" data-kind={row.kind} data-turn-id={row.turnId ?? undefined} data-muted={muted ? '' : undefined} tabIndex={-1}>
      {muted && opensTurn(row) && <div className="transcript-not-in-context">{NOT_IN_CONTEXT}</div>}
      {children}
    </div>
  );
}
