// R3's mounts adapt row bodies without changing history. The sitting's assistant-only probes may promote a drawn
// row out of the work fold; virtualized-away dividers and folded tool/group rows issue no asks. Child transcripts
// are not their parent's engine surface.
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { assistantDrawingKey, retainAssistantDrawing, useAssistantDrawings } from '../../engine-surface/assistant-drawings';
import type { AppSessionId } from '@shared/graph/ids';
import { stripAnsi } from '@shared/wire/ansi';
import { nativeQuestionsOf, parseTranscriptProps, type TranscriptProps } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../../engine-surface/SurfaceRow';
import { assistantPresentation } from '../../owner/to-human/Presenter';
import { useSurfaceAttached, useSurfaceSite } from '../../engine-surface/site';
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
import { arrivalInput, assistantInput, commandInput, groupInput, noticeFollows, questionInput, sentInput, userInput } from './adapters';
import { setCarrierConcealed, useCarrierConcealed } from './carrier-drawing'; // UX wave U3
import { SurfaceCellLine } from './Tools';

import { useDisclosure, useTranscriptContext } from '../view/context';
import { useTranscriptSurface } from './context';

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
  const follows = noticeFollows(row, turn, revealed, drawn);
  const input = arrivalInput(row, turn, { revealed, expanded, drawn });
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
  const { storeKey, variant } = useTranscriptContext();
  // Local comment threads never ask the attached session's surface.
  const forcedLocal = useTranscriptContext().presentation === 'local';
  const appSessionId = variant === 'session' && storeKey && !forcedLocal ? storeKey as AppSessionId : null;
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
  return <>
    {input && <SurfaceRow appSessionId={appSessionId} component="ToolGroup" {...input} drawingOnly onRewrite={expand}>{() => null}</SurfaceRow>}
    <GroupRow row={row} renderCell={(cell) => <SurfaceCellLine cell={cell} turnId={row.turnId} />} />
  </>;
}
