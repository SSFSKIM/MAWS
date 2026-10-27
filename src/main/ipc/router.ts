// The IPC boundary in main (X2, §4.1). One `ipcMain.handle` per command name in the registry, registered at startup,
// so a channel outside the registry has no handler at all. Every invoke passes, in order: the sender check (the app
// window's top frame at the app's origin), input validation, then dispatch by the registry entry's `owner`, to a
// handler registered here for `main` or to the host dispatcher for a utility process. Every outcome is a
// `CommandResult`; nothing is thrown across the boundary.
//
// P5 O1 M5: a router is built over a registry (`createRouter`), and the module's exports are one router bound to
// production's `REGISTRY`. A `machine`-owned command goes through the router's `MachineBinding`: `embedded` runs the
// handler registered with `registerMachine` here, `host` forwards it with the asker's `ClientRef` to the `machine` host
// (src/main/hosts/supervisor.ts), which runs the same handler code in its own runtime. O1 binds production embedded.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { HostCommandError, thrownError } from '@shared/host/runtime';
import type { ClientRef, HandlerContext } from '@shared/ipc/client';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import { REGISTRY, type InputOf, type NameOf, type OutputOf, type WireRegistry } from '@shared/ipc/registry';
import { commandChannel, type CommandInput, type CommandName, type CommandOutput, type CommandResult, type Owner } from '@shared/ipc/schema';
import { codecOf } from '@shared/ipc/validate';
import { clientOf } from './clients';

export { emit } from './events';

// Who asked (P5 O1 M2): the asking page instance's `ClientRef`, for a handler whose state is held per client (git.watch's
// counts), keyed by `client.id` and released on `client.onGone`. A client-shell handler that acts on the page itself gets
// it with `pageOf(client)` (./clients).
export type MainContext = HandlerContext;
export type MainHandler<N extends CommandName> = (input: CommandInput<N>, context: MainContext) => CommandOutput<N> | Promise<CommandOutput<N>>;
export type HostOwner = Exclude<Owner, 'main'>;
// The supervisor interface M4 implements (`HostSupervisor.dispatch`): forward to the owning host, answer its result.
// P5 O1 M5: `client` is the asker, passed for a `machine`-owned command only (the host binding).
export type HostDispatch = (owner: HostOwner, name: string, input: unknown, client?: ClientRef) => Promise<CommandResult<CommandName>>;
export type MachineBinding = { kind: 'embedded' } | { kind: 'host' };

// A handler over registry R, for `main` or `machine` alike: the same signature in main and in a host runtime.
export type RegistryHandler<R extends WireRegistry, N extends NameOf<R>> = (input: InputOf<R, N>, ctx: HandlerContext) => OutputOf<R, N> | Promise<OutputOf<R, N>>;

export interface Router<R extends WireRegistry> {
  install(): void; // one ipcMain.handle per name of R
  registerMain<N extends NameOf<R>>(name: N, handler: RegistryHandler<R, N>): void; // refuses a name R does not give to `main`
  registerMachine<N extends NameOf<R>>(name: N, handler: RegistryHandler<R, N>): void; // refuses a name R does not give to `machine`
  intercept<N extends NameOf<R>>(name: N, handler: RegistryHandler<R, N>): () => void;
}

export interface RouterOptions {
  // The URL the app window loads: the dev server's in development, the renderer's `index.html` file URL otherwise.
  appUrl: string;
  dispatchToHost?: HostDispatch;
  machine?: MachineBinding; // P5 O1 M5: `embedded` unless said otherwise
}

// C4: a main handler that fails with a specific IpcError (session.replay.start relaying the host dispatch's `timeout` or
// `host_unavailable`) throws this; any other throw is `internal`.
export class CommandFailure extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
  }
}
// end C4

// Without a supervisor (tests, or a main that runs no hosts) every host-owned command is unavailable. The app passes
// the host supervisor's `dispatch` (src/main/hosts).
const hostsNotStarted: HostDispatch = async (owner, name) => ({
  ok: false,
  error: ipcError('host_unavailable', `${owner} is not running; cannot answer ${name}`),
});

type AnyHandler = (input: unknown, context: MainContext) => unknown;

