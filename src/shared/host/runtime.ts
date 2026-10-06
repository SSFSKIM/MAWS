// The host side of the host protocol, shared by both utility-process entries (`src/engine-host`, `src/pty-host`). An
// entry calls `runHost` once at load with the handlers for the X2 commands it owns; the runtime waits for main's
// `hello` on `process.parentPort`, then serves requests on the port that came with it. Every request is validated
// (envelope, name, input) before a handler runs, and every answer and event is validated before it is posted, so a
// host can neither be fed nor emit anything outside X2. Nothing is thrown across the port: failures are `res` errors.
import type { MessagePortMain } from 'electron';
import { ipcError, IpcErrorSchema, type IpcError } from '../ipc/errors';
import { HostHelloSchema, HostReadySchema, HostRequestSchema, type HostMessage, type HostRequest } from '../ipc/host-protocol';
import {
  commands,
  HOST_EVENTS,
  type CommandInput,
  type CommandName,
  type CommandOutput,
  type EventName,
  type EventPayload,
  type HostPing,
  type Owner,
} from '../ipc/schema';
import { isCommandName, validateCommandInput, validateCommandOutput, validateEventPayload } from '../ipc/validate';

export type HostOn = <N extends CommandName>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => void;
// E10: true when the event was written to a connected, ready client; false when it was refused or dropped.
export type HostEmit = <N extends EventName>(name: N, payload: EventPayload<N>) => boolean;
export type HostRegister = (on: HostOn, emit: HostEmit) => void;

// The part of MessagePortMain the runtime uses, so tests can drive it with a fake.
export type HostPort = Pick<MessagePortMain, 'postMessage' | 'start'> & {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
};

// C3 start: typed errors through the host runtime (C3 execution document, Interfaces "Typed errors through the host
// runtime"). A handler that throws a HostCommandError answers with its IpcError intact (the engine host's `timeout` for
// a bounded control deadline, so the renderer can tell the host's deadline from the router's); every other throw
// answers `internal` exactly as before.
export class HostCommandError extends Error {
  constructor(readonly ipcError: IpcError) {
    super(ipcError.message);
    this.name = 'HostCommandError';
  }
}

function thrownError(error: unknown): IpcError {
  if (error instanceof HostCommandError) {
    const typed = IpcErrorSchema.safeParse(error.ipcError);
    if (typed.success) return typed.data;
  }
  return ipcError('internal', error instanceof Error ? error.message : String(error));
}
// C3 end

// E10: the runtime serves one client at a time, over a MessagePort (utility mode) or a Unix socket (detached mode, the
// supervisor). A client is served first and is ready once it sends `{t: 'ready'}` (after it pulled what it needs by
// command); events reach it only from then on, and an event emitted with no ready client is dropped, never queued
// (X13 as made precise in the E10 execution document, §Design 3).
export interface HostRuntime {
  serve(port: HostPort): void; // a second serve replaces the port (the previous client was closed by the caller)
  detach(): void; // no client: emits return false and are dropped
  setReady(): void; // the client sent `ready`: the onConnect hooks run synchronously, then events flow
  hasClient(): boolean; // connected and ready
  onConnect(hook: () => void): void; // the connect burst, registered by the engine ipc
}

