// A background shell's row and a monitor's (C8b execution document, M3): `<description> · running <elapsed>`, then
// `· <status> <ago>` once it ends. A shell's `Output` opens the Log on the file the engine reported (the Bash result's
// own sentence at start, or the notification), never a derived one, and is disabled until one is reported (P5 O9 M5: and
// absent for a lane A job, whose output tail is remote-only). `Stop` asks
// no confirmation (the TUI's `x` asks none) and reads `stopping…` until the engine's terminal frame. A monitor's
// interval is not on the wire and is not shown. Also the pieces the workflow card shares: the stop button, its error.
import type { ReactNode } from 'react';
import type { TaskId } from '@shared/graph/ids';
import { BACKGROUND_COPY } from '../copy';
import { elapsedOf, formatAgo, formatElapsed } from '../model/elapsed';
import type { TaskNode, TaskStatus } from '../model/task-graph';

export const ACTION =
  'shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export const statusWord = (status: TaskStatus): string => (status === 'running' ? '' : BACKGROUND_COPY.status[status]);

// A shell's or a monitor's one line.
export function taskLine(node: TaskNode, now: number): string {
  if (node.status === 'running') {
    const elapsed = elapsedOf(node, now);
    return elapsed ? BACKGROUND_COPY.running(node.description, formatElapsed(elapsed.ms)) : BACKGROUND_COPY.runningUntimed(node.description);
  }
  const word = statusWord(node.status);
  if (node.status === 'exited' || node.endedAt === null) return BACKGROUND_COPY.endedUndated(node.description, word);
  return BACKGROUND_COPY.ended(node.description, word, formatAgo(now - Date.parse(node.endedAt)));
}

// `gap`: why the session's port can't stop it (P5 O9 M5, its `stop-task` capability): drawn in place, disabled, with that.
export function StopButton({ node, label, onStop, gap = null }: { node: TaskNode; label: string; onStop: (taskId: TaskId) => void; gap?: string | null }) {
  return (
    <button type="button" disabled={node.stopping || gap !== null} title={gap ?? undefined} onClick={() => onStop(node.taskId)} className={ACTION}>
      {node.stopping ? BACKGROUND_COPY.stopping : label}
    </button>
  );
}

export function StopError({ message }: { message: string | null }) {
  return message === null ? null : <p className="text-ui-sm text-danger">{BACKGROUND_COPY.stopFailed(message)}</p>;
}

// P5 O9: a stop whose outcome is unknown, while its task still runs.
export function StopDoubt() {
  return <p className="text-ui-sm text-warning">{BACKGROUND_COPY.stopUncertain}</p>;
}

interface RowProps {
  node: TaskNode;
  now: number;
  selected: boolean;
  stopError: string | null;
  stopDoubt?: boolean; // P5 O9: its stop's outcome is unknown
  onStop: (taskId: TaskId) => void;
  stopGap?: string | null; // P5 O9 M5: why Stop is unavailable, from the port's `stop-task` capability
}

function TaskRow({ node, now, selected, stopError, stopDoubt = false, onStop, stopGap = null, kind, children }: RowProps & { kind: 'shell' | 'monitor'; children?: ReactNode }) {
  const running = node.status === 'running';
  const line = taskLine(node, now);
  return (
    <div
      data-shell={kind === 'shell' ? node.taskId : undefined}
      data-monitor={kind === 'monitor' ? node.taskId : undefined}
      data-task-id={node.taskId}
      data-selected={selected}
      className={`mx-3 flex flex-col gap-1 rounded-sm border px-2 py-1.5 ${selected ? 'border-accent' : 'border-transparent'}`}
    >
      <div className="flex min-h-6 items-center gap-2">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${running ? 'bg-success' : 'bg-border-strong'}`} />
        <span data-part="line" title={line} className={`min-w-0 flex-1 truncate text-ui-sm tabular-nums ${node.status === 'failed' ? 'text-danger' : 'text-fg'}`}>
          {line}
        </span>
        {children}
        {running && <StopButton node={node} label={BACKGROUND_COPY.stop} onStop={onStop} gap={stopGap} />}
      </div>
      <StopError message={stopError} />
      {stopDoubt && running && <StopDoubt />}
    </div>
  );
}

export function ShellRow({ onOutput, ...props }: RowProps & { onOutput: ((path: string) => void) | null }) {
  const path = props.node.outputFile;
  return (
    <TaskRow {...props} kind="shell">
      {onOutput !== null && (
        <button type="button" disabled={path === null} title={path === null ? BACKGROUND_COPY.outputPending : path} onClick={() => path !== null && onOutput(path)} className={ACTION}>
          {BACKGROUND_COPY.output}
        </button>
      )}
    </TaskRow>
  );
}

export function MonitorRow(props: RowProps) {
  return <TaskRow {...props} kind="monitor" />;
}
