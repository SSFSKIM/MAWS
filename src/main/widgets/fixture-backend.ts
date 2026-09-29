// The widget e2e's engine stand-in (C11 execution document, M2 decisions): under MAWS_WIDGET_BACKEND=fixtures, in launch
// mode `scenario` only, main answers the widgets' reads through C5's `interceptCommand` from the fixture-backed widget
// backend over the scenario's statuses, so Playwright drives the real X2 path and the real stores with no engine and
// no replay. A test moves the sessions through `globalThis.__maws_widget_backend` in main (`app.evaluate`), as C5's
// scenario clock is driven; no IPC command exists for it. A production launch never installs it.
import type { IpcError } from '@shared/ipc/errors';
import type { CommandName, EventName, EventPayload } from '@shared/ipc/schema';
import { loadScenario } from '../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../test/support/widget-backend';
import type { interceptCommand } from '../ipc/router';
import { launchMode, scenarioPath } from '../sessions/select-source';

declare global {
  var __maws_widget_backend: WidgetBackend | undefined;
}

export interface WidgetBackendInstall {
  env: Record<string, string | undefined>;
  packaged: boolean;
  appRoot: string; // the repository root: the scenario's relative path and the fixture lines resolve from it
  intercept: typeof interceptCommand;
  emit<N extends EventName>(name: N, payload: EventPayload<N>): void;
  fail(error: IpcError): Error; // the error main's router turns into the command's IpcError (its CommandFailure)
}

export function installWidgetBackend(deps: WidgetBackendInstall): (() => void) | null {
  if (deps.env.MAWS_WIDGET_BACKEND !== 'fixtures' || launchMode(deps.env, deps.packaged) !== 'scenario') return null;
  const scenario = loadScenario(scenarioPath(deps.env, { packaged: deps.packaged, appRoot: deps.appRoot }));
  const backend = createWidgetBackend({ root: deps.appRoot, statuses: scenario.engine, emit: deps.emit });
  const offs = backend.commands.map((name: CommandName) =>
    deps.intercept(name, async (input) => {
      try {
        return (await backend.answer(name, input)) as never;
      } catch (error) {
        throw error instanceof WidgetBackendError ? deps.fail(error.error) : error;
      }
    }),
  );
  globalThis.__maws_widget_backend = backend;
  return () => {
    offs.forEach((off) => off());
    if (globalThis.__maws_widget_backend === backend) delete globalThis.__maws_widget_backend;
  };
}
