// A `MawsBridge` for renderer store tests (P5 O6 M2: on `TEST_MACHINE`, so the ids it carries are addresses on it): records the order of subscriptions and invocations, lets a test answer each
// command when it chooses (so snapshot/event races can be staged in either order), and delivers events by name.
import type { CommandName, CommandResult, EventName, MawsBridge } from '../../src/shared/ipc/schema';
import type { IpcError } from '../../src/shared/ipc/errors';
import type { MachineRef } from '../../src/shared/machine/ref';
import { TEST_MACHINE } from './machine';

export interface FakeClient {
  client: MawsBridge;
  calls: string[];
  // Answers the oldest unanswered invocation of `name`, or the `nth` of those still unanswered (from 0, so a later one can
  // be answered first), and lets the promise chain settle.
  reply(name: CommandName, value: unknown, nth?: number): Promise<void>;
  fail(name: CommandName, message?: string, code?: IpcError['code'], issues?: unknown): Promise<void>; // `internal` unless named
  // P5 O6 M4: a listener hears the machine the event came from, `TEST_MACHINE` unless the test names another.
  event(name: EventName, payload: unknown, machine?: MachineRef): void;
  pending(name: CommandName): number;
  invoked(name: CommandName): unknown[]; // the inputs, in order
  machines(name: CommandName): (MachineRef | undefined)[]; // P5 O6 M4: the machine each invocation's options named, in order
  sessions(name: CommandName): (string | undefined)[]; // P5 O7 M4: the session (or M4c's tab) each invocation's options named, in order
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// `auto` answers a command at once: with the value, or with the value a function computes from the input (and the
// machine it was sent to). Main's
// `session.appEvents` answers at once with nothing kept unless `auto` says otherwise (debt wave 5: every transcript
// snapshot reads it after the journal's, and a test staging the journal read has no reason to stage this one too).
export function fakeClient(given: Partial<Record<CommandName, unknown>> = {}): FakeClient {
  const auto: Partial<Record<CommandName, unknown>> = { 'session.appEvents': { events: [] }, ...given };
  const listeners = new Map<string, Set<(payload: unknown, from: { machine: MachineRef }) => void>>();
  const waiting = new Map<string, ((result: CommandResult<CommandName>) => void)[]>();
  const inputs = new Map<string, unknown[]>();
  const named = new Map<string, (MachineRef | undefined)[]>();
  const madeFrom = new Map<string, (string | undefined)[]>();
  const calls: string[] = [];
  const client = {
    localMachine: TEST_MACHINE,
    // the client's `opts`, or the machine the page's client hands a bridge (installed as `window.maws`)
    invoke(name: CommandName, input: unknown, opts?: { machine?: MachineRef; session?: string; from?: string } | MachineRef) {
      calls.push(`invoke ${name}`);
      inputs.set(name, [...(inputs.get(name) ?? []), input]);
      const machine = typeof opts === 'string' ? opts : opts?.machine;
      named.set(name, [...(named.get(name) ?? []), machine]);
      madeFrom.set(name, [...(madeFrom.get(name) ?? []), typeof opts === 'string' ? undefined : (opts?.session ?? opts?.from)]); // M4c fix wave 2: or the tab it is made from
      if (name in auto) {
        const given = auto[name];
        return Promise.resolve({ ok: true, value: typeof given === 'function' ? (given as (i: unknown, m: MachineRef | undefined) => unknown)(input, machine) : given });
      }
      return new Promise<CommandResult<CommandName>>((resolve) => waiting.set(name, [...(waiting.get(name) ?? []), resolve]));
    },
    on(name: EventName, listener: (payload: unknown, from: { machine: MachineRef }) => void) {
      calls.push(`on ${name}`);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    },
  } as unknown as MawsBridge;
  const answer = async (name: CommandName, result: CommandResult<CommandName>, nth = 0) => {
    const queue = waiting.get(name) ?? [];
    const [resolve] = queue.splice(nth, 1);
    if (!resolve) throw new Error(`fake client: no pending ${name}`);
    resolve(result);
    await settle();
  };
  return {
    client,
    calls,
    reply: (name, value, nth) => answer(name, { ok: true, value } as CommandResult<CommandName>, nth),
    fail: (name, message = 'failed', code = 'internal', issues?: unknown) => answer(name, { ok: false, error: { code, message, ...(issues !== undefined && { issues }) } }),
    event: (name, payload, machine = TEST_MACHINE) => listeners.get(name)?.forEach((listener) => listener(payload, { machine })),
    pending: (name) => waiting.get(name)?.length ?? 0,
    invoked: (name) => inputs.get(name) ?? [],
    machines: (name) => named.get(name) ?? [],
    sessions: (name) => madeFrom.get(name) ?? [],
  };
}
