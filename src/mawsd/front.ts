// The services front (P5 O3-D M2, M4; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §B, §C, §E): what
// `mawsd` serves on `machine.sock` for the machine's services: the command table the spine registers through the front's
// bus, the event fan-out, the forwarded owners, each client's session streams (front-streams.ts) and the client port's
// requests back to the asking client (client-port.ts). The machine half of settings and the mirror's two reads (M5b)
// are the spine's commands like any other. The endpoint reaches the same table in process (`dispatch`), and hears every
// event the spine emits (`events`).
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
// supervisor's `onRaw` runs before its `onEvent`); those that name no session (the app-bound requests and the feeds) go
// only to a ready client whose hello listed `machine.spine`, the app that reads them here from M5 on, when the relay
// stops giving them to it (§B, §L). Until then the app hears them on its engine-host relay, so a client without the
// capability (main's machine transport among them) hears none here, or it would hear each twice. The events a stream
// carries (a session's batches and its replace-whole parts) are the streams' alone, per follow (D3), which is how a
// client without the capability gets its sessions' events; another event that names a session goes to the
// `machine.spine` clients and to every client that follows that session. At each streaming of the engine-host link
// every stream catches up from its cursor (D41). The bus's registrations are a load's: `unbind` drops them when the
// spine's parts have stopped, so the next load registers afresh.
//
// A client's own commands (main-only): `session.follow` (its streams), `clientPort.answer` (the port's answers, refused
// for an id it was not asked) and `machine.client` (the attached app's browser socket, which the spine reads through
// `browserSocket()`). A client's end ends its streams and settles what the port asked it `noClient`.
//
// P5 O3-D M5 (D44(3)): the engine host's names the spine intercepts (SPINE_ENGINE_INTERCEPTS: the stale answer's check,
// the rewind's note and the acts that clear it) load a cold spine first, so the intercept applies whatever path the
// request came by: a client here, the endpoint's `machine` route, and (`intercepted`, daemon.ts) a post-D app's relay
// and, under claimSpine (D47), the endpoint's `engine-host` route, a phone's claimed `host.op` of one of them included.
// A spine refused by the lock or yielded leaves the request to go on unintercepted, as a request did before the spine
// moved here: the note is then the lock holder's to keep. Any other failure to load answers it host_unavailable.
import { thrownError, type DocPortEnd, type HostPort } from '@shared/host/runtime';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import { MACHINE_SPINE_CAPABILITY } from '@shared/host/socket-protocol';
import { remoteClients, type RemoteClients } from '@shared/host/client-refs';
import type { ServedRuntime } from '@shared/host/socket-server';
import type { ClientPort } from '@shared/client/port';
import { endableClientRef, type ClientRef, type HandlerContext } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import { HostClientGoneSchema, HostReadySchema, HostRequestSchema, type HostDoc, type HostResponse } from '@shared/ipc/host-protocol';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineIdentity } from '@shared/ipc/schema/machine';
import { readTolerant } from '@shared/ipc/tolerant';
import { codecOf } from '@shared/ipc/validate';
import type { ServicesBus } from '@shared/spine/bus';
import { createClientPort, type ClientPortRequest, type FrontClientPort, type PortTarget } from './client-port';
import { FrontStreams, STREAM_EVENTS, type Follower } from './front-streams';
import type { LazySpine } from './spine-seam';
import { SpineUnavailable } from './spine-seam';
import type { EngineIntercept } from './spine-hosts';

