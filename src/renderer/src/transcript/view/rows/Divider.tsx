// The work divider: one line that summarises a turn's work area and folds it (Copy: divider). A button with
// aria-expanded and, while open, aria-controls naming the list that holds the work-area rows (they are virtual, so
// no row is guaranteed to be in the DOM; the list always is); the denied and auto-denied counts are links to the first
// such cell (the store's jumpTo expands and scrolls); a trailing control opens the turn summary popover (§19: the
// auto-mode verdict appears there, never on a cell line). A working turn's duration ticks.
import { Popover } from 'radix-ui';
import { useEffect, useState } from 'react';
import { ticks, useTranscriptStore, workingDurationMs, type TranscriptEntry } from '../../../stores/transcript';
import { dividerCopy, turnSummaryCopy } from '../../model/copy';
import { turnPhrases } from '../../model/derive';
import type { CellId, Row, TurnId } from '../../model/rows';
import { listElementId, useTranscriptContext } from '../context';
import { Chevron } from './parts';

type DividerRowData = Extract<Row, { kind: 'divider' }>;

const completedMs = (row: DividerRowData) => row.summary.durationMs ?? (row.endedAt === null ? 0 : Date.parse(row.endedAt) - Date.parse(row.startedAt));

// A working turn's duration, re-read from the store once a second while its process is live; without one (C5's
// liveness rule) it is the latest event's time, following the events as they arrive and never the wall clock.
function useDuration(row: DividerRowData, storeKey: string): number {
  const working = row.state === 'working';
  const frozen = useTranscriptStore((state) => (working && !ticks(state, storeKey) ? workingDurationMs(state.entries[storeKey], row.startedAt, 0, false) : null));
  const [ms, setMs] = useState(() => workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.startedAt, Date.now()));
  const ticking = working && frozen === null;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setMs(workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.startedAt, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [ticking, storeKey, row.startedAt]);
  return working ? (frozen ?? ms) : completedMs(row);
}

export function DividerRow({ row }: { row: DividerRowData }) {
  const { storeKey, idPrefix } = useTranscriptContext();
  const durationMs = useDuration(row, storeKey);
  const store = useTranscriptStore.getState();
  const label = dividerCopy({ state: row.state, origin: row.origin, durationMs, toolCalls: row.toolCalls, denied: 0, autoDenied: 0 });
  const firstOf = (disposition: 'denied' | 'auto_denied') => row.summary.denials.find((denial) => denial.disposition === disposition)?.cellId ?? null;
  return (
    <div className="transcript-divider">
      <button
        type="button"
        className="transcript-disclosure"
        aria-expanded={row.expanded}
        aria-controls={row.expanded ? listElementId(idPrefix) : undefined}
        onClick={() => store.toggleTurn(storeKey, row.turnId!)}
      >
        <Chevron />
        {label}
      </button>
      {row.denied > 0 && <CountLink count={row.denied} noun="denied" cell={firstOf('denied')} turnId={row.turnId!} storeKey={storeKey} />}
      {row.autoDenied > 0 && <CountLink count={row.autoDenied} noun="auto-denied" cell={firstOf('auto_denied')} turnId={row.turnId!} storeKey={storeKey} />}
      <TurnSummary row={row} durationMs={durationMs} />
    </div>
  );
}

// The jump names the owning turn, so locating the cell in a collapsed turn derives that turn alone.
function CountLink({ count, noun, cell, turnId, storeKey }: { count: number; noun: string; cell: CellId | null; turnId: TurnId; storeKey: string }) {
  return (
    <>
      <span aria-hidden="true">·</span>
      <a
        href={cell ? `#${cell}` : undefined}
        className="transcript-divider-count"
        onClick={(event) => {
          event.preventDefault();
          if (cell) useTranscriptStore.getState().jumpTo(storeKey, cell, { turnId });
        }}
      >
        {count} {noun}
      </a>
    </>
  );
}

const tokensOf = (usage: DividerRowData['summary']['usage']) =>
  usage === null ? null : usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;

function TurnSummary({ row, durationMs }: { row: DividerRowData; durationMs: number }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="transcript-divider-summary" aria-label="Turn summary">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="3" cy="6" r="1" fill="currentColor" />
          <circle cx="6" cy="6" r="1" fill="currentColor" />
          <circle cx="9" cy="6" r="1" fill="currentColor" />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="transcript-popover" side="bottom" align="start" sideOffset={6}>
          <SummaryText row={row} durationMs={durationMs} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Mounted only while the popover is open: the whole turn's phrases come from a derivation of that turn.
function SummaryText({ row, durationMs }: { row: DividerRowData; durationMs: number }) {
  const { storeKey } = useTranscriptContext();
  const turn = useTranscriptStore((state: { entries: Record<string, TranscriptEntry> }) => state.entries[storeKey]?.state.turns.get(row.turnId as TurnId));
  const { summary } = row;
  return (
    <p>
      {turnSummaryCopy({
        state: row.state, origin: row.origin, durationMs, toolCalls: summary.toolCalls, model: summary.model, phrases: turn ? turnPhrases(turn) : '',
        denied: summary.denials.filter((denial) => denial.disposition !== 'stopped'), safeguard: summary.safeguard, costUsd: summary.costUsd,
        tokens: tokensOf(summary.usage), childAgents: summary.childAgents,
      })}
    </p>
  );
}
