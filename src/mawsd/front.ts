// The services front (P5 O3-D M2; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §B): what `mawsd`
// serves on `machine.sock` for the machine's services, its core at M2: the command table the spine registers through the
// front's bus, the event fan-out, and the forwarded owners. Not yet the session streams or the client port (M4), nor
// the machine half of settings (M5), whose names answer `internal` until then.
//
// A client's runtime answers a `machine`-owned name: `daemon.*` and `machine.identity` without the spine (the identity
// cold, from @shared/machine/identity's helpers, D16); a spine command once `spine.ensure('command')` answered, from the
// bus's table with its intercept first (input read tolerantly, output validated strictly, a `HostCommandError` intact,
// per-connection refs as a host runtime mints them), or `host_unavailable` naming why the spine is not loadable (the
// holder of spine.lock, or the yield). An `engine-host` or `pty-host` name goes through the bus's intercepts, then the
// daemon's engine intercepts, then raw to the host; `host.attachment` is `mawsd`'s own and refused.
//
// `bus.emit` is gated by the registry's `machineEvents` and validated, then posted to every client that said ready and
// handed to the taps. The engine host's events reach the taps raw, before the spine's listeners fold them (the
// supervisor's `onRaw` runs before its `onEvent`), and every ready client hears those that name no session (the app-bound
// requests and the feeds); a session's events are the streams' (M4). The bus's registrations are a load's: `unbind`
// drops them when the spine's parts have stopped, so the next load registers afresh.
import { thrownError, type DocPortEnd, type HostPort } from '@shared/host/runtime';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { remoteClients, type RemoteClients } from '@shared/host/client-refs';
import type { ServedRuntime } from '@shared/host/socket-server';
import type { HandlerContext } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import { HostClientGoneSchema, HostReadySchema, HostRequestSchema, type HostDoc, type HostResponse } from '@shared/ipc/host-protocol';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineIdentity } from '@shared/ipc/schema/machine';
import { readTolerant } from '@shared/ipc/tolerant';
import { codecOf } from '@shared/ipc/validate';
import type { ServicesBus } from '@shared/spine/bus';
import type { LazySpine } from './spine-seam';
import { SpineUnavailable } from './spine-seam';
import type { EngineIntercept } from './spine-hosts';

// The front's own `machine` names, answered without the spine.
export const FRONT_COMMANDS = ['daemon.endpoint', 'daemon.restart', 'daemon.status', 'machine.identity'] as const;
// `machine` names a later milestone gives a handler (the streams, the client port, the ledger and the attached app's
// facts at M4; the machine half of settings at M5): `internal` until then, and no trigger.
export const LATER_COMMANDS: ReadonlySet<string> = new Set([
  'clientPort.answer', 'library.fileLinkedPaths', 'machine.client', 'machine.op', 'machine.opQuery',
  'machineSettings.get', 'machineSettings.set', 'session.follow', 'session.visible',
]);

export interface ClientFacts {
  appPid: number;
  capabilities: readonly string[];
}

export interface FrontOptions {
  spine: Pick<LazySpine, 'ensure'>;
  hosts: Pick<HostSupervisor, 'forward' | 'onRaw'>; // the forwarded owners
  intercept: EngineIntercept; // the daemon's engine-host intercepts, after the bus's
  daemon(name: string, input: unknown): Promise<unknown>; // daemon.*
  identity(): MachineIdentity; // machine.identity, cold
  log(line: string): void;
}

export interface ServicesFront {
  runtimeFor(client: ClientFacts): ServedRuntime; // one per welcomed machine.sock client (socket-server's `many`)
  bus: ServicesBus; // what startSpine registers through
  commands(): CommandName[]; // what the front answers now: its own names and what the loaded spine registered
  unbind(): void; // the spine's parts stopped: its registrations, intercepts and taps go
  close(): void;
}

type AnyHandler = (input: unknown, context: HandlerContext) => unknown;

const codec = codecOf(REGISTRY);
const OWN: ReadonlySet<string> = new Set(FRONT_COMMANDS);

