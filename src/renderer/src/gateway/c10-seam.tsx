// C10 seam: replaced by C10's exports at integration (C11 execution document, Decision Log "executor pre-flight"). C10
// (sessions, worktrees, trust) is not on this branch, so the route switch and the Direct model choice code against the
// stand-ins below, each named for the C10 piece it stands for; the widgets' seams (`isGatewayModel` among them) stay in
// `widgets/c10-seam.ts`. The C10 integration task swaps each for C10's and deletes this file; nothing here copies C10.
import { create } from 'zustand';
import type { Effort } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { listedModelsOf, rememberListedModels, useComposerStore, type ListedModel } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { BACKGROUND, type Route } from './copy';

// ---- C10: `session.start` -------------------------------------------------------------------------------------------------

// C10's `SessionStartOptions` as the switch passes them (`gateway`, and the resume's `model` / `effort` overrides).
export type StartOptions = { gateway: Route; model?: string | null; effort?: Effort | null };
// C10's `StartOutcome` reduced to what the switch reads: `starting`, or any other status as a refusal in words.
export type StartAnswer = { status: 'starting' } | { status: 'refused'; reason: string };

export interface SessionStart {
  // C10: `ipc.invoke('session.start', { appSessionId, message: null, options })`, a non-`starting` outcome in words.
  start(appSessionId: AppSessionId, options: StartOptions): Promise<StartAnswer>;
  // C10: `session.setup` events for the session whose outcome is `error`, `relay_unreachable` or `held`, in words.
  onSetupFailure(appSessionId: AppSessionId, listener: (reason: string) => void): () => void;
}

// No start exists before C10, so the switch is offered disabled; the widgets harness provides a stand-in for its e2e.
// At integration this store goes and `sessionStart()` answers C10's implementation.
const useStartSeam = create<{ start: SessionStart | null }>()(() => ({ start: null }));
export const sessionStart = (): SessionStart | null => useStartSeam.getState().start;
export const useSessionStartAvailable = (): boolean => useStartSeam((s) => s.start !== null);
export function provideSessionStart(start: SessionStart): () => void {
  useStartSeam.setState({ start });
  return () => {
    if (useStartSeam.getState().start === start) useStartSeam.setState({ start: null });
  };
}

// ---- C10: `engine.models` -------------------------------------------------------------------------------------------------

// The catalogue the Direct model choice lists. C10: `engine.models { refresh: false }`, answered before any process.
// Until then: a ready session's `session.listModels` (C7's read, remembered for the chip), else the models C7 last
// listed for the session, else none.
export async function directCatalogue(appSessionId: AppSessionId): Promise<readonly ListedModel[]> {
  if (useSessions.getState().engine.get(appSessionId)?.process === 'ready') {
    const result = await ipc.invoke('session.listModels', { appSessionId });
    if (result.ok) {
      rememberListedModels(appSessionId, result.value.models);
      return result.value.models;
    }
  }
  return listedModelsOf(useComposerStore.getState(), appSessionId) ?? [];
}

// ---- C10: `BackgroundWorkDisclosure` --------------------------------------------------------------------------------------

// C10: `<BackgroundWorkDisclosure appSessionId={…} />` (the archive dialog's list, §4.4's wording). Until then the
// running tasks by count and description, from the status the switch read when its sheet opened.
export function BackgroundWorkDisclosure({ tasks }: { tasks: EngineSessionStatus['backgroundTasks'] }) {
  return (
    <div data-seam="c10-background-work" className="flex flex-col gap-1">
      <p className="m-0 text-ui-sm text-fg-muted">{BACKGROUND.count(tasks.length)}</p>
      <ul aria-label={BACKGROUND.list} className="m-0 flex list-none flex-col gap-0.5 p-0">
        {tasks.map((task) => (
          <li key={task.taskId} className="truncate text-ui">
            {task.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
