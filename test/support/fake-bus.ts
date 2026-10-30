// A `ServicesBus` for the library's tests (P5 O3-C, Interfaces §G): what main's binding does (src/main/ipc/router.ts,
// events.ts) over the production registry's codec, with no Electron. `invoke` is a client's command as the router routes
// it: the input validated, an interceptor before the handler, the output validated, and the answer a `CommandResult`
// (a `HostCommandError` intact, any other throw `internal`; a host-owned command no interceptor answers is
// `host_unavailable`, since no host runs here). `emit` validates, records what it sent and hands it to the taps.
import { HostCommandError, thrownError } from '../../src/shared/host/runtime';
import { endableClientRef, type ClientRef, type HandlerContext } from '../../src/shared/ipc/client';
import { ipcError } from '../../src/shared/ipc/errors';
import { REGISTRY } from '../../src/shared/ipc/registry';
import type { CommandName, CommandResult, EventName, EventPayload } from '../../src/shared/ipc/schema';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '../../src/shared/ipc/validate';
import type { ServicesBus } from '../../src/shared/spine/bus';

export interface FakeBus extends ServicesBus {
  // A client's command, routed as main's router routes it; the asker is `page:1.1` unless the test names its own (a ref,
  // or the bus's own `invoke` context, P5 O3-D M2).
  invoke<N extends CommandName>(name: N, input?: unknown, client?: ClientRef | HandlerContext): Promise<CommandResult<N>>;
  // A main-only command as main (or `mawsd`'s front) asks it: `invoke` past the main-only gate (P5 O3-D M5b).
  main<N extends CommandName>(name: N, input?: unknown, client?: ClientRef | HandlerContext): Promise<CommandResult<N>>;
  readonly emitted: { name: EventName; payload: unknown }[]; // what `emit` sent, in order
  emittedOf<N extends EventName>(name: N): EventPayload<N>[];
  registered(): CommandName[];
  intercepted(): CommandName[];
  tapped(): EventName[]; // the events some tap still hears
}

type AnyHandler = (input: unknown, context: HandlerContext) => unknown;

export function fakeBus(): FakeBus {
  const handlers = new Map<CommandName, AnyHandler>();
  const interceptors = new Map<CommandName, AnyHandler>();
  const taps = new Map<EventName, Set<(payload: unknown) => void>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const asker = endableClientRef('page:1.1');

  const answer = async <N extends CommandName>(name: N, handler: AnyHandler, input: unknown, client: ClientRef): Promise<CommandResult<N>> => {
    try {
      const output = validateCommandOutput(name, await handler(input, { client }));
      return output.ok ? output : { ok: false, error: ipcError('internal', output.error.message, output.error.issues) };
    } catch (error) {
      return { ok: false, error: error instanceof HostCommandError ? thrownError(error) : ipcError('internal', error instanceof Error ? error.message : String(error)) };
    }
  };

  // A client's command past the main-only gate: the input validated, an interceptor before the handler
  const route = async <N extends CommandName>(name: N, rawInput: unknown, asked: ClientRef | HandlerContext): Promise<CommandResult<N>> => {
    const client = 'client' in asked ? asked.client : asked;
    const input = validateCommandInput(name, rawInput);
    if (!input.ok) return input;
    const handler = interceptors.get(name) ?? handlers.get(name);
    if (handler) return answer(name, handler, input.value, client);
    const { owner } = REGISTRY.commands[name];
    if (owner !== 'main' && owner !== 'machine') return { ok: false, error: ipcError('host_unavailable', `${owner} is not running; cannot answer ${name}`) };
    return { ok: false, error: ipcError('internal', `no handler registered for ${name}`) };
  };

  return {
    emitted,
    register(name, handler) {
      const { owner } = REGISTRY.commands[name];
      if (owner !== 'main' && owner !== 'machine') throw new Error(`${name} is owned by ${owner}, which a service does not answer`);
      if (handlers.has(name)) throw new Error(`a handler for ${name} is already registered`);
      handlers.set(name, handler as unknown as AnyHandler);
    },
    intercept(name, handler) {
      if (interceptors.has(name)) throw new Error(`${name} is already intercepted`);
      const entry = handler as unknown as AnyHandler;
      interceptors.set(name, entry);
      return () => {
        if (interceptors.get(name) === entry) interceptors.delete(name);
      };
    },
    emit(name, payload) {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) return false;
      emitted.push({ name, payload: checked.value });
      for (const tap of [...(taps.get(name) ?? [])]) tap(checked.value);
      return true;
    },
    onEmitted(name, listener) {
      let set = taps.get(name);
      if (!set) taps.set(name, (set = new Set()));
      const entry = listener as (payload: unknown) => void;
      set.add(entry);
      return () => void set.delete(entry);
    },
    async invoke(name, rawInput, asked = asker) {
      if (REGISTRY.mainOnly.has(name)) return { ok: false, error: ipcError('forbidden_sender', `${name} may only be invoked by main`) };
      return route(name, rawInput, asked);
    },
    main: (name, rawInput, asked = asker) => route(name, rawInput, asked),
    emittedOf: <N extends EventName>(name: N) => emitted.filter((entry) => entry.name === name).map((entry) => entry.payload as EventPayload<N>),
    registered: () => [...handlers.keys()],
    intercepted: () => [...interceptors.keys()],
    tapped: () => [...taps].flatMap(([name, set]) => (set.size > 0 ? [name] : [])),
  };
}
