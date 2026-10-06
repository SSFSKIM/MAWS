// The session's task checklist (C8b execution document, M3; Interfaces *Background work's data*): read-only, the list a
// TaskCreate writes, through the agent-work client's `tasks` as a TanStack query keyed `['fs.tasks', listId]` (never
// `useCommand`, which would reach the real bridge for a harness session; `connectAgentWorkEvents` invalidates the key on
// `fs.tasksChanged`). A live session's list is C3's `taskListId`, a disk-only one's the record's engine session id,
// labelled `session list`; with neither, the section says the list is not known yet rather than guessing one.
// E7 (P-20): the read and the list body are shared with the Tasks panel (`useChecklist`, `ChecklistBody`), so the glance
// and the panel are two surfaces over one list; this section's heading gains `Open`, which opens the panel.
import { useQuery } from '@tanstack/react-query';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { PersistedTask } from '@shared/wire/store';
import { Icon } from '../../../app/IconButton';
import { actionClass } from '../../../panel/summary/Section';
import { agentWorkClient } from '../client';
import { BACKGROUND_COPY, TASKS_COPY } from '../copy';
import { checklistOf, listIdFor, type ListIdAnswer } from '../model/task-list';
import { Group } from './Group';

export interface Checklist {
  answer: ListIdAnswer;
  list: ReturnType<typeof checklistOf> | null; // null until the first read answers, or while it cannot be read
  error: Error | null;
  label: string | null; // `session list` for a disk-only session's list
}

export function useChecklist(status: EngineSessionStatus | null, session: SessionRecord | null): Checklist {
  const answer = listIdFor(status, session);
  const listId = answer.listId;
  const tasks = useQuery({ queryKey: ['fs.tasks', listId], queryFn: () => agentWorkClient().tasks(listId!), enabled: listId !== null });
  const list = listId !== null && tasks.data ? checklistOf(tasks.data) : null;
  const label = answer.listId !== null && answer.label === 'session list' ? BACKGROUND_COPY.sessionList : null;
  return { answer, list, error: tasks.error, label };
}

interface Props {
  status: EngineSessionStatus | null;
  session: SessionRecord | null;
  expanded: boolean;
  onToggle: () => void;
  showEarlier: boolean;
  onToggleEarlier: () => void;
  onOpen: () => void; // E7: the heading's `Open`, the Tasks panel
}

export function TaskChecklist({ status, session, expanded, onToggle, showEarlier, onToggleEarlier, onOpen }: Props) {
  const checklist = useChecklist(status, session);
  const { list } = checklist;
  const heading = list ? BACKGROUND_COPY.tasks(list.completed, list.total) : BACKGROUND_COPY.tasksHeading;
  const open = (
    <button type="button" aria-label={TASKS_COPY.openPanel} onClick={onOpen} className={actionClass}>
      {TASKS_COPY.open}
    </button>
  );
  return (
    <Group id="tasks" heading={heading} suffix={checklist.label} action={open} expanded={expanded} onToggle={onToggle}>
      <ChecklistBody checklist={checklist} showEarlier={showEarlier} onToggleEarlier={onToggleEarlier} />
    </Group>
  );
}

// The list as both surfaces draw it: the state's note, else the open tasks, then the completed ones behind the fold.
// Elements, not a wrapper, so a section's notes stay its direct children. `selected` (the Tasks panel's target) marks
// that row.
export function ChecklistBody({
  checklist, showEarlier, onToggleEarlier, selected = null,
}: { checklist: Checklist; showEarlier: boolean; onToggleEarlier: () => void; selected?: string | null }) {
  const { answer, list, error } = checklist;
  if (answer.listId === null) return <Note>{BACKGROUND_COPY.tasksNoListId}</Note>;
  if (error) return <Note danger>{BACKGROUND_COPY.tasksUnavailable(error.message)}</Note>;
  if (list === null) return null; // the first read is in flight
  if (list.total === 0) return <Note>{BACKGROUND_COPY.noTaskLists}</Note>;
  return (
    <>
      <ul className="flex flex-col px-3.5">
        {list.open.map((task) => (
          <TaskItem key={task.id} task={task} selected={task.id === selected} />
        ))}
        {showEarlier && list.earlier.map((task) => <TaskItem key={task.id} task={task} selected={task.id === selected} />)}
      </ul>
      {list.earlier.length > 0 && (
        <button type="button" aria-expanded={showEarlier} onClick={onToggleEarlier} className="mx-3.5 mt-0.5 h-6 self-start rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2">
          {BACKGROUND_COPY.earlierCompleted(list.earlier.length)}
        </button>
      )}
    </>
  );
}

function Note({ children, danger = false }: { children: string; danger?: boolean }) {
  return <p className={`px-3.5 text-ui-sm ${danger ? 'text-danger' : 'text-fg-muted'}`}>{children}</p>;
}

// An in-progress task reads its `activeForm` ("Checking keyboard reorder"), else its subject.
function TaskItem({ task, selected }: { task: PersistedTask; selected: boolean }) {
  const done = task.status === 'completed';
  const mark =
    task.status === 'in_progress' ? (
      <span role="img" aria-label={task.status} className="size-3 shrink-0 animate-spin rounded-full border border-border-strong border-t-accent" />
    ) : (
      <span role="img" aria-label={task.status} className={`inline-flex size-3 shrink-0 items-center justify-center rounded-[3px] border ${done ? 'border-success text-success' : 'border-border-strong'}`}>
        {done && (
          <Icon className="size-2.5">
            <path d="M3.5 8.5l3 3 6-7" />
          </Icon>
        )}
      </span>
    );
  return (
    <li aria-current={selected || undefined} className={`-mx-1.5 flex min-h-6 items-center gap-2 rounded-sm px-1.5 text-ui-sm ${selected ? 'bg-bg-active' : ''} ${done ? 'text-fg-muted' : 'text-fg'}`}>
      {mark}
      <span data-task={task.id} className="min-w-0 truncate">
        {task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject}
      </span>
    </li>
  );
}