// A router's handler tables, which take registrations before or after `install` (main's startup registers both ways).
function routerOver<R extends WireRegistry>(registry: R): Omit<Router<R>, 'install'> & { install(options: RouterOptions): void } {
  const { commands, mainOnly } = registry;
  const codec = codecOf<WireRegistry>(registry);
  const mainHandlers = new Map<string, AnyHandler>();
  const machineHandlers = new Map<string, AnyHandler>(); // P5 O1 M5: the embedded binding's
  // ---- C5: interceptCommand -----------------------------------------------------------------------------------------
  // The stub source's seam (C5 execution document, Main modules): in launch mode `scenario` the stub answers a few
  // commands (C4's record side, C3's `attention.list`/`attention.request`/`session.answer`) itself. An interceptor is
  // consulted after the sender check and input validation and before the main handler or the host dispatcher for
  // exactly that name. Only the stub source installs one; a production launch never does.
  const interceptors = new Map<string, AnyHandler>();
  // ---- end C5 ---------------------------------------------------------------------------------------------------------

  const registerIn = (table: Map<string, AnyHandler>, owner: 'main' | 'machine') => (name: string, handler: AnyHandler) => {
    const { owner: actual } = commands[name];
    if (actual !== owner) throw new Error(`${name} is owned by ${actual}, not ${owner}`);
    if (table.has(name)) throw new Error(`a ${owner} handler for ${name} is already registered`);
    table.set(name, handler);
  };

  async function route(
    event: IpcMainInvokeEvent,
    name: string,
    rawInput: unknown,
    { appUrl, dispatchToHost = hostsNotStarted, machine = { kind: 'embedded' } }: RouterOptions,
  ): Promise<CommandResult<CommandName>> {
    if (!isAppSender(event, appUrl)) {
      console.warn(`[ipc] refused ${name} from ${event.senderFrame?.url ?? 'a detached frame'}`);
      return { ok: false, error: ipcError('forbidden_sender', `${name} may only be invoked by the app window`) };
    }
    if (mainOnly.has(name)) {
      return { ok: false, error: ipcError('forbidden_sender', `${name} may only be invoked by main`) };
    }
    const input = codec.validateCommandInput(name, rawInput);
    if (!input.ok) return input;

    const { owner } = commands[name];
    const context: MainContext = { client: clientOf(event.sender) };
    const run = (handler: AnyHandler) => async () => ({ ok: true, value: (await handler(input.value, context)) as CommandOutput<CommandName> }) as const;
    // P5 O1 M5: an embedded machine handler's output is checked against the registry, as a host runtime checks it before
    // answering, so a handler answers the same in either root.
    const runMachine = (handler: AnyHandler) => async (): Promise<CommandResult<CommandName>> => {
      const output = codec.validateCommandOutput(name, await handler(input.value, context));
      if (output.ok) return output as CommandResult<CommandName>;
      console.error(`[ipc] ${name} produced an invalid output`, output.error.issues);
      return { ok: false, error: ipcError('internal', output.error.message, output.error.issues) };
    };
    let answer: () => Promise<CommandResult<CommandName>>;
    const interceptor = interceptors.get(name); // C5: the stub source's seam, above
    if (interceptor) {
      answer = run(interceptor);
    } else if (owner === 'machine' && machine.kind === 'host') {
      answer = () => dispatchToHost(owner, name, input.value, context.client); // P5 O1 M5
    } else if (owner === 'machine') {
      const handler = machineHandlers.get(name); // P5 O1 M5: embedded
      if (!handler) return { ok: false, error: ipcError('internal', `no machine handler registered for ${name}`) };
      answer = runMachine(handler);
    } else if (owner !== 'main') {
      answer = () => dispatchToHost(owner, name, input.value);
    } else {
      const handler = mainHandlers.get(name);
      if (!handler) return { ok: false, error: ipcError('internal', `no main handler registered for ${name}`) };
      answer = run(handler);
    }
    // A throwing main handler and a rejecting host dispatcher alike end as `internal` in the envelope, never as a
    // rejection across the boundary. (A host that is not running answers `host_unavailable` itself; a rejection is a
    // fault in the dispatch path, so it is not guessed to mean unavailability.)
    try {
      return await answer();
    } catch (error) {
      if (error instanceof CommandFailure) return { ok: false, error: error.error }; // C4
      if (error instanceof HostCommandError) return { ok: false, error: thrownError(error) }; // P5 O1 M5: as a host runtime answers it
      console.error(`[ipc] ${name} failed`, error);
      return { ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
    }
  }

  return {
    install(options) {
      for (const name of Object.keys(commands)) {
        ipcMain.handle(commandChannel(name as CommandName), (event, input: unknown) => route(event, name, input, options));
      }
    },
    registerMain: registerIn(mainHandlers, 'main') as Router<R>['registerMain'],
    registerMachine: registerIn(machineHandlers, 'machine') as Router<R>['registerMachine'],
    intercept: ((name: string, handler: AnyHandler) => {
      if (interceptors.has(name)) throw new Error(`${name} is already intercepted`);
      interceptors.set(name, handler);
      return () => {
        if (interceptors.get(name) === handler) interceptors.delete(name);
      };
    }) as Router<R>['intercept'],
  };
}

export function createRouter<R extends WireRegistry>({ registry, ...options }: RouterOptions & { registry: R }): Router<R> {
  const router = routerOver(registry);
  return { ...router, install: () => router.install(options) };
}

// Production: one router over REGISTRY, with today's names.
const production = routerOver(REGISTRY);

export function installRouter(options: RouterOptions): void {
  production.install(options);
}

// For children adding `main`-owned commands: register once, before or after `installRouter`, from main's startup.
export const registerMainHandler: <N extends CommandName>(name: N, handler: MainHandler<N>) => void = production.registerMain;
// P5 O1 M5: for a `machine`-owned command's handler in main's root (the embedded binding); mawsd's root registers the same
// handler with its runtime's `on` (O3).
export const registerMachineHandler: <N extends CommandName>(name: N, handler: MainHandler<N>) => void = production.registerMachine;
// C5: the stub source's seam (above).
export const interceptCommand: <N extends CommandName>(name: N, handler: MainHandler<N>) => () => void = production.intercept;

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
