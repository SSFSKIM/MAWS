import { useCallback } from 'react';
import type { TranscriptProps } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../../engine-surface/SurfaceRow';
import { useSurfaceAttached, useSurfaceHooked } from '../../engine-surface/site';
import { useTranscriptStore } from '../../stores/transcript';
import { aloneInRun, drawsAsRun, runOfOneId, runOfOneLabel } from '../model/groups';
import type { Cell, Row, TurnId } from '../model/rows';
import { CellDetailView } from '../view/cells/CellDetail';
import { CellLine } from '../view/cells/CellLine';
import { useDisclosure } from '../view/context';
import { asksAsRun, resultInput, standaloneRunInput, toolInputs, withToolProps, type ToolInput } from './adapters';
import { useTranscriptSurface } from './context';

export function SurfaceCellLine({ cell, turnId, standalone = false, focusable = false }: { cell: Cell; turnId: TurnId | null; standalone?: boolean; focusable?: boolean }) {
  const { appSessionId, state, turn } = useTranscriptSurface({ turnId });
  const attached = useSurfaceAttached(appSessionId);
  const hooked = useSurfaceHooked(appSessionId, 'ToolUse');
  const inputs = toolInputs(cell, turn, state?.ui.revealed, state);
  // UX wave U2b (M5's fix waves 1 and 2, §E): a call whose tool joins runs asks its run's site for its row's whole life;
  // standing alone, whatever its result, it is a run of one, and asks no ToolUse of its own
  if (standalone && asksAsRun(cell)) return <RunOfOne cell={cell as Extract<Row, { kind: 'cell' }>} turnId={turnId} focusable={focusable} inputs={inputs} />;
  // A merged read remains MAWS's one merged row unless a ToolUse hook owns the calls. When hook knowledge is not
  // available, ask each call but give only the first the merged native; a later hooked answer unfolds the calls.
  if (!inputs.length || !attached || hooked === false) return <CellLine cell={cell} turnId={turnId} focusable={focusable} standalone={standalone} renderDetail={standalone && inputs.length === 1 ? (drawn) => <ToolResult input={{ ...inputs[0], cell: drawn }} turnId={turnId} /> : undefined} />;
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
      return <CellLine cell={split ? { ...native, expanded: open } : native} turnId={turnId} focusable={focusable && !concealed} standalone={standalone} onToggle={split ? toggle : undefined}
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

// A call alone in its run: the `ToolGroup` site under the run's id, MAWS's own drawing in its engine slot (an answer with
// none replaces it, as a run's does). Mounted while it asks nothing (a request waits on the call, the jump's target), so
// the drawing keeps its element. Board ticket 852: one quiet line, its call's own `CellLine`, whatever its presentation:
// read as its run (`runOfOneLabel`: its description, else the run's words) unless it failed, its status mark its call's
// (a running ring, a stop), one press opening it straight onto its command and result. Its open state is one, its run's
// key of its turn's (a run's rewrite of that state opens it, as a run's does), so a result that turns it into a failed
// line keeps it open, and the line keeps its element and the keyboard.
const NO_GROUP = { calls: [], isActive: false, isExpanded: false };
function RunOfOne({ cell, turnId, focusable, inputs }: { cell: Extract<Row, { kind: 'cell' }>; turnId: TurnId | null; focusable: boolean; inputs: ToolInput[] }) {
  const { appSessionId, state, turn, storeKey } = useTranscriptSurface({ turnId });
  const input = state ? standaloneRunInput(cell, turn, state, state.ui.revealed) : null;
  const id = runOfOneId(cell);
  const expand = useCallback((props: TranscriptProps['ToolGroup']) => {
    if (!props.isExpanded) return;
    // read now, not from the render: two mounts of one transcript answered alike must not open it and close it again
    const open = useTranscriptStore.getState().entries[storeKey]?.state.ui.expandedGroups.has(id) ?? false;
    if (!open) useTranscriptStore.getState().toggleGroup(storeKey, id);
  }, [storeKey, id]);
  const toggle = useCallback(() => useTranscriptStore.getState().toggleGroup(storeKey, id), [storeKey, id]);
  const alone = aloneInRun(cell); // else a call its result put apart (a refusal, an image): its own line and open state
  return <SurfaceRow appSessionId={appSessionId} component="ToolGroup" instanceId={input?.instanceId ?? cell.id} props={input?.props ?? NO_GROUP} enabled={input !== null} onRewrite={expand} placeholder={<span className="text-fg-faint">…</span>}>
    {(_props, { concealed }) => <CellLine cell={alone ? { ...cell, expanded: cell.runExpanded === true } : cell} turnId={turnId} focusable={focusable && !concealed} standalone runOfOne={drawsAsRun(cell)} label={runOfOneLabel(cell) ?? undefined} onToggle={alone ? toggle : undefined}
      renderDetail={inputs.length === 1 ? (drawn) => <ToolResult input={{ ...inputs[0], cell: drawn }} turnId={turnId} enabled={!concealed} /> : undefined} />}
  </SurfaceRow>;
}
