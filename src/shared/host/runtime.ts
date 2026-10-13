// The host side of the host protocol, shared by both utility-process entries (`src/engine-host`, `src/pty-host`). An
// entry calls `runHost` once at load with the handlers for the X2 commands it owns; the runtime waits for main's
// `hello` on `process.parentPort`, then serves requests on the port that came with it. Every request is validated
// (envelope, name, input) before a handler runs, and every answer and event is validated before it is posted, so a
// host can neither be fed nor emit anything outside X2. Nothing is thrown across the port: failures are `res` errors.
import type { MessagePortMain } from 'electron';
import { ipcError, IpcErrorSchema, type IpcError } from '../ipc/errors';
import { HostDocSchema, HostHelloSchema, HostReadySchema, HostRequestSchema, type HostDoc, type HostMessage, type HostRequest } from '../ipc/host-protocol';
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
// E10: a register is handed the runtime's client hooks too (the engine host's connect burst, its bridges' fail-fast)
// E4c: and the client's going (the browser bridge settles its pending requests on it)
// P3-A M4: and the document ports main posts on the parent port (`onDocPort`)
export type HostClientHooks = Pick<HostRuntime, 'onConnect' | 'hasClient' | 'onClientGone' /* E4c */ | 'onDocPort' /* P3-A M4 */>;
export type HostRegister = (on: HostOn, emit: HostEmit, client: HostClientHooks) => void;

// The part of MessagePortMain the runtime uses, so tests can drive it with a fake.
// E10: `postMessage` may answer `false` when it wrote nothing (a socket port already closing); a MessagePort answers
// nothing, which counts as written.
export type HostPort = Pick<MessagePortMain, 'start'> & {
  postMessage(message: unknown): boolean | void;
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
  // E4c start: the hooks told a ready client went, once per client, from the three places the runtime learns it
  const goneHooks = new Set<() => void>();
  const clientGone = () => {
    for (const hook of [...goneHooks]) {
      try {
        hook();
      } catch (error) {
        console.error('[host] a client-gone hook failed', error);
      }
    }
  };
  const onClientGone = (hook: () => void) => {
    goneHooks.add(hook);
    return () => void goneHooks.delete(hook);
  };
  // E4c end
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
      if (dropped++ === 0) console.info(`[host] dropping events until a client is ready (first: ${name})`); // E11: the rule with no client, not a failure
      return false;
    }
    if (port.postMessage({ t: 'evt', name, payload: checked.value } satisfies HostMessage) !== false) return true;
    // E10: a port that wrote nothing is closing, closed or stalled, and never writes again: the client is gone (the
    // caller's detach follows at the close), so hasClient() after a false tells a gone client from a refused payload
    ready = false;
    console.info(`[host] the client stopped taking events (at ${name}); dropping until a client is ready`); // E11: a client leaving, as a keep-quit does
    dropped += 1;
    clientGone(); // E4c
    return false;
  };

  const hasClient = () => port !== null && ready; // E10
  const onConnect = (hook: () => void) => void connectHooks.push(hook); // E10
  // P3-A M4 start: one handler for the document ports, installed by the register
  let docHandler: DocPortHandler | null = null;
  const onDocPort = (handler: DocPortHandler) => {
    if (docHandler) throw new Error('a document port handler is already installed');
    docHandler = handler;
  };
  const docPort = (message: HostDoc, docPortEnd: MessagePortMain) => {
    if (!docHandler) {
      console.error(`[host] closed the port of document channel ${message.channel}: this host serves no documents`);
      return docPortEnd.close();
    }
    try {
      docHandler(message, docPortEnd);
    } catch (error) {
      console.error(`[host] closed the port of document channel ${message.channel}: its handler failed`, error);
      docPortEnd.close();
    }
  };
  // P3-A M4 end
  register(on, emit, { onConnect, hasClient, onClientGone /* E4c */, onDocPort /* P3-A M4 */ });

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
    if (dropped > 0) console.info(`[host] ${dropped} events dropped while no client was ready`);
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
      const replaced = ready; // E4c: a ready client this one replaces is gone
      port = p;
      ready = false; // E10
      if (replaced) clientGone(); // E4c
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
      const wasReady = ready; // E4c
      port = null;
      ready = false;
      if (wasReady) clientGone(); // E4c
    },
    setReady,
    hasClient,
    onConnect,
    // E10 end
    onClientGone, // E4c
    onDocPort, // P3-A M4
    docPort, // P3-A M4
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
  process.parentPort.on('message', parentPortListener(runtime));
  console.log(`[host] ${hostVersion} pid ${process.pid} waiting for main`);
}

// What a utility host does with a parent-port message: the first `hello` serves its port; P3-A M4: a `doc` message's
// one port goes to the document port handler. Every port of a message it cannot use is closed, so no document channel is
// left open with nobody on this end. Exported for its tests (`process.parentPort` exists only in a utility process).
export function parentPortListener(runtime: Pick<HostRuntime, 'serve' | 'docPort'>): (event: { data: unknown; ports: MessagePortMain[] }) => void {
  let served = false;
  return ({ data, ports }) => {
    if (HostHelloSchema.safeParse(data).success && ports.length === 1) {
      if (served) {
        console.error('[host] ignored a second hello');
        return;
      }
      served = true;
      runtime.serve(ports[0]);
      return;
    }
    // P3-A M4 start
    const doc = HostDocSchema.safeParse(data);
    if (doc.success && ports.length === 1) return runtime.docPort(doc.data, ports[0]);
    if (doc.success || (typeof data === 'object' && data !== null && (data as { t?: unknown }).t === 'doc')) {
      console.error('[host] closed the ports of a doc message that is not one well-formed document with one port');
      for (const port of ports) port.close();
      return;
    }
    // P3-A M4 end
    console.error('[host] ignored a parent-port message that is not a hello with one port');
  };
}

// The answer to a host's `<namespace>.ping`.
export function hostPing(hostVersion: string): HostPing {
  return { pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000), hostVersion };
}

// E4c start (E4c execution document, Decision Log 31 and 43; X13): the runtime tells who asked when a ready client goes
// (its socket closed, a new client replaced it, or a write to it failed), once per client, so a request waiting on the
// app settles rather than holding an engine turn on a main that is gone. Returns the unsubscribe.
export interface HostRuntime {
  onClientGone(hook: () => void): () => void;
}
// E4c end

// P3-A M4 start (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 13): a document's port as main posts it on
// the parent port, and the handler the engine host's register installs for it (`onDocPort`, once). A handler that
// throws costs that port only: the runtime closes it. Detached mode (M5) reaches the same handler through its socket
// channels.
export type DocPortHandler = (message: HostDoc, port: MessagePortMain) => void;
export interface HostRuntime {
  onDocPort(handler: DocPortHandler): void;
  docPort(message: HostDoc, port: MessagePortMain): void;
}
// P3-A M4 end
