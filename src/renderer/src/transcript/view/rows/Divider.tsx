// The work divider: one line that summarises a turn's work area and folds it (Copy: divider). A button with
// aria-expanded and, while open, aria-controls naming the work area's rows by their element ids (they are virtual, so
// only the mounted ones resolve; an id with no element is ignored); the denied and auto-denied counts are links to the first
// such cell (the store's jumpTo expands and scrolls); a trailing control opens the turn summary popover (§19: the
// auto-mode verdict appears there, never on a cell line). A working turn's duration ticks. W8: a click opens or folds
// the work area through the shared disclosure motion (motion.ts); a fold reads closed from the click on, while its rows
// close, and the store folds the turn when they have. R1: while the turn works, the most recent status line a plugin
// pinned (the engine's `ui_status`) reads under the divider, muted and on one line, the label itself untouched. R2: a
// plugin hooking the Spinner site replaces the working label's text (engine-surface/spinner.ts), nothing else.
import { Dialog, Popover } from 'radix-ui';
import { rowId } from '../../model/keys';
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
function useDuration(row: DividerRowData | undefined, storeKey: string): number {
  const startedAt = row?.startedAt;
  const working = row?.state === 'working';
  const frozen = useTranscriptStore((state) => (working && startedAt !== undefined && !ticks(state, storeKey) ? workingDurationMs(state.entries[storeKey], startedAt, 0, false) : null));
  const [now, setNow] = useState(Date.now);
  const ticking = working && frozen === null;
  useEffect(() => {
    if (!ticking) return;
    // Report can introduce a summary into an already-mounted disclosure; sample its clock as it opens.
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); };
  }, [ticking, startedAt]);
  return row === undefined ? 0 : working ? (frozen ?? workingDurationMs(useTranscriptStore.getState().entries[storeKey], row.startedAt, now)) : completedMs(row);
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

// Report uses the same summary inside its own stable disclosure, never a replacement button.
export function useDividerSummary(row: DividerRowData | undefined, open: boolean) {
  const { storeKey, idPrefix, variant } = useTranscriptContext();
  const durationMs = useDuration(row, storeKey);
  // A string, so the divider re-renders only when the work area's rows change, not with every batch.
  const controls = useTranscriptStore((state) => {
    const rows = open ? state.entries[storeKey]?.rows : undefined;
    return rows && row ? workAreaRowIds(rows, row).map((id) => rowElementId(idPrefix, id)).join(' ') : '';
  });
  // R2: a plugin hooking the Spinner gives the working label its text (a session's own transcript, never a child's)
  const spinner = useSpinnerText(variant === 'session' ? (storeKey as AppSessionId) : null, row?.state === 'working');
  const label = row === undefined ? null : spinner ?? dividerCopy({ state: row.state, cause: row.cause, origin: row.origin, durationMs, toolCalls: row.toolCalls, denied: 0, autoDenied: 0 });
  return { durationMs, controls, label: spinner === null ? label : <span data-plugin-spinner="">{label}</span> };
}

export function DividerRow({ row }: { row: DividerRowData }) {
  const { storeKey } = useTranscriptContext();
  const motion = useWorkMotion();
  const turn = row.turnId!;
  const open = !useSyncExternalStore(motion.subscribe, () => motion.isFolding(turn)) && row.expanded;
  const { durationMs, controls, label } = useDividerSummary(row, open);
  const store = useTranscriptStore.getState();
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
          {label}
        </button>
        <DividerDetails row={row} durationMs={durationMs} />
      </div>
      {row.state === 'working' && <PluginStatusLine storeKey={storeKey} />}
    </>
  );
}