export function createServicesFront(options: FrontOptions): ServicesFront {
  const { log } = options;
  const table = new Map<string, AnyHandler>();
  const intercepts = new Map<string, AnyHandler>();
  const taps = new Map<string, Set<(payload: unknown) => void>>();
  const clients = new Set<FrontClient>();
  let connections = 0;

  const own: Record<(typeof FRONT_COMMANDS)[number], AnyHandler> = {
    'daemon.endpoint': (input) => options.daemon('daemon.endpoint', input),
    'daemon.restart': async () => void (await options.daemon('daemon.restart', undefined)),
    'daemon.status': () => options.daemon('daemon.status', undefined),
    'machine.identity': () => options.identity(),
  };

  const tap = (name: string, payload: unknown) => {
    for (const listener of [...(taps.get(name) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        log(`machine.sock: a tap on ${name} failed: ${messageOf(error)}`);
      }
    }
  };
  const post = (name: string, payload: unknown) => {
    for (const client of clients) client.event(name, payload);
  };

  const offRaw = options.hosts.onRaw('engine-host', ({ name, payload }) => {
    tap(name, payload);
    if (!namesSession(payload)) post(name, payload);
  });

  // A handler's answer, as a host runtime gives it: its output validated, a HostCommandError intact.
  async function run(name: CommandName, handler: AnyHandler, input: unknown, context: HandlerContext): Promise<CommandResult<CommandName>> {
    let value: unknown;
    try {
      value = await handler(input, context);
    } catch (error) {
      return { ok: false, error: thrownError(error) };
    }
    const output = codec.validateCommandOutput(name, value);
    if (!output.ok) {
      log(`machine.sock: ${name} produced an invalid output: ${output.error.message}`);
      return { ok: false, error: ipcError('internal', output.error.message, output.error.issues) };
    }
    return output as CommandResult<CommandName>;
  }

  async function forward(name: string, input: unknown): Promise<CommandResult<CommandName>> {
    const { owner } = REGISTRY.commands[name as CommandName];
    if (owner !== 'engine-host' && owner !== 'pty-host') return { ok: false, error: ipcError('internal', `mawsd serves no ${owner} command (${name})`) };
    if (name === 'host.attachment') return { ok: false, error: ipcError('forbidden_sender', 'host.attachment is mawsd’s own link to the engine host') };
    const intercepted = owner === 'engine-host' ? options.intercept({ id: 'machine', name, input }) : null;
    const response: HostResponse = await (intercepted ?? options.hosts.forward(owner, { name, input }));
    return (response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error }) as CommandResult<CommandName>;
  }

  // A client's request, or the bus's invoke (`loaded`: the spine asks it of itself, so it is not waited for).
  async function answer(name: string, rawInput: unknown, context: HandlerContext, loaded: boolean): Promise<CommandResult<CommandName>> {
    if (!codec.isCommandName(name)) return { ok: false, error: ipcError('unknown_command', `unknown command: ${name}`) };
    const input = codec.readCommandInput(name, rawInput);
    if (!input.ok) return input;
    const { owner } = REGISTRY.commands[name];
    const intercept = intercepts.get(name);
    if (owner !== 'machine') return intercept ? run(name, intercept, input.value, context) : forward(name, rawInput);
    if (OWN.has(name)) return run(name, own[name as keyof typeof own], input.value, context);
    if (LATER_COMMANDS.has(name)) return { ok: false, error: ipcError('internal', `mawsd serves no ${name} yet`) };
    if (!loaded) {
      try {
        await options.spine.ensure('command');
      } catch (error) {
        return { ok: false, error: ipcError('host_unavailable', error instanceof SpineUnavailable ? error.message : `the spine did not load: ${messageOf(error)}`) };
      }
    }
    const handler = intercepts.get(name) ?? table.get(name);
    if (!handler) return { ok: false, error: ipcError('internal', `the spine registered no handler for ${name}`) };
    return run(name, handler, input.value, context);
  }

  const bus: ServicesBus = {
    register(name, handler) {
      if (REGISTRY.commands[name].owner !== 'machine') throw new Error(`${name} is owned by ${REGISTRY.commands[name].owner}; the front serves the machine's`);
      if (table.has(name) || OWN.has(name)) throw new Error(`a handler for ${name} is already registered`);
      table.set(name, handler as unknown as AnyHandler);
    },
    intercept(name, handler) {
      if (intercepts.has(name)) throw new Error(`${name} is already intercepted`);
      const entry = handler as unknown as AnyHandler;
      intercepts.set(name, entry);
      return () => {
        if (intercepts.get(name) === entry) intercepts.delete(name);
      };
    },
    emit(name, payload) {
      if (!(REGISTRY.machineEvents as readonly string[]).includes(name)) {
        log(`machine.sock: refused to emit ${name}: it is not in MACHINE_EVENTS`);
        return false;
      }
      const checked = codec.validateEventPayload(name, payload);
      if (!checked.ok) {
        log(`machine.sock: refused to emit an invalid ${name}`);
        return false;
      }
      post(name, checked.value);
      tap(name, checked.value);
      return true;
    },
    onEmitted(name, listener) {
      let set = taps.get(name);
      if (!set) taps.set(name, (set = new Set()));
      const entry = listener as (payload: unknown) => void;
      set.add(entry);
      return () => void set.delete(entry);
    },
    invoke: (name, input, context) => answer(name, input, context, true) as never,
  };

  // One welcomed machine.sock client: a host runtime's reading of its lines, with no handler table of its own.
  class FrontClient implements ServedRuntime {
    private port: HostPort | null = null;
    private ready = false;
    private refs: RemoteClients | null = null;

    constructor(readonly facts: ClientFacts) {}

    serve(port: HostPort): void {
      const refs = (this.refs = remoteClients(++connections));
      this.port = port;
      clients.add(this);
      port.on('message', ({ data }) => {
        if (this.port !== port) return;
        if (readTolerant(HostReadySchema, data).ok) return void (this.ready = true);
        const gone = readTolerant(HostClientGoneSchema, data);
        if (gone.ok) return refs.gone(gone.value.client);
        const request = readTolerant(HostRequestSchema, data);
        if (!request.ok) return log('machine.sock: dropped a malformed message');
        const { id, name, input, client } = request.value;
        void answer(name, input, { client: refs.refFor(client) }, false).then((result) => {
          if (this.port === port) port.postMessage({ t: 'res', id, ...result });
        });
      });
      port.start();
    }

    event(name: string, payload: unknown): void {
      if (this.ready && this.port?.postMessage({ t: 'evt', name, payload }) === false) this.detach();
    }

    detach(): void {
      this.port = null;
      this.ready = false;
      this.refs?.end();
      this.refs = null;
      clients.delete(this);
    }

    docPort(_message: HostDoc, end: DocPortEnd): void {
      end.close(); // machine.sock carries no document channel
    }
  }

  return {
    runtimeFor: (facts) => new FrontClient(facts),
    bus,
    commands: () => [...FRONT_COMMANDS, ...table.keys()].sort() as CommandName[],
    unbind() {
      table.clear();
      intercepts.clear();
      taps.clear();
    },
    close() {
      offRaw();
      for (const client of [...clients]) client.detach();
    },
  };
}

// A payload a session's stream carries (M4): one that names a session.
function namesSession(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const record = payload as { appSessionId?: unknown; status?: { appSessionId?: unknown } };
  return typeof record.appSessionId === 'string' || typeof record.status?.appSessionId === 'string';
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
