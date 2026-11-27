// One X3 row → its component, in the transcript's reading column (W2: the `.thread-column` the composer frame shares).
// The wrapper carries the row's element id (the divider's aria-controls names work-area rows by it), its kind and turn
// for tests and the harness, and is focusable so a jump can land on it. A row of a rewound branch the reader revealed
// is muted and marked not in context. W8: a work-area row's wrapper runs the shared disclosure motion when its divider
// opens or folds the work area (motion.ts); board ticket 850: so does a row of a stretch its record line opens or folds,
// and of a branch its rewind's line reveals or hides.
import { useState, useSyncExternalStore, type ReactNode, type Ref } from 'react';
import { useTranscriptStore } from '../../../stores/transcript';
import { useDisclosureMotion } from '../../../ui/disclosure';
import { NOT_IN_CONTEXT } from '../../model/copy';
import type { Row } from '../../model/rows';
import { rowElementId, useTranscriptContext, useWorkMotion } from '../context';
import { inWorkArea } from '../motion';
import { AskCapsule } from './AskCapsule'; // E1
import { DeliveryRowView } from './Delivery'; // E1
import { SideThreadRow } from './SideThread'; // E3
import { AgentListRow } from './AgentList'; // E7
import { ArtifactRowView } from './Artifact'; // E2
import { BrowserActionRow } from './BrowserAction'; // E4c
import { BrowserActivityRow } from './BrowserActivity'; // E13
import { RecordFold } from '../../../owner/view/RecordFold'; // UX wave U2b
import { ReportOnly } from '../../../owner/view/Message'; // UX wave U2b
import { DrawnAnswerActions, FoldedAssistantProbes, SurfaceAgentMessageRow /* UX wave U3 */, SurfaceAssistantRow, SurfaceCallRow, SurfaceCommandRow, SurfaceGroupRow, SurfaceNoticeRow /* UX wave U3 */, SurfaceQuestionRow, SurfaceThinkingRow, SurfaceTurnLine, SurfaceUserRow } from '../../surface/Rows'; // UX wave U2b: the mod route's asks (§E)
import { SurfaceFollower } from '../../surface/follow'; // UX wave U2b
import { CutTextRow } from './AssistantText'; // P5 O9
import { ActivityRow } from './Activity'; // UX wave U3b (M4)
import { BashRow } from './Bash';
import { BoundaryRow } from './Boundary';
import { GapRow } from './GapRow'; // P5 O7 M2
import { CellRow } from './Cell';
import { DividerRow } from './Divider';
import { ErrorRow } from './Error';
import { PlanRow } from './Plan';
import { RequestSlotRow } from './RequestSlot';
import { WaitingAsk, WaitingRow } from './WaitingForm'; // UX wave U1b
import { SheetRow } from './SheetRow'; // the question sheet's C3 M5
import { SubagentRow } from './Subagent';
import { TimeRow } from './Time';
import { ToHumanMessageRow } from '../../../owner/to-human/MessageRow'; // P4-R7

