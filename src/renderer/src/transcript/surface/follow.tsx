// UX wave U2b (the execution document, §E and R3; reported point 24): the rows that ask no site of their own and follow
// the drawing of another row's ask: a time separator follows the row after it, and a browser activity under a call
// follows the row that holds its call. While mounted, such a row keeps that row's ask alive by a probe at the row's own
// address and props (so the window sends one ask, whichever of the two is mounted), and is drawn exactly while the answer
// leaves anything in sight: MAWS's own drawing, or a drawing of a mod's with ink. So it folds with what it stands for,
// and decision 14 holds for a row mounted with no other row of its stretch.
//
// The mounted list publishes which row each follower follows (`publishFollows`, by the list's prefix), from the rows it
// draws; a row rendered outside a mounted transcript follows nothing and is drawn.
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { useSurfaceSite } from '../../engine-surface/site';
import type { SiteAnswer } from '../../engine-surface/registry';
import { drawsEngine, firstEngineRef, hasInk } from '../../engine-surface/tree';
import type { AskedSite } from '@shared/engine/surface';
import { liveBuffer, useTranscriptStore } from '../../stores/transcript';
import { turnRows } from '../model/derive';
import type { Row, RowId } from '../model/rows';
import { useDisclosure, useTranscriptContext } from '../view/context';
import { arrivalInput, assistantInput, callInput, commandInput, groupInput, noticeFollows, questionInput, sentInput, thinkingInput, toolInputs, turnLineInput, userInput } from './adapters';
import { useTranscriptSurface } from './context';

// What each mounted list says its followers follow, by the list's own prefix (`idPrefix`, unique per mounted transcript).
// A hook's name, so the React Compiler keeps its call in every render.
const usePublished = create<ReadonlyMap<string, ReadonlyMap<RowId, Row>>>(() => new Map());

/** A mounted list's followers and what each follows (`followsOf` over its rows), or null when it unmounts. */
export function publishFollows(mount: string, follows: ReadonlyMap<RowId, Row> | null): void {
  const held = usePublished.getState().get(mount);
  if (follows === null ? held === undefined : held !== undefined && held.size === follows.size && [...follows].every(([id, row]) => held.get(id) === row)) return;
  usePublished.setState((s) => {
    const next = new Map(s);
    if (follows === null) next.delete(mount);
    else next.set(mount, follows);
    return next;
  }, true);
}

/** Over the rows the list draws: which row each time separator and each browser activity under a call follows. */
export function followsOf(rows: readonly Row[]): Map<RowId, Row> {
  const holders = new Map<string, Row>();
  for (const row of rows) {
    if (row.kind === 'cell' && row.toolUseId !== null) holders.set(row.toolUseId, row);
    else if (row.kind === 'group') {
      for (const cell of row.cells) if (cell.toolUseId !== null) holders.set(cell.toolUseId, row);
    } else if (row.kind === 'to_human' || row.kind === 'agent_list' || row.kind === 'browser_action') holders.set(row.toolUseId, row);
  }
  const follows = new Map<RowId, Row>();
  rows.forEach((row, i) => {
    if (row.kind === 'time' && i + 1 < rows.length) follows.set(row.id, rows[i + 1]!);
    else if (row.kind === 'browser_activity' && row.toolUseId !== null) {
      const holder = holders.get(row.toolUseId);
      if (holder !== undefined) follows.set(row.id, holder);
    }
  });
  return follows;
}

/** Whether an answer draws nothing in its row: a mod's tree with no engine slot and no ink (an empty Box). */
export const drawsNothing = (answer: SiteAnswer | null | undefined): boolean => {
  if (answer === null || answer === undefined || !answer.hooked) return false;
  const tree = answer.tree;
  return !drawsEngine(tree) && firstEngineRef(tree) === null && !hasInk(tree);
};

interface Ask { component: AskedSite; instanceId: string; props: Record<string, unknown> }
const NOTHING: Pick<Row, 'turnId'> = { turnId: null };
const NO_PROPS: Record<string, unknown> = {};

// The ask the row's own drawing makes, at its address and with its props, as its component builds them (Rows.tsx,
// Tools.tsx); null where it asks none.
function useRowAsk(row: Row | undefined): Ask | null {
  const { storeKey } = useTranscriptContext();
  const { state, turn } = useTranscriptSurface(row ?? NOTHING);
  const live = useTranscriptStore((s) => (row?.kind === 'assistant_text' ? liveBuffer(s.entries[storeKey], row) : undefined));
  const [expanded] = useDisclosure(`line:${row?.id ?? ''}`);
  if (row === undefined || state === undefined) return null;
  const revealed = state.ui.revealed;
  const of = (component: AskedSite, input: { instanceId: string; props: object } | null | undefined): Ask | null =>
    input ? { component, instanceId: input.instanceId, props: input.props as Record<string, unknown> } : null;
  switch (row.kind) {
    case 'user': return of('UserMessage', userInput(row, turn, revealed));
    case 'assistant_text': return row.cut ? null : of('AssistantMessage', assistantInput({ ...row, markdown: live ?? row.markdown }, turn, revealed));
    case 'thinking': return of('AssistantMessage', thinkingInput(row, revealed));
    case 'group': return of('ToolGroup', groupInput(row, turn, state.pending, revealed));
    case 'cell': return of('ToolUse', toolInputs(row, turn, revealed, state)[0]);
    case 'to_human': case 'agent_list': case 'browser_action': return of('ToolUse', callInput(row, turn, revealed));
    case 'local_command': return of('CommandOutput', commandInput(row, state, revealed));
    case 'question': return row.waiting ? null : of('AskUserQuestion', questionInput(row, turn, revealed));
    case 'agent_message': return of('ToolUse', sentInput(row, turn, revealed)) ?? of('UserMessage', arrivalInput(row, turn, { revealed, expanded }));
    case 'notice': {
      const drawn = turn ? turnRows(state, turn.id) : undefined;
      return noticeFollows(row, turn, revealed, drawn) !== null ? null : of('UserMessage', arrivalInput(row, turn, { revealed, expanded, drawn, state }));
    }
    case 'divider': return state.ui.noTurnFold === true ? of('TurnDuration', turnLineInput(row, turn, revealed)) : null;
    default: return null;
  }
}

/** A row drawn while the row it follows is in sight, by a probe of that row's ask; drawn as it is where it follows none. */
export function SurfaceFollower({ row, children }: { row: Row; children: ReactNode }) {
  const { idPrefix, presentation } = useTranscriptContext();
  const followed = usePublished((s) => s.get(idPrefix)?.get(row.id));
  const asked = useRowAsk(followed);
  const ask = presentation === 'local' ? null : asked; // a local comment thread asks the session's surface nothing
  const { appSessionId } = useTranscriptSurface(row);
  const answer = useSurfaceSite({ appSessionId, component: ask?.component ?? 'UserMessage', instanceId: ask?.instanceId ?? row.id, props: ask?.props ?? NO_PROPS, enabled: ask !== null });
  return ask !== null && drawsNothing(answer) ? null : children;
}
