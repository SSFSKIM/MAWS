// A `MawsBridge` for renderer store tests: records the order of subscriptions and invocations, lets a test answer each
// command when it chooses (so snapshot/event races can be staged in either order), and delivers events by name.
import type { CommandName, CommandResult, EventName, MawsBridge } from '../../src/shared/ipc/schema';

export interface FakeClient {
  client: MawsBridge;
  calls: string[];
  // Answers the oldest unanswered invocation of `name` and lets the promise chain settle.
  reply(name: CommandName, value: unknown): Promise<void>;
  fail(name: CommandName, message?: string): Promise<void>;
  event(name: EventName, payload: unknown): void;
  pending(name: CommandName): number;
  invoked(name: CommandName): unknown[]; // the inputs, in order
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// `auto` answers a command at once: with the value, or with the value a function computes from the input.
export function fakeClient(auto: Partial<Record<CommandName, unknown>> = {}): FakeClient {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const waiting = new Map<string, ((result: CommandResult<CommandName>) => void)[]>();
  const inputs = new Map<string, unknown[]>();
  const calls: string[] = [];
  const client = {
    invoke(name: CommandName, input: unknown) {
      calls.push(`invoke ${name}`);
      inputs.set(name, [...(inputs.get(name) ?? []), input]);
      if (name in auto) {
        const given = auto[name];
        return Promise.resolve({ ok: true, value: typeof given === 'function' ? (given as (i: unknown) => unknown)(input) : given });
      }
      return new Promise<CommandResult<CommandName>>((resolve) => waiting.set(name, [...(waiting.get(name) ?? []), resolve]));
    },
    on(name: EventName, listener: (payload: unknown) => void) {
      calls.push(`on ${name}`);
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    },
  } as unknown as MawsBridge;
  const answer = async (name: CommandName, result: CommandResult<CommandName>) => {
    const queue = waiting.get(name) ?? [];
    const resolve = queue.shift();
    if (!resolve) throw new Error(`fake client: no pending ${name}`);
    resolve(result);
    await settle();
  };
  return {
    client,
    calls,
    reply: (name, value) => answer(name, { ok: true, value } as CommandResult<CommandName>),
    fail: (name, message = 'failed') => answer(name, { ok: false, error: { code: 'internal', message } }),
    event: (name, payload) => listeners.get(name)?.forEach((listener) => listener(payload)),
    pending: (name) => waiting.get(name)?.length ?? 0,
    invoked: (name) => inputs.get(name) ?? [],
  };
}
