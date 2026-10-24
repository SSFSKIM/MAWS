// The live thinking label (W8, T1; the owner: "copy claude cli's style … with yellow color change when the thinking
// gets longer", and Codex's light sweep over "Thinking"). While a thinking block streams its label reads the CLI's tier,
// the session's effort and the time it has run (copy.ts, `liveThinkingLabel`), ticking once a second, and turns toward
// the warning colour between 10 and 20 s as the CLI's does (`thinkingWarmth`); Codex's shimmer sweeps the text while it
// is live, static under reduced motion (transcript.css, `.transcript-shimmer`).
import type { CSSProperties, ReactNode } from 'react';
import { liveThinkingLabel, thinkingWarmth } from '../../model/copy';
import { useTranscriptContext } from '../context';
import { useWorkingMs } from './parts';
import { liveBlockBuffer, useTranscriptStore } from '../../../stores/transcript';
import type { Cell, TurnId } from '../../model/rows';

// Text under the shimmer, in its own colour turned `warmth` of the way to the warning colour.
export function Shimmer({ children, warmth = 0 }: { children: ReactNode; warmth?: number }) {
  const style = { '--thinking-warmth': `${warmth * 100}%` } as CSSProperties;
  return (
    <span className="transcript-shimmer" data-shimmer="" data-warmth={warmth} style={style}>
      {children}
    </span>
  );
}

export function LiveThinkingLabel({ startedAt, text = '' }: { startedAt: string; text?: string }) {
  const { storeKey, effort } = useTranscriptContext();
  const elapsedMs = useWorkingMs(storeKey, startedAt);
  const latest = text.trim().split(/\r?\n/).filter((line) => line.trim()).at(-1);
  return <span className="transcript-thinking-summary"><Shimmer warmth={thinkingWarmth(elapsedMs)}>{latest || liveThinkingLabel(elapsedMs, effort ?? null)}</Shimmer></span>;
}

export function LiveThinkingCellLabel({ cell, turnId }: { cell: Cell; turnId: TurnId | null }) {
  const { storeKey } = useTranscriptContext();
  const buffer = useTranscriptStore((state) => turnId && cell.id.startsWith('cell:think:') ? liveBlockBuffer(state.entries[storeKey], turnId, cell.id.slice('cell:think:'.length)) : null);
  return <LiveThinkingLabel startedAt={cell.startedAt} text={buffer ?? (cell.detail.kind === 'thinking' ? cell.detail.text : '')} />;
}