// The front's own `machine` names, answered without the spine: the daemon's, the identity, and a client's own.
export const FRONT_COMMANDS = ['clientPort.answer', 'daemon.endpoint', 'daemon.restart', 'daemon.status', 'machine.client', 'machine.identity', 'session.follow'] as const;
// The names a machine.sock client asks of the front for itself, never the endpoint.
const CLIENT_COMMANDS: ReadonlySet<string> = new Set(['clientPort.answer', 'machine.client', 'session.follow']);
// P5 O3-D M5 (D44(3)): the engine host's names the spine's session service intercepts in launch mode `index`
// (src/services/sessions/index.ts's `session.answer`, service-register.ts's `session.rewind` and CONVERSATION_ACTS);
// daemon-spine.test.ts pins it to what the spine registers.
export const SPINE_ENGINE_INTERCEPTS: ReadonlySet<string> = new Set(['session.answer', 'session.bash', 'session.queue.promote', 'session.rewind', 'session.send', 'session.steer']);
// D47: lane B's claimed act (`host.op`) carries one of them as its inner name; the session service intercepts it too.
export function spineTakes(name: string, input: unknown): boolean {
  if (SPINE_ENGINE_INTERCEPTS.has(name)) return true;
  const inner = name === 'host.op' && typeof input === 'object' && input !== null ? (input as { name?: unknown }).name : undefined;
  return typeof inner === 'string' && SPINE_ENGINE_INTERCEPTS.has(inner);
}

export interface ClientFacts {
  appPid: number;
  capabilities: readonly string[];
}

export interface FrontOptions {
  spine: Pick<LazySpine, 'ensure'>;
  hosts: Pick<HostSupervisor, 'forward' | 'onRaw' | 'onStreaming' | 'parked'>; // the forwarded owners, and the streams' reads
  intercept: EngineIntercept; // the daemon's engine-host intercepts, after the bus's
  daemon(name: string, input: unknown): Promise<unknown>; // daemon.*
  identity(): MachineIdentity; // machine.identity, cold
  isApp(appPid: number): boolean; // the app attached on engine-host.sock: where the port's requests with no client go
  log(line: string): void;
  portDeadlineMs?: number; // the client port's deadline (CLIENT_PORT_DEADLINE_MS unless a test shortens it)
}

export interface ServicesFront {
  runtimeFor(client: ClientFacts): ServedRuntime; // one per welcomed machine.sock client (socket-server's `many`)
  bus: ServicesBus; // what startSpine registers through
  port: ClientPort; // §E: the spine's client port
  // The endpoint's `dispatch('machine', …)`: a client's request in process, `client` the endpoint's ref for its device
  dispatch(name: string, input: unknown, client?: ClientRef): Promise<CommandResult<CommandName>>;
  // P5 O3-D M5 (D44(3)): an engine-host request through the spine's intercept for its name, the spine loaded for it if
  // cold; null when the spine intercepts no such name or is refused by the lock or yielded, for the caller to forward it
  // raw as before; host_unavailable when it fails to load otherwise. No `client` is the endpoint's own request.
  intercepted(name: string, input: unknown, client?: ClientRef): Promise<CommandResult<CommandName> | null>;
  intercepts(): CommandName[]; // the names the loaded spine intercepts now
  events(listener: (name: string, payload: unknown) => void): () => void; // every event `bus.emit` sent (the endpoint's owner `machine`)
  browserSocket(): string | null; // the attached app's, from its machine.client; null with no app
  clients(): number;
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
  const emitted = new Set<(name: string, payload: unknown) => void>();
  const clients = new Set<FrontClient>();
  let connections = 0;

  // Who a ClientRef a client's request minted belongs to, and its id there (null: the connection's own).
  const owners = new WeakMap<ClientRef, { client: FrontClient; id: string | null }>();
  const clientPort: FrontClientPort = createClientPort({
    route(ref) {
      if (ref === null) {
        const app = [...clients].find((client) => options.isApp(client.facts.appPid));
        return app === undefined ? null : { target: app, client: null };
      }
      const owner = owners.get(ref);
      return owner === undefined || !clients.has(owner.client) ? null : { target: owner.client, client: owner.id };
    },
    deadlineMs: options.portDeadlineMs,
    log,
  });

  // The streams read the engine host only while it is up: a parked host is not woken for a follow.
  const streams = new FrontStreams({
    read: (name, input) => (options.hosts.parked('engine-host') ? Promise.resolve({ ok: false }) : options.hosts.forward('engine-host', { name, input })),
    async liveSessions() {
      if (options.hosts.parked('engine-host')) return [];
      const listed = await options.hosts.forward('engine-host', { name: 'engine.sessions', input: undefined });
      if (!listed.ok || !Array.isArray(listed.value)) return [];
      return (listed.value as { appSessionId?: unknown; process?: unknown }[]).flatMap((row) => (typeof row.appSessionId === 'string' && row.process !== 'exited' ? [row.appSessionId] : []));
    },
    log,
  });
  const offStreaming = options.hosts.onStreaming('engine-host', () => streams.relinked());