export function DividerDetails({ row, durationMs }: { row: DividerRowData; durationMs: number }) {
  const { storeKey } = useTranscriptContext();
  const firstOf = (disposition: 'denied' | 'auto_denied') => row.summary.denials.find((denial) => denial.disposition === disposition)?.cellId ?? null;
  return (
    <>
      {row.denied > 0 && <CountLink count={row.denied} noun="denied" cell={firstOf('denied')} turnId={row.turnId!} storeKey={storeKey} />}
      {row.autoDenied > 0 && <CountLink count={row.autoDenied} noun="auto-denied" cell={firstOf('auto_denied')} turnId={row.turnId!} storeKey={storeKey} />}
      <TurnSummary row={row} durationMs={durationMs} />
    </>
  );
}

// R1: a string, so the divider re-renders only when the line itself changes.
export function PluginStatusLine({ storeKey }: { storeKey: string }) {
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
  const { storeKey, rewind, actions } = useTranscriptContext();
  const [files, setFiles] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const receipt = rowId.receipt(row.turnId!);
  const restoreState = useTranscriptStore((state) => state.entries[storeKey]?.state.ui.receipts.get(receipt)?.state ?? 'applied');
  const working = useTranscriptStore((state) => [...(state.entries[storeKey]?.state.turns.values() ?? [])].some((turn) => turn.state === 'open'));
  const busy = checking || restoreState === 'undoing';
  const preview = async () => {
    if (!rewind || busy || working) return;
    setChecking(true); setError(null);
    try {
      const answer = await rewind.canUndo(row.turnId!);
      if (!answer.ok) setError(answer.reason ?? 'Files cannot be restored.');
      else if (!answer.files?.length) setError(answer.files ? 'No files need restoring.' : 'The engine did not provide a file list.');
      else { setFiles(answer.files); setMenuOpen(false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setChecking(false); }
  };
  const restore = async () => {
    if (!rewind || !files || busy || working) return;
    const update = useTranscriptStore.getState().setReceipt;
    update(storeKey, receipt, { state: 'undoing' }); setError(null);
    try {
      const answer = await rewind.canUndo(row.turnId!);
      if (!answer.ok || !answer.files) throw new Error(answer.reason ?? 'The engine did not provide a file list.');
      if (answer.files.length !== files.length || answer.files.some((file) => !files.includes(file))) {
        update(storeKey, receipt, { state: 'applied' });
        setFiles(answer.files); setError('The files to restore changed. Review the list and confirm again.'); return;
      }
      await rewind.undo(row.turnId!);
      update(storeKey, receipt, { state: 'undone' }); setFiles(null);
    } catch (cause) {
      update(storeKey, receipt, { state: 'applied' });
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <>
    <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
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
          {(row.files?.length ?? 0) > 0 && <button type="button" className="transcript-button" onClick={() => { actions.reviewChanges(row.turnId!); setMenuOpen(false); }}>Review changes</button>}
          {rewind && (row.files?.length ?? 0) > 0 && <button type="button" className="transcript-button" disabled={working || busy || restoreState === 'undone'} onClick={() => void preview()}>
            {restoreState === 'undone' ? 'Files restored' : checking ? 'Checking files…' : 'Restore files to before this turn'}
          </button>}
          {error && <p role="alert">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <Dialog.Root open={files !== null} onOpenChange={(open) => { if (!open && !busy) { setFiles(null); setError(null); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60" />
        <Dialog.Content className="transcript-restore-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById(`${storeKey}-${receipt}-cancel`)?.focus(); }}>
          <Dialog.Title>Restore files to before this turn?</Dialog.Title>
          <Dialog.Description>This restores the following files, including changes made in later turns. Conversation history stays unchanged. There is no reapply.</Dialog.Description>
          <ul>{files?.map((file) => <li key={file}>{file}</li>)}</ul>
          {error && <p role="alert">{error}</p>}
          {working && <p role="status">Wait for the active turn to finish before restoring.</p>}
          <div className="transcript-restore-actions">
            <Dialog.Close id={`${storeKey}-${receipt}-cancel`} className="transcript-button" disabled={busy}>Cancel</Dialog.Close>
            <button type="button" className="transcript-button" disabled={busy || working} onClick={() => void restore()}>{busy ? 'Restoring…' : 'Restore files'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
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
