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
//
// P5 O6 M2 (OX2; docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "The router and `emit`"): every invoke names
// the machine it goes to (the IPC message's last argument; none is the local machine), validated as a `MachineRef`, and a
// handler learns it as `ctx.target`. A command graded `client` (O1 M4) is the local app's own: for another machine's ids it
// is refused `host_unavailable` before any handler runs, since an app effect has no app to run in there, except
// `attention.viewing`, answered with no effect (its only effect is the local notifier's).
//
// P5 O6 M3 ("Machine links"): any other command for another machine, its input validated here, goes to the connection
// manager (`RouterOptions.remote`, src/main/machines/manager.ts), which answers it through that machine's link, or
// `host_unavailable` while the machine is not up; with no manager it answers `host_unavailable` itself. `dispatchLocal` is
// the route minus the sender check, the local link's entry to this machine's services (src/main/machines/local-link.ts);
// another profile's app reaches them through this profile's mawsd (P5 O3-D M6, O6's stand-in gone).
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { HostDispatch, HostOwner } from '@shared/host/host-supervisor'; // P5 O2 M3
import { HostCommandError, thrownError } from '@shared/host/runtime';
import type { ClientRef, HandlerContext } from '@shared/ipc/client';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import { REGISTRY, type InputOf, type NameOf, type OutputOf, type WireRegistry } from '@shared/ipc/registry';
import { commandChannel, type CommandInput, type CommandName, type CommandOutput, type CommandResult } from '@shared/ipc/schema';
import { codecOf } from '@shared/ipc/validate';
import { gradeOf } from '@shared/ipc/grades';
import { MachineRefSchema, type MachineRef } from '@shared/machine/ref';
import { clientOf } from './clients';

export { emit } from './events';

// Who asked (P5 O1 M2): the asking page instance's `ClientRef`, for a handler whose state is held per client (git.watch's
// counts), keyed by `client.id` and released on `client.onGone`. A client-shell handler that acts on the page itself gets
// it with `pageOf(client)` (./clients).
// P5 O6 M2: `target` is the machine the command goes to: the local one, or (a `client` command) the machine its ids name.
export type MainContext = HandlerContext & { readonly target: MachineRef };
export type MainHandler<N extends CommandName> = (input: CommandInput<N>, context: MainContext) => CommandOutput<N> | Promise<CommandOutput<N>>;
export type MachineHandler<N extends CommandName> = (input: CommandInput<N>, context: HandlerContext) => CommandOutput<N> | Promise<CommandOutput<N>>;
// The supervisor interface M4 implements (`HostSupervisor.dispatch`): forward to the owning host, answer its result.
// P5 O1 M5: `client` is the asker, passed for a `machine`-owned command only (the host binding). P5 O2 M3: both types
// moved with the host supervisor to @shared/host/host-supervisor.
export type { HostDispatch, HostOwner };
export type MachineBinding = { kind: 'embedded' } | { kind: 'host' };
// P5 O6 M3: the connection manager's dispatch, for a command whose target is another machine (its input validated).
export type RemoteDispatch = (machine: MachineRef, name: CommandName, input: unknown, ctx: MainContext) => Promise<CommandResult<CommandName>>;

// A handler over registry R, for `main` or `machine` alike: the same signature in main and in a host runtime.
export type RegistryHandler<R extends WireRegistry, N extends NameOf<R>> = (input: InputOf<R, N>, ctx: HandlerContext) => OutputOf<R, N> | Promise<OutputOf<R, N>>;
// P5 O6 M2: one that runs only in main (a `main` handler, an interceptor) also learns the machine the command goes to. A
// `machine` handler does not: a host runtime runs the same code, and it is always its own machine's.
export type MainRegistryHandler<R extends WireRegistry, N extends NameOf<R>> = (input: InputOf<R, N>, ctx: MainContext) => OutputOf<R, N> | Promise<OutputOf<R, N>>;

// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §F, D24): a hook run before the owner switch
// for the commands it names, on both shapes and for main's own calls alike, with the validated input and the asker: an
// answer short-circuits the route, undefined lets it continue. The window report (src/main/connectors/windows.ts) and
// the delivery cancel of a send in its export phase (src/main/delivery/send.ts) use it.
export type BeforeHook = (name: CommandName, input: unknown, client: ClientRef) => Promise<CommandResult<CommandName> | undefined>;

export interface Router<R extends WireRegistry> {
  install(): void; // one ipcMain.handle per name of R
  registerMain<N extends NameOf<R>>(name: N, handler: MainRegistryHandler<R, N>): void; // refuses a name R does not give to `main`
  registerMachine<N extends NameOf<R>>(name: N, handler: RegistryHandler<R, N>): void; // refuses a name R does not give to `machine`
  intercept<N extends NameOf<R>>(name: N, handler: MainRegistryHandler<R, N>): () => void;
  before(names: readonly NameOf<R>[], hook: BeforeHook): () => void; // P5 O4 M2: the hook's disposer
  // P5 O6 M3: the route minus the sender check, for the client and machine `ctx` names; `internal` before `install`
  dispatchLocal(name: NameOf<R>, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §D): main's own in-process call, the
  // local route minus the main-only refusal too (a main-only name is main's to send), as the services bus's `invoke`
  invokeOwn(name: NameOf<R>, input: unknown, ctx: MainContext): Promise<CommandResult<CommandName>>;
}

export interface RouterOptions {
  // The URL the app window loads: the dev server's in development, the renderer's `index.html` file URL otherwise.
  appUrl: string;
  local: MachineRef; // P5 O6 M2: this main's own machine (src/main/machine/local.ts), which a command naming none goes to
  dispatchToHost?: HostDispatch;
  machine?: MachineBinding; // P5 O1 M5: `embedded` unless said otherwise
  remote?: RemoteDispatch; // P5 O6 M3: the connection manager; none answers every other machine `host_unavailable`
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
  let installed: RouterOptions | null = null; // P5 O6 M3: what dispatchLocal routes with
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
  const befores = new Map<string, BeforeHook[]>(); // P5 O4 M2 (D24): by name, in registration order

  const registerIn = (table: Map<string, AnyHandler>, owner: 'main' | 'machine') => (name: string, handler: AnyHandler) => {
    const { owner: actual } = commands[name];
    if (actual !== owner) throw new Error(`${name} is owned by ${actual}, not ${owner}`);
    if (table.has(name)) throw new Error(`a ${owner} handler for ${name} is already registered`);
    table.set(name, handler);
  };

  const mainOnlyRefusal = (name: string): CommandResult<CommandName> => ({ ok: false, error: ipcError('forbidden_sender', `${name} may only be invoked by main`) });

  async function route(event: IpcMainInvokeEvent, name: string, rawInput: unknown, rawMachine: unknown, options: RouterOptions): Promise<CommandResult<CommandName>> {
    if (!isAppSender(event, options.appUrl)) {
      console.warn(`[ipc] refused ${name} from ${event.senderFrame?.url ?? 'a detached frame'}`);
      return { ok: false, error: ipcError('forbidden_sender', `${name} may only be invoked by the app window`) };
    }
    if (mainOnly.has(name)) return mainOnlyRefusal(name);
    let target = options.local;
    if (rawMachine !== undefined) {
      const parsed = MachineRefSchema.safeParse(rawMachine);
      if (!parsed.success) return { ok: false, error: ipcError('invalid_input', `${name}: not a machine: ${JSON.stringify(rawMachine)}`, parsed.error.issues) };
      target = parsed.data;
    }
    return dispatch(name, rawInput, { client: clientOf(event.sender), target }, options);
  }

