// R3's mounts adapt row bodies without changing history. The sitting's assistant-only probes may promote a drawn
// row out of the work fold; virtualized-away dividers and folded tool/group rows issue no asks. Child transcripts
// are not their parent's engine surface.
// UX wave U2b (the execution document, §E; R3): every row the to-human view can fold asks a site of its own while it is
// mounted, whoever draws the view: the run as a full `ToolGroup` site, a message tool's call, an agent listing and a
// browser action at `ToolUse`, a thought at `AssistantMessage`, a closed turn's line at `TurnDuration`; an answer's action
// row stands only under a body its answer draws (reported point 23).
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { assistantDrawingKey, retainAssistantDrawing, useAssistantDrawings } from '../../engine-surface/assistant-drawings';
import type { AppSessionId } from '@shared/graph/ids';
import { stripAnsi } from '@shared/wire/ansi';
import { nativeQuestionsOf, parseTranscriptProps, type TranscriptProps } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../../engine-surface/SurfaceRow';
import { assistantPresentation } from '../../owner/to-human/Presenter';
import { useSurfaceAttached, useSurfaceSite } from '../../engine-surface/site';
import { siteKey, useSurfaceAnswers, type SiteAnswer } from '../../engine-surface/registry'; // UX wave U2b
import { SurfaceBoundary } from '../../engine-surface/SurfaceBoundary'; // UX wave U2b
import { SurfaceTree } from '../../engine-surface/SurfaceTree'; // UX wave U2b
import { ipc } from '../../ipc/client'; // UX wave U2b
import { drawsEngine, firstEngineRef, hasInk } from '../../engine-surface/tree';
import { hasClosedMarks } from '../../owner/to-human/message-ink';
import { expandedTurnRows, turnRows } from '../model/derive';
import { liveBuffer, useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { AgentMessageRow } from '../view/rows/AgentMessage'; // UX wave U3
import { AssistantTextRow } from '../view/rows/AssistantText';
import { GroupRow } from '../view/rows/Group';
import { LocalCommandRow } from '../view/rows/LocalCommand';
import { NoticeRow } from '../view/rows/Notice'; // UX wave U3
import { QuestionRow } from '../view/rows/Question';
import { UserRow } from '../view/rows/User';
import { arrivalInput, assistantInput, callInput, commandInput, groupInput, noticeFollows, questionInput, sentInput, thinkingInput, turnLineInput, userInput } from './adapters';
import { drawsNothing } from './follow'; // UX wave U2b
import { AnswerActions } from '../view/rows/AnswerActions'; // UX wave U3b; U2b
import { ThinkingRow } from '../view/rows/Thinking'; // UX wave U2b
import { setCarrierConcealed, useCarrierConcealed } from './carrier-drawing'; // UX wave U3
import { SurfaceCellLine } from './Tools';

import { useDisclosure, useTranscriptContext } from '../view/context';
import { useOwnerChannelSurface, useTranscriptSurface } from './context';

export function SurfaceUserRow({ row }: { row: Extract<Row, { kind: 'user' }> }) {
  const { appSessionId, state, turn } = useTranscriptSurface(row);
  const input = userInput(row, turn, state?.ui.revealed);
  if (!input) return <UserRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="UserMessage" {...input} placeholder={<UserRow row={{ ...row, text: '…', attachments: [], placeholders: [] }} />}>
    {(props) => <UserRow row={props.text === row.text ? row : { ...row, text: props.text, placeholders: [], attachments: row.attachments.filter((a) => a.kind !== 'text') }} />}
  </SurfaceRow>;
}

// UX wave U3 (UC-3; the U3a document, M5): a message line and a notice ask the engine's UserMessage site where the
// engine's own transcript draws their carrier through it, and a message the agent sent asks ToolUse (adapters.ts says
// which); MAWS's line is the native drawing, so no hook, or one that keeps the engine's drawing, leaves it, and a mod's
// own drawing replaces it. The tab's revealed jump target asks nothing. The line's words are MAWS's reading of the
// carrier and stay as they are under a rewrite of the site's text.
export function SurfaceAgentMessageRow({ row }: { row: Extract<Row, { kind: 'agent_message' }> }) {
  const { appSessionId, state, turn } = useTranscriptSurface(row);
  const [expanded] = useDisclosure(`line:${row.id}`);
  const revealed = state?.ui.revealed;
  const sent = sentInput(row, turn, revealed);
  if (sent) return <SurfaceRow appSessionId={appSessionId} component="ToolUse" {...sent} placeholder={<span className="text-fg-faint">…</span>}>{() => <AgentMessageRow row={row} />}</SurfaceRow>;
  const input = arrivalInput(row, turn, { revealed, expanded });
  if (!input) return <AgentMessageRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="UserMessage" {...input} placeholder={<span className="text-fg-faint">…</span>}>{() => <AgentMessageRow row={row} />}</SurfaceRow>;
}

export function SurfaceNoticeRow({ row }: { row: Extract<Row, { kind: 'notice' }> }) {
  const { appSessionId, state, turn } = useTranscriptSurface(row);
  const [expanded] = useDisclosure(`line:${row.id}`);
  const revealed = state?.ui.revealed;
  const drawn = state && turn ? turnRows(state, turn.id) : undefined; // the turn after its fold: its notices elect the carrier's owner
  const follows = noticeFollows(row, turn, revealed, drawn, state); // panel finding 6: under the asking notice's own ask's id
  const input = arrivalInput(row, turn, { revealed, expanded, drawn, state }); // UX wave U2b: `state`, for an answer's receipt (R13)
  const instanceId = input?.instanceId ?? null;
  // The carrier's other notices follow the drawing this one applied (carrier-drawing.ts); it conceals nothing once gone.
  const report = useCallback((_ink: boolean, native: { visible: boolean }) => {
    if (appSessionId !== null && instanceId !== null) setCarrierConcealed(appSessionId, instanceId, !native.visible);
  }, [appSessionId, instanceId]);
  useEffect(() => () => {
    if (appSessionId !== null && instanceId !== null) setCarrierConcealed(appSessionId, instanceId, false);
  }, [appSessionId, instanceId]);
  if (follows !== null) return <FollowingNotice row={row} appSessionId={appSessionId} instanceId={follows} />;
  if (!input) return <NoticeRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="UserMessage" {...input} onInk={report} placeholder={<span className="text-fg-faint">…</span>}>{() => <NoticeRow row={row} />}</SurfaceRow>;
}

// A notice its carrier's other notice asks for: hidden where that notice's applied drawing conceals MAWS's own (a mod
// replaced or hid the carrier), MAWS's line wherever that notice shows its own line.
function FollowingNotice({ row, appSessionId, instanceId }: { row: Extract<Row, { kind: 'notice' }>; appSessionId: AppSessionId | null; instanceId: string }) {
  return useCarrierConcealed(appSessionId, instanceId) ? null : <NoticeRow row={row} />;
}

function useAssistantInput(row: Extract<Row, { kind: 'assistant_text' }>) {
  const { storeKey } = useTranscriptContext();
  const appSessionId = useOwnerChannelSurface(); // local comment threads never ask the attached session's surface
  const turn = useTranscriptStore((s) => row.turnId === null ? undefined : s.entries[storeKey]?.state.turns.get(row.turnId));
  const live = useTranscriptStore((s) => liveBuffer(s.entries[storeKey], row));
  const revealed = useTranscriptStore((s) => s.entries[storeKey]?.state.ui.revealed); // UX wave U3
  const input = assistantInput({ ...row, markdown: live ?? row.markdown }, turn, revealed);
  const attached = useSurfaceAttached(appSessionId);
  const text = live ?? row.markdown;
  const reportInk = useCallback((ink: boolean) => {
    if (row.turnId !== null) useTranscriptStore.getState().setAssistantInk(storeKey, row.id, row.turnId, ink, attached ? 'surface' : 'local');
  }, [storeKey, row.id, row.turnId, attached]);
  const presentation = useMemo(() => assistantPresentation(text), [text]);
  return { appSessionId, input, reportInk, attached, presentation, key: assistantDrawingKey(storeKey, row.id) };
}

// The virtualized divider bounds these ask-only mounts to turns in/near the viewport. Only assistant text bypasses
// the fold; tool/group sites still wait for expansion. Shared registry addresses mean one ask per text block.
export function FoldedAssistantProbes({ row }: { row: Extract<Row, { kind: 'divider' }> }) {
  const { storeKey } = useTranscriptContext();
  const ownRows = useTranscriptStore((s) => {
    const state = s.entries[storeKey]?.state;
    return !row.expanded && state && row.turnId !== null ? turnRows(state, row.turnId) : undefined;
  });
  return useMemo(() => {
    // ownRows is the per-turn invalidation key; read the latest state only when that key changes.
    const state = useTranscriptStore.getState().entries[storeKey]?.state;
    if (row.expanded || !ownRows || !state || row.turnId === null) return null;
    return <>{expandedTurnRows(state, row.turnId).filter((r): r is Extract<Row, { kind: 'assistant_text' }> => r.kind === 'assistant_text' && r.phase === 'commentary').map((text) => <AssistantProbe key={text.id} row={text} />)}</>;
  }, [row.expanded, row.turnId, ownRows, storeKey]);
}
function AssistantProbe({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { appSessionId, input, reportInk, key, attached, presentation } = useAssistantInput(row);
  const owned = useAssistantDrawings((s) => s.has(key));
  const answer = useSurfaceSite({ appSessionId, component: 'AssistantMessage', instanceId: input?.instanceId ?? row.id, props: input?.props ?? { text: '', isFirstOfReply: false }, enabled: input !== null });
  const props = answer?.hooked && answer.rewritten && input ? parseTranscriptProps('AssistantMessage', answer.props, input.props) : input?.props;
  const tree = answer?.hooked && props ? answer.tree : null;
  const native = drawsEngine(tree) || firstEngineRef(tree) !== null;
  const ink = hasInk(tree) || (native && hasClosedMarks(props?.text ?? ''));
  useEffect(() => {
    // Read ownership at application time too: a drawing may have mounted since this probe rendered.
    if (!useAssistantDrawings.getState().has(key) && (!attached || answer !== null)) reportInk(attached ? ink : presentation !== null);
  }, [owned, key, attached, answer, ink, presentation, reportInk]);
  return null;
}

export function SurfaceAssistantRow({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { appSessionId, input, reportInk, key, attached, presentation } = useAssistantInput(row);
  const surfaceInk = useCallback((ink: boolean, native: { visible: boolean; props: TranscriptProps['AssistantMessage'] }) => {
    reportInk(ink || (native.visible && hasClosedMarks(native.props.text)));
  }, [reportInk]);
  // Claim in layout before a folded probe's passive answer or surface cleanup can demote this drawing.
  useLayoutEffect(() => retainAssistantDrawing(key), [key]);
  useEffect(() => {
    if (!attached) reportInk(presentation !== null);
  }, [attached, presentation, reportInk]);
  if (!attached || !input) return presentation ? presentation.render({ live: row.live }) : <AssistantTextRow row={{ ...row, forHuman: false }} />;
  return <SurfaceRow appSessionId={appSessionId} component="AssistantMessage" {...input} onInk={surfaceInk} placeholder={<AssistantTextRow row={row} text="…" />}>
    {(props, { ink }) => assistantPresentation(stripAnsi(props.text))?.render({ live: row.live }) ?? <AssistantTextRow row={{ ...row, forHuman: ink }} text={stripAnsi(props.text)} />}
  </SurfaceRow>;
}

export function SurfaceCommandRow({ row }: { row: Extract<Row, { kind: 'local_command' }> }) {
  const { appSessionId, state } = useTranscriptSurface(row);
  const input = commandInput(row, state, state?.ui.revealed);
  if (!input) return <LocalCommandRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="CommandOutput" {...input} placeholder={<LocalCommandRow row={{ ...row, text: '…' }} />}>
    {(props) => <LocalCommandRow row={props.text === row.text ? row : { ...row, text: props.text }} />}
  </SurfaceRow>;
}

export function SurfaceQuestionRow({ row }: { row: Extract<Row, { kind: 'question' }> }) {
  const { appSessionId, state, turn } = useTranscriptSurface(row);
  const input = questionInput(row, turn, state?.ui.revealed);
  if (!input) return <QuestionRow row={row} />;
  const { props } = input;
  return <SurfaceRow appSessionId={appSessionId} component="AskUserQuestion" instanceId={row.toolUseId} props={props} placeholder={<span className="text-fg-faint">…</span>}>
    {(rewritten) => <QuestionRow row={rewritten === props ? row : { ...row, questions: nativeQuestionsOf(rewritten.questions) ?? row.questions }} />}
  </SurfaceRow>;
}

export function SurfaceGroupRow({ row }: { row: Extract<Row, { kind: 'group' }> }) {
  const { appSessionId, state, turn, storeKey } = useTranscriptSurface(row);
  const input = state ? groupInput(row, turn, state.pending, state.ui.revealed) : null; // UX wave U2: the jump's target asks nothing
  const expand = useCallback((props: TranscriptProps['ToolGroup']) => {
    if (!props.isExpanded) return;
    const current = useTranscriptStore.getState().rows(storeKey).find((r) => r.id === row.id);
    if (current?.kind === 'group' && !current.expanded) useTranscriptStore.getState().toggleGroup(storeKey, row.id);
  }, [storeKey, row.id]);
  // UX wave U2b (§E): a full site. An answer with no engine slot replaces the run; one that keeps it draws MAWS's run there
  // The site stays mounted while the row asks nothing (a request waits on its call, the reader's jump reveals it), so
  // the run MAWS draws keeps its element and its open state through it.
  const group = <GroupRow row={row} renderCell={(cell) => <SurfaceCellLine cell={cell} turnId={row.turnId} />} />;
  return <SurfaceRow appSessionId={appSessionId} component="ToolGroup" {...idle(row, input)} onRewrite={expand} placeholder={<span className="text-fg-faint">…</span>}>{() => group}</SurfaceRow>;
}

// A site that asks nothing for now: mounted, disabled, so the row's own drawing keeps its element when an ask starts or
// stops. Its props reach no one (the site's children draw the row itself, and a disabled site sends nothing).
function idle<P>(row: Row, input: { instanceId: string; props: P } | null): { instanceId: string; props: P; enabled: boolean } {
  return input ? { ...input, enabled: true } : { instanceId: row.id, props: {} as P, enabled: false };
}

// UX wave U2b (§E): a thought outside a run asks `AssistantMessage` with the engine's props for one, under its own uuid;
// MAWS's own row is its drawing (one with no text yet asks nothing, its site idle).
export function SurfaceThinkingRow({ row }: { row: Extract<Row, { kind: 'thinking' }> }) {
  const { appSessionId, state } = useTranscriptSurface(row);
  const input = thinkingInput(row, state?.ui.revealed);
  return <SurfaceRow appSessionId={appSessionId} component="AssistantMessage" {...idle(row, input)} placeholder={<span className="text-fg-faint">…</span>}>{() => <ThinkingRow row={row} />}</SurfaceRow>;
}

// UX wave U2b (§E): a call a row of its own draws (a message tool's message, whose drawing is MAWS's `MessageView`; an
// agent listing; a browser action) asks `ToolUse` with the call's props, and no `ToolResult`.
export function SurfaceCallRow({ row, children }: { row: Extract<Row, { kind: 'to_human' | 'agent_list' | 'browser_action' }>; children: ReactNode }) {
  const { state, turn } = useTranscriptSurface(row);
  const appSessionId = useOwnerChannelSurface(); // panel finding 1: the card's thread draws these through MAWS too
  const input = callInput(row, turn, state?.ui.revealed);
  return <SurfaceRow appSessionId={appSessionId} component="ToolUse" {...idle(row, input)} placeholder={<span className="text-fg-faint">…</span>}>{() => children}</SurfaceRow>;
}

// UX wave U2b (§E): a closed turn's line, where no turn folds, asks `TurnDuration` (through `session.ui.renderSite`) and
// is MAWS's own line in the answer's engine slot, hidden where the answer draws nothing; with no answer (none yet, an
// earlier engine host's `unknown_command`, no surface) MAWS's own. A turn whose line folds (no view in force) asks
// nothing: its line is the fold's control.
const NO_PROPS: Record<string, unknown> = {};
export function SurfaceTurnLine({ row, children }: { row: Extract<Row, { kind: 'divider' }>; children: ReactNode }) {
  const { appSessionId, state, turn } = useTranscriptSurface(row);
  const input = state?.ui.noTurnFold === true ? turnLineInput(row, turn, state.ui.revealed) : null;
  const answer = useSurfaceSite({ appSessionId, component: 'TurnDuration', instanceId: input?.instanceId ?? row.id, props: (input?.props ?? NO_PROPS) as Record<string, unknown>, enabled: input !== null });
  const [failed, setFailed] = useState<SiteAnswer | null>(null);
  const tree = input !== null && appSessionId !== null && answer?.hooked && answer !== failed ? answer.tree : null;
  if (tree === null || drawsEngine(tree)) return children;
  if (drawsNothing(answer)) return null;
  return (
    <SurfaceBoundary answer={answer} name={`TurnDuration ${input!.instanceId}`} onError={setFailed}>
      <div data-plugin-drawn="TurnDuration" style={{ display: 'contents' }}>
        <SurfaceTree tree={tree} site={{ appSessionId: appSessionId!, component: 'TurnDuration', instanceId: input!.instanceId, client: ipc }} engine={children} />
      </div>
    </SurfaceBoundary>
  );
}

// UX wave U2b (reported point 23, §E "An answer's action row where the mod draws"): U3b's action row stands under an
// answer only while its body is drawn: where the answer's site draws nothing it is not laid out, so nothing of it can be
// hovered or reached by the keyboard. Its placement stays U3b's own.
export function DrawnAnswerActions({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { appSessionId, input } = useAssistantInput(row);
  const hidden = useSurfaceAnswers((s) => !row.cut && appSessionId !== null && input !== null && drawsNothing(s.answers.get(siteKey({ appSessionId, component: 'AssistantMessage', instanceId: input.instanceId }))));
  return hidden ? null : <AnswerActions row={row} />;
}
