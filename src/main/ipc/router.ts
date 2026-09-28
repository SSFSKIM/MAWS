// The IPC boundary in main (X2, §4.1). One `ipcMain.handle` per command name in the registry, registered at startup,
// so a channel outside the registry has no handler at all. Every invoke passes, in order: the sender check (the app
// window's top frame at the app's origin), input validation, then dispatch by the registry entry's `owner`, to a
// handler registered here for `main` or to the host dispatcher for a utility process. Every outcome is a
// `CommandResult`; nothing is thrown across the boundary.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { ipcError } from '@shared/ipc/errors';
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

export { emit } from './events';

export type MainHandler<N extends CommandName> = (input: CommandInput<N>) => CommandOutput<N> | Promise<CommandOutput<N>>;
export type HostOwner = Exclude<Owner, 'main'>;
// The supervisor interface M4 implements (`HostSupervisor.dispatch`): forward to the owning host, answer its result.
export type HostDispatch = (owner: HostOwner, name: CommandName, input: unknown) => Promise<CommandResult<CommandName>>;

export interface RouterOptions {
  // The URL the app window loads: the dev server's in development, the renderer's `index.html` file URL otherwise.
  appUrl: string;
  dispatchToHost?: HostDispatch;
}

const mainHandlers = new Map<CommandName, (input: unknown) => unknown>();

// For children adding `main`-owned commands: register once, before or after `installRouter`, from main's startup.
export function registerMainHandler<N extends CommandName>(name: N, handler: MainHandler<N>): void {
  const { owner } = commands[name];
  if (owner !== 'main') throw new Error(`${name} is owned by ${owner}, not main`);
  if (mainHandlers.has(name)) throw new Error(`a main handler for ${name} is already registered`);
  mainHandlers.set(name, handler as (input: unknown) => unknown);
}

// M3 stub of the supervisor: no utility process runs yet, so every host-owned command is unavailable.
const hostsNotStarted: HostDispatch = async (owner, name) => ({
  ok: false,
  error: ipcError('host_unavailable', `${owner} is not running; cannot answer ${name}`),
});

export function installRouter({ appUrl, dispatchToHost = hostsNotStarted }: RouterOptions): void {
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
  let answer: () => Promise<CommandResult<CommandName>>;
  if (owner !== 'main') {
    answer = () => dispatchToHost(owner, name, input.value);
  } else {
    const handler = mainHandlers.get(name);
    if (!handler) return { ok: false, error: ipcError('internal', `no main handler registered for ${name}`) };
    answer = async () => ({ ok: true, value: (await handler(input.value)) as CommandOutput<CommandName> });
  }
  // A throwing main handler and a rejecting host dispatcher alike end as `internal` in the envelope, never as a
  // rejection across the boundary. (A host that is not running answers `host_unavailable` itself; a rejection is a
  // fault in the dispatch path, so it is not guessed to mean unavailability.)
  try {
    return await answer();
  } catch (error) {
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