  // Everything after the sender check, the main-only refusal and the machine's parse: `route`'s rest, (P5 O6 M3)
  // `dispatchLocal`'s and (P5 O3-E) `invokeOwn`'s.
  async function dispatch(
    name: string,
    rawInput: unknown,
    context: MainContext,
    { local, dispatchToHost = hostsNotStarted, machine = { kind: 'embedded' }, remote }: RouterOptions,
  ): Promise<CommandResult<CommandName>> {
    const { target } = context;
    const input = codec.validateCommandInput(name, rawInput);
    if (!input.ok) return input;
    if (target !== local) {
      if (gradeOf(name) === 'client') {
        if (name === 'attention.viewing') return { ok: true, value: undefined as CommandOutput<CommandName> };
        return { ok: false, error: ipcError('host_unavailable', `${name}: not available for a session on another machine yet`) };
      }
      if (!remote) return { ok: false, error: ipcError('host_unavailable', `${name}: machine ${target} is not connected`) };
      try {
        return await remote(target, name as CommandName, input.value, context); // P5 O6 M3: the connection manager
      } catch (error) {
        console.error(`[ipc] ${name} for machine ${target} failed`, error);
        return { ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
      }
    }

    const { owner } = commands[name];
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
    // P5 O4 M2 (D24): the hooks before the owner switch, for a command no interceptor shadows; the first answer is the route's
    const hooks = interceptor ? undefined : befores.get(name);
    if (hooks) {
      try {
        for (const hook of [...hooks]) {
          const early = await hook(name as CommandName, input.value, context.client);
          if (early !== undefined) return early;
        }
      } catch (error) {
        return failed(name, error);
      }
    }
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
      return failed(name, error);
    }
  }

  function failed(name: string, error: unknown): CommandResult<CommandName> {
    if (error instanceof CommandFailure) return { ok: false, error: error.error }; // C4
    if (error instanceof HostCommandError) return { ok: false, error: thrownError(error) }; // P5 O1 M5: as a host runtime answers it
    console.error(`[ipc] ${name} failed`, error);
    return { ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
  }

  return {
    install(options) {
      installed = options;
      for (const name of Object.keys(commands)) {
        ipcMain.handle(commandChannel(name as CommandName), (event, input: unknown, machine: unknown) => route(event, name, input, machine, options));
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
    before(names, hook) {
      for (const name of names) befores.set(name, [...(befores.get(name) ?? []), hook]);
      return () => {
        for (const name of names) {
          const left = (befores.get(name) ?? []).filter((each) => each !== hook);
          if (left.length > 0) befores.set(name, left);
          else befores.delete(name);
        }
      };
    },
    async dispatchLocal(name, input, ctx) {
      if (!installed) return { ok: false, error: ipcError('internal', `${name}: the router is not installed yet`) };
      if (mainOnly.has(name)) return mainOnlyRefusal(name);
      return dispatch(name, input, ctx, installed);
    },
    async invokeOwn(name, input, ctx) {
      if (!installed) return { ok: false, error: ipcError('internal', `${name}: the router is not installed yet`) };
      return dispatch(name, input, ctx, installed);
    },
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
export const registerMachineHandler: <N extends CommandName>(name: N, handler: MachineHandler<N>) => void = production.registerMachine;
// C5: the stub source's seam (above).
export const interceptCommand: <N extends CommandName>(name: N, handler: MainHandler<N>) => () => void = production.intercept;
// P5 O4 M2 (Interfaces §F, D24): the seam before the owner switch (above).
export const beforeCommand: (names: readonly CommandName[], hook: BeforeHook) => () => void = production.before;
// P5 O6 M3: the local link's entry to this machine's services (src/main/machines/local-link.ts).
export const dispatchLocal: (name: CommandName, input: unknown, ctx: MainContext) => Promise<CommandResult<CommandName>> = production.dispatchLocal;
// P5 O3-E M2 (Interfaces §D): main's own calls (the services bus's `invoke`; P5 O4: the catalog's `catalog.engine`).
export const invokeOwn: (name: CommandName, input: unknown, ctx: MainContext) => Promise<CommandResult<CommandName>> = production.invokeOwn;

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
