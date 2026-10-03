// R3's mounts change row bodies, never the transcript's turn/work-area structure. Virtual rows own these mounts;
// folded or virtualized-away rows therefore issue no asks. Child transcripts are not their parent's engine surface.
import { useCallback, useEffect, useMemo } from 'react';
import { nativeQuestionsOf, parseTranscriptProps, type TranscriptProps } from '@shared/engine/surface-rows';
import { SurfaceRow } from '../../engine-surface/SurfaceRow';
import { useSurfaceAttached, useSurfaceSite } from '../../engine-surface/site';
import { hasInk } from '../../engine-surface/tree';
import { expandedTurnRows } from '../model/derive';
import { liveBuffer, useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { AssistantTextRow } from '../view/rows/AssistantText';
import { GroupRow } from '../view/rows/Group';
import { LocalCommandRow } from '../view/rows/LocalCommand';
import { QuestionRow } from '../view/rows/Question';
import { UserRow } from '../view/rows/User';
import { assistantInput, commandInput, groupInput, questionInput, userInput } from './adapters';
import { SurfaceCellLine } from './Tools';

import { useTranscriptSurface } from './context';

export function SurfaceUserRow({ row }: { row: Extract<Row, { kind: 'user' }> }) {
  const { appSessionId, turn } = useTranscriptSurface(row);
  const input = userInput(row, turn);
  if (!input) return <UserRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="UserMessage" {...input} placeholder={<UserRow row={{ ...row, text: '…', attachments: [], placeholders: [] }} />}>
    {(props) => <UserRow row={props.text === row.text ? row : { ...row, text: props.text, placeholders: [], attachments: row.attachments.filter((a) => a.kind !== 'text') }} />}
  </SurfaceRow>;
}

function useAssistantPresentation(row: Extract<Row, { kind: 'assistant_text' }>) {
  const { appSessionId, turn, storeKey } = useTranscriptSurface(row);
  const live = useTranscriptStore((s) => liveBuffer(s.entries[storeKey], row));
  const input = assistantInput({ ...row, markdown: live ?? row.markdown }, turn);
  const attached = useSurfaceAttached(appSessionId);
  const answer = useSurfaceSite({ appSessionId, component: 'AssistantMessage', instanceId: input?.instanceId ?? row.id, props: input?.props ?? { text: '', isFirstOfReply: false }, enabled: input !== null });
  const ink = answer?.hooked === true && hasInk(answer.tree) && (!answer.rewritten || parseTranscriptProps('AssistantMessage', answer.props, input!.props) !== null);
  useEffect(() => {
    // A remount's pending ask does not erase the presentation remembered through virtualization.
    if ((!attached || answer !== null) && row.turnId !== null) useTranscriptStore.getState().setAssistantInk(storeKey, row.id, row.turnId, attached && ink);
  }, [attached, answer, ink, storeKey, row.id, row.turnId]);
  return { appSessionId, input, ink };
}

// The virtualized divider bounds these ask-only mounts to turns in/near the viewport. Only assistant text bypasses
// the fold; tool/group sites still wait for expansion. Shared registry addresses mean one ask per text block.
export function FoldedAssistantProbes({ row }: { row: Extract<Row, { kind: 'divider' }> }) {
  const { state, turn } = useTranscriptSurface(row);
  const texts = useMemo(() => !row.expanded && state && turn ? expandedTurnRows(state, turn.id).filter((r): r is Extract<Row, { kind: 'assistant_text' }> => r.kind === 'assistant_text' && r.phase === 'commentary') : [], [row.expanded, state, turn]);
  return <>{texts.map((text) => <AssistantProbe key={text.id} row={text} />)}</>;
}
function AssistantProbe({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  useAssistantPresentation(row);
  return null;
}

export function SurfaceAssistantRow({ row }: { row: Extract<Row, { kind: 'assistant_text' }> }) {
  const { appSessionId, input, ink } = useAssistantPresentation(row);
  if (!input) return <AssistantTextRow row={row} />;
  return <SurfaceRow appSessionId={appSessionId} component="AssistantMessage" {...input} placeholder={<AssistantTextRow row={row} text="…" />}>
    {(props) => <AssistantTextRow row={{ ...row, forHuman: ink }} text={props.text} />}
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
