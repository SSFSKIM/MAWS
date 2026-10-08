// The work divider: one line that summarises a turn's work area and folds it (Copy: divider). A button with
// aria-expanded and, while open, aria-controls naming the work area's rows by their element ids (they are virtual, so
// only the mounted ones resolve; an id with no element is ignored); the denied and auto-denied counts are links to the first
// such cell (the store's jumpTo expands and scrolls); a trailing control opens the turn summary popover (§19: the
// auto-mode verdict appears there, never on a cell line). A working turn's duration ticks. W8: a click opens or folds
// the work area through the shared disclosure motion (motion.ts); a fold reads closed from the click on, while its rows
// close, and the store folds the turn when they have. R1: while the turn works, the most recent status line a plugin
// pinned (the engine's `ui_status`) reads under the divider, muted and on one line, the label itself untouched. R2: a
// plugin hooking the Spinner site replaces the working label's text (engine-surface/spinner.ts), nothing else.
import { Popover } from 'radix-ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ticks, useTranscriptStore, workingDurationMs, type TranscriptEntry } from '../../../stores/transcript';
import { dividerCopy, turnSummaryCopy } from '../../model/copy';
import { isPersistentRow, turnPhrases } from '../../model/derive';
import { latestPluginLine } from '../../model/plugins';
import type { AppSessionId } from '@shared/graph/ids';
import { useSpinnerText } from '../../../engine-surface/spinner'; // R2
import type { CellId, Row, TurnId } from '../../model/rows';
import { rowElementId, useTranscriptContext, useWorkMotion } from '../context';
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

// The rows of an open work area: the turn's rows after its divider up to its receipt, without those that stay in view
// when it folds (W1: a steer at its delivery position splits the work around it; derive.ts, isPersistentRow), time
// separators skipped.
function workAreaRowIds(rows: readonly Row[], divider: DividerRowData): string[] {
  const ids: string[] = [];
  for (let i = rows.findIndex((candidate) => candidate.id === divider.id) + 1; i > 0 && i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind === 'time') continue;
    if (row.turnId !== divider.turnId || row.kind === 'receipt') break;
    if (!isPersistentRow(row)) ids.push(row.id);
  }
  return ids;
}

export function DividerRow({ row }: { row: DividerRowData }) {
  const { storeKey, idPrefix, variant } = useTranscriptContext();
  const durationMs = useDuration(row, storeKey);
  const motion = useWorkMotion();
  const turn = row.turnId!;
  const open = !useSyncExternalStore(motion.subscribe, () => motion.isFolding(turn)) && row.expanded;
  // A string, so the divider re-renders only when the work area's rows change, not with every batch.
  const controls = useTranscriptStore((state) => {
    const rows = open ? state.entries[storeKey]?.rows : undefined;
    return rows ? workAreaRowIds(rows, row).map((id) => rowElementId(idPrefix, id)).join(' ') : '';
  });
  const store = useTranscriptStore.getState();
  // R2: a plugin hooking the Spinner gives the working label its text (a session's own transcript, never a child's)
  const spinner = useSpinnerText(variant === 'session' ? (storeKey as AppSessionId) : null, row.state === 'working');
  const label = spinner ?? dividerCopy({ state: row.state, cause: row.cause, origin: row.origin, durationMs, toolCalls: row.toolCalls, denied: 0, autoDenied: 0 });
  const firstOf = (disposition: 'denied' | 'auto_denied') => row.summary.denials.find((denial) => denial.disposition === disposition)?.cellId ?? null;
  return (
    <>
      <div className="transcript-divider">
        <button
          type="button"
          className="transcript-disclosure"
          aria-expanded={open}
          aria-controls={controls || undefined}
          onClick={() => {
            const target = !row.expanded;
            motion.toggle(turn, row.expanded, () => {
              const current = useTranscriptStore.getState().entries[storeKey]?.rows.find((candidate) => candidate.id === row.id);
              if (current?.kind === 'divider' && current.expanded !== target) store.toggleTurn(storeKey, turn);
            });
          }}
        >
          <Chevron />
          {spinner === null ? label : <span data-plugin-spinner="">{label}</span>}
        </button>
        {row.denied > 0 && <CountLink count={row.denied} noun="denied" cell={firstOf('denied')} turnId={row.turnId!} storeKey={storeKey} />}
        {row.autoDenied > 0 && <CountLink count={row.autoDenied} noun="auto-denied" cell={firstOf('auto_denied')} turnId={row.turnId!} storeKey={storeKey} />}
        <TurnSummary row={row} durationMs={durationMs} />
      </div>
      {row.state === 'working' && <PluginStatusLine storeKey={storeKey} />}
    </>
  );
}

// R1: a string, so the divider re-renders only when the line itself changes.
function PluginStatusLine({ storeKey }: { storeKey: string }) {
  const line = useTranscriptStore((state) => latestPluginLine(state.entries[storeKey]?.state.pluginStatus));
  if (line === null) return null;
  return (
    <p className="transcript-plugin-status" title={line}>
      {line}
    </p>
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
        state: row.state, cause: row.cause, origin: row.origin, durationMs, toolCalls: summary.toolCalls, model: summary.model, phrases: turn ? turnPhrases(turn) : '',
        denied: summary.denials.filter((denial) => denial.disposition !== 'stopped'), safeguard: summary.safeguard, costUsd: summary.costUsd,
        tokens: tokensOf(summary.usage), childAgents: summary.childAgents,
      })}
    </p>
  );
}
