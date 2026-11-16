import { SurfaceRow } from '../../engine-surface/SurfaceRow';
import { useSurfaceAttached, useSurfaceHooked } from '../../engine-surface/site';
import type { Cell, Row, TurnId } from '../model/rows';
import { CellDetailView } from '../view/cells/CellDetail';
import { CellLine } from '../view/cells/CellLine';
import { useDisclosure } from '../view/context';
import { resultInput, standaloneRunInput, toolInputs, withToolProps, type ToolInput } from './adapters';
import { useTranscriptSurface } from './context';

export function SurfaceCellLine({ cell, turnId, standalone = false, focusable = false }: { cell: Cell; turnId: TurnId | null; standalone?: boolean; focusable?: boolean }) {
  const { appSessionId, state, turn } = useTranscriptSurface({ turnId });
  const attached = useSurfaceAttached(appSessionId);
  const hooked = useSurfaceHooked(appSessionId, 'ToolUse');
  const inputs = toolInputs(cell, turn, state?.ui.revealed, state);
  // UX wave U2b (M5's fix wave 1, §E): a call the live derivation draws as a run asks its run's site for its row's whole
  // life; standing alone, it is a run of one, and asks no ToolUse of its own
  if (standalone && cell.classification.groupable) return <RunOfOne cell={cell as Extract<Row, { kind: 'cell' }>} turnId={turnId} focusable={focusable} inputs={inputs} />;
  // A merged read remains MAWS's one merged row unless a ToolUse hook owns the calls. When hook knowledge is not
  // available, ask each call but give only the first the merged native; a later hooked answer unfolds the calls.
  if (!inputs.length || !attached || hooked === false) return <CellLine cell={cell} turnId={turnId} focusable={focusable} renderDetail={standalone && inputs.length === 1 ? (drawn) => <ToolResult input={{ ...inputs[0], cell: drawn }} turnId={turnId} /> : undefined} />;
  return <>{inputs.map((input, index) => <ToolCall key={input.instanceId} input={input} merged={inputs.length > 1 ? cell : null} first={index === 0} turnId={turnId} standalone={standalone} focusable={focusable} />)}</>;
}

function ToolCall({ input, merged, first, turnId, standalone, focusable }: { input: ToolInput; merged: Cell | null; first: boolean; turnId: TurnId | null; standalone: boolean; focusable: boolean }) {
  const { appSessionId } = useTranscriptSurface({ turnId });
  const hooked = useSurfaceHooked(appSessionId, 'ToolUse');
  const [open, toggle] = useDisclosure(`surface-cell:${input.instanceId}`);
  const split = merged !== null && hooked === true;
  return <SurfaceRow appSessionId={appSessionId} component="ToolUse" instanceId={input.instanceId} props={input.props} placeholder={<span className="text-fg-faint">…</span>}>
    {(props, { concealed }) => {
      if (merged !== null && !split && !first) return null;
      const native = merged !== null && !split ? merged : withToolProps(input, props);
      return <CellLine cell={split ? { ...native, expanded: open } : native} turnId={turnId} focusable={focusable && !concealed} onToggle={split ? toggle : undefined}
        renderDetail={standalone ? (drawn) => <ToolResult input={{ ...input, cell: drawn }} drawnProps={props} turnId={turnId} enabled={!concealed} /> : undefined} />;
    }}
  </SurfaceRow>;
}

function ToolResult({ input, drawnProps = input.props, turnId, enabled = true }: { input: ToolInput; drawnProps?: ToolInput['props']; turnId: TurnId | null; enabled?: boolean }) {
  const { appSessionId } = useTranscriptSurface({ turnId });
  const props = { tool_use_id: input.props.tool_use_id, tool: input.props.tool, output: input.props.output, isErrored: input.props.isErrored };
  const resolved = resultInput(input) !== null;
  return <SurfaceRow appSessionId={appSessionId} component="ToolResult" instanceId={input.instanceId} props={props} enabled={enabled && resolved} onlyRewrites frameInkOnly placeholder={<span className="text-fg-faint">…</span>}>
    {(rewritten) => <CellDetailView cell={rewritten.output === props.output ? input.cell : withToolProps(input, { ...drawnProps, output: rewritten.output })} turnId={turnId} />}
  </SurfaceRow>;
}

// A run of one drawn as its call's line: the `ToolGroup` site under the run's id, MAWS's own line in its engine slot (an
// answer with none replaces it, as a run's does). Mounted while it asks nothing (a request waits on the call, the jump's
// target), so the line keeps its element; a run's rewrite of its open state has no run to open here.
const NO_GROUP = { calls: [], isActive: false, isExpanded: false };
function RunOfOne({ cell, turnId, focusable, inputs }: { cell: Extract<Row, { kind: 'cell' }>; turnId: TurnId | null; focusable: boolean; inputs: ToolInput[] }) {
  const { appSessionId, state, turn } = useTranscriptSurface({ turnId });
  const input = state ? standaloneRunInput(cell, turn, state, state.ui.revealed) : null;
  return <SurfaceRow appSessionId={appSessionId} component="ToolGroup" instanceId={input?.instanceId ?? cell.id} props={input?.props ?? NO_GROUP} enabled={input !== null} placeholder={<span className="text-fg-faint">…</span>}>
    {(_props, { concealed }) => <CellLine cell={cell} turnId={turnId} focusable={focusable && !concealed} renderDetail={inputs.length === 1 ? (drawn) => <ToolResult input={{ ...inputs[0], cell: drawn }} turnId={turnId} enabled={!concealed} /> : undefined} />}
  </SurfaceRow>;
}

