// One X3 row → its component, in the transcript's reading column (W2: the `.thread-column` the composer frame shares).
// The wrapper carries the row's element id (the divider's aria-controls names work-area rows by it), its kind and turn
// for tests and the harness, and is focusable so a jump can land on it. A row of a rewound branch the reader revealed
// is muted and marked not in context. W8: a work-area row's wrapper runs the shared disclosure motion when its divider
// opens or folds the work area (motion.ts).
import { useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { useDisclosureMotion } from '../../../ui/disclosure';
import { NOT_IN_CONTEXT } from '../../model/copy';
import type { Row, TurnId } from '../../model/rows';
import { rowElementId, useTranscriptContext, useWorkMotion } from '../context';
import { inWorkArea } from '../motion';
import { AgentMessageRow } from './AgentMessage';
import { AssistantTextRow } from './AssistantText';
import { BashRow } from './Bash';
import { BoundaryRow } from './Boundary';
import { CellRow } from './Cell';
import { DividerRow } from './Divider';
import { ErrorRow } from './Error';
import { GroupRow } from './Group';
import { LocalCommandRow } from './LocalCommand';
import { PlanRow } from './Plan';
import { QuestionRow } from './Question';
import { ReceiptRow } from './Receipt';
import { RequestSlotRow } from './RequestSlot';
import { SubagentRow } from './Subagent';
import { ThinkingRow } from './Thinking';
import { TimeRow } from './Time';
import { UserRow } from './User';

function body(row: Row) {
  switch (row.kind) {
    case 'time': return <TimeRow row={row} />;
    case 'user': return <UserRow row={row} />;
    case 'assistant_text': return <AssistantTextRow row={row} />;
    case 'thinking': return <ThinkingRow row={row} />;
    case 'divider': return <DividerRow row={row} />;
    case 'group': return <GroupRow row={row} />;
    case 'cell': return <CellRow row={row} />;
    case 'receipt': return <ReceiptRow row={row} />;
    case 'subagent': return <SubagentRow row={row} />;
    case 'agent_message': return <AgentMessageRow row={row} />;
    case 'bash': return <BashRow row={row} />;
    case 'local_command': return <LocalCommandRow row={row} />;
    case 'plan': return <PlanRow row={row} />;
    case 'question': return <QuestionRow row={row} />;
    case 'request_slot': return <RequestSlotRow row={row} />;
    case 'boundary': return <BoundaryRow row={row} />;
    case 'error': return <ErrorRow row={row} />;
  }
}

// The first row a turn shows: where a revealed branch's turn says it is not in context.
const opensTurn = (row: Row) => row.kind === 'user' || (row.kind === 'divider' && row.origin !== 'human'); // engine and peer turns open with their divider

export function RowView({ row }: { row: Row }) {
  return inWorkArea(row) ? <WorkRowView row={row} turn={row.turnId!} /> : <RowFrame row={row}>{body(row)}</RowFrame>;
}

// A work-area row: it grows in when its divider has just opened the work area and closes away while the divider folds it.
function WorkRowView({ row, turn }: { row: Row; turn: TurnId }) {
  const motion = useWorkMotion();
  const folding = useSyncExternalStore(motion.subscribe, () => motion.isFolding(turn));
  const [appear] = useState(() => motion.isOpening(turn));
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