// Registers the handlers now (so a registration mistake fails the host at load, loudly) and serves once given a port.
export function createHostRuntime(register: HostRegister): HostRuntime {
  const handlers = new Map<CommandName, (input: unknown) => Promise<unknown>>();
  let port: HostPort | null = null;
  // E10 start
  let ready = false;
  const connectHooks: (() => void)[] = [];
  let dropped = 0; // events dropped since the last ready client; logged once when the stretch starts and ends
  // E10 end
  // Which host this is. `runHost`'s signature does not name it, so the first registration fixes it and every later
  // one must match: a handler registered in the wrong host fails at load instead of sitting unreachable, since main
  // routes each command to its registry owner.
  let servedOwner: Owner | null = null;

  const on: HostOn = (name, handler) => {
    const { owner } = commands[name];
    if (owner === 'main') throw new Error(`${name} is owned by main; a host cannot serve it`);
    if (servedOwner !== null && owner !== servedOwner) {
      throw new Error(`${name} is owned by ${owner}, but this host serves ${servedOwner}`);
    }
    servedOwner = owner;
    if (handlers.has(name)) throw new Error(`a handler for ${name} is already registered`);
    handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  };

  const emit: HostEmit = (name, payload) => {
    // E10: the engine host emits only what HOST_EVENTS lists, so the wire fingerprint covers every event it sends
    if (servedOwner === 'engine-host' && !(HOST_EVENTS as readonly EventName[]).includes(name)) {
      console.error(`[host] refused to emit ${name}: ${name} is not in HOST_EVENTS`);
      return false;
    }
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) {
      console.error(`[host] refused to emit invalid ${name}`, checked.issues);
      return false;
    }
    if (!port || !ready) {
      if (dropped++ === 0) console.error(`[host] dropping events until a client is ready (first: ${name})`);
      return false;
    }
    port.postMessage({ t: 'evt', name, payload: checked.value } satisfies HostMessage);
    return true;
  };

  register(on, emit);

  // E10 start
  const setReady = () => {
    if (!port) {
      console.error('[host] ignored ready: no client is served');
      return;
    }
    if (ready) {
      console.error('[host] ignored a second ready from the same client');
      return;
    }
    ready = true;
    if (dropped > 0) console.error(`[host] ${dropped} events dropped while no client was ready`);
    dropped = 0;
    for (const hook of connectHooks) {
      try {
        hook();
      } catch (error) {
        console.error('[host] a connect hook failed', error);
      }
    }
  };
  // E10 end

  return {
    serve(p) {
      port = p;
      ready = false; // E10
      p.on('message', ({ data }) => {
        // E10: the client's ready line; one from a port this runtime no longer serves is stale and ignored
        if (HostReadySchema.safeParse(data).success) {
          if (port === p) setReady();
          return;
        }
        const request = HostRequestSchema.safeParse(data);
        if (!request.success) {
          console.error('[host] dropped a malformed message from main', request.error.issues);
          return;
        }
        void answer(request.data).then((response) => p.postMessage(response));
      });
      p.start();
    },
    // E10 start
    detach() {
      port = null;
      ready = false;
    },
    setReady,
    hasClient: () => port !== null && ready,
    onConnect(hook) {
      connectHooks.push(hook);
    },
    // E10 end
  };

  async function answer({ id, name, input }: HostRequest): Promise<HostMessage> {
    if (!isCommandName(name)) return { t: 'res', id, ok: false, error: ipcError('unknown_command', `unknown command: ${name}`) };
    const handler = handlers.get(name);
    if (!handler) return { t: 'res', id, ok: false, error: ipcError('internal', `this host has no handler for ${name}`) };
    const checkedInput = validateCommandInput(name, input);
    if (!checkedInput.ok) return { t: 'res', id, ok: false, error: checkedInput.error };

    let value: unknown;
    try {
      value = await handler(checkedInput.value);
    } catch (error) {
      return { t: 'res', id, ok: false, error: thrownError(error) }; // C3: typed errors keep their code
    }
    // An output the registry refuses is a fault in this host, not the renderer's `invalid_output`.
    const output = validateCommandOutput(name, value);
    if (!output.ok) {
      console.error(`[host] ${name} produced an invalid output`, output.error.issues);
      return { t: 'res', id, ok: false, error: ipcError('internal', output.error.message, output.error.issues) };
    }
    return { t: 'res', id, ok: true, value: output.value };
  }
}

// The utility-process entry point. `hostVersion` is what this host's ping reports; see `hostPing`. The port that comes
// with main's hello is served at once; its events flow from main's `{t: 'ready'}` on that port (E10).
export function runHost(hostVersion: string, register: HostRegister): void {
  const runtime = createHostRuntime(register);
  let served = false;
  process.parentPort.on('message', ({ data, ports }) => {
    if (!HostHelloSchema.safeParse(data).success || ports.length !== 1) {
      console.error('[host] ignored a parent-port message that is not a hello with one port');
      return;
    }
    if (served) {
      console.error('[host] ignored a second hello');
      return;
    }
    served = true;
    runtime.serve(ports[0]);
  });
  console.log(`[host] ${hostVersion} pid ${process.pid} waiting for main`);
}

// The answer to a host's `<namespace>.ping`.
export function hostPing(hostVersion: string): HostPing {
  return { pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000), hostVersion };
}
