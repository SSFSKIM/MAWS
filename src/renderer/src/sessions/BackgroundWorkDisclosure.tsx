// What stopping a session would end (§4.4: exit never silently discards background work): its running background
// tasks and workflows from C3's `session.status.backgroundTasks`, by count and description. Exported under C10's
// ownership for C11's route switch (Consumed asks of C11 (6)); `useBackgroundWork` is the list without the rendering.
import { useShallow } from 'zustand/react/shallow';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { useSessions } from '../stores/sessions';

export type BackgroundWork = EngineSessionStatus['backgroundTasks'];

const NONE: BackgroundWork = [];

// The session's running background work, while its process is live; empty otherwise.
export function useBackgroundWork(appSessionId: AppSessionId): BackgroundWork {
  return useSessions(
    useShallow((s) => {
      const status = s.engine.get(appSessionId);
      return status && status.process !== 'exited' ? status.backgroundTasks : NONE;
    }),
  );
}

export function backgroundWorkSummary(work: BackgroundWork): string {
  const n = work.length;
  return `${n} background ${n === 1 ? 'task is' : 'tasks are'} still running and will be stopped`;
}

export function BackgroundWorkDisclosure({ appSessionId }: { appSessionId: AppSessionId }) {
  const work = useBackgroundWork(appSessionId);
  if (work.length === 0) return null;
  return (
    <div role="note" className="flex flex-col gap-1 rounded-md border border-l-2 border-border border-l-warning bg-bg-raised px-2.5 py-2 text-ui-sm">
      <p className="m-0 text-fg">{backgroundWorkSummary(work)}:</p>
      <ul className="m-0 list-disc pl-5 text-fg-muted">
        {work.map((task) => (
          <li key={task.taskId}>{task.description || task.taskType}</li>
        ))}
      </ul>
    </div>
  );
}
