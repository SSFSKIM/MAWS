// The host side of the host protocol, shared by both utility-process entries (`src/engine-host`, `src/pty-host`). An
// entry calls `runHost` once at load with the handlers for the X2 commands it owns; the runtime waits for main's
// `hello` on `process.parentPort`, then serves requests on the port that came with it. Every request is validated
// (envelope, name, input) before a handler runs, and every answer and event is validated before it is posted, so a
// host can neither be fed nor emit anything outside X2. Nothing is thrown across the port: failures are `res` errors.
import type { MessagePortMain } from 'electron';
import { ipcError } from '../ipc/errors';
import { HostHelloSchema, HostRequestSchema, type HostMessage, type HostRequest } from '../ipc/host-protocol';
import {
  commands,
  type CommandInput,
  type CommandName,
  type CommandOutput,
  type EventName,
  type EventPayload,
  type HostPing,
} from '../ipc/schema';
import { isCommandName, validateCommandInput, validateCommandOutput, validateEventPayload } from '../ipc/validate';

export type HostOn = <N extends CommandName>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => void;
export type HostEmit = <N extends EventName>(name: N, payload: EventPayload<N>) => void;
export type HostRegister = (on: HostOn, emit: HostEmit) => void;

// The part of MessagePortMain the runtime uses, so tests can drive it with a fake.
export type HostPort = Pick<MessagePortMain, 'postMessage' | 'start'> & {
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
};

export interface HostRuntime {
  serve(port: HostPort): void;
}

// Registers the handlers now (so a registration mistake fails the host at load, loudly) and serves once given a port.
export function createHostRuntime(register: HostRegister): HostRuntime {
  const handlers = new Map<CommandName, (input: unknown) => Promise<unknown>>();
  let port: HostPort | null = null;

  const on: HostOn = (name, handler) => {
    const { owner } = commands[name];
    if (owner === 'main') throw new Error(`${name} is owned by main; a host cannot serve it`);
    if (handlers.has(name)) throw new Error(`a handler for ${name} is already registered`);
    handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  };

  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) {
      console.error(`[host] refused to emit invalid ${name}`, checked.issues);
      return;
    }
    if (!port) {
      console.error(`[host] dropped ${name}: main has not connected yet`);
      return;
    }
    port.postMessage({ t: 'evt', name, payload: checked.value } satisfies HostMessage);
  };

  register(on, emit);

  return {
    serve(p) {
      port = p;
      p.on('message', ({ data }) => {
        const request = HostRequestSchema.safeParse(data);
        if (!request.success) {
          console.error('[host] dropped a malformed message from main', request.error.issues);
          return;
        }
        void answer(request.data).then((response) => p.postMessage(response));
      });
      p.start();
    },
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
      return { t: 'res', id, ok: false, error: ipcError('internal', error instanceof Error ? error.message : String(error)) };
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

// The utility-process entry point. `hostVersion` is what this host's ping reports; see `hostPing`.
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