  const own: Record<(typeof FRONT_COMMANDS)[number], (input: unknown, context: HandlerContext, from: FrontClient | null) => unknown> = {
    'clientPort.answer': (input, _context, from) => clientPort.answer(from!, input as CommandInput<'clientPort.answer'>),
    'daemon.endpoint': (input) => options.daemon('daemon.endpoint', input),
    'daemon.restart': async () => void (await options.daemon('daemon.restart', undefined)),
    'daemon.status': () => options.daemon('daemon.status', undefined),
    'machine.client': (input, _context, from) => void (from!.browserSocket = (input as CommandInput<'machine.client'>).browserSocket),
    'machine.identity': () => options.identity(),
    'session.follow': (input, _context, from) => from!.follower.follow(input as CommandInput<'session.follow'>),
  };
  const endpointClient = endableClientRef('endpoint'); // the endpoint's requests that name no device

  const tap = (name: string, payload: unknown) => {
    for (const listener of [...(taps.get(name) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        log(`machine.sock: a tap on ${name} failed: ${messageOf(error)}`);
      }
    }
  };
  const post = (name: string, payload: unknown, to: (client: FrontClient) => boolean = () => true) => {
    for (const client of clients) if (to(client)) client.event(name, payload);
  };

  const offRaw = options.hosts.onRaw('engine-host', ({ name, payload }) => {
    tap(name, payload);
    if (STREAM_EVENTS.has(name)) return streams.liveEvent(name, payload);
    const app = sessionOf(payload);
    post(name, payload, app === null ? readsHostEvents : (client) => readsHostEvents(client) || client.follower.carries(app));
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

  // The intercept the spine installs for an engine-host name it intercepts, through the seam as a spine command is (a
  // cold spine loaded for it, a releasing one waited for); no handler when there is none, or the spine is refused by the
  // lock or yielded (logged: the request goes on raw). Any other failure to load (a chunk's or its data's error, the
  // daemon's exit) is the request's answer, `host_unavailable`, so nothing the spine must see goes on unseen. Another
  // engine-host name keeps what is installed now (the scenario stub's).
  type Taken = { handler?: AnyHandler; failed?: CommandResult<CommandName> };
  async function spineIntercept(name: string, input: unknown): Promise<Taken> {
    if (!spineTakes(name, input)) return { handler: intercepts.get(name) };
    try {
      await options.spine.ensure('command');
    } catch (error) {
      if (error instanceof SpineUnavailable && error.why !== 'exiting') {
        log(`[spine] ${name} goes on without the spine’s intercept: ${error.message}`);
        return {};
      }
      log(`[spine] ${name} is refused: the spine did not load: ${messageOf(error)}`);
      return { failed: { ok: false, error: ipcError('host_unavailable', `the spine did not load for ${name}: ${messageOf(error)}`) } };
    }
    return { handler: intercepts.get(name) };
  }

  // A client's request (`from`: its connection; null for the endpoint's), or the bus's invoke (`loaded`: the spine asks
  // it of itself, so it is not waited for).
  async function answer(name: string, rawInput: unknown, context: HandlerContext, loaded: boolean, from: FrontClient | null): Promise<CommandResult<CommandName>> {
    if (!codec.isCommandName(name)) return { ok: false, error: ipcError('unknown_command', `unknown command: ${name}`) };
    const input = codec.readCommandInput(name, rawInput);
    if (!input.ok) return input;
    const { owner } = REGISTRY.commands[name];
    if (owner !== 'machine') {
      const taken: Taken = loaded ? { handler: intercepts.get(name) } : await spineIntercept(name, rawInput); // the spine's own invoke never waits on it
      if (taken.failed) return taken.failed;
      return taken.handler ? run(name, taken.handler, input.value, context) : forward(name, rawInput);
    }
    if (CLIENT_COMMANDS.has(name) && from === null) return { ok: false, error: ipcError('internal', `${name} is a machine.sock client's own`) };
    if (OWN.has(name)) return run(name, (value, ctx) => own[name as keyof typeof own](value, ctx, from), input.value, context);
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
      for (const listener of [...emitted]) {
        try {
          listener(name, checked.value);
        } catch (error) {
          log(`machine.sock: a listener of ${name} failed: ${messageOf(error)}`);
        }
      }
      return true;
    },
    onEmitted(name, listener) {
      let set = taps.get(name);
      if (!set) taps.set(name, (set = new Set()));
      const entry = listener as (payload: unknown) => void;
      set.add(entry);
      return () => void set.delete(entry);
    },
    invoke: (name, input, context) => answer(name, input, context, true, null) as never,
  };

  // One welcomed machine.sock client: a host runtime's reading of its lines, with no handler table of its own.
  class FrontClient implements ServedRuntime, PortTarget {
    private port: HostPort | null = null;
    private ready = false;
    private refs: RemoteClients | null = null;
    readonly follower: Follower;
    browserSocket: string | null = null;

    constructor(readonly facts: ClientFacts) {
      this.follower = streams.follower((name, payload) => this.send(name, payload));
    }

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
        const ref = refs.refFor(client);
        owners.set(ref, { client: this, id: client ?? null });
        void answer(name, input, { client: ref }, false, this).then((result) => {
          if (this.port === port) port.postMessage({ t: 'res', id, ...result });
        });
      });
      port.start();
    }

