// The session's task checklist (C8b execution document, M3; Interfaces *Background work's data*): read-only, the list a
// TaskCreate writes, through the agent-work client's `tasks` as a TanStack query keyed `['fs.tasks', listId]` (never
// `useCommand`, which would reach the real bridge for a harness session; `connectAgentWorkEvents` invalidates the key on
// `fs.tasksChanged`). A live session's list is C3's `taskListId`, a disk-only one's the record's engine session id,
// labelled `session list`; with neither, the section says the list is not known yet rather than guessing one.
import { useQuery } from '@tanstack/react-query';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { PersistedTask } from '@shared/wire/store';
import { Icon } from '../../../app/IconButton';
import { agentWorkClient } from '../client';
import { BACKGROUND_COPY } from '../copy';
import { checklistOf, listIdFor } from '../model/task-list';
import { Group } from './Group';

interface Props {
  status: EngineSessionStatus | null;
  session: SessionRecord | null;
  expanded: boolean;
  onToggle: () => void;
  showEarlier: boolean;
  onToggleEarlier: () => void;
}

export function TaskChecklist({ status, session, expanded, onToggle, showEarlier, onToggleEarlier }: Props) {
  const answer = listIdFor(status, session);
  const listId = answer.listId;
  const tasks = useQuery({ queryKey: ['fs.tasks', listId], queryFn: () => agentWorkClient().tasks(listId!), enabled: listId !== null });
  const list = listId !== null && tasks.data ? checklistOf(tasks.data) : null;
  const heading = list ? BACKGROUND_COPY.tasks(list.completed, list.total) : BACKGROUND_COPY.tasksHeading;
  const label = answer.listId !== null && answer.label === 'session list' ? BACKGROUND_COPY.sessionList : null;

  let body;
  if (listId === null) body = <Note>{BACKGROUND_COPY.tasksNoListId}</Note>;
  else if (tasks.error) body = <Note danger>{BACKGROUND_COPY.tasksUnavailable(tasks.error.message)}</Note>;
  else if (list === null) body = null; // the first read is in flight
  else if (list.total === 0) body = <Note>{BACKGROUND_COPY.noTasks}</Note>;
  else {
    body = (
      <>
        <ul className="flex flex-col px-3.5">
          {list.open.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
          {showEarlier && list.earlier.map((task) => <TaskItem key={task.id} task={task} />)}
        </ul>
        {list.earlier.length > 0 && (
          <button type="button" aria-expanded={showEarlier} onClick={onToggleEarlier} className="mx-3.5 mt-0.5 h-6 self-start rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2">
            {BACKGROUND_COPY.earlierCompleted(list.earlier.length)}
          </button>
        )}
      </>
    );
  }
  return (
    <Group id="tasks" heading={heading} suffix={label} expanded={expanded} onToggle={onToggle}>
      {body}
    </Group>
  );
}

function Note({ children, danger = false }: { children: string; danger?: boolean }) {
  return <p className={`px-3.5 text-ui-sm ${danger ? 'text-danger' : 'text-fg-muted'}`}>{children}</p>;
}

// An in-progress task reads its `activeForm` ("Checking keyboard reorder"), else its subject.
function TaskItem({ task }: { task: PersistedTask }) {
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
    <li className={`flex min-h-6 items-center gap-2 text-ui-sm ${done ? 'text-fg-muted' : 'text-fg'}`}>
      {mark}
      <span data-task={task.id} className="min-w-0 truncate">
        {task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject}
      </span>
    </li>
  );
}