function body(row: Row) {
  switch (row.kind) {
    case 'time': return <SurfaceFollower row={row}><TimeRow row={row} /></SurfaceFollower>; // UX wave U2b (§E): drawn while the row after it is
    case 'user': return <SurfaceUserRow row={row} />;
    case 'assistant_text': return <ReportOnly value={row.reportOnly === true}>{row.cut ? <CutTextRow row={row} /> : <SurfaceAssistantRow row={row} />}</ReportOnly>; // P5 O9: a cut reply is no answer a surface draws; UX wave U2b: a closed stretch's head draws only its messages, a cut one's under its note
    case 'thinking': return <SurfaceThinkingRow row={row} />; // UX wave U2b (§E)
    case 'divider': return <><FoldedAssistantProbes row={row} /><SurfaceTurnLine row={row}><DividerRow row={row} /></SurfaceTurnLine></>; // UX wave U2b (§E): a closed turn's line asks TurnDuration
    case 'group': return <SurfaceGroupRow row={row} />;
    case 'cell': return <CellRow row={row} />;
    case 'receipt': return null; // legacy X3 row; file changes are tool rows now
    case 'subagent': return <SubagentRow row={row} />;
    case 'agent_message': return <SurfaceAgentMessageRow row={row} />;
    case 'bash': return <BashRow row={row} />;
    case 'notice': return <SurfaceNoticeRow row={row} />; // UX wave U3: a task's end, a scheduled fire, an answer, the bridge's wake
    case 'local_command': return <SurfaceCommandRow row={row} />;
    // UX wave U1b (Interfaces §D): a waiting row draws its request's form and asks no mod's site of its own
    case 'plan': return row.waiting ? <WaitingRow row={row} receipt={<PlanRow row={row} />} /> : <PlanRow row={row} />;
    case 'question': return row.waiting ? <WaitingRow row={row} receipt={<SurfaceQuestionRow row={row} />} /> : <SurfaceQuestionRow row={row} />;
    case 'sheet': return <SheetRow row={row} />; // the question sheet's C3 M5: no mod site (§I)
    case 'request_slot': return <RequestSlotRow row={row} />;
    case 'boundary': return <BoundaryRow row={row} />;
    case 'gap': return <GapRow row={row} />; // P5 O7 M2
    case 'error': return <ErrorRow row={row} />;
    // E1 start
    case 'ask': return row.waiting ? <WaitingAsk row={row} /> : <AskCapsule row={row} />;
    case 'delivery': return <DeliveryRowView row={row} />;
    // E1 end
    case 'side_thread': return <SideThreadRow row={row} />; // E3
    case 'agent_list': return <SurfaceCallRow row={row}><AgentListRow row={row} /></SurfaceCallRow>; // E7; UX wave U2b (§E): asks ToolUse
    case 'artifact': return <ArtifactRowView row={row} />; // E2
    case 'browser_action': return <SurfaceCallRow row={row}><BrowserActionRow row={row} /></SurfaceCallRow>; // E4c; UX wave U2b (§E): asks ToolUse
    case 'browser_activity': return row.toolUseId === null ? <BrowserActivityRow row={row} /> : <SurfaceFollower row={row}><BrowserActivityRow row={row} /></SurfaceFollower>; // E13; UX wave U2b (point 24): under a call, drawn while its call's row is
    case 'record_fold': return <RecordFold row={row} />; // UX wave U2b: placed by the mirror
    case 'to_human': return <SurfaceCallRow row={row}><ToHumanMessageRow row={row} /></SurfaceCallRow>; // P4-R7: a message tool's message; UX wave U2b (§E): asks ToolUse
    case 'activity': return <ActivityRow row={row} />; // UX wave U3b (M4): placed by the view at the drawn list's end
  }
}

// The first row a turn shows: where a revealed branch's turn says it is not in context. UX wave U2 (O-15): a turn with
// nothing under it has no divider, so the mark goes on the turn's first drawn row, whatever its kind.
const opensTurn = (row: Row, rows: readonly Row[] | undefined) => rows?.find((candidate) => candidate.turnId === row.turnId && candidate.kind !== 'time')?.id === row.id;

// Keep one frame/body lineage when a surface answer moves a row into or out of the work area. UX wave U3b (Interfaces
// §C): an answer's action row follows its body, drawn when the mount placed one on it; UX wave U2b (reported point 23):
// and only while its site's answer draws the body.
export function RowView({ row }: { row: Row }) {
  const motion = useWorkMotion();
  const work = inWorkArea(row);
  // board ticket 850: and a row of a set that opens or folds as one (a stretch of the to-human view, a rewound branch)
  const folding = useSyncExternalStore(motion.subscribe, () => (work && motion.isFolding(row.turnId!)) || motion.isFoldingRow(row));
  const [appear] = useState(() => (work && motion.isOpening(row.turnId!)) || motion.isOpeningRow(row));
  const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(!folding, { appear });
  return (
    <RowFrame row={row} frameRef={ref}>
      {mounted && body(row)}
      {mounted && row.kind === 'assistant_text' && <DrawnAnswerActions row={row} />}
    </RowFrame>
  );
}

function RowFrame({ row, frameRef, children }: { row: Row; frameRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  const { idPrefix, storeKey } = useTranscriptContext();
  const mark = useTranscriptStore((state) => {
    const entry = state.entries[storeKey];
    if (row.turnId === null || !(entry?.state.hidden?.turns.includes(row.turnId) ?? false)) return null;
    return opensTurn(row, entry?.rows) ? 'opens' : 'muted';
  });
  const muted = mark !== null;
  return (
    <div ref={frameRef} id={rowElementId(idPrefix, row.id)} className="thread-column transcript-row" data-kind={row.kind} data-turn-id={row.turnId ?? undefined} data-muted={muted ? '' : undefined} tabIndex={-1}>
      {mark === 'opens' && <div className="transcript-not-in-context">{NOT_IN_CONTEXT}</div>}
      {children}
    </div>
  );
}
