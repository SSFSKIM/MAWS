// A background shell's row, a monitor's and a task of another kind's (C8b execution document, M3; the UX wave's U8b,
// M7): its kind's mark, then `<description> · running <elapsed>`, then `· <status> <ago>` once it ends; the description
// is the part a narrow row cuts first, the state only when the row cannot hold the state alone. A shell's `Output` opens the Log on the file the engine reported (the Bash result's
// own sentence at start, or the notification), never a derived one, and is disabled until one is reported (P5 O9 M5: and
// absent for a lane A job, whose output tail is remote-only). `Stop` asks
// no confirmation (the TUI's `x` asks none) and reads `stopping…` until the engine's terminal frame. A monitor's
// interval is not on the wire and is not shown. A task of another kind has a monitor's row: no Output, and Stop, which
// asks the engine to stop it by its id as a monitor's does (the engine answers for a kind it cannot stop, and the row
// says so as any refused stop does). Also the pieces the workflow card shares: the stop button, its error.
import type { ReactNode } from 'react';
import type { TaskId } from '@shared/graph/ids';
import { BACKGROUND_COPY } from '../copy';
import { elapsedOf, formatAgo, formatElapsed } from '../model/elapsed';
import type { TaskNode, TaskStatus } from '../model/task-graph';
import { KindMark } from '../marks';

export const ACTION =
  'shrink-0 rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export const statusWord = (status: TaskStatus): string => (status === 'running' ? '' : BACKGROUND_COPY.status[status]);

// A shell's or a monitor's state after its description: ` · running <elapsed>`, ` · <status> <ago>`.
export function taskState(node: TaskNode, now: number): string {
  if (node.status === 'running') {
    const elapsed = elapsedOf(node, now);
    return elapsed ? BACKGROUND_COPY.runningState(formatElapsed(elapsed.ms)) : BACKGROUND_COPY.runningUntimedState;
  }
  const word = statusWord(node.status);
  if (node.status === 'exited' || node.endedAt === null) return BACKGROUND_COPY.endedUndatedState(word);
  return BACKGROUND_COPY.endedState(word, formatAgo(now - Date.parse(node.endedAt)));
}

// The one line whole (a row's tooltip).
export const taskLine = (node: TaskNode, now: number): string => BACKGROUND_COPY.line(node.description, taskState(node, now));

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
  // The UX wave's U8b: its kind's mark before the line, which the app's panel asks for; desk web's depth view, which
  // draws these rows too, does not, and its rows hold no mark (Decision Log 18: no visible change there).
  kindMark?: boolean;
}

function TaskRow({ node, now, selected, stopError, stopDoubt = false, onStop, stopGap = null, kindMark = false, kind, children }: RowProps & { kind: 'shell' | 'monitor' | 'other'; children?: ReactNode }) {
  const running = node.status === 'running';
  const state = taskState(node, now);
  return (
    <div
      data-shell={kind === 'shell' ? node.taskId : undefined}
      data-monitor={kind === 'monitor' ? node.taskId : undefined}
      data-other={kind === 'other' ? node.taskId : undefined}
      data-task-id={node.taskId}
      data-selected={selected}
      className={`mx-3 flex flex-col gap-1 rounded-sm border px-2 py-1.5 ${selected ? 'border-accent' : 'border-transparent'}`}
    >
      <div className="flex min-h-6 items-center gap-2">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${running ? 'bg-success' : 'bg-border-strong'}`} />
        {kindMark && <KindMark kind={kind} />}
        {/* The line clips to its box: the description is cut first, down to nothing, and the state only once the row is
            narrower than the state alone (at most the line's width); the buttons after it keep their size. */}
        <span data-part="line" title={taskLine(node, now)} className={`flex min-w-0 flex-1 overflow-hidden text-ui-sm tabular-nums ${node.status === 'failed' ? 'text-danger' : 'text-fg'}`}>
          <span data-part="description" className="min-w-0 truncate">
            {node.description}
          </span>
          <span data-part="state" className="max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-pre">
            {state}
          </span>
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

export function OtherTaskRow(props: RowProps) {
  return <TaskRow {...props} kind="other" />;
}
