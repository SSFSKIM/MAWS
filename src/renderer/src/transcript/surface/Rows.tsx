// R3's mounts adapt row bodies without changing history. The sitting's assistant-only probes may promote a drawn
// row out of the work fold; virtualized-away dividers and folded tool/group rows issue no asks. Child transcripts
// are not their parent's engine surface.
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { stripAnsi } from '@shared/wire/ansi';
import { nativeQuestionsOf, parseTranscriptProps, type TranscriptProps } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../../engine-surface/SurfaceRow';
import { assistantPresentation } from '../../owner/to-human/Presenter';
import { useSurfaceAttached, useSurfaceSite } from '../../engine-surface/site';
import { hasInk } from '../../engine-surface/tree';
import { expandedTurnRows, turnRows } from '../model/derive';
import { liveBuffer, useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { AssistantTextRow } from '../view/rows/AssistantText';
import { GroupRow } from '../view/rows/Group';
import { LocalCommandRow } from '../view/rows/LocalCommand';
import { QuestionRow } from '../view/rows/Question';
import { UserRow } from '../view/rows/User';
import { assistantInput, commandInput, groupInput, questionInput, userInput } from './adapters';
import { SurfaceCellLine } from './Tools';

import { useTranscriptContext } from '../view/context';
import { useTranscriptSurface } from './context';

export function SurfaceUserRow({ row }: { row: Extract<Row, { kind: 'user' }> }) {
  const { appSessionId, turn } = useTranscriptSurface(row);
  const input = userInput(row, turn);
  if (!input) return <UserRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="UserMessage" {...input} placeholder={<UserRow row={{ ...row, text: '…', attachments: [], placeholders: [] }} />}>
    {(props) => <UserRow row={props.text === row.text ? row : { ...row, text: props.text, placeholders: [], attachments: row.attachments.filter((a) => a.kind !== 'text') }} />}
  </SurfaceRow>;
}

// Live drawings own presentation while mounted; a divider probe takes over when virtualization removes them.
// Register in layout so a probe's passive answer effect cannot outrun a newly mounted drawing's gesture hold.
const useAssistantDrawings = create<ReadonlyMap<string, number>>(() => new Map());
function retainAssistantDrawing(key: string) {
  useAssistantDrawings.setState((s) => new Map(s).set(key, (s.get(key) ?? 0) + 1), true);
  return () => useAssistantDrawings.setState((s) => {
    const next = new Map(s), count = next.get(key)! - 1;
    if (count) next.set(key, count);
    else next.delete(key);
    return next;
  }, true);
}

function useAssistantInput(row: Extract<Row, { kind: 'assistant_text' }>) {
  const { storeKey, variant } = useTranscriptContext();
  const appSessionId = variant === 'session' && storeKey ? storeKey as AppSessionId : null;
  const turn = useTranscriptStore((s) => row.turnId === null ? undefined : s.entries[storeKey]?.state.turns.get(row.turnId));
  const live = useTranscriptStore((s) => liveBuffer(s.entries[storeKey], row));
  const input = assistantInput({ ...row, markdown: live ?? row.markdown }, turn);
  const attached = useSurfaceAttached(appSessionId);
  const reportInk = useCallback((ink: boolean) => {
    if (row.turnId !== null) useTranscriptStore.getState().setAssistantInk(storeKey, row.id, row.turnId, ink, attached ? 'surface' : 'local');
  }, [storeKey, row.id, row.turnId, attached]);
  const text = live ?? row.markdown;
  const presentation = useMemo(() => attached ? null : assistantPresentation(text), [attached, text]);
  const showRecord = useTranscriptStore((s) => {
    const state = s.entries[storeKey]?.state;
    return row.turnId === null || !state || state.ui.expandedTurns.has(row.turnId) || (turn?.state === 'open' && !state.ui.collapsedTurns.has(row.turnId));
  });
  return { appSessionId, input, reportInk, attached, presentation, showRecord, key: `${storeKey}\u0000${row.id}` };
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
  const ink = answer?.hooked === true && hasInk(answer.tree) && (!answer.rewritten || parseTranscriptProps('AssistantMessage', answer.props, input!.props) !== null);
  useEffect(() => {
    // Read ownership at application time too: a drawing may have mounted since this probe rendered.
    if (!useAssistantDrawings.getState().has(key) && (!attached || answer !== null)) reportInk(attached ? ink : presentation !== null);
  }, [owned, key, attached, answer, ink, presentation, reportInk]);
  return null;
}

export function SurfaceAssistantRow({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { appSessionId, input, reportInk, key, attached, presentation, showRecord } = useAssistantInput(row);
  const { storeKey } = useTranscriptContext();
  const hasWorkFold = useTranscriptStore((s) => {
    const state = s.entries[storeKey]?.state;
    return !!state && row.turnId !== null && !!turnRows(state, row.turnId)?.some((r) => r.kind === 'divider');
  });
  useLayoutEffect(() => retainAssistantDrawing(key), [key]);
  useEffect(() => {
    if (!attached) reportInk(presentation !== null);
  }, [attached, presentation, reportInk]);
  if (!attached) return presentation ? presentation.render({ showRecord, live: row.live, hasWorkFold, recordKey: key }) : <AssistantTextRow row={{ ...row, forHuman: false }} />;
  if (!input) return <AssistantTextRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="AssistantMessage" {...input} onInk={reportInk} placeholder={<AssistantTextRow row={row} text="…" />}>
    {(props, { ink }) => <AssistantTextRow row={{ ...row, forHuman: ink }} text={stripAnsi(props.text)} />}
  </SurfaceRow>;
}

export function SurfaceCommandRow({ row }: { row: Extract<Row, { kind: 'local_command' }> }) {
  const { appSessionId, state } = useTranscriptSurface(row);
  const input = commandInput(row, state);
  if (!input) return <LocalCommandRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="CommandOutput" {...input} placeholder={<LocalCommandRow row={{ ...row, text: '…' }} />}>
    {(props) => <LocalCommandRow row={props.text === row.text ? row : { ...row, text: props.text }} />}
  </SurfaceRow>;
}

export function SurfaceQuestionRow({ row }: { row: Extract<Row, { kind: 'question' }> }) {
  const { appSessionId, turn } = useTranscriptSurface(row);
  const { props } = questionInput(row, turn);
  return <SurfaceRow appSessionId={appSessionId} component="AskUserQuestion" instanceId={row.toolUseId} props={props} placeholder={<span className="text-fg-faint">…</span>}>
    {(rewritten) => <QuestionRow row={rewritten === props ? row : { ...row, questions: nativeQuestionsOf(rewritten.questions) ?? row.questions }} />}
  </SurfaceRow>;
}

export function SurfaceGroupRow({ row }: { row: Extract<Row, { kind: 'group' }> }) {
  const { appSessionId, state, turn, storeKey } = useTranscriptSurface(row);
  const input = state ? groupInput(row, turn, state.pending) : null;
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
