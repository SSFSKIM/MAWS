// A background shell's row and a monitor's (C8b execution document, M3): `<description> · running <elapsed>`, then
// `· <status> <ago>` once it ends. A shell's `Output` opens the Log on the file the engine reported (the Bash result's
// own sentence at start, or the notification), never a derived one, and is disabled until one is reported. `Stop` asks
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

export function StopButton({ node, label, onStop }: { node: TaskNode; label: string; onStop: (taskId: TaskId) => void }) {
  return (
    <button type="button" disabled={node.stopping} onClick={() => onStop(node.taskId)} className={ACTION}>
      {node.stopping ? BACKGROUND_COPY.stopping : label}
    </button>
  );
}

export function StopError({ message }: { message: string | null }) {
  return message === null ? null : <p className="text-ui-sm text-danger">{BACKGROUND_COPY.stopFailed(message)}</p>;
}

interface RowProps {
  node: TaskNode;
  now: number;
  selected: boolean;
  stopError: string | null;
  onStop: (taskId: TaskId) => void;
}

function TaskRow({ node, now, selected, stopError, onStop, kind, children }: RowProps & { kind: 'shell' | 'monitor'; children?: ReactNode }) {
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
        {running && <StopButton node={node} label={BACKGROUND_COPY.stop} onStop={onStop} />}
      </div>
      <StopError message={stopError} />
    </div>
  );
}

export function ShellRow({ onOutput, ...props }: RowProps & { onOutput: (path: string) => void }) {
  const path = props.node.outputFile;
  return (
    <TaskRow {...props} kind="shell">
      <button type="button" disabled={path === null} title={path === null ? BACKGROUND_COPY.outputPending : path} onClick={() => path !== null && onOutput(path)} className={ACTION}>
        {BACKGROUND_COPY.output}
      </button>
    </TaskRow>
  );
}

export function MonitorRow(props: RowProps) {
  return <TaskRow {...props} kind="monitor" />;
}
