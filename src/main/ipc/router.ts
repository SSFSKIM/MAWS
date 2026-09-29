// The IPC boundary in main (X2, §4.1). One `ipcMain.handle` per command name in the registry, registered at startup,
// so a channel outside the registry has no handler at all. Every invoke passes, in order: the sender check (the app
// window's top frame at the app's origin), input validation, then dispatch by the registry entry's `owner`, to a
// handler registered here for `main` or to the host dispatcher for a utility process. Every outcome is a
// `CommandResult`; nothing is thrown across the boundary.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import {
  commandChannel,
  commands,
  type CommandInput,
  type CommandName,
  type CommandOutput,
  type CommandResult,
  type Owner,
} from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { openExternalUrl } from '../open-external'; // C9: pty.openLink

export { emit } from './events';

// The invoke's origin, for a handler whose effect is held per window (git.watch's counts): the app window's webContents.
export interface MainContext {
  sender: WebContents;
}
export type MainHandler<N extends CommandName> = (input: CommandInput<N>, context: MainContext) => CommandOutput<N> | Promise<CommandOutput<N>>;
export type HostOwner = Exclude<Owner, 'main'>;
// The supervisor interface M4 implements (`HostSupervisor.dispatch`): forward to the owning host, answer its result.
export type HostDispatch = (owner: HostOwner, name: CommandName, input: unknown) => Promise<CommandResult<CommandName>>;

export interface RouterOptions {
  // The URL the app window loads: the dev server's in development, the renderer's `index.html` file URL otherwise.
  appUrl: string;
  dispatchToHost?: HostDispatch;
}

// C4: a main handler that fails with a specific IpcError (session.replay.start relaying the host dispatch's `timeout` or
// `host_unavailable`) throws this; any other throw is `internal`.
export class CommandFailure extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
  }
}
// end C4

const mainHandlers = new Map<CommandName, (input: unknown, context: MainContext) => unknown>();

// For children adding `main`-owned commands: register once, before or after `installRouter`, from main's startup.
export function registerMainHandler<N extends CommandName>(name: N, handler: MainHandler<N>): void {
  const { owner } = commands[name];
  if (owner !== 'main') throw new Error(`${name} is owned by ${owner}, not main`);
  if (mainHandlers.has(name)) throw new Error(`a main handler for ${name} is already registered`);
  mainHandlers.set(name, handler as (input: unknown, context: MainContext) => unknown);
}

// ---- C5: interceptCommand -------------------------------------------------------------------------------------------
// The stub source's seam (C5 execution document, Main modules): in launch mode `scenario` the stub answers a few
// commands (C4's record side, C3's `attention.list`/`attention.request`/`session.answer`) itself. An interceptor is
// consulted after the sender check and input validation and before the main handler or the host dispatcher for
// exactly that name. Only the stub source installs one; a production launch never does.
const interceptors = new Map<CommandName, (input: unknown, context: MainContext) => unknown>();

export function interceptCommand<N extends CommandName>(name: N, handler: MainHandler<N>): () => void {
  if (interceptors.has(name)) throw new Error(`${name} is already intercepted`);
  const entry = handler as (input: unknown, context: MainContext) => unknown;
  interceptors.set(name, entry);
  return () => {
    if (interceptors.get(name) === entry) interceptors.delete(name);
  };
}
// ---- end C5 -----------------------------------------------------------------------------------------------------------

// Without a supervisor (tests, or a main that runs no hosts) every host-owned command is unavailable. The app passes
// the host supervisor's `dispatch` (src/main/hosts).
const hostsNotStarted: HostDispatch = async (owner, name) => ({
  ok: false,
  error: ipcError('host_unavailable', `${owner} is not running; cannot answer ${name}`),
});

export function installRouter({ appUrl, dispatchToHost = hostsNotStarted }: RouterOptions): void {
  // C9 block begin: a terminal's link opens through the one scheme-checked shell.openExternal
  registerMainHandler('pty.openLink', ({ url }) => ({ opened: openExternalUrl(url) }));
  // C9 block end
  for (const name of Object.keys(commands) as CommandName[]) {
    ipcMain.handle(commandChannel(name), (event, input: unknown) => route(event, name, input, appUrl, dispatchToHost));
  }
}

async function route(
  event: IpcMainInvokeEvent,
  name: CommandName,
  rawInput: unknown,
  appUrl: string,
  dispatchToHost: HostDispatch,
): Promise<CommandResult<CommandName>> {
  if (!isAppSender(event, appUrl)) {
    console.warn(`[ipc] refused ${name} from ${event.senderFrame?.url ?? 'a detached frame'}`);
    return { ok: false, error: ipcError('forbidden_sender', `${name} may only be invoked by the app window`) };
  }
  const input = validateCommandInput(name, rawInput);
  if (!input.ok) return input;

  const { owner } = commands[name];
  const context: MainContext = { sender: event.sender };
  let answer: () => Promise<CommandResult<CommandName>>;
  const interceptor = interceptors.get(name); // C5: the stub source's seam, above
  if (interceptor) {
    answer = async () => ({ ok: true, value: (await interceptor(input.value, context)) as CommandOutput<CommandName> });
  } else if (owner !== 'main') {
    answer = () => dispatchToHost(owner, name, input.value);
  } else {
    const handler = mainHandlers.get(name);
    if (!handler) return { ok: false, error: ipcError('internal', `no main handler registered for ${name}`) };
    answer = async () => ({ ok: true, value: (await handler(input.value, context)) as CommandOutput<CommandName> });
  }
  // A throwing main handler and a rejecting host dispatcher alike end as `internal` in the envelope, never as a
  // rejection across the boundary. (A host that is not running answers `host_unavailable` itself; a rejection is a
  // fault in the dispatch path, so it is not guessed to mean unavailability.)
  try {
    return await answer();
  } catch (error) {
    if (error instanceof CommandFailure) return { ok: false, error: error.error }; // C4
    console.error(`[ipc] ${name} failed`, error);
    return { ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
  }
}

// The sender must be the top frame of an app window (not a subframe, not a webContents without a window) and its
// URL must be at the app's origin: `file:` for the built app, the dev server's origin under `pnpm dev`.
function isAppSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, appUrl: string): boolean {
  const frame = event.senderFrame;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!frame || !win || frame !== win.webContents.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    const app = new URL(appUrl);
    return app.protocol === 'file:' ? url.protocol === 'file:' : url.origin === app.origin;
  } catch {
    return false;
  }
}