    // An event to every client that said ready
    event(name: string, payload: unknown): void {
      if (this.ready) this.send(name, payload);
    }

    // An event this client asked for (its streams, the port's requests)
    send(name: string, payload: unknown): boolean {
      if (this.port === null) return false;
      if (this.port.postMessage({ t: 'evt', name, payload }) !== false) return true;
      this.detach();
      return false;
    }

    post(request: ClientPortRequest): boolean {
      return this.send('clientPort.request', request);
    }

    detach(): void {
      if (this.port === null && !clients.has(this)) return;
      this.port = null;
      this.ready = false;
      this.refs?.end();
      this.refs = null;
      clients.delete(this);
      this.follower.end();
      clientPort.gone(this);
    }

    docPort(_message: HostDoc, end: DocPortEnd): void {
      end.close(); // machine.sock carries no document channel
    }
  }

  return {
    runtimeFor: (facts) => new FrontClient(facts),
    bus,
    port: clientPort,
    dispatch: (name, input, client) => answer(name, input, { client: client ?? endpointClient }, false, null),
    async intercepted(name, rawInput, client) {
      if (!codec.isCommandName(name) || REGISTRY.commands[name].owner !== 'engine-host') return null;
      const taken = await spineIntercept(name, rawInput);
      if (taken.failed) return taken.failed;
      if (!taken.handler) return null;
      const input = codec.readCommandInput(name, rawInput);
      return input.ok ? run(name, taken.handler, input.value, { client: client ?? endpointClient }) : input;
    },
    intercepts: () => [...intercepts.keys()].sort() as CommandName[],
    events(listener) {
      emitted.add(listener);
      return () => void emitted.delete(listener);
    },
    browserSocket: () => [...clients].find((client) => options.isApp(client.facts.appPid))?.browserSocket ?? null,
    clients: () => clients.size,
    commands: () => [...FRONT_COMMANDS, ...table.keys()].sort() as CommandName[],
    unbind() {
      table.clear();
      intercepts.clear();
      taps.clear();
    },
    close() {
      offRaw();
      offStreaming();
      for (const client of [...clients]) client.detach();
      streams.stop();
      clientPort.close();
    },
  };
}

// A client that reads the engine host's app-bound events on machine.sock rather than on its relay (the post-D app, M5).
const readsHostEvents = (client: { facts: ClientFacts }) => client.facts.capabilities.includes(MACHINE_SPINE_CAPABILITY);

// The session a payload names, if any.
function sessionOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { appSessionId?: unknown; status?: { appSessionId?: unknown } };
  if (typeof record.appSessionId === 'string') return record.appSessionId;
  return typeof record.status?.appSessionId === 'string' ? record.status.appSessionId : null;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
