// The work divider: one line that summarises a turn's work area and folds it (Copy: divider). A button with
// aria-expanded and aria-controls naming the work-area rows; the denied and auto-denied counts are links to the first
// such cell (the store's jumpTo expands and scrolls); a trailing control opens the turn summary popover (§19: the
// auto-mode verdict appears there, never on a cell line). A working turn's duration ticks.
import { Popover } from 'radix-ui';
import { useEffect, useState } from 'react';
import { useTranscriptStore, workingDurationMs, type TranscriptEntry } from '../../../stores/transcript';
import { dividerCopy, turnSummaryCopy } from '../../model/copy';
import { turnPhrases } from '../../model/derive';
import type { CellId, Row, TurnId } from '../../model/rows';
import { rowElementId, useTranscriptContext } from '../context';
import { Chevron } from './parts';

type DividerRowData = Extract<Row, { kind: 'divider' }>;

// The rows of each expanded turn's work area (between its divider and its answer), per derived row list.
const workAreas = new WeakMap<Row[], Map<string, string[]>>();
function workAreaOf(rows: Row[] | undefined, divider: DividerRowData): string[] {
  if (!rows) return [];
  let areas = workAreas.get(rows);
  if (!areas) {
    areas = new Map();
    workAreas.set(rows, areas);
  }
  const cached = areas.get(divider.id);
  if (cached) return cached;
  const ids: string[] = [];
  for (let i = rows.indexOf(divider) + 1; i > 0 && i < rows.length; i += 1) {
    const row = rows[i];
    const outside = row.turnId !== divider.turnId || row.kind === 'receipt' || (row.kind === 'user' && row.steer) || (row.kind === 'assistant_text' && row.phase === 'answer');
    if (outside) break;
    ids.push(row.id);
  }
  areas.set(divider.id, ids);
  return ids;
}

const completedMs = (row: DividerRowData) => row.summary.durationMs ?? (row.endedAt === null ? 0 : Date.parse(row.endedAt) - Date.parse(row.startedAt));

// A working turn's duration, re-read from the store once a second.
function useDuration(row: DividerRowData, storeKey: string): number {
  const working = row.state === 'working';
  const read = () => workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.startedAt, Date.now());
  const [ms, setMs] = useState(read);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setMs(workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.startedAt, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [working, storeKey, row.startedAt]);
  return working ? ms : completedMs(row);
}

export function DividerRow({ row }: { row: DividerRowData }) {
  const { storeKey, idPrefix } = useTranscriptContext();
  const workArea = useTranscriptStore((state) => (row.expanded ? workAreaOf(state.entries[storeKey]?.rows, row) : null));
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
        aria-controls={workArea && workArea.length > 0 ? workArea.map((id) => rowElementId(idPrefix, id)).join(' ') : undefined}
        onClick={() => store.toggleTurn(storeKey, row.turnId!)}
      >
        <Chevron />
        {label}
      </button>
      {row.denied > 0 && <CountLink count={row.denied} noun="denied" cell={firstOf('denied')} storeKey={storeKey} />}
      {row.autoDenied > 0 && <CountLink count={row.autoDenied} noun="auto-denied" cell={firstOf('auto_denied')} storeKey={storeKey} />}
      <TurnSummary row={row} durationMs={durationMs} />
    </div>
  );
}

function CountLink({ count, noun, cell, storeKey }: { count: number; noun: string; cell: CellId | null; storeKey: string }) {
  return (
    <>
      <span aria-hidden="true">·</span>
      <a
        href={cell ? `#${cell}` : undefined}
        className="transcript-divider-count"
        onClick={(event) => {
          event.preventDefault();
          if (cell) useTranscriptStore.getState().jumpTo(storeKey, cell);
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
